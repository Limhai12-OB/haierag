package com.haierag.collection;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.haierag.audit.AuditService;
import com.haierag.auth.CurrentUser;
import com.haierag.collection.CollectionDtos.CollectionDto;
import com.haierag.collection.CollectionDtos.CollectionRequest;
import com.haierag.common.ApiException;
import com.haierag.workspace.Role;
import com.haierag.workspace.WorkspaceAccess;
import com.haierag.workspace.WorkspaceService;

@Service
public class CollectionService {

    private static final String SELECT = """
            select c.id, c.workspace_id, c.name, c.description,
                   (select count(*) from documents d where d.collection_id = c.id), c.created_at, c.updated_at
            from collections c""";

    private final JdbcClient jdbc;
    private final WorkspaceAccess access;
    private final AuditService audit;

    public CollectionService(JdbcClient jdbc, WorkspaceAccess access, AuditService audit) {
        this.jdbc = jdbc;
        this.access = access;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public List<CollectionDto> list(UUID workspaceId, CurrentUser user) {
        access.require(workspaceId, user, Role.VIEWER);
        return jdbc.sql(SELECT + " where c.workspace_id = ? order by lower(c.name)").param(workspaceId)
                .query(this::map).list();
    }

    @Transactional
    public CollectionDto create(UUID workspaceId, CollectionRequest req, CurrentUser user) {
        access.require(workspaceId, user, Role.MEMBER);
        UUID id;
        try {
            id = jdbc.sql("insert into collections (workspace_id, name, description, created_by) values (?, ?, ?, ?) returning id")
                    .params(workspaceId, req.name().trim(), blankToNull(req.description()), user.id())
                    .query(UUID.class).single();
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A collection with this name already exists");
        }
        audit.record(user.id(), workspaceId, "collection.create", "COLLECTION", id, Map.of("name", req.name().trim()));
        return get(id);
    }

    @Transactional
    public CollectionDto update(UUID id, CollectionRequest req, CurrentUser user) {
        UUID ws = requireCollection(id, user, Role.MEMBER);
        try {
            jdbc.sql("update collections set name = ?, description = ? where id = ?")
                    .params(req.name().trim(), blankToNull(req.description()), id).update();
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A collection with this name already exists");
        }
        audit.record(user.id(), ws, "collection.update", "COLLECTION", id, Map.of("name", req.name().trim()));
        return get(id);
    }

    @Transactional
    public void delete(UUID id, CurrentUser user) {
        UUID ws = requireCollection(id, user, Role.MEMBER);
        String name = jdbc.sql("select name from collections where id = ?").param(id).query(String.class).single();
        jdbc.sql("delete from collections where id = ?").param(id).update(); // documents.collection_id -> NULL (FK)
        audit.record(user.id(), ws, "collection.delete", "COLLECTION", id, Map.of("name", name));
    }

    /** Returns the collection's workspace id after checking the caller's role (404 if not visible). */
    public UUID requireCollection(UUID id, CurrentUser user, Role min) {
        UUID ws = jdbc.sql("select workspace_id from collections where id = ?").param(id).query(UUID.class).optional()
                .orElseThrow(() -> ApiException.notFound("Collection"));
        try {
            access.require(ws, user, min);
        } catch (ApiException e) {
            if (e.getStatus().value() == 404) {
                throw ApiException.notFound("Collection");
            }
            throw e;
        }
        return ws;
    }

    public boolean belongsTo(UUID collectionId, UUID workspaceId) {
        return jdbc.sql("select exists(select 1 from collections where id = ? and workspace_id = ?)")
                .params(collectionId, workspaceId).query(Boolean.class).single();
    }

    private CollectionDto get(UUID id) {
        return jdbc.sql(SELECT + " where c.id = ?").param(id).query(this::map).single();
    }

    private CollectionDto map(java.sql.ResultSet rs, int n) throws java.sql.SQLException {
        return new CollectionDto(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getString(3),
                rs.getString(4), rs.getLong(5), WorkspaceService.instant(rs, 6), WorkspaceService.instant(rs, 7));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
