package com.haierag.workspace;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public final class WorkspaceDtos {

    private WorkspaceDtos() {
    }

    public record WorkspaceRequest(@NotBlank @Size(max = 120) String name, @Size(max = 1000) String description) {
    }

    public record AddMemberRequest(@NotBlank @Email @Size(max = 320) String email, @NotNull Role role) {
    }

    public record UpdateMemberRequest(@NotNull Role role) {
    }

    public record WorkspaceDto(UUID id, String name, String description, Role role, Instant createdAt, Instant updatedAt) {
    }

    public record MemberDto(UUID userId, String email, String displayName, Role role, Instant joinedAt) {
    }

    public record WorkspaceStats(long documents, long collections, long chunks, long conversations,
                                 Map<String, Long> documentsByStatus) {
    }

    public record Activity(long id, String action, String entityType, UUID entityId, String actorName,
                           Map<String, Object> details, Instant createdAt) {
    }
}
