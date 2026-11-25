package com.haierag.conversation;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.haierag.auth.CurrentUser;
import com.haierag.collection.CollectionService;
import com.haierag.common.ApiException;
import com.haierag.common.Json;
import com.haierag.conversation.ConversationDtos.CitationDto;
import com.haierag.conversation.ConversationDtos.ConversationDetail;
import com.haierag.conversation.ConversationDtos.ConversationDto;
import com.haierag.conversation.ConversationDtos.ConversationRow;
import com.haierag.conversation.ConversationDtos.CreateConversationRequest;
import com.haierag.conversation.ConversationDtos.HistoryItem;
import com.haierag.conversation.ConversationDtos.MessageDto;
import com.haierag.conversation.ConversationDtos.ScopeType;
import com.haierag.workspace.Role;
import com.haierag.workspace.WorkspaceAccess;
import com.haierag.workspace.WorkspaceService;

@Service
public class ConversationService {

    public static final String DEFAULT_TITLE = "New conversation";

    private static final String SELECT = """
            select id, workspace_id, user_id, title, scope_type, collection_id, created_at, updated_at
            from conversations""";

    private final JdbcClient jdbc;
    private final WorkspaceAccess access;
    private final CollectionService collections;
    private final Json json;

    public ConversationService(JdbcClient jdbc, WorkspaceAccess access, CollectionService collections, Json json) {
        this.jdbc = jdbc;
        this.access = access;
        this.collections = collections;
        this.json = json;
    }

    @Transactional
    public ConversationDto create(CreateConversationRequest req, CurrentUser user) {
        access.require(req.workspaceId(), user, Role.VIEWER);
        ScopeType scope = req.scopeType();
        if (scope == null) {
            scope = req.documentIds() != null && !req.documentIds().isEmpty() ? ScopeType.DOCUMENTS
                    : req.collectionId() != null ? ScopeType.COLLECTION : ScopeType.WORKSPACE;
        }
        UUID collectionId = null;
        List<UUID> documentIds = List.of();
        switch (scope) {
            case COLLECTION -> {
                if (req.collectionId() == null) {
                    throw ApiException.badField("collectionId", "is required for COLLECTION scope");
                }
                if (!collections.belongsTo(req.collectionId(), req.workspaceId())) {
                    throw ApiException.badField("collectionId", "Collection not found in this workspace");
                }
                collectionId = req.collectionId();
            }
            case DOCUMENTS -> {
                if (req.documentIds() == null || req.documentIds().isEmpty()) {
                    throw ApiException.badField("documentIds", "at least one document is required for DOCUMENTS scope");
                }
                documentIds = new ArrayList<>(new LinkedHashSet<>(req.documentIds()));
                long found = jdbc.sql("select count(*) from documents where workspace_id = :ws and id in (:ids)")
                        .param("ws", req.workspaceId()).param("ids", documentIds).query(Long.class).single();
                if (found != documentIds.size()) {
                    throw ApiException.badField("documentIds", "One or more documents were not found in this workspace");
                }
            }
            case WORKSPACE -> {
                // no extra scope
            }
        }
        String title = req.title() == null || req.title().isBlank() ? DEFAULT_TITLE : req.title().trim();
        UUID id = jdbc.sql("""
                        insert into conversations (workspace_id, user_id, title, scope_type, collection_id)
                        values (?, ?, ?, ?, ?) returning id""")
                .params(req.workspaceId(), user.id(), title, scope.name(), collectionId).query(UUID.class).single();
        for (UUID docId : documentIds) {
            jdbc.sql("insert into conversation_documents (conversation_id, document_id) values (?, ?)")
                    .params(id, docId).update();
        }
        return toDto(row(id).orElseThrow());
    }

    @Transactional(readOnly = true)
    public List<ConversationDto> list(UUID workspaceId, CurrentUser user) {
        List<ConversationRow> rows;
        if (workspaceId != null) {
            access.require(workspaceId, user, Role.VIEWER);
            rows = jdbc.sql(SELECT + " where user_id = ? and workspace_id = ? order by updated_at desc limit 500")
                    .params(user.id(), workspaceId).query(ConversationService::mapRow).list();
        } else {
            rows = jdbc.sql(SELECT + """
                             c where c.user_id = ? and exists (select 1 from workspace_members m
                                 where m.workspace_id = c.workspace_id and m.user_id = c.user_id)
                             order by c.updated_at desc limit 500""")
                    .param(user.id()).query(ConversationService::mapRow).list();
        }
        return rows.stream().map(this::toDto).toList();
    }

