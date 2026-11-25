package com.haierag.ai;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.haierag.config.AppProperties;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Client for the internal AI service API (contracts.md section 2). */
@Component
public class AiClient {

    private static final Logger log = LoggerFactory.getLogger(AiClient.class);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {
    };

    /** Receives one SSE event (name + raw data). */
    @FunctionalInterface
    public interface SseListener {
        void onEvent(String event, String data);
    }

    private final AppProperties.Ai cfg;
    private final JsonMapper mapper;
    private final HttpClient http;

    public AiClient(AppProperties props, JsonMapper mapper) {
        this.cfg = props.ai();
        this.mapper = mapper;
        this.http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(cfg.connectTimeout())
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    private String base() {
        String b = cfg.baseUrl();
        return b.endsWith("/") ? b.substring(0, b.length() - 1) : b;
    }

    /**
     * POSTs a chat request and invokes {@code listener} for every SSE event until the stream ends.
     * Errors before the stream starts are thrown as {@link AiException}.
     */
    public void streamChat(Map<String, Object> request, SseListener listener) {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base() + "/internal/v1/chat"))
                .timeout(cfg.chatTimeout())
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .header("X-Internal-Token", cfg.internalToken() == null ? "" : cfg.internalToken())
                .POST(HttpRequest.BodyPublishers.ofByteArray(mapper.writeValueAsBytes(request)))
                .build();
        HttpResponse<InputStream> resp;
        try {
            resp = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
        } catch (IOException e) {
            log.warn("AI service unreachable: {}", e.toString());
            throw new AiException("AI_UNAVAILABLE", "The AI service is unavailable. Is it running?");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiException("AI_UNAVAILABLE", "Interrupted while contacting the AI service");
        }
        try (InputStream body = resp.body()) {
            if (resp.statusCode() != 200) {
                throw errorFromResponse(resp.statusCode(), body);
            }
            readSse(body, listener);
        } catch (IOException e) {
            log.warn("AI stream interrupted: {}", e.toString());
            throw new AiException("AI_UNAVAILABLE", "The AI service stream was interrupted");
        }
    }

    /** Minimal SSE parser (event/data fields, comments ignored, blank line dispatches). */
    public static void readSse(InputStream body, SseListener listener) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8));
        String event = null;
        StringBuilder data = new StringBuilder();
        boolean hasData = false;
        String line;
        while ((line = reader.readLine()) != null) {
            if (line.isEmpty()) {
                if (hasData) {
                    listener.onEvent(event == null ? "message" : event, data.toString());
                }
                event = null;
                data.setLength(0);
                hasData = false;
                continue;
            }
            if (line.startsWith(":")) {
                continue;
            }
            int colon = line.indexOf(':');
            String field = colon < 0 ? line : line.substring(0, colon);
            String value = colon < 0 ? "" : line.substring(colon + 1);
            if (value.startsWith(" ")) {
                value = value.substring(1);
            }
            switch (field) {
                case "event" -> event = value;
                case "data" -> {
                    if (hasData) {
                        data.append('\n');
                    }
                    data.append(value);
                    hasData = true;
                }
                default -> {
                    // id / retry: not used
                }
            }
        }
        if (hasData) {
            listener.onEvent(event == null ? "message" : event, data.toString());
        }
    }

    private AiException errorFromResponse(int status, InputStream body) {
        String code = status == 503 ? "AI_UNAVAILABLE" : "AI_ERROR";
        String message = "The AI service returned HTTP " + status;
        try {
            byte[] bytes = body.readNBytes(64 * 1024);
            Map<String, Object> problem = mapper.readValue(bytes, MAP);
            if (problem.get("code") instanceof String c && !c.isBlank()) {
                code = c;
            }
            if (problem.get("detail") instanceof String d && !d.isBlank()) {
                message = d;
            } else if (problem.get("message") instanceof String m && !m.isBlank()) {
                message = m;
            } else if (problem.get("title") instanceof String t && !t.isBlank()) {
                message = t;
            }
        } catch (IOException | RuntimeException ignored) {
            // non-JSON error body
        }
        if (status == 401 || status == 403) {
            log.error("AI service rejected the internal token (HTTP {}); check INTERNAL_API_TOKEN", status);
            code = "AI_UNAVAILABLE";
            message = "The AI service rejected the backend's credentials";
        }
        return new AiException(code, message);
    }

    /** GET /health with a short timeout. Never throws. */
    public Map<String, Object> health() {
        HttpRequest req = HttpRequest.newBuilder(URI.create(base() + "/health"))
                .timeout(cfg.healthTimeout())
                .header("Accept", "application/json")
                .header("X-Internal-Token", cfg.internalToken() == null ? "" : cfg.internalToken())
                .GET().build();
        try {
            HttpResponse<byte[]> resp = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
                    .connectTimeout(cfg.healthTimeout()).build()
                    .send(req, HttpResponse.BodyHandlers.ofByteArray());
            if (resp.statusCode() / 100 == 2 || resp.statusCode() == 503) {
                Map<String, Object> parsed = mapper.readValue(resp.body(), MAP);
                if (parsed.containsKey("status")) {
                    return parsed;
                }
            }
            return down("HTTP " + resp.statusCode());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return down("interrupted");
        } catch (IOException | RuntimeException e) {
            return down("unreachable");
        }
    }

    private static Map<String, Object> down(String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", "down");
        m.put("components", Map.of());
        m.put("detail", detail);
        return m;
    }
}
