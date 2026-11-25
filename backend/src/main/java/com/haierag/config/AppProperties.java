package com.haierag.config;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("haierag")
public record AppProperties(
        String env,
        Jwt jwt,
        String bootstrapAdminEmail,
        String corsAllowedOrigins,
        int maxUploadSizeMb,
        Storage storage,
        Ai ai,
        RateLimit rateLimit) {

    public boolean isProduction() {
        return "production".equalsIgnoreCase(env);
    }

    public long maxUploadBytes() {
        return (long) maxUploadSizeMb * 1024L * 1024L;
    }

    public List<String> corsOrigins() {
        if (corsAllowedOrigins == null || corsAllowedOrigins.isBlank()) {
            return List.of();
        }
        return Arrays.stream(corsAllowedOrigins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    public record Jwt(String secret, int accessTtlMinutes, int refreshTtlDays) {
    }

    public record Storage(String endpoint, String accessKey, String secretKey, String bucket, String region) {
    }

    public record Ai(String baseUrl, String internalToken, Duration connectTimeout, Duration healthTimeout,
                     Duration chatTimeout, int historyMessages) {
    }

    public record RateLimit(boolean enabled, int authPerMinute, int chatPerMinute) {
    }
}