    @Transactional(readOnly = true)
    public ConversationDetail detail(UUID id, CurrentUser user) {
        ConversationRow c = requireOwned(id, user);
        return new ConversationDetail(c.id(), c.workspaceId(), c.title(), c.scopeType(), c.collectionId(),
                documentIds(c.id()), c.createdAt(), c.updatedAt(), messages(c.id()));
    }

    @Transactional
    public ConversationDto rename(UUID id, String title, CurrentUser user) {
        requireOwned(id, user);
        jdbc.sql("update conversations set title = ? where id = ?").params(title.trim(), id).update();
        return toDto(row(id).orElseThrow());
    }

    @Transactional
    public void delete(UUID id, CurrentUser user) {
        requireOwned(id, user);
        jdbc.sql("delete from conversations where id = ?").param(id).update();
    }

    /** Conversations are private to their creator, who must still be able to read the workspace. Otherwise 404. */
    public ConversationRow requireOwned(UUID id, CurrentUser user) {
        ConversationRow c = row(id).filter(r -> r.userId().equals(user.id()))
                .orElseThrow(() -> ApiException.notFound("Conversation"));
        try {
            access.require(c.workspaceId(), user, Role.VIEWER);
        } catch (ApiException e) {
            throw ApiException.notFound("Conversation");
        }
        return c;
    }

    public Optional<ConversationRow> row(UUID id) {
        return jdbc.sql(SELECT + " where id = ?").param(id).query(ConversationService::mapRow).optional();
    }

    public List<UUID> documentIds(UUID conversationId) {
        return jdbc.sql("select document_id from conversation_documents where conversation_id = ? order by document_id")
                .param(conversationId).query(UUID.class).list();
    }

    // ---------------------------------------------------------------- messages

    public List<MessageDto> messages(UUID conversationId) {
        List<MessageDto> msgs = jdbc.sql("""
                        select id, role, content, status, metadata::text, created_at from messages
                        where conversation_id = ? order by created_at, id""")
                .param(conversationId)
                .query((rs, n) -> new MessageDto(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getString(4), new ArrayList<>(), json.toMap(rs.getString(5)), WorkspaceService.instant(rs, 6)))
                .list();
        if (msgs.isEmpty()) {
            return msgs;
        }
        Map<UUID, MessageDto> byId = new java.util.HashMap<>();
        msgs.forEach(m -> byId.put(m.id(), m));
        jdbc.sql("""
                        select mc.message_id, mc.marker, mc.chunk_id, mc.document_id, mc.document_name, mc.page_number,
                               mc.section_heading, mc.excerpt, mc.retrieval_score, mc.rerank_score
                        from message_citations mc join messages m on m.id = mc.message_id
                        where m.conversation_id = ? order by mc.message_id, mc.marker""")
                .param(conversationId)
                .query((rs, n) -> {
                    MessageDto m = byId.get(rs.getObject(1, UUID.class));
                    if (m != null) {
                        m.citations().add(mapCitation(rs, 2));
                    }
                    return null;
                }).list();
        return msgs;
    }

