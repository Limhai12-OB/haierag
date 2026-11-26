package com.haierag.document;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import com.haierag.ai.AiClient;
import com.haierag.ai.AiException;
import com.haierag.audit.AuditService;
import com.haierag.auth.CurrentUser;
import com.haierag.collection.CollectionService;
import com.haierag.common.AfterCommit;
import com.haierag.common.ApiException;
import com.haierag.common.Json;
import com.haierag.common.RateLimiter;
import com.haierag.config.AppProperties;
import com.haierag.document.DocumentDtos.AdminJobDto;
import com.haierag.document.DocumentDtos.ChunkDto;
import com.haierag.document.DocumentDtos.DocumentDto;
import com.haierag.document.DocumentDtos.DocumentStatusInfo;
import com.haierag.document.DocumentDtos.JobDto;
import com.haierag.document.DocumentDtos.PageDto;
import com.haierag.document.DocumentDtos.StoredObject;
import com.haierag.storage.StorageService;
import com.haierag.workspace.Role;
import com.haierag.workspace.WorkspaceAccess;
import com.haierag.workspace.WorkspaceService;

/**
 * Document metadata. The AI service owns the processing-state columns (status, error_message, chunk_count,
 * page_count, processed_at) while a job runs, so this class only ever issues targeted UPDATEs, never
 * full-row writes.
 */
@Service
public class DocumentService {

    private static final Logger log = LoggerFactory.getLogger(DocumentService.class);

    private static final String SELECT = """
            select d.id, d.workspace_id, d.collection_id, c.name, d.name, d.original_filename, d.content_type,
                   d.file_type, d.size_bytes, d.status, d.error_message, d.page_count, d.chunk_count, d.uploaded_by,
                   d.processed_at, d.created_at, d.updated_at, d.source_url
            from documents d left join collections c on c.id = d.collection_id""";

    private final JdbcClient jdbc;
    private final WorkspaceAccess access;
    private final CollectionService collections;
    private final FileValidator validator;
    private final StorageService storage;
    private final IngestQueue queue;
    private final AuditService audit;
    private final AppProperties props;
    private final TransactionTemplate tx;
    private final Json json;
    private final AiClient ai;
    private final RateLimiter rateLimiter;

    public DocumentService(JdbcClient jdbc, WorkspaceAccess access, CollectionService collections, FileValidator validator,
                           StorageService storage, IngestQueue queue, AuditService audit, AppProperties props,
                           TransactionTemplate tx, Json json, AiClient ai, RateLimiter rateLimiter) {
        this.jdbc = jdbc;
        this.access = access;
        this.collections = collections;
        this.validator = validator;
        this.storage = storage;
        this.queue = queue;
        this.audit = audit;
        this.props = props;
        this.tx = tx;
        this.json = json;
        this.ai = ai;
        this.rateLimiter = rateLimiter;
    }

    // ---------------------------------------------------------------- upload

    public DocumentDto upload(UUID workspaceId, MultipartFile file, UUID collectionId, CurrentUser user) {
        access.require(workspaceId, user, Role.MEMBER);
        if (file == null || file.isEmpty()) {
            throw ApiException.badField("file", "A non-empty file is required");
        }
        if (file.getSize() > props.maxUploadBytes()) {
            throw tooLarge();
        }
        if (collectionId != null && !collections.belongsTo(collectionId, workspaceId)) {
            throw ApiException.badField("collectionId", "Collection not found in this workspace");
        }
        String originalFilename = sanitizeOriginalName(file.getOriginalFilename());

        Path tmp = null;
        try {
            tmp = Files.createTempFile("haierag-upload-", ".bin");
            String sha256;
            long size;
            try (InputStream in = new DigestInputStream(file.getInputStream(), sha256Digest())) {
                size = Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
                sha256 = HexFormat.of().formatHex(((DigestInputStream) in).getMessageDigest().digest());
            }
            if (size == 0) {
                throw ApiException.badField("file", "A non-empty file is required");
            }
            if (size > props.maxUploadBytes()) {
                throw tooLarge();
            }
            FileType type = validator.validate(originalFilename, tmp);

            UUID documentId = UUID.randomUUID();
            String key = storageKey(workspaceId, documentId, 1, originalFilename);
            storage.put(key, tmp, type.contentType());

            try {
                insertDocument(documentId, workspaceId, collectionId, originalFilename, originalFilename, type,
                        type.contentType(), size, sha256, key, null, user, "document.upload",
                        Map.of("name", originalFilename, "fileType", type.name(), "sizeBytes", size));
            } catch (RuntimeException e) {
                safeDelete(List.of(key));
                throw e;
            }
            return find(documentId);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Could not read the uploaded file");
        } finally {
            if (tmp != null) {
                try {
                    Files.deleteIfExists(tmp);
                } catch (IOException ignored) {
                    // best effort
                }
            }
        }
    }

