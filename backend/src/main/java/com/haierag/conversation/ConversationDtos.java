package com.haierag.conversation;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public final class ConversationDtos {

    private ConversationDtos() {
    }

    public enum ScopeType { WORKSPACE, COLLECTION, DOCUMENTS }

    public record CreateConversationRequest(@NotNull UUID workspaceId, @Size(max = 200) String title, ScopeType scopeType,
                                            UUID collectionId, @Size(max = 100) List<UUID> documentIds) {
    }

    public record RenameRequest(@NotBlank @Size(max = 200) String title) {
    }

    public record SendMessageRequest(@NotBlank @Size(max = 8000) String content) {
    }

    public record ConversationDto(UUID id, UUID workspaceId, String title, ScopeType scopeType, UUID collectionId,
                                  List<UUID> documentIds, Instant createdAt, Instant updatedAt) {
    }

    public record ConversationDetail(UUID id, UUID workspaceId, String title, ScopeType scopeType, UUID collectionId,
                                     List<UUID> documentIds, Instant createdAt, Instant updatedAt,
                                     List<MessageDto> messages) {
    }

    public record CitationDto(int marker, UUID chunkId, UUID documentId, String documentName, Integer pageNumber,
                              String sectionHeading, String excerpt, Double retrievalScore, Double rerankScore) {
    }

    public record MessageDto(UUID id, String role, String content, String status, List<CitationDto> citations,
                             Map<String, Object> metadata, Instant createdAt) {
    }

    /** Internal view of a conversation row. */
    public record ConversationRow(UUID id, UUID workspaceId, UUID userId, String title, ScopeType scopeType,
                                  UUID collectionId, Instant createdAt, Instant updatedAt) {
    }

    /** Internal: a message used as chat history. */
    public record HistoryItem(String role, String content) {
    }
}
