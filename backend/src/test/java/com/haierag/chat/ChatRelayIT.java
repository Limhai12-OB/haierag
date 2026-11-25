package com.haierag.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;

import com.haierag.ai.AiClient;
import com.haierag.support.Files;
import com.haierag.support.IntegrationTest;
import com.haierag.support.StubAiServer;

import tools.jackson.databind.JsonNode;

class ChatRelayIT extends IntegrationTest {

    record Event(String name, JsonNode data, long atMillis) {
    }

    record StreamResult(int status, String contentType, List<Event> events) {
        List<String> names() {
            return events.stream().map(Event::name).toList();
        }

        Event first(String name) {
            return events.stream().filter(e -> e.name().equals(name)).findFirst().orElseThrow();
        }
    }

    TestUser user;
    UUID ws;
    UUID docId;
    UUID chunkId;
    UUID foreignChunkId;

    @BeforeEach
    void setUp() throws Exception {
        user = register("chat");
        ws = createWorkspace(user, "Chat");
        docId = uploadAndChunk(user, ws);
        chunkId = jdbc.sql("select id from document_chunks where document_id = ?").param(docId).query(UUID.class).single();
        TestUser other = register("other");
        UUID otherWs = createWorkspace(other, "Other");
        UUID otherDoc = uploadAndChunk(other, otherWs);
        foreignChunkId = jdbc.sql("select id from document_chunks where document_id = ?").param(otherDoc)
                .query(UUID.class).single();
    }

    private UUID uploadAndChunk(TestUser u, UUID workspace) throws Exception {
        MvcResult res = mvc.perform(auth(multipart("/api/v1/workspaces/" + workspace + "/documents")
                        .file(new MockMultipartFile("file", "handbook.pdf", "application/pdf", Files.pdf())), u))
                .andExpect(status().isAccepted()).andReturn();
        UUID doc = UUID.fromString(body(res).get("id").asString());
        UUID version = jdbc.sql("select current_version_id from documents where id = ?").param(doc).query(UUID.class).single();
        jdbc.sql("""
                        insert into document_chunks (document_id, version_id, workspace_id, chunk_index, content, content_hash,
                                                     token_count, page_start, page_end, section_heading)
                        values (?, ?, ?, 0, 'Vacation is 25 days.', 'h', 5, 3, 3, 'Leave')""")
                .params(doc, version, workspace).update();
        return doc;
    }

    private UUID newConversation(Map<String, Object> body) throws Exception {
        MvcResult res = mvc.perform(auth(post("/api/v1/conversations"), user).contentType(MediaType.APPLICATION_JSON)
                .content(jsonOf(body))).andExpect(status().isCreated()).andReturn();
        return UUID.fromString(body(res).get("id").asString());
    }

