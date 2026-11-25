package com.haierag.support;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/** A tiny stand-in for the AI service: records chat requests and answers with a scripted SSE stream. */
public final class StubAiServer {

    public record Recorded(String token, String body) {
    }

    @FunctionalInterface
    public interface ChatScript {
        void handle(HttpExchange exchange) throws IOException;
    }

    private static final HttpServer SERVER;
    public static final List<Recorded> CHAT_REQUESTS = new CopyOnWriteArrayList<>();
    private static volatile ChatScript chatScript = ex -> respond(ex, 503, "application/problem+json",
            "{\"status\":503,\"detail\":\"no script\"}");

    static {
        try {
            SERVER = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        SERVER.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        SERVER.createContext("/internal/v1/chat", ex -> {
            String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            CHAT_REQUESTS.add(new Recorded(ex.getRequestHeaders().getFirst("X-Internal-Token"), body));
            try {
                chatScript.handle(ex);
            } finally {
                ex.close();
            }
        });
        SERVER.createContext("/health", ex -> {
            respond(ex, 200, "application/json", "{\"status\":\"ok\",\"components\":{\"llm\":{\"status\":\"ok\"}}}");
            ex.close();
        });
        SERVER.start();
    }

    private StubAiServer() {
    }

    public static String baseUrl() {
        return "http://127.0.0.1:" + SERVER.getAddress().getPort();
    }

    public static void script(ChatScript script) {
        chatScript = script;
    }

    public static void respond(HttpExchange ex, int status, String contentType, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", contentType);
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = ex.getResponseBody()) {
            out.write(bytes);
        }
    }

    /** Streams the given (event, json) pairs as SSE, flushing after each one. */
    public static ChatScript sse(String... eventsAndData) {
        return ex -> {
            ex.getResponseHeaders().set("Content-Type", "text/event-stream");
            ex.sendResponseHeaders(200, 0);
            OutputStream out = ex.getResponseBody();
            for (int i = 0; i < eventsAndData.length; i += 2) {
                out.write(("event: " + eventsAndData[i] + "\ndata: " + eventsAndData[i + 1] + "\n\n")
                        .getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
            out.close();
        };
    }
}
