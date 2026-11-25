package com.haierag.collection;

import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class CollectionDtos {

    private CollectionDtos() {
    }

    public record CollectionRequest(@NotBlank @Size(max = 120) String name, @Size(max = 1000) String description) {
    }

    public record CollectionDto(UUID id, UUID workspaceId, String name, String description, long documentCount,
                                Instant createdAt, Instant updatedAt) {
    }
}