    private StreamResult stream(String path, String jsonBody) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Authorization", user.bearer())
                .header("Accept", "text/event-stream");
        if (jsonBody != null) {
            b.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(jsonBody));
        } else {
            b.POST(HttpRequest.BodyPublishers.noBody());
        }
        HttpResponse<InputStream> resp = HttpClient.newHttpClient().send(b.build(), HttpResponse.BodyHandlers.ofInputStream());
        List<Event> events = new ArrayList<>();
        long start = System.currentTimeMillis();
        try (InputStream in = resp.body()) {
            if (resp.statusCode() == 200) {
                AiClient.readSse(in, (name, data) ->
                        events.add(new Event(name, json.readTree(data), System.currentTimeMillis() - start)));
            }
        }
        return new StreamResult(resp.statusCode(), resp.headers().firstValue("Content-Type").orElse(""), events);
    }

    private String citations() {
        return jsonOf(Map.of("citations", List.of(
                Map.of("marker", 1, "chunkId", chunkId.toString(), "documentId", docId.toString(),
                        "documentName", "spoofed-name.pdf", "pageNumber", 3, "sectionHeading", "Leave",
                        "excerpt", "Vacation is 25 days.", "retrievalScore", 0.0325, "rerankScore", 0.91),
                Map.of("marker", 2, "chunkId", foreignChunkId.toString(), "documentName", "secret.pdf",
                        "excerpt", "leaked", "retrievalScore", 0.01))));
    }

    @Test
    void relaysAiStreamAndPersistsAssistantMessageWithValidatedCitations() throws Exception {
        UUID conv = newConversation(Map.of("workspaceId", ws.toString()));
        StubAiServer.script(StubAiServer.sse(
                "meta", "{\"retrieval\":{\"candidates\":12,\"passages\":1,\"timingsMs\":{\"vector\":5,\"keyword\":3}}}",
                "token", "{\"text\":\"Vacation is \"}",
                "token", "{\"text\":\"25 days [1].\"}",
                "citations", citations(),
                "done", "{\"answer\":\"Vacation is 25 days [1].\",\"grounded\":true,\"model\":\"qwen3:4b\","
                        + "\"promptTokens\":321,\"completionTokens\":9,\"timingsMs\":{\"generation\":120}}"));

        StreamResult r = stream("/api/v1/conversations/" + conv + "/messages",
                jsonOf(Map.of("content", "How many vacation days do I get?")));

        assertThat(r.status()).isEqualTo(200);
        assertThat(r.contentType()).startsWith("text/event-stream");
        assertThat(r.names()).containsExactly("user_message", "meta", "token", "token", "citations", "done");
        assertThat(r.first("user_message").data().get("role").asString()).isEqualTo("USER");
        assertThat(r.first("meta").data().get("retrieval").get("candidates").asInt()).isEqualTo(12);
        assertThat(r.first("token").data().get("text").asString()).isEqualTo("Vacation is ");
        JsonNode streamedCitations = r.first("citations").data().get("citations");
        assertThat(streamedCitations).hasSize(1);
        assertThat(streamedCitations.get(0).get("documentName").asString()).isEqualTo("handbook.pdf");

        JsonNode message = r.first("done").data().get("message");
        assertThat(message.get("role").asString()).isEqualTo("ASSISTANT");
        assertThat(message.get("status").asString()).isEqualTo("COMPLETED");
        assertThat(message.get("content").asString()).isEqualTo("Vacation is 25 days [1].");
        assertThat(message.get("metadata").get("grounded").asBoolean()).isTrue();
        assertThat(message.get("metadata").get("model").asString()).isEqualTo("qwen3:4b");
        assertThat(message.get("citations")).hasSize(1);
        JsonNode cit = message.get("citations").get(0);
        assertThat(cit.get("marker").asInt()).isEqualTo(1);
        assertThat(cit.get("chunkId").asString()).isEqualTo(chunkId.toString());
        assertThat(cit.get("documentId").asString()).isEqualTo(docId.toString());
        assertThat(cit.get("pageNumber").asInt()).isEqualTo(3);
        assertThat(cit.get("rerankScore").asDouble()).isEqualTo(0.91);

        // Request to the AI service
        assertThat(StubAiServer.CHAT_REQUESTS).hasSize(1);
        assertThat(StubAiServer.CHAT_REQUESTS.getFirst().token()).isEqualTo(INTERNAL_TOKEN);
        JsonNode aiReq = json.readTree(StubAiServer.CHAT_REQUESTS.getFirst().body());
        assertThat(aiReq.get("workspaceId").asString()).isEqualTo(ws.toString());
        assertThat(aiReq.get("question").asString()).isEqualTo("How many vacation days do I get?");
        assertThat(aiReq.get("history")).isEmpty();

        // Persisted state
        Map<String, Object> row = jdbc.sql("""
                        select content, status, model, prompt_tokens, completion_tokens, latency_ms
                        from messages where conversation_id = ? and role = 'ASSISTANT'""").param(conv).query().singleRow();
        assertThat(row.get("status")).isEqualTo("COMPLETED");
        assertThat(row.get("model")).isEqualTo("qwen3:4b");
        assertThat(row.get("prompt_tokens")).isEqualTo(321);
        assertThat(row.get("latency_ms")).isNotNull();
        assertThat(jdbc.sql("select count(*) from message_citations mc join messages m on m.id = mc.message_id "
                + "where m.conversation_id = ?").param(conv).query(Long.class).single()).isEqualTo(1);

        mvc.perform(auth(get("/api/v1/conversations/" + conv), user)).andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("How many vacation days do I get?"))
                .andExpect(jsonPath("$.messages.length()").value(2))
                .andExpect(jsonPath("$.messages[0].role").value("USER"))
                .andExpect(jsonPath("$.messages[1].citations[0].documentName").value("handbook.pdf"));

        // A follow-up question carries the history
        StreamResult r2 = stream("/api/v1/conversations/" + conv + "/messages", jsonOf(Map.of("content", "And sick days?")));
        assertThat(r2.names()).endsWith("done");
        JsonNode aiReq2 = json.readTree(StubAiServer.CHAT_REQUESTS.get(1).body());
        assertThat(aiReq2.get("history")).hasSize(2);
        assertThat(aiReq2.get("history").get(0).get("role").asString()).isEqualTo("USER");
        assertThat(aiReq2.get("history").get(1).get("content").asString()).isEqualTo("Vacation is 25 days [1].");

        // Regenerate replaces the last assistant message
        StubAiServer.script(StubAiServer.sse("token", "{\"text\":\"Ten.\"}",
                "done", "{\"answer\":\"Ten.\",\"grounded\":false,\"model\":\"qwen3:4b\",\"promptTokens\":null,"
                        + "\"completionTokens\":null,\"timingsMs\":{}}"));
        StreamResult r3 = stream("/api/v1/conversations/" + conv + "/regenerate", null);
        assertThat(r3.names()).containsExactly("token", "done");
        JsonNode aiReq3 = json.readTree(StubAiServer.CHAT_REQUESTS.get(2).body());
        assertThat(aiReq3.get("question").asString()).isEqualTo("And sick days?");
        assertThat(aiReq3.get("history")).hasSize(2);
        mvc.perform(auth(get("/api/v1/conversations/" + conv), user))
                .andExpect(jsonPath("$.messages.length()").value(4))
                .andExpect(jsonPath("$.messages[3].content").value("Ten."));
    }

    @Test
    void streamsTokensWithoutBuffering() throws Exception {
        UUID conv = newConversation(Map.of("workspaceId", ws.toString()));
        StubAiServer.script(ex -> {
            ex.getResponseHeaders().set("Content-Type", "text/event-stream");
            ex.sendResponseHeaders(200, 0);
            OutputStream out = ex.getResponseBody();
            out.write("event: token\ndata: {\"text\":\"first\"}\n\n".getBytes(StandardCharsets.UTF_8));
            out.flush();
            try {
                Thread.sleep(1500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            out.write(("event: done\ndata: {\"answer\":\"first\",\"grounded\":true,\"model\":\"m\",\"timingsMs\":{}}\n\n")
                    .getBytes(StandardCharsets.UTF_8));
            out.close();
        });
        StreamResult r = stream("/api/v1/conversations/" + conv + "/messages", jsonOf(Map.of("content", "Stream?")));
        assertThat(r.names()).containsExactly("user_message", "token", "done");
        long gap = r.first("done").atMillis() - r.first("token").atMillis();
        assertThat(gap).as("token must reach the client before the stream ends").isGreaterThanOrEqualTo(1000);
    }

    @Test
    void aiErrorsBecomeErrorEventsAndFailedMessages() throws Exception {
        UUID conv = newConversation(Map.of("workspaceId", ws.toString(), "scopeType", "DOCUMENTS",
                "documentIds", List.of(docId.toString())));
        StubAiServer.script(ex -> StubAiServer.respond(ex, 503, "application/problem+json",
                "{\"status\":503,\"title\":\"Service Unavailable\",\"code\":\"MODEL_UNAVAILABLE\","
                        + "\"detail\":\"Model bge-m3 is not available. Run: ollama pull bge-m3\"}"));
        StreamResult r = stream("/api/v1/conversations/" + conv + "/messages", jsonOf(Map.of("content", "Hello?")));
        assertThat(r.names()).containsExactly("user_message", "error");
        assertThat(r.first("error").data().get("code").asString()).isEqualTo("MODEL_UNAVAILABLE");
        assertThat(r.first("error").data().get("message").asString()).contains("ollama pull bge-m3");
        JsonNode aiReq = json.readTree(StubAiServer.CHAT_REQUESTS.getFirst().body());
        assertThat(aiReq.get("documentIds").get(0).asString()).isEqualTo(docId.toString());
        assertThat(jdbc.sql("select status from messages where conversation_id = ? and role = 'ASSISTANT'")
                .param(conv).query(String.class).single()).isEqualTo("FAILED");

        // An error event in the middle of the stream keeps the partial answer
        UUID conv2 = newConversation(Map.of("workspaceId", ws.toString()));
        StubAiServer.script(StubAiServer.sse("token", "{\"text\":\"Partial\"}",
                "error", "{\"code\":\"GENERATION_FAILED\",\"message\":\"LLM crashed\"}"));
        StreamResult r2 = stream("/api/v1/conversations/" + conv2 + "/messages", jsonOf(Map.of("content", "Hi")));
        assertThat(r2.names()).containsExactly("user_message", "token", "error");
        assertThat(r2.first("error").data().get("code").asString()).isEqualTo("GENERATION_FAILED");
        Map<String, Object> failed = jdbc.sql("select content, status from messages where conversation_id = ? and role = 'ASSISTANT'")
                .param(conv2).query().singleRow();
        assertThat(failed.get("status")).isEqualTo("FAILED");
        assertThat(failed.get("content")).isEqualTo("Partial");

        // Validation errors before streaming are plain problem JSON
        HttpResponse<String> bad = HttpClient.newHttpClient().send(HttpRequest.newBuilder(
                        URI.create("http://localhost:" + port + "/api/v1/conversations/" + conv2 + "/messages"))
                .header("Authorization", user.bearer()).header("Accept", "text/event-stream")
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString("{\"content\":\"  \"}"))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(bad.statusCode()).isEqualTo(400);
        assertThat(bad.headers().firstValue("Content-Type").orElse("")).startsWith("application/problem+json");
    }

    @Test
    void aiServiceDownYieldsAiUnavailable() throws Exception {
        UUID conv = newConversation(Map.of("workspaceId", ws.toString()));
        StubAiServer.script(ex -> {
            // close without a done event
            ex.getResponseHeaders().set("Content-Type", "text/event-stream");
            ex.sendResponseHeaders(200, 0);
            ex.getResponseBody().close();
        });
        StreamResult r = stream("/api/v1/conversations/" + conv + "/messages", jsonOf(Map.of("content", "Anyone?")));
        assertThat(r.names()).containsExactly("user_message", "error");
        assertThat(r.first("error").data().get("code").asString()).isEqualTo("AI_UNAVAILABLE");
    }
}
