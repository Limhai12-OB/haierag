package com.haierag.auth;

import java.util.UUID;

/** The authenticated caller, resolved from the access token. */
public record CurrentUser(UUID id, String email, String systemRole) {

    public boolean isAdmin() {
        return "ADMIN".equals(systemRole);
    }
}
