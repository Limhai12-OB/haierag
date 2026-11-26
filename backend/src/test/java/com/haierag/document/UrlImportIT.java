package com.haierag.document;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import com.haierag.storage.StorageService;
import com.haierag.support.Files;
import com.haierag.support.IntegrationTest;
import com.haierag.support.StubAiServer;

import tools.jackson.databind.JsonNode;

class UrlImportIT extends IntegrationTest {

    @Autowired
    StorageService storage;

    TestUser owner;
    UUID ws;

    @BeforeEach
    void setUp() throws Exception {
        owner = register("import");
        ws = createWorkspace(owner, "Links");
        redis.delete(IngestQueue.KEY);
        StubAiServer.FETCH_REQUESTS.clear();
    }

    private ResultActions importUrl(TestUser user, String url) throws Exception {
        return mvc.perform(auth(post("/api/v1/workspaces/" + ws + "/documents/import-url")
                .contentType(MediaType.APPLICATION_JSON).content(jsonOf(Map.of("url", url))), user));
    }

    @Test
    void importsAWebPageAndQueuesIt() throws Exception {
        byte[] html = "<html><head><title>Leave policy</title></head><body><p>21 days</p></body></html>"
                .getBytes(StandardCharsets.UTF_8);
        StubAiServer.scriptFetch(StubAiServer.fetched("https://example.com/hr/leave", "HTML", "text/html",
                "Leave policy | ACME", html));

        JsonNode doc = body(importUrl(owner, "  https://example.com/hr/leave  ").andExpect(status().isAccepted())
                .andExpect(jsonPath("$.fileType").value("HTML"))
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andExpect(jsonPath("$.name").value("Leave policy | ACME"))
                .andExpect(jsonPath("$.originalFilename").value("leave.html"))
                .andExpect(jsonPath("$.sourceUrl").value("https://example.com/hr/leave"))
                .andReturn());

        assertThat(StubAiServer.FETCH_REQUESTS).hasSize(1);
        assertThat(StubAiServer.FETCH_REQUESTS.getFirst().token()).isEqualTo(INTERNAL_TOKEN);
        assertThat(StubAiServer.FETCH_REQUESTS.getFirst().body()).contains("\"url\":\"https://example.com/hr/leave\"");
        assertThat(redis.opsForList().size(IngestQueue.KEY)).isEqualTo(1);
        String key = jdbc.sql("""
                        select v.storage_key from documents d join document_versions v on v.id = d.current_version_id
                        where d.id = ?""").param(UUID.fromString(doc.get("id").asString())).query(String.class).single();
        try (var in = storage.get(key)) {
            assertThat(in.readAllBytes()).isEqualTo(html);
        }
        // listed with its source URL
        mvc.perform(auth(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/v1/workspaces/" + ws + "/documents"), owner))
                .andExpect(jsonPath("$[0].sourceUrl").value("https://example.com/hr/leave"));
    }

    @Test
    void linkedFilesKeepTheirTypeAndAreValidated() throws Exception {
        StubAiServer.scriptFetch(StubAiServer.fetched("https://example.com/files/report.pdf", "PDF",
                "application/pdf", "report.pdf", Files.pdf()));
        importUrl(owner, "https://example.com/files/report.pdf").andExpect(status().isAccepted())
                .andExpect(jsonPath("$.fileType").value("PDF"))
                .andExpect(jsonPath("$.originalFilename").value("report.pdf"));

        // a server that claims PDF but sends something else is rejected like a mislabelled upload
        StubAiServer.scriptFetch(StubAiServer.fetched("https://example.com/fake.pdf", "PDF", "application/pdf",
                "fake", "not a pdf".getBytes(StandardCharsets.UTF_8)));
        importUrl(owner, "https://example.com/fake.pdf").andExpect(status().isUnsupportedMediaType());
    }

    @Test
    void fetchFailuresBecomeFieldErrors() throws Exception {
        StubAiServer.scriptFetch(StubAiServer.fetchFailed("URL_BLOCKED",
                "Links to local or private network addresses are not allowed."));
        importUrl(owner, "http://169.254.169.254/latest/meta-data/").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.url").value("Links to local or private network addresses are not allowed."));

        StubAiServer.scriptFetch(StubAiServer.fetchFailed("URL_TOO_LARGE", "too big"));
        importUrl(owner, "https://example.com/huge.pdf").andExpect(status().is(413));

        StubAiServer.scriptFetch(ex -> StubAiServer.respond(ex, 503, "application/problem+json",
                "{\"status\":503,\"code\":\"AI_UNAVAILABLE\",\"detail\":\"down\"}"));
        importUrl(owner, "https://example.com/").andExpect(status().isServiceUnavailable());

        assertThat(redis.opsForList().size(IngestQueue.KEY)).isZero();
        assertThat(jdbc.sql("select count(*) from documents where workspace_id = ?").param(ws).query(Long.class).single())
                .isZero();
    }

    @Test
    void rejectsNonHttpLinksWithoutCallingTheAiService() throws Exception {
        importUrl(owner, "file:///etc/passwd").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.url").exists());
        importUrl(owner, "").andExpect(status().isBadRequest());
        importUrl(owner, "https://example.com/" + "a".repeat(2100)).andExpect(status().isBadRequest());
        assertThat(StubAiServer.FETCH_REQUESTS).isEmpty();
    }

    @Test
    void viewersCannotImport() throws Exception {
        TestUser viewer = register("viewer");
        addMember(owner, ws, viewer, "VIEWER");
        importUrl(viewer, "https://example.com/").andExpect(status().isForbidden());
        assertThat(StubAiServer.FETCH_REQUESTS).isEmpty();
    }

    @Test
    void filenamesAndNamesAreDerivedSafely() {
        assertThat(DocumentService.filenameForUrl("https://example.com/", FileType.HTML)).isEqualTo("example.com.html");
        assertThat(DocumentService.filenameForUrl("https://example.com/a/guide.md", FileType.MARKDOWN)).isEqualTo("guide.md");
        assertThat(DocumentService.filenameForUrl("https://example.com/dl?id=3", FileType.PDF)).isEqualTo("dl.pdf");
        assertThat(DocumentService.displayName("  A\n\tB  ", "x.html")).isEqualTo("A B");
        assertThat(DocumentService.displayName("", "x.html")).isEqualTo("x.html");
        assertThat(DocumentService.displayName("t".repeat(300), "x")).hasSize(255);
    }
}
