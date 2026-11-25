package com.haierag.workspace;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.haierag.audit.AuditService;
import com.haierag.auth.CurrentUser;
import com.haierag.common.AfterCommit;
import com.haierag.common.ApiException;
import com.haierag.common.Json;
import com.haierag.storage.StorageService;
import com.haierag.workspace.WorkspaceDtos.Activity;
import com.haierag.workspace.WorkspaceDtos.AddMemberRequest;
import com.haierag.workspace.WorkspaceDtos.MemberDto;
import com.haierag.workspace.WorkspaceDtos.WorkspaceDto;
import com.haierag.workspace.WorkspaceDtos.WorkspaceRequest;
import com.haierag.workspace.WorkspaceDtos.WorkspaceStats;

@Service
public class WorkspaceService {

    private static final List<String> STATUSES = List.of("UPLOADED", "QUEUED", "PROCESSING", "COMPLETED", "FAILED");

    private final JdbcClient jdbc;
    private final WorkspaceAccess access;
    private final AuditService audit;
    private final StorageService storage;
    private final Json json;

    public WorkspaceService(JdbcClient jdbc, WorkspaceAccess access, AuditService audit, StorageService storage, Json json) {
        this.jdbc = jdbc;
        this.access = access;
        this.audit = audit;
        this.storage = storage;
        this.json = json;
    }

    @Transactional(readOnly = true)
    public List<WorkspaceDto> list(CurrentUser user) {
        return jdbc.sql("""
                        select w.id, w.name, w.description, m.role, w.created_at, w.updated_at
                        from workspaces w join workspace_members m on m.workspace_id = w.id
                        where m.user_id = ? order by w.created_at desc""")
                .param(user.id()).query(WorkspaceService::mapWorkspace).list();
    }

    @Transactional(readOnly = true)
    public WorkspaceDto get(UUID id, CurrentUser user) {
        Role role = access.require(id, user, Role.VIEWER);
        return load(id, role);
    }

    @Transactional
    public WorkspaceDto create(WorkspaceRequest req, CurrentUser user) {
        UUID id = jdbc.sql("insert into workspaces (name, description, created_by) values (?, ?, ?) returning id")
                .params(req.name().trim(), blankToNull(req.description()), user.id()).query(UUID.class).single();
        jdbc.sql("insert into workspace_members (workspace_id, user_id, role) values (?, ?, 'OWNER')")
                .params(id, user.id()).update();
        audit.record(user.id(), id, "workspace.create", "WORKSPACE", id, Map.of("name", req.name().trim()));
        return load(id, Role.OWNER);
    }

    @Transactional
    public WorkspaceDto update(UUID id, WorkspaceRequest req, CurrentUser user) {
        Role role = access.require(id, user, Role.OWNER);
        jdbc.sql("update workspaces set name = ?, description = ? where id = ?")
                .params(req.name().trim(), blankToNull(req.description()), id).update();
        audit.record(user.id(), id, "workspace.update", "WORKSPACE", id, Map.of("name", req.name().trim()));
        return load(id, role);
    }

    @Transactional
    public void delete(UUID id, CurrentUser user) {
        access.require(id, user, Role.OWNER);
        List<String> keys = jdbc.sql("""
                        select v.storage_key from document_versions v join documents d on d.id = v.document_id
                        where d.workspace_id = ?""").param(id).query(String.class).list();
        String name = jdbc.sql("select name from workspaces where id = ?").param(id).query(String.class).single();
        audit.record(user.id(), null, "workspace.delete", "WORKSPACE", id, Map.of("name", name, "objects", keys.size()));
        jdbc.sql("delete from workspaces where id = ?").param(id).update();
        if (!keys.isEmpty()) {
            AfterCommit.run("delete workspace objects", () -> storage.delete(keys));
        }
    }

    // ---------------------------------------------------------------- members

    @Transactional(readOnly = true)
    public List<MemberDto> members(UUID id, CurrentUser user) {
        access.require(id, user, Role.VIEWER);
        return jdbc.sql("""
                        select u.id, u.email, u.display_name, m.role, m.created_at
                        from workspace_members m join users u on u.id = m.user_id
                        where m.workspace_id = ? order by m.created_at""")
                .param(id).query(WorkspaceService::mapMember).list();
    }

    @Transactional
    public MemberDto addMember(UUID id, AddMemberRequest req, CurrentUser user) {
        access.require(id, user, Role.OWNER);
        UUID userId = jdbc.sql("select id from users where lower(email) = lower(?)").param(req.email().trim())
                .query(UUID.class).optional()
                .orElseThrow(() -> ApiException.notFound("User"));
        if (access.roleOf(id, userId).isPresent()) {
            throw ApiException.conflict("User is already a member of this workspace");
        }
        jdbc.sql("insert into workspace_members (workspace_id, user_id, role) values (?, ?, ?)")
                .params(id, userId, req.role().name()).update();
        audit.record(user.id(), id, "member.add", "USER", userId, Map.of("role", req.role().name()));
        return member(id, userId);
    }