    /** Inserts document, version 1 and the ingestion job in one transaction; enqueues the job after commit. */
    private void insertDocument(UUID documentId, UUID workspaceId, UUID collectionId, String name, String originalFilename,
                                FileType type, String contentType, long size, String sha256, String key, String sourceUrl,
                                CurrentUser user, String auditAction, Map<String, Object> auditDetails) {
        UUID versionId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        tx.executeWithoutResult(status -> {
            jdbc.sql("""
                            insert into documents (id, workspace_id, collection_id, name, original_filename, content_type,
                                                   file_type, size_bytes, sha256, status, uploaded_by, source_url)
                            values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)""")
                    .params(documentId, workspaceId, collectionId, name, originalFilename, contentType, type.name(), size,
                            sha256, user.id(), sourceUrl)
                    .update();
            jdbc.sql("""
                            insert into document_versions (id, document_id, version_number, storage_key, sha256,
                                                           size_bytes, content_type, created_by)
                            values (?, ?, 1, ?, ?, ?, ?, ?)""")
                    .params(versionId, documentId, key, sha256, size, contentType, user.id())
                    .update();
            jdbc.sql("update documents set current_version_id = ? where id = ?").params(versionId, documentId).update();
            jdbc.sql("insert into document_processing_jobs (id, document_id, version_id, status) values (?, ?, ?, 'QUEUED')")
                    .params(jobId, documentId, versionId).update();
            audit.record(user.id(), workspaceId, auditAction, "DOCUMENT", documentId, auditDetails);
            AfterCommit.run("enqueue ingestion job", () -> queue.push(jobId, documentId, versionId));
        });
    }

    // ---------------------------------------------------------------- link import (ADR-018)

    private static final int IMPORTS_PER_MINUTE = 10;

    /**
     * Imports a web page or linked file. The AI service downloads it (SSRF rules, size and time limits); the
     * result is stored and processed exactly like an upload, with the final URL kept as {@code source_url}.
     */
    public DocumentDto importUrl(UUID workspaceId, String rawUrl, UUID collectionId, CurrentUser user) {
        access.require(workspaceId, user, Role.MEMBER);
        String url = rawUrl == null ? "" : rawUrl.strip();
        if (url.isEmpty()) {
            throw ApiException.badField("url", "Enter a link to import");
        }
        if (url.length() > 2048) {
            throw ApiException.badField("url", "The link is too long");
        }
        String lower = url.toLowerCase(java.util.Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            throw ApiException.badField("url", "Only http:// and https:// links can be imported");
        }
        if (collectionId != null && !collections.belongsTo(collectionId, workspaceId)) {
            throw ApiException.badField("collectionId", "Collection not found in this workspace");
        }
        rateLimiter.check("import", user.id().toString(), IMPORTS_PER_MINUTE);

        AiClient.FetchedUrl page;
        try {
            page = ai.fetchUrl(url, props.maxUploadBytes());
        } catch (AiException e) {
            throw importError(e);
        }
        FileType type;
        try {
            type = FileType.valueOf(page.fileType());
        } catch (IllegalArgumentException e) {
            throw ApiException.badField("url", "This link points to an unsupported content type");
        }
        byte[] data = page.data();
        if (data.length == 0) {
            throw ApiException.badField("url", "The page is empty");
        }
        if (data.length > props.maxUploadBytes()) {
            throw tooLarge();
        }
        String originalFilename = filenameForUrl(page.url(), type);
        String name = displayName(page.title(), originalFilename);
        String contentType = type == FileType.HTML ? "text/html" : type.contentType();

        Path tmp = null;
        try {
            tmp = Files.createTempFile("haierag-import-", ".bin");
            Files.write(tmp, data);
            if (type != FileType.HTML) {
                validator.validate(originalFilename, tmp); // the server's content type must match the content
            }
            String sha256 = HexFormat.of().formatHex(sha256Digest().digest(data));
            UUID documentId = UUID.randomUUID();
            String key = storageKey(workspaceId, documentId, 1, originalFilename);
            storage.put(key, tmp, contentType);
            try {
                insertDocument(documentId, workspaceId, collectionId, name, originalFilename, type, contentType,
                        data.length, sha256, key, page.url(), user, "document.import_url",
                        Map.of("name", name, "fileType", type.name(), "sizeBytes", data.length, "url", page.url()));
            } catch (RuntimeException e) {
                safeDelete(List.of(key));
                throw e;
            }
            return find(documentId);
        } catch (IOException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not store the imported content");
        } finally {
            if (tmp != null) {
                try {
                    Files.deleteIfExists(tmp);
                } catch (IOException ignored) {
                    // best effort
                }
            }
        }
    }

