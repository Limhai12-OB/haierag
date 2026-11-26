package com.haierag.document;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class DocumentDtos {

    private DocumentDtos() {
    }

    public record DocumentDto(UUID id, UUID workspaceId, UUID collectionId, String collectionName, String name,
                              String originalFilename, String contentType, String fileType, long sizeBytes,
                              String status, String errorMessage, Integer pageCount, int chunkCount,
                              String uploadedBy, String sourceUrl, Instant processedAt, Instant createdAt,
                              Instant updatedAt) {
    }

    public record ImportUrlRequest(String url, UUID collectionId) {
    }

    public record JobDto(UUID id, String status, String stage, int attempts, Instant startedAt, Instant finishedAt,
                         Map<String, Object> metrics) {
    }

    public record DocumentStatusInfo(UUID documentId, String status, String errorMessage, JobDto job) {
    }

    public record ChunkDto(UUID id, int chunkIndex, String content, int tokenCount, Integer pageStart, Integer pageEnd,
                           String sectionHeading, Map<String, Object> metadata) {
    }

    public record PageDto<T>(List<T> content, int page, int size, long totalElements, int totalPages) {
    }

    public record AdminJobDto(UUID id, UUID documentId, String documentName, UUID workspaceId, String status,
                              String stage, int attempts, String errorMessage, Map<String, Object> metrics,
                              Instant startedAt, Instant finishedAt, Instant createdAt) {
    }

    /** Internal: storage location of a document's current version. */
    public record StoredObject(String storageKey, String contentType, long sizeBytes, String filename) {
    }
}
