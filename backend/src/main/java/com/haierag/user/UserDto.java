package com.haierag.user;

import java.time.Instant;
import java.util.UUID;

public record UserDto(UUID id, String email, String displayName, String systemRole, Instant createdAt) {

    public static UserDto of(User u) {
        return new UserDto(u.getId(), u.getEmail(), u.getDisplayName(), u.getSystemRole(), u.getCreatedAt());
    }
}