    private ApiException importError(AiException e) {
        return switch (e.getCode()) {
            case "URL_TOO_LARGE" -> tooLarge();
            case "URL_INVALID", "URL_BLOCKED", "URL_UNSUPPORTED", "URL_FETCH_FAILED" ->
                    ApiException.badField("url", e.getMessage());
            default -> new ApiException(HttpStatus.SERVICE_UNAVAILABLE, e.getMessage());
        };
    }

    /** A readable file name with the right extension, e.g. {@code annual-report.pdf} or {@code example.com.html}. */
    static String filenameForUrl(String url, FileType type) {
        String ext = switch (type) {
            case HTML -> "html";
            case MARKDOWN -> "md";
            default -> type.name().toLowerCase(java.util.Locale.ROOT);
        };
        String last = "";
        String host = "page";
        try {
            java.net.URI uri = java.net.URI.create(url);
            host = uri.getHost() == null ? host : uri.getHost();
            String path = uri.getPath() == null ? "" : uri.getPath();
            last = path.substring(path.lastIndexOf('/') + 1);
        } catch (IllegalArgumentException ignored) {
            // keep defaults
        }
        String base = last.isBlank() ? host : last;
        base = base.replaceAll("\\p{Cntrl}", "").trim();
        if (!base.toLowerCase(java.util.Locale.ROOT).endsWith("." + ext)) {
            base = base + "." + ext;
        }
        return base.length() > 255 ? base.substring(base.length() - 255) : base;
    }

    static String displayName(String title, String fallback) {
        String t = title == null ? "" : title.replaceAll("\\p{Cntrl}", " ").replaceAll("\\s+", " ").strip();
        if (t.isEmpty()) {
            return fallback;
        }
        return t.length() > 255 ? t.substring(0, 254) + "…" : t;
    }

    static String storageKey(UUID workspaceId, UUID documentId, int version, String filename) {
        return "workspaces/" + workspaceId + "/documents/" + documentId + "/v" + version + "/" + safeFilename(filename);
    }

    /** ASCII-only, path-free object-key component. */
    static String safeFilename(String name) {
        String base = name == null ? "" : name.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        String safe = base.replaceAll("[^A-Za-z0-9._-]", "_").replaceAll("_+", "_").replaceAll("^[._]+", "");
        if (safe.length() > 120) {
            int dot = safe.lastIndexOf('.');
            String ext = dot > 0 && safe.length() - dot <= 10 ? safe.substring(dot) : "";
            safe = safe.substring(0, 120 - ext.length()) + ext;
        }
        return safe.isBlank() ? "file" : safe;
    }

    static String sanitizeOriginalName(String original) {
        String name = original == null ? "" : original.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("\\p{Cntrl}", "").trim();
        if (name.isEmpty()) {
            throw ApiException.badField("file", "The file must have a name");
        }
        if (name.length() > 255) {
            int dot = name.lastIndexOf('.');
            String ext = dot > 0 && name.length() - dot <= 10 ? name.substring(dot) : "";
            name = name.substring(0, 255 - ext.length()) + ext;
        }
        return name;
    }

    // ---------------------------------------------------------------- queries

