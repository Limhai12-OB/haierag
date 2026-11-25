package com.haierag.audit;

import java.util.Map;
import java.util.UUID;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import com.haierag.common.Json;

/** Writes rows into {@code audit_logs}. Never pass secrets or document content in {@code details}. */
@Service
public class AuditService {

    private final JdbcClient jdbc;
    private final Json json;

    public AuditService(JdbcClient jdbc, Json json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public void record(UUID actorId, UUID workspaceId, String action, String entityType, UUID entityId,
                       Map<String, ?> details) {
        jdbc.sql("""
                        insert into audit_logs (actor_id, workspace_id, action, entity_type, entity_id, details, ip_address)
                        values (?, ?, ?, ?, ?, cast(? as jsonb), ?)""")
                .params(actorId, workspaceId, action, entityType, entityId, json.write(details), clientIp())
                .update();
    }

    private static String clientIp() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
            HttpServletRequest req = attrs.getRequest();
            String ip = req.getRemoteAddr();
            return ip != null && ip.length() > 64 ? ip.substring(0, 64) : ip;
        }
        return null;
    }
}
