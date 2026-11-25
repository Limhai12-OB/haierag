package com.haierag.auth;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import com.haierag.common.RateLimitedException;
import com.haierag.common.RateLimiter;
import com.haierag.support.IntegrationTest;

class RateLimiterIT extends IntegrationTest {

    @Autowired
    RateLimiter limiter;

    @Test
    void fixedWindowBlocksAfterLimit() {
        String subject = UUID.randomUUID().toString();
        for (int i = 0; i < 3; i++) {
            limiter.check("test", subject, 3);
        }
        assertThatThrownBy(() -> limiter.check("test", subject, 3)).isInstanceOf(RateLimitedException.class);
    }
}