    @Transactional(readOnly = true)
    public List<DocumentDto> list(UUID workspaceId, UUID collectionId, String status, String q, CurrentUser user) {
        access.require(workspaceId, user, Role.VIEWER);
        StringBuilder sql = new StringBuilder(SELECT).append(" where d.workspace_id = :ws");
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("ws", workspaceId);
        if (collectionId != null) {
            sql.append(" and d.collection_id = :col");
            params.put("col", collectionId);
        }
        if (status != null && !status.isBlank()) {
            String s = status.trim().toUpperCase(java.util.Locale.ROOT);
            if (!List.of("UPLOADED", "QUEUED", "PROCESSING", "COMPLETED", "FAILED").contains(s)) {
                throw ApiException.badField("status", "Unknown status");
            }
            sql.append(" and d.status = :status");
            params.put("status", s);
        }
        if (q != null && !q.isBlank()) {
            sql.append(" and (d.name ilike :q escape '\\' or d.original_filename ilike :q escape '\\')");
            params.put("q", "%" + q.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%");
        }
        sql.append(" order by d.created_at desc, d.id limit 1000");
        return jdbc.sql(sql.toString()).params(params).query(this::map).list();
    }

    @Transactional(readOnly = true)
    public DocumentDto get(UUID id, CurrentUser user) {
        requireDocument(id, user, Role.VIEWER);
        return find(id);
    }

    @Transactional(readOnly = true)
    public DocumentStatusInfo status(UUID id, CurrentUser user) {
        requireDocument(id, user, Role.VIEWER);
        DocumentDto doc = find(id);
        JobDto job = jdbc.sql("""
                        select id, status, stage, attempts, started_at, finished_at, metrics::text
                        from document_processing_jobs where document_id = ? order by created_at desc limit 1""")
                .param(id)
                .query((rs, n) -> new JobDto(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getInt(4),
                        WorkspaceService.instant(rs, 5), WorkspaceService.instant(rs, 6), json.toMap(rs.getString(7))))
                .optional().orElse(null);
        return new DocumentStatusInfo(id, doc.status(), doc.errorMessage(), job);
    }

    @Transactional(readOnly = true)
    public PageDto<ChunkDto> chunks(UUID id, int page, int size, CurrentUser user) {
        requireDocument(id, user, Role.VIEWER);
        int p = Math.max(0, page);
        int s = Math.clamp(size, 1, 200);
        long total = jdbc.sql("select count(*) from document_chunks where document_id = ?").param(id)
                .query(Long.class).single();
        List<ChunkDto> content = jdbc.sql("""
                        select id, chunk_index, content, token_count, page_start, page_end, section_heading, metadata::text
                        from document_chunks where document_id = ? order by chunk_index limit ? offset ?""")
                .params(id, s, (long) p * s)
                .query((rs, n) -> new ChunkDto(rs.getObject(1, UUID.class), rs.getInt(2), rs.getString(3), rs.getInt(4),
                        (Integer) rs.getObject(5), (Integer) rs.getObject(6), rs.getString(7), json.toMap(rs.getString(8))))
                .list();
        int totalPages = (int) ((total + s - 1) / s);
        return new PageDto<>(content, p, s, total, totalPages);
    }

    @Transactional(readOnly = true)
    public StoredObject storedObject(UUID id, CurrentUser user) {
        requireDocument(id, user, Role.VIEWER);
        return jdbc.sql("""
                        select v.storage_key, v.content_type, v.size_bytes, d.original_filename
                        from documents d join document_versions v on v.id = d.current_version_id where d.id = ?""")
                .param(id)
                .query((rs, n) -> new StoredObject(rs.getString(1), rs.getString(2), rs.getLong(3), rs.getString(4)))
                .optional().orElseThrow(() -> ApiException.notFound("Document file"));
    }

    // ---------------------------------------------------------------- mutations

    @Transactional
    public DocumentDto patch(UUID id, Map<String, Object> body, CurrentUser user) {
        UUID ws = requireDocument(id, user, Role.MEMBER);
        Map<String, Object> changes = new LinkedHashMap<>();
        if (body.containsKey("name")) {
            Object raw = body.get("name");
            if (!(raw instanceof String name) || name.isBlank() || name.length() > 255) {
                throw ApiException.badField("name", "must be a non-blank string of at most 255 characters");
            }
            jdbc.sql("update documents set name = ? where id = ?").params(name.trim(), id).update();
            changes.put("name", name.trim());
        }
        if (body.containsKey("collectionId")) {
            Object raw = body.get("collectionId");
            UUID collectionId = null;
            if (raw != null) {
                try {
                    collectionId = UUID.fromString(raw.toString());
                } catch (IllegalArgumentException e) {
                    throw ApiException.badField("collectionId", "must be a UUID or null");
                }
                if (!collections.belongsTo(collectionId, ws)) {
                    throw ApiException.badField("collectionId", "Collection not found in this workspace");
                }
            }
            jdbc.sql("update documents set collection_id = ? where id = ?").params(collectionId, id).update();
            changes.put("collectionId", collectionId == null ? "null" : collectionId.toString());
        }
        if (!changes.isEmpty()) {
            audit.record(user.id(), ws, "document.update", "DOCUMENT", id, changes);
        }
        return find(id);
    }

    @Transactional
    public DocumentDto reprocess(UUID id, CurrentUser user) {
        UUID ws = requireDocument(id, user, Role.MEMBER);
        // Serialise concurrent reprocess requests for the same document.
        UUID versionId = jdbc.sql("select current_version_id from documents where id = ? for update").param(id)
                .query(UUID.class).optional().orElse(null);
        if (versionId == null) {
            throw ApiException.conflict("Document has no stored version");
        }
        boolean active = jdbc.sql("""
                        select exists(select 1 from document_processing_jobs
                                      where document_id = ? and status in ('QUEUED', 'PROCESSING'))""")
                .param(id).query(Boolean.class).single();
        if (active) {
            throw ApiException.conflict("Document is already queued or processing");
        }
        UUID jobId = UUID.randomUUID();
        jdbc.sql("insert into document_processing_jobs (id, document_id, version_id, status) values (?, ?, ?, 'QUEUED')")
                .params(jobId, id, versionId).update();
        jdbc.sql("update documents set status = 'QUEUED', error_message = null where id = ?").param(id).update();
        audit.record(user.id(), ws, "document.reprocess", "DOCUMENT", id, Map.of("jobId", jobId.toString()));
        AfterCommit.run("enqueue reprocess job", () -> queue.push(jobId, id, versionId));
        return find(id);
    }

    @Transactional
    public void delete(UUID id, CurrentUser user) {
        UUID ws = requireDocument(id, user, Role.MEMBER);
        List<String> keys = new ArrayList<>(jdbc.sql("select storage_key from document_versions where document_id = ?")
                .param(id).query(String.class).list());
        String name = jdbc.sql("select name from documents where id = ?").param(id).query(String.class).single();
        jdbc.sql("delete from documents where id = ?").param(id).update();
        audit.record(user.id(), ws, "document.delete", "DOCUMENT", id, Map.of("name", name));
        if (!keys.isEmpty()) {
            AfterCommit.run("delete document objects", () -> storage.delete(keys));
        }
    }

    // ---------------------------------------------------------------- admin

    @Transactional(readOnly = true)
    public List<AdminJobDto> recentJobs(String status) {
        String sql = """
                select j.id, j.document_id, d.name, d.workspace_id, j.status, j.stage, j.attempts, j.error_message,
                       j.metrics::text, j.started_at, j.finished_at, j.created_at
                from document_processing_jobs j join documents d on d.id = j.document_id""";
        JdbcClient.StatementSpec spec;
        if (status != null && !status.isBlank()) {
            spec = jdbc.sql(sql + " where j.status = ? order by j.created_at desc limit 200")
                    .param(status.trim().toUpperCase(java.util.Locale.ROOT));
        } else {
            spec = jdbc.sql(sql + " order by j.created_at desc limit 200");
        }
        return spec.query((rs, n) -> new AdminJobDto(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
                rs.getString(3), rs.getObject(4, UUID.class), rs.getString(5), rs.getString(6), rs.getInt(7),
                rs.getString(8), json.toMap(rs.getString(9)), WorkspaceService.instant(rs, 10),
                WorkspaceService.instant(rs, 11), WorkspaceService.instant(rs, 12))).list();
    }

    // ---------------------------------------------------------------- helpers

    /** Returns the document's workspace id after checking the caller's role (404 when not visible). */
    public UUID requireDocument(UUID id, CurrentUser user, Role min) {
        UUID ws = jdbc.sql("select workspace_id from documents where id = ?").param(id).query(UUID.class).optional()
                .orElseThrow(() -> ApiException.notFound("Document"));
        try {
            access.require(ws, user, min);
        } catch (ApiException e) {
            if (e.getStatus() == HttpStatus.NOT_FOUND) {
                throw ApiException.notFound("Document");
            }
            throw e;
        }
        return ws;
    }

    public DocumentDto find(UUID id) {
        return jdbc.sql(SELECT + " where d.id = ?").param(id).query(this::map).optional()
                .orElseThrow(() -> ApiException.notFound("Document"));
    }

    private DocumentDto map(ResultSet rs, int n) throws SQLException {
        UUID uploadedBy = rs.getObject(14, UUID.class);
        return new DocumentDto(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getObject(3, UUID.class),
                rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8), rs.getLong(9),
                rs.getString(10), rs.getString(11), (Integer) rs.getObject(12), rs.getInt(13),
                uploadedBy == null ? null : uploadedBy.toString(), rs.getString(18), WorkspaceService.instant(rs, 15),
                WorkspaceService.instant(rs, 16), WorkspaceService.instant(rs, 17));
    }

    private void safeDelete(List<String> keys) {
        try {
            storage.delete(keys);
        } catch (RuntimeException e) {
            log.warn("Could not delete orphaned objects: {}", e.toString());
        }
    }

    private static MessageDigest sha256Digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private ApiException tooLarge() {
        return new ApiException(HttpStatus.CONTENT_TOO_LARGE,
                "File exceeds the maximum upload size of " + props.maxUploadSizeMb() + " MB");
    }
}
