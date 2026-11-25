package com.haierag.common;

import java.time.Duration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import com.haierag.config.AppProperties;

/** Redis fixed-window rate limiter. Fails open if Redis is unreachable. */
@Component
public class RateLimiter {

    private static final Logger log = LoggerFactory.getLogger(RateLimiter.class);
    private static final long WINDOW_SECONDS = 60;

    private final StringRedisTemplate redis;
    private final AppProperties props;

    public RateLimiter(StringRedisTemplate redis, AppProperties props) {
        this.redis = redis;
        this.props = props;
    }

    public void checkAuth(String clientKey) {
        check("auth", clientKey, props.rateLimit().authPerMinute());
    }

    public void checkChat(String userKey) {
        check("chat", userKey, props.rateLimit().chatPerMinute());
    }

    public void check(String bucket, String subject, int limitPerMinute) {
        if (!props.rateLimit().enabled() || limitPerMinute <= 0) {
            return;
        }
        long nowSec = System.currentTimeMillis() / 1000;
        long window = nowSec / WINDOW_SECONDS;
        String key = "haierag:rl:" + bucket + ":" + subject + ":" + window;
        Long count;
        try {
            count = redis.opsForValue().increment(key);
            if (count != null && count == 1L) {
                redis.expire(key, Duration.ofSeconds(WINDOW_SECONDS + 5));
            }
        } catch (RuntimeException e) {
            log.warn("Rate limiter unavailable ({}); allowing request", e.getClass().getSimpleName());
            return;
        }
        if (count != null && count > limitPerMinute) {
            long retryAfter = Math.max(1, (window + 1) * WINDOW_SECONDS - nowSec);
            throw new RateLimitedException(retryAfter);
        }
    }
}
