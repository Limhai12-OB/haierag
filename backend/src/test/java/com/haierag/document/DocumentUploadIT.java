package com.haierag.document;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MvcResult;

import com.haierag.storage.StorageService;
import com.haierag.support.Files;
import com.haierag.support.IntegrationTest;

import tools.jackson.databind.JsonNode;

class DocumentUploadIT extends IntegrationTest {

    @Autowired
    StorageService storage;

    TestUser owner;
    UUID ws;

    @BeforeEach
    void setUp() throws Exception {
        owner = register("docs");
        ws = createWorkspace(owner, "Docs");
        redis.delete(IngestQueue.KEY);
    }

    private org.springframework.test.web.servlet.ResultActions upload(String name, byte[] bytes) throws Exception {
        return mvc.perform(auth(multipart("/api/v1/workspaces/" + ws + "/documents")
                .file(new MockMultipartFile("file", name, "application/octet-stream", bytes)), owner));
    }

    @Test
    void rejectsContentThatDoesNotMatchTheExtension() throws Exception {
        upload("fake.pdf", "hello, not a pdf".getBytes(StandardCharsets.UTF_8))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
        upload("fake.docx", Files.pdf()).andExpect(status().isUnsupportedMediaType());
        upload("noct.docx", Files.zip("word/document.xml")).andExpect(status().isUnsupportedMediaType());
        upload("wrong.xlsx", Files.docx()).andExpect(status().isUnsupportedMediaType());
        upload("nul.txt", new byte[]{'a', 0, 'b'}).andExpect(status().isUnsupportedMediaType());
        upload("latin1.csv", new byte[]{'a', ',', (byte) 0xE9, '\n'}).andExpect(status().isUnsupportedMediaType());
        upload("program.exe", Files.pdf()).andExpect(status().isUnsupportedMediaType());
        upload("empty.txt", new byte[0]).andExpect(status().isBadRequest());
        assertThat(redis.opsForList().size(IngestQueue.KEY)).isZero();
        assertThat(jdbc.sql("select count(*) from documents where workspace_id = ?").param(ws).query(Long.class).single())
                .isZero();
    }

    @Test
    void rejectsOversizedFilesWith413() throws Exception {
        byte[] big = new byte[1024 * 1024 + 10];
        java.util.Arrays.fill(big, (byte) 'a');
        upload("big.txt", big).andExpect(status().is(413))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    void uploadHappyPathStoresObjectCreatesRowsAndEnqueuesJob() throws Exception {
        byte[] pdf = Files.pdf();
        MvcResult res = upload("Annual Report (2024).pdf", pdf)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andExpect(jsonPath("$.fileType").value("PDF"))
                .andExpect(jsonPath("$.contentType").value("application/pdf"))
                .andExpect(jsonPath("$.name").value("Annual Report (2024).pdf"))
                .andExpect(jsonPath("$.sizeBytes").value(pdf.length))
                .andExpect(jsonPath("$.chunkCount").value(0))
                .andExpect(jsonPath("$.uploadedBy").value(owner.id().toString()))
                .andReturn();
        UUID docId = UUID.fromString(body(res).get("id").asString());

        Map<String, Object> doc = jdbc.sql("select status, sha256, current_version_id from documents where id = ?")
                .param(docId).query().singleRow();
        String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(pdf));
        assertThat(doc.get("status")).isEqualTo("QUEUED");
        assertThat(doc.get("sha256")).isEqualTo(sha);
        UUID versionId = (UUID) doc.get("current_version_id");
        assertThat(versionId).isNotNull();

        Map<String, Object> version = jdbc.sql("select version_number, storage_key, sha256 from document_versions where id = ?")
                .param(versionId).query().singleRow();
        String key = (String) version.get("storage_key");
        assertThat(version.get("version_number")).isEqualTo(1);
        assertThat(key).isEqualTo("workspaces/" + ws + "/documents/" + docId + "/v1/Annual_Report_2024_.pdf");
        assertThat(storage.exists(key)).isTrue();

        Map<String, Object> job = jdbc.sql("select id, status, version_id from document_processing_jobs where document_id = ?")
                .param(docId).query().singleRow();
        assertThat(job.get("status")).isEqualTo("QUEUED");
        assertThat(job.get("version_id")).isEqualTo(versionId);

        List<String> queued = redis.opsForList().range(IngestQueue.KEY, 0, -1);
        assertThat(queued).hasSize(1);
        JsonNode msg = json.readTree(queued.getFirst());
        assertThat(msg.get("jobId").asString()).isEqualTo(job.get("id").toString());
        assertThat(msg.get("documentId").asString()).isEqualTo(docId.toString());
        assertThat(msg.get("versionId").asString()).isEqualTo(versionId.toString());

        // status endpoint
        mvc.perform(auth(get("/api/v1/documents/" + docId + "/status"), owner)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andExpect(jsonPath("$.job.status").value("QUEUED"))
                .andExpect(jsonPath("$.job.attempts").value(0));

        // download streams the original bytes
        MvcResult dl = mvc.perform(auth(get("/api/v1/documents/" + docId + "/download"), owner))
                .andExpect(request().asyncStarted()).andReturn();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch(dl))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", org.hamcrest.Matchers.startsWith("attachment")))
                .andExpect(content().bytes(pdf));

        // list + filter
        mvc.perform(auth(get("/api/v1/workspaces/" + ws + "/documents?q=annual&status=QUEUED"), owner))
                .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(auth(get("/api/v1/workspaces/" + ws + "/documents?q=nothing"), owner))
                .andExpect(jsonPath("$.length()").value(0));

        // reprocess is refused while queued, allowed once the AI service has finished
        mvc.perform(auth(post("/api/v1/documents/" + docId + "/reprocess"), owner)).andExpect(status().isConflict());
        jdbc.sql("update document_processing_jobs set status = 'FAILED' where document_id = ?").param(docId).update();
        jdbc.sql("update documents set status = 'FAILED', error_message = 'boom' where id = ?").param(docId).update();
        mvc.perform(auth(post("/api/v1/documents/" + docId + "/reprocess"), owner)).andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andExpect(jsonPath("$.errorMessage").doesNotExist());
        assertThat(redis.opsForList().size(IngestQueue.KEY)).isEqualTo(2);
        assertThat(jdbc.sql("select count(*) from document_processing_jobs where document_id = ?").param(docId)
                .query(Long.class).single()).isEqualTo(2);

        // delete removes rows and the stored object
        mvc.perform(auth(delete("/api/v1/documents/" + docId), owner)).andExpect(status().isNoContent());
        assertThat(jdbc.sql("select count(*) from documents where id = ?").param(docId).query(Long.class).single()).isZero();
        await().atMost(Duration.ofSeconds(5)).until(() -> !storage.exists(key));
    }

