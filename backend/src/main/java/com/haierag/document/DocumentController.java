package com.haierag.document;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.haierag.auth.CurrentUser;
import com.haierag.document.DocumentDtos.ChunkDto;
import com.haierag.document.DocumentDtos.DocumentDto;
import com.haierag.document.DocumentDtos.DocumentStatusInfo;
import com.haierag.document.DocumentDtos.PageDto;
import com.haierag.document.DocumentDtos.StoredObject;
import com.haierag.storage.StorageService;

@RestController
@RequestMapping("/api/v1")
public class DocumentController {

    private final DocumentService service;
    private final StorageService storage;

    public DocumentController(DocumentService service, StorageService storage) {
        this.service = service;
        this.storage = storage;
    }

    @PostMapping(path = "/workspaces/{workspaceId}/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<DocumentDto> upload(@PathVariable UUID workspaceId,
                                              @RequestPart(name = "file", required = false) MultipartFile file,
                                              @RequestParam(name = "collectionId", required = false) UUID collectionId,
                                              CurrentUser user) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(service.upload(workspaceId, file, collectionId, user));
    }

    @GetMapping("/workspaces/{workspaceId}/documents")
    public List<DocumentDto> list(@PathVariable UUID workspaceId,
                                  @RequestParam(required = false) UUID collectionId,
                                  @RequestParam(required = false) String status,
                                  @RequestParam(required = false) String q,
                                  CurrentUser user) {
        return service.list(workspaceId, collectionId, status, q, user);
    }

    @GetMapping("/documents/{id}")
    public DocumentDto get(@PathVariable UUID id, CurrentUser user) {
        return service.get(id, user);
    }

    @PatchMapping("/documents/{id}")
    public DocumentDto patch(@PathVariable UUID id, @RequestBody Map<String, Object> body, CurrentUser user) {
        return service.patch(id, body, user);
    }

    @GetMapping("/documents/{id}/status")
    public DocumentStatusInfo status(@PathVariable UUID id, CurrentUser user) {
        return service.status(id, user);
    }

    @GetMapping("/documents/{id}/chunks")
    public PageDto<ChunkDto> chunks(@PathVariable UUID id, @RequestParam(defaultValue = "0") int page,
                                    @RequestParam(defaultValue = "50") int size, CurrentUser user) {
        return service.chunks(id, page, size, user);
    }

    @GetMapping("/documents/{id}/download")
    public ResponseEntity<StreamingResponseBody> download(@PathVariable UUID id, CurrentUser user) {
        StoredObject obj = service.storedObject(id, user);
        InputStream in = storage.get(obj.storageKey());
        StreamingResponseBody body = out -> {
            try (in) {
                in.transferTo(out);
            }
        };
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(obj.contentType()))
                .contentLength(obj.sizeBytes())
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(obj.filename(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(body);
    }

    @PostMapping("/documents/{id}/reprocess")
    public ResponseEntity<DocumentDto> reprocess(@PathVariable UUID id, CurrentUser user) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(service.reprocess(id, user));
    }

    @DeleteMapping("/documents/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, CurrentUser user) {
        service.delete(id, user);
        return ResponseEntity.noContent().build();
    }
}