    @Transactional
    public MemberDto updateMember(UUID id, UUID userId, Role role, CurrentUser user) {
        access.require(id, user, Role.OWNER);
        Role current = lockMemberRole(id, userId);
        if (current == Role.OWNER && role != Role.OWNER && ownerCount(id) <= 1) {
            throw ApiException.conflict("The last owner cannot be demoted");
        }
        jdbc.sql("update workspace_members set role = ? where workspace_id = ? and user_id = ?")
                .params(role.name(), id, userId).update();
        audit.record(user.id(), id, "member.update", "USER", userId, Map.of("from", current.name(), "to", role.name()));
        return member(id, userId);
    }

    @Transactional
    public void removeMember(UUID id, UUID userId, CurrentUser user) {
        access.require(id, user, Role.OWNER);
        Role current = lockMemberRole(id, userId);
        if (current == Role.OWNER && ownerCount(id) <= 1) {
            throw ApiException.conflict("The last owner cannot be removed");
        }
        jdbc.sql("delete from workspace_members where workspace_id = ? and user_id = ?").params(id, userId).update();
        audit.record(user.id(), id, "member.remove", "USER", userId, Map.of("role", current.name()));
    }

    private Role lockMemberRole(UUID id, UUID userId) {
        // Lock all owner rows too, so two concurrent demotions cannot both pass the last-owner check.
        jdbc.sql("select user_id from workspace_members where workspace_id = ? and role = 'OWNER' for update")
                .param(id).query(UUID.class).list();
        return jdbc.sql("select role from workspace_members where workspace_id = ? and user_id = ? for update")
                .params(id, userId).query(String.class).optional().map(Role::valueOf)
                .orElseThrow(() -> ApiException.notFound("Member"));
    }

    private long ownerCount(UUID id) {
        return jdbc.sql("select count(*) from workspace_members where workspace_id = ? and role = 'OWNER'")
                .param(id).query(Long.class).single();
    }

    private MemberDto member(UUID id, UUID userId) {
        return jdbc.sql("""
                        select u.id, u.email, u.display_name, m.role, m.created_at
                        from workspace_members m join users u on u.id = m.user_id
                        where m.workspace_id = ? and m.user_id = ?""")
                .params(id, userId).query(WorkspaceService::mapMember).single();
    }

    // ---------------------------------------------------------------- stats & activity

    @Transactional(readOnly = true)
    public WorkspaceStats stats(UUID id, CurrentUser user) {
        access.require(id, user, Role.VIEWER);
        Map<String, Long> byStatus = new LinkedHashMap<>();
        STATUSES.forEach(s -> byStatus.put(s, 0L));
        jdbc.sql("select status, count(*) from documents where workspace_id = ? group by status").param(id)
                .query((rs, n) -> Map.entry(rs.getString(1), rs.getLong(2))).list()
                .forEach(e -> byStatus.put(e.getKey(), e.getValue()));
        long documents = byStatus.values().stream().mapToLong(Long::longValue).sum();
        long collections = count("select count(*) from collections where workspace_id = ?", id);
        long chunks = count("select count(*) from document_chunks where workspace_id = ?", id);
        long conversations = count("select count(*) from conversations where workspace_id = ?", id);
        return new WorkspaceStats(documents, collections, chunks, conversations, byStatus);
    }

    @Transactional(readOnly = true)
    public List<Activity> activity(UUID id, CurrentUser user) {
        access.require(id, user, Role.VIEWER);
        return jdbc.sql("""
                        select a.id, a.action, a.entity_type, a.entity_id, u.display_name, a.details::text, a.created_at
                        from audit_logs a left join users u on u.id = a.actor_id
                        where a.workspace_id = ? order by a.created_at desc, a.id desc limit 50""")
                .param(id)
                .query((rs, n) -> new Activity(rs.getLong(1), rs.getString(2), rs.getString(3),
                        rs.getObject(4, UUID.class), rs.getString(5), json.toMap(rs.getString(6)),
                        instant(rs, 7)))
                .list();
    }

    private long count(String sql, UUID id) {
        return jdbc.sql(sql).param(id).query(Long.class).single();
    }

    private WorkspaceDto load(UUID id, Role role) {
        return jdbc.sql("select id, name, description, ?, created_at, updated_at from workspaces where id = ?")
                .params(role.name(), id).query(WorkspaceService::mapWorkspace).optional()
                .orElseThrow(() -> ApiException.notFound("Workspace"));
    }

    static WorkspaceDto mapWorkspace(ResultSet rs, int n) throws SQLException {
        return new WorkspaceDto(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                Role.valueOf(rs.getString(4)), instant(rs, 5), instant(rs, 6));
    }

    static MemberDto mapMember(ResultSet rs, int n) throws SQLException {
        return new MemberDto(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                Role.valueOf(rs.getString(4)), instant(rs, 5));
    }

    public static Instant instant(ResultSet rs, int col) throws SQLException {
        java.time.OffsetDateTime odt = rs.getObject(col, java.time.OffsetDateTime.class);
        return odt == null ? null : odt.toInstant();
    }

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
