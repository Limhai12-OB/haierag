package com.haierag.document;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import tools.jackson.databind.json.JsonMapper;

/** Producer side of the Redis ingestion queue consumed by the AI service worker (ADR-003). */
@Component
public class IngestQueue {

    public static final String KEY = "haierag:ingest:queue";
    private static final Logger log = LoggerFactory.getLogger(IngestQueue.class);

    private final StringRedisTemplate redis;
    private final JsonMapper mapper;

    public IngestQueue(StringRedisTemplate redis, JsonMapper mapper) {
        this.redis = redis;
        this.mapper = mapper;
    }

    public void push(UUID jobId, UUID documentId, UUID versionId) {
        Map<String, String> msg = new LinkedHashMap<>();
        msg.put("jobId", jobId.toString());
        msg.put("documentId", documentId.toString());
        msg.put("versionId", versionId.toString());
        try {
            redis.opsForList().leftPush(KEY, mapper.writeValueAsString(msg));
        } catch (RuntimeException e) {
            // The job row stays QUEUED; the AI worker re-enqueues QUEUED jobs on start-up (ADR-003).
            log.warn("Could not enqueue ingestion job {}: {}", jobId, e.toString());
        }
    }
}
