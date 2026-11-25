package com.haierag.system;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import jakarta.annotation.PreDestroy;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.haierag.ai.AiClient;
import com.haierag.document.DocumentDtos.AdminJobDto;
import com.haierag.document.DocumentService;
import com.haierag.storage.StorageService;
import com.haierag.user.UserDto;
import com.haierag.user.UserRepository;

@RestController
@RequestMapping("/api/v1")
public class SystemController {

    private final JdbcClient jdbc;
    private final StringRedisTemplate redis;
    private final StorageService storage;
    private final AiClient ai;
    private final UserRepository users;
    private final DocumentService documents;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public SystemController(JdbcClient jdbc, StringRedisTemplate redis, StorageService storage, AiClient ai,
                            UserRepository users, DocumentService documents) {
        this.jdbc = jdbc;
        this.redis = redis;
        this.storage = storage;
        this.ai = ai;
        this.users = users;
        this.documents = documents;
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    /** Pings every dependency in parallel with short timeouts. */
    @GetMapping("/system/health")
    public Map<String, Object> health() {
        CompletableFuture<String> db = check(() -> jdbc.sql("select 1").query(Integer.class).single());
        CompletableFuture<String> rd = check(() -> redis.execute((org.springframework.data.redis.core.RedisCallback<String>) c -> c.ping()));
        CompletableFuture<String> st = check(() -> {
            storage.ping();
            return "ok";
        });
        CompletableFuture<Map<String, Object>> aiHealth = CompletableFuture.supplyAsync(ai::health, executor);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("backend", "UP");
        out.put("database", await(db));
        out.put("redis", await(rd));
        out.put("storage", await(st));
        Map<String, Object> aiResult;
        try {
            aiResult = aiHealth.get(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            aiResult = Map.of("status", "down", "components", Map.of(), "detail", "timeout");
        }
        out.put("aiService", aiResult);
        return out;
    }

    private CompletableFuture<String> check(Supplier<?> probe) {
        return CompletableFuture.supplyAsync(() -> {
            probe.get();
            return "UP";
        }, executor);
    }

    private static String await(CompletableFuture<String> f) {
        try {
            return f.get(3, TimeUnit.SECONDS);
        } catch (Exception e) {
            return "DOWN";
        }
    }

    @GetMapping("/admin/users")
    public List<UserDto> adminUsers() {
        return users.findAllByOrderByCreatedAtDesc().stream().map(UserDto::of).toList();
    }

    @GetMapping("/admin/jobs")
    public List<AdminJobDto> adminJobs(@RequestParam(required = false) String status) {
        return documents.recentJobs(status);
    }
}