    @Test
    void acceptsOfficeAndTextFormatsAndServesChunks() throws Exception {
        upload("spec.docx", Files.docx()).andExpect(status().isAccepted()).andExpect(jsonPath("$.fileType").value("DOCX"));
        upload("sheet.xlsx", Files.zip("[Content_Types].xml", "xl/workbook.xml")).andExpect(status().isAccepted());
        upload("deck.pptx", Files.zip("[Content_Types].xml", "ppt/presentation.xml")).andExpect(status().isAccepted());
        upload("notes.md", "# Título\nUTF-8 ✓ ក្នុង".getBytes(StandardCharsets.UTF_8)).andExpect(status().isAccepted())
                .andExpect(jsonPath("$.fileType").value("MARKDOWN"));
        MvcResult res = upload("data.csv", "a,b\n1,2\n".getBytes(StandardCharsets.UTF_8))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.fileType").value("CSV")).andReturn();
        UUID docId = UUID.fromString(body(res).get("id").asString());
        UUID versionId = jdbc.sql("select current_version_id from documents where id = ?").param(docId)
                .query(UUID.class).single();

        // Simulate the AI worker writing chunks + processing state directly in the database.
        for (int i = 0; i < 3; i++) {
            jdbc.sql("""
                            insert into document_chunks (document_id, version_id, workspace_id, chunk_index, content,
                                                         content_hash, token_count, page_start, section_heading, metadata)
                            values (?, ?, ?, ?, ?, ?, ?, ?, ?, '{"k":1}'::jsonb)""")
                    .params(docId, versionId, ws, i, "chunk " + i, "h" + i, 5, 1, "Intro").update();
        }
        jdbc.sql("update documents set status = 'COMPLETED', chunk_count = 3, processed_at = now() where id = ?")
                .param(docId).update();

        // A metadata edit must not clobber AI-owned columns
        mvc.perform(auth(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/documents/" + docId), owner)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"Data\"}"))
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.chunkCount").value(3))
                .andExpect(jsonPath("$.processedAt").exists());

        mvc.perform(auth(get("/api/v1/documents/" + docId + "/chunks?page=0&size=2"), owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].chunkIndex").value(0))
                .andExpect(jsonPath("$.content[0].sectionHeading").value("Intro"))
                .andExpect(jsonPath("$.content[0].metadata.k").value(1))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2));
        mvc.perform(auth(get("/api/v1/workspaces/" + ws + "/stats"), owner))
                .andExpect(jsonPath("$.chunks").value(3))
                .andExpect(jsonPath("$.documents").value(5));
    }
}
