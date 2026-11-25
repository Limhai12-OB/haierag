package com.haierag.workspace;

import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

import com.haierag.auth.CurrentUser;
import com.haierag.common.ApiException;

/**
 * Central workspace authorization. Non-members get 404 (never reveal existence);
 * members below the required role get 403. System ADMINs may read (VIEWER level) any workspace.
 */
@Component
public class WorkspaceAccess {

    private final JdbcClient jdbc;

    public WorkspaceAccess(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Role> roleOf(UUID workspaceId, UUID userId) {
        return jdbc.sql("select role from workspace_members where workspace_id = ? and user_id = ?")
                .params(workspaceId, userId).query(String.class).optional().map(Role::valueOf);
    }

    /** Returns the caller's effective role or throws 404/403. */
    public Role require(UUID workspaceId, CurrentUser user, Role min) {
        Optional<Role> role = roleOf(workspaceId, user.id());
        if (role.isEmpty()) {
            if (user.isAdmin() && min == Role.VIEWER && exists(workspaceId)) {
                return Role.VIEWER;
            }
            throw ApiException.notFound("Workspace");
        }
        if (!role.get().atLeast(min)) {
            throw ApiException.forbidden("This action requires the " + min + " role");
        }
        return role.get();
    }

    public boolean exists(UUID workspaceId) {
        return jdbc.sql("select exists(select 1 from workspaces where id = ?)").param(workspaceId)
                .query(Boolean.class).single();
    }
}
