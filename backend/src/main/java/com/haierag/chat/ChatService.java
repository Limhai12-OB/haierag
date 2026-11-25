package com.haierag.chat;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import jakarta.annotation.PreDestroy;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.haierag.ai.AiClient;
import com.haierag.ai.AiException;
import com.haierag.auth.CurrentUser;
import com.haierag.common.ApiException;
import com.haierag.common.RateLimiter;
import com.haierag.config.AppProperties;
import com.haierag.conversation.ConversationDtos.CitationDto;
import com.haierag.conversation.ConversationDtos.ConversationRow;
import com.haierag.conversation.ConversationDtos.HistoryItem;
import com.haierag.conversation.ConversationDtos.MessageDto;
import com.haierag.conversation.ConversationService;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * Chat orchestration (ADR-004, ADR-007): authorises and resolves the scope, persists the user message,
 * relays the AI service SSE stream to the browser on a virtual thread, and persists the assistant message
 * with validated citations when the AI signals {@code done}.
 */
@Service
public class ChatService {

    private static final Logger log = LoggerFactory.getLogger(ChatService.class);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {
    };

    private final ConversationService conversations;
    private final AiClient ai;
    private final RateLimiter rateLimiter;
    private final TransactionTemplate tx;
    private final JdbcClient jdbc;
    private final JsonMapper mapper;
    private final AppProperties props;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public ChatService(ConversationService conversations, AiClient ai, RateLimiter rateLimiter, TransactionTemplate tx,
                       JdbcClient jdbc, JsonMapper mapper, AppProperties props) {
        this.conversations = conversations;
        this.ai = ai;
        this.rateLimiter = rateLimiter;
        this.tx = tx;
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.props = props;
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    private record Scope(UUID collectionId, List<UUID> documentIds) {
    }

    /** POST /conversations/{id}/messages */
    public SseEmitter sendMessage(UUID conversationId, String content, CurrentUser user) {
        ConversationRow conv = conversations.requireOwned(conversationId, user);
        rateLimiter.checkChat(user.id().toString());
        Scope scope = resolveScope(conv);
        String question = content.trim();
        List<HistoryItem> history = conversations.history(conv.id(), props.ai().historyMessages(), null);

        MessageDto userMessage = tx.execute(status -> {
            boolean first = conversations.messageCount(conv.id()) == 0;
            UUID id = conversations.insertMessage(conv.id(), "USER", question, "COMPLETED", null, null, null, null, Map.of());
            if (first) {
                conversations.autoTitle(conv.id(), question);
            }
            return conversations.message(id);
        });

        SseEmitter emitter = newEmitter();
        Relay relay = new Relay(emitter, conv, scope, question, history, null);
        executor.submit(() -> {
            relay.send("user_message", userMessage);
            relay.run();
        });
        return emitter;
    }

    /** POST /conversations/{id}/regenerate: answers the last user message again, replacing the last assistant message. */
    public SseEmitter regenerate(UUID conversationId, CurrentUser user) {
        ConversationRow conv = conversations.requireOwned(conversationId, user);
        rateLimiter.checkChat(user.id().toString());
        Scope scope = resolveScope(conv);
        Object[] last = conversations.lastMessage(conv.id())
                .orElseThrow(() -> ApiException.conflict("There is no message to regenerate"));
        UUID replaceId = "ASSISTANT".equals(last[1]) ? (UUID) last[0] : null;
        Object[] userMsg = conversations.lastUserMessageBefore(conv.id(), (UUID) last[0])
                .orElseThrow(() -> ApiException.conflict("There is no question to answer again"));
        List<HistoryItem> history = conversations.history(conv.id(), props.ai().historyMessages(), (UUID) userMsg[0]);

        SseEmitter emitter = newEmitter();
        Relay relay = new Relay(emitter, conv, scope, (String) userMsg[1], history, replaceId);
        executor.submit(relay::run);
        return emitter;
    }

    private SseEmitter newEmitter() {
        Duration timeout = props.ai().chatTimeout().plusSeconds(30);
        SseEmitter emitter = new SseEmitter(timeout.toMillis());
        emitter.onTimeout(emitter::complete);
        return emitter;
    }

    /** ADR-004: re-validate the scope against the workspace before every AI call. */
    private Scope resolveScope(ConversationRow conv) {
        return switch (conv.scopeType()) {
            case WORKSPACE -> new Scope(null, null);
            case COLLECTION -> {
                if (conv.collectionId() == null) {
                    throw ApiException.conflict("The collection this conversation was scoped to no longer exists");
                }
                yield new Scope(conv.collectionId(), null);
            }
            case DOCUMENTS -> {
                List<UUID> ids = jdbc.sql("""
                                select cd.document_id from conversation_documents cd join documents d on d.id = cd.document_id
                                where cd.conversation_id = ? and d.workspace_id = ? order by cd.document_id""")
                        .params(conv.id(), conv.workspaceId()).query(UUID.class).list();
                if (ids.isEmpty()) {
                    throw ApiException.conflict("The documents this conversation was scoped to no longer exist");
                }
                yield new Scope(null, ids);
            }
        };
    }

    /** One streaming exchange. Runs on a virtual thread. */
    private final class Relay {

        private final SseEmitter emitter;
        private final ConversationRow conv;
        private final Scope scope;
        private final String question;
        private final List<HistoryItem> history;
        private final UUID replaceMessageId;

        private final StringBuilder partial = new StringBuilder();
        private Map<String, Object> meta;
        private List<CitationDto> citations = List.of();
        private Map<String, Object> done;
        private AiException failure;
        private volatile boolean clientGone;

        Relay(SseEmitter emitter, ConversationRow conv, Scope scope, String question, List<HistoryItem> history,
              UUID replaceMessageId) {
            this.emitter = emitter;
            this.conv = conv;
            this.scope = scope;
            this.question = question;
            this.history = history;
            this.replaceMessageId = replaceMessageId;
            emitter.onCompletion(() -> clientGone = true);
            emitter.onError(e -> clientGone = true);
        }

        void run() {
            long started = System.nanoTime();
            try {
                Map<String, Object> request = new LinkedHashMap<>();
                request.put("workspaceId", conv.workspaceId());
                request.put("collectionId", scope.collectionId());
                request.put("documentIds", scope.documentIds());
                request.put("question", question);
                request.put("history", history);
                ai.streamChat(request, this::onAiEvent);
            } catch (AiException e) {
                failure = e;
            } catch (RuntimeException e) {
                log.error("Chat relay failed for conversation {}", conv.id(), e);
                failure = new AiException("INTERNAL_ERROR", "Unexpected error while generating the answer");
            }
            int latencyMs = (int) Math.min(Integer.MAX_VALUE, (System.nanoTime() - started) / 1_000_000);
            try {
                if (failure == null && done == null) {
                    failure = new AiException("AI_UNAVAILABLE", "The AI service stream ended unexpectedly");
                }
                if (failure == null) {
                    MessageDto saved = persist(true, latencyMs);
                    send("done", Map.of("message", saved));
                } else {
                    persist(false, latencyMs);
                    send("error", Map.of("code", failure.getCode(), "message", failure.getMessage()));
                }
            } catch (RuntimeException e) {
                log.error("Could not persist assistant message for conversation {}", conv.id(), e);
                send("error", Map.of("code", "INTERNAL_ERROR", "message", "Could not save the answer"));
            } finally {
                complete();
            }
        }

        private void onAiEvent(String event, String data) {
            switch (event) {
                case "meta" -> {
                    meta = parse(data);
                    send("meta", meta);
                }
                case "token" -> {
                    Map<String, Object> m = parse(data);
                    Object text = m.get("text");
                    if (text instanceof String s && !s.isEmpty()) {
                        partial.append(s);
                        send("token", Map.of("text", s));
                    }
                }
                case "citations" -> {
                    Object raw = parse(data).get("citations");
                    citations = validateCitations(raw);
                    send("citations", Map.of("citations", citations));
                }
                case "done" -> done = parse(data);
                case "error" -> {
                    Map<String, Object> m = parse(data);
                    failure = new AiException(str(m.get("code"), "AI_ERROR"),
                            str(m.get("message"), "The AI service failed to generate an answer"));
                }
                default -> {
                    // ignore unknown events (forward compatible)
                }
            }
        }

        private MessageDto persist(boolean ok, int latencyMs) {
            return tx.execute(status -> {
                if (replaceMessageId != null) {
                    conversations.deleteMessage(replaceMessageId);
                }
                Map<String, Object> metadata = new LinkedHashMap<>();
                if (meta != null && meta.get("retrieval") != null) {
                    metadata.put("retrieval", meta.get("retrieval"));
                }
                metadata.put("latencyMs", latencyMs);
                UUID id;
                if (ok) {
                    String answer = str(done.get("answer"), partial.toString());
                    String model = done.get("model") instanceof String s ? s : null;
                    Integer promptTokens = intOrNull(done.get("promptTokens"));
                    Integer completionTokens = intOrNull(done.get("completionTokens"));
                    metadata.put("grounded", done.get("grounded") instanceof Boolean b ? b : null);
                    metadata.put("model", model);
                    metadata.put("promptTokens", promptTokens);
                    metadata.put("completionTokens", completionTokens);
                    metadata.put("timingsMs", done.getOrDefault("timingsMs", Map.of()));
                    id = conversations.insertMessage(conv.id(), "ASSISTANT", answer, "COMPLETED", model, promptTokens,
                            completionTokens, latencyMs, metadata);
                    conversations.insertCitations(id, citations);
                } else {
                    metadata.put("errorCode", failure.getCode());
                    metadata.put("errorMessage", failure.getMessage());
                    id = conversations.insertMessage(conv.id(), "ASSISTANT", partial.toString(), "FAILED", null, null,
                            null, latencyMs, metadata);
                }
                return conversations.message(id);
            });
        }

        /**
         * ADR-008: citation metadata must come from database rows. Citations whose chunk/document is not in this
         * conversation's workspace are dropped; document id/name come from the database.
         */
        private List<CitationDto> validateCitations(Object raw) {
            if (!(raw instanceof List<?> list) || list.isEmpty()) {
                return List.of();
            }
            List<Map<?, ?>> items = new ArrayList<>();
            Set<UUID> chunkIds = new java.util.HashSet<>();
            Set<UUID> docIds = new java.util.HashSet<>();
            for (Object o : list) {
                if (o instanceof Map<?, ?> m) {
                    items.add(m);
                    UUID c = uuid(m.get("chunkId"));
                    UUID d = uuid(m.get("documentId"));
                    if (c != null) {
                        chunkIds.add(c);
                    }
                    if (d != null) {
                        docIds.add(d);
                    }
                }
            }
            Map<UUID, Object[]> chunks = new HashMap<>();
            if (!chunkIds.isEmpty()) {
                jdbc.sql("""
                                select ch.id, d.id, d.name from document_chunks ch join documents d on d.id = ch.document_id
                                where ch.workspace_id = :ws and d.workspace_id = :ws and ch.id in (:ids)""")
                        .param("ws", conv.workspaceId()).param("ids", chunkIds)
                        .query((rs, n) -> chunks.put(rs.getObject(1, UUID.class),
                                new Object[]{rs.getObject(2, UUID.class), rs.getString(3)}))
                        .list();
            }
            Map<UUID, String> docs = new HashMap<>();
            if (!docIds.isEmpty()) {
                jdbc.sql("select id, name from documents where workspace_id = :ws and id in (:ids)")
                        .param("ws", conv.workspaceId()).param("ids", docIds)
                        .query((rs, n) -> docs.put(rs.getObject(1, UUID.class), rs.getString(2)))
                        .list();
            }
            Map<Integer, CitationDto> byMarker = new LinkedHashMap<>();
            for (Map<?, ?> m : items) {
                Integer marker = intOrNull(m.get("marker"));
                if (marker == null || byMarker.containsKey(marker)) {
                    continue;
                }
                UUID chunkId = uuid(m.get("chunkId"));
                UUID documentId;
                String documentName;
                if (chunkId != null) {
                    Object[] row = chunks.get(chunkId);
                    if (row == null) {
                        continue;
                    }
                    documentId = (UUID) row[0];
                    documentName = (String) row[1];
                } else {
                    documentId = uuid(m.get("documentId"));
                    if (documentId == null || !docs.containsKey(documentId)) {
                        continue;
                    }
                    documentName = docs.get(documentId);
                }
                String excerpt = str(m.get("excerpt"), "");
                if (excerpt.length() > 2000) {
                    excerpt = excerpt.substring(0, 2000);
                }
                String heading = m.get("sectionHeading") instanceof String s ? truncate(s, 500) : null;
                byMarker.put(marker, new CitationDto(marker, chunkId, documentId, documentName,
                        intOrNull(m.get("pageNumber")), heading, excerpt,
                        doubleOrNull(m.get("retrievalScore")), doubleOrNull(m.get("rerankScore"))));
            }
            return new ArrayList<>(byMarker.values());
        }

        void send(String event, Object data) {
            if (clientGone) {
                return;
            }
            try {
                emitter.send(SseEmitter.event().name(event).data(mapper.writeValueAsString(data), MediaType.TEXT_PLAIN));
            } catch (IOException | IllegalStateException e) {
                // Browser went away: keep consuming the AI stream so the answer is still persisted.
                clientGone = true;
            }
        }

        private void complete() {
            try {
                emitter.complete();
            } catch (RuntimeException ignored) {
                // already completed
            }
        }

        private Map<String, Object> parse(String data) {
            try {
                return mapper.readValue(data, MAP);
            } catch (RuntimeException e) {
                return Map.of();
            }
        }
    }

    private static String str(Object o, String fallback) {
        return o instanceof String s ? s : fallback;
    }

    private static String truncate(String s, int max) {
        return s.length() > max ? s.substring(0, max) : s;
    }

    private static UUID uuid(Object o) {
        if (o == null) {
            return null;
        }
        try {
            return UUID.fromString(o.toString());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static Integer intOrNull(Object o) {
        if (o instanceof Number n) {
            return n.intValue();
        }
        if (o instanceof String s) {
            try {
                return Integer.parseInt(s.trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static Double doubleOrNull(Object o) {
        return o instanceof Number n ? n.doubleValue() : null;
    }
}