    public MessageDto message(UUID messageId) {
        MessageDto m = jdbc.sql("select id, role, content, status, metadata::text, created_at from messages where id = ?")
                .param(messageId)
                .query((rs, n) -> new MessageDto(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3),
                        rs.getString(4), new ArrayList<>(), json.toMap(rs.getString(5)), WorkspaceService.instant(rs, 6)))
                .single();
        m.citations().addAll(jdbc.sql("""
                        select marker, chunk_id, document_id, document_name, page_number, section_heading, excerpt,
                               retrieval_score, rerank_score
                        from message_citations where message_id = ? order by marker""")
                .param(messageId).query((rs, n) -> mapCitation(rs, 1)).list());
        return m;
    }

    /** Most recent completed messages, oldest first; optionally only those created before {@code before}. */
    public List<HistoryItem> history(UUID conversationId, int limit, UUID beforeMessageId) {
        List<HistoryItem> items;
        if (beforeMessageId == null) {
            items = jdbc.sql("""
                            select role, content from messages where conversation_id = ? and status = 'COMPLETED'
                            order by created_at desc, id desc limit ?""")
                    .params(conversationId, limit)
                    .query((rs, n) -> new HistoryItem(rs.getString(1), rs.getString(2))).list();
        } else {
            items = jdbc.sql("""
                            select role, content from messages where conversation_id = ? and status = 'COMPLETED'
                              and created_at < (select created_at from messages where id = ?)
                            order by created_at desc, id desc limit ?""")
                    .params(conversationId, beforeMessageId, limit)
                    .query((rs, n) -> new HistoryItem(rs.getString(1), rs.getString(2))).list();
        }
        List<HistoryItem> chronological = new ArrayList<>(items);
        Collections.reverse(chronological);
        return chronological;
    }

    public long messageCount(UUID conversationId) {
        return jdbc.sql("select count(*) from messages where conversation_id = ?").param(conversationId)
                .query(Long.class).single();
    }

    /** Last message of the conversation, as (id, role, content). */
    public Optional<Object[]> lastMessage(UUID conversationId) {
        return jdbc.sql("select id, role, content from messages where conversation_id = ? order by created_at desc, id desc limit 1")
                .param(conversationId)
                .query((rs, n) -> new Object[]{rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3)})
                .optional();
    }

    /** The latest USER message created at or before the given message. */
    public Optional<Object[]> lastUserMessageBefore(UUID conversationId, UUID messageId) {
        return jdbc.sql("""
                        select id, content from messages where conversation_id = ? and role = 'USER'
                          and created_at <= (select created_at from messages where id = ?)
                        order by created_at desc, id desc limit 1""")
                .params(conversationId, messageId)
                .query((rs, n) -> new Object[]{rs.getObject(1, UUID.class), rs.getString(2)})
                .optional();
    }

    public UUID insertMessage(UUID conversationId, String role, String content, String status, String model,
                              Integer promptTokens, Integer completionTokens, Integer latencyMs, Map<String, ?> metadata) {
        UUID id = jdbc.sql("""
                        insert into messages (conversation_id, role, content, status, model, prompt_tokens,
                                              completion_tokens, latency_ms, metadata)
                        values (?, ?, ?, ?, ?, ?, ?, ?, cast(? as jsonb)) returning id""")
                .params(conversationId, role, content, status, model, promptTokens, completionTokens, latencyMs,
                        json.write(metadata))
                .query(UUID.class).single();
        jdbc.sql("update conversations set updated_at = now() where id = ?").param(conversationId).update();
        return id;
    }

    public void insertCitations(UUID messageId, List<CitationDto> citations) {
        for (CitationDto c : citations) {
            jdbc.sql("""
                            insert into message_citations (message_id, marker, chunk_id, document_id, document_name,
                                                           page_number, section_heading, excerpt, retrieval_score, rerank_score)
                            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
                    .params(messageId, c.marker(), c.chunkId(), c.documentId(), c.documentName(), c.pageNumber(),
                            c.sectionHeading(), c.excerpt(), c.retrievalScore(), c.rerankScore())
                    .update();
        }
    }

    public void deleteMessage(UUID messageId) {
        jdbc.sql("delete from messages where id = ?").param(messageId).update();
    }

    public void autoTitle(UUID conversationId, String question) {
        String t = question.replaceAll("\\s+", " ").trim();
        if (t.length() > 80) {
            int cut = t.lastIndexOf(' ', 80);
            t = (cut > 40 ? t.substring(0, cut) : t.substring(0, 80)) + "…";
        }
        if (!t.isEmpty()) {
            jdbc.sql("update conversations set title = ? where id = ? and title = ?")
                    .params(t, conversationId, DEFAULT_TITLE).update();
        }
    }

    // ---------------------------------------------------------------- mapping

    ConversationDto toDto(ConversationRow c) {
        return new ConversationDto(c.id(), c.workspaceId(), c.title(), c.scopeType(), c.collectionId(),
                documentIds(c.id()), c.createdAt(), c.updatedAt());
    }

    static ConversationRow mapRow(ResultSet rs, int n) throws SQLException {
        return new ConversationRow(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getObject(3, UUID.class),
                rs.getString(4), ScopeType.valueOf(rs.getString(5)), rs.getObject(6, UUID.class),
                WorkspaceService.instant(rs, 7), WorkspaceService.instant(rs, 8));
    }

    static CitationDto mapCitation(ResultSet rs, int start) throws SQLException {
        return new CitationDto(rs.getInt(start), rs.getObject(start + 1, UUID.class), rs.getObject(start + 2, UUID.class),
                rs.getString(start + 3), (Integer) rs.getObject(start + 4), rs.getString(start + 5),
                rs.getString(start + 6), (Double) rs.getObject(start + 7), (Double) rs.getObject(start + 8));
    }

    static ApiException scopeGone(String detail) {
        return new ApiException(HttpStatus.CONFLICT, detail);
    }
}
