package com.haierag.config;

import java.nio.charset.StandardCharsets;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Component;

/** Refuses to start in production with weak or default secrets. */
@Component
public class StartupGuard implements InitializingBean {

    private static final Logger log = LoggerFactory.getLogger(StartupGuard.class);

    private final AppProperties props;

    public StartupGuard(AppProperties props) {
        this.props = props;
    }

    @Override
    public void afterPropertiesSet() {
        String secret = props.jwt().secret();
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalStateException("JWT_SECRET must be at least 32 bytes");
        }
        boolean weak = secret.startsWith("dev-only") || secret.startsWith("change-me");
        if (props.isProduction() && weak) {
            throw new IllegalStateException("JWT_SECRET uses a default value; set a random secret for production");
        }
        if (weak) {
            log.warn("JWT_SECRET is a development default; never use it in production");
        }
        if (props.ai().internalToken() == null || props.ai().internalToken().isBlank()) {
            log.warn("INTERNAL_API_TOKEN is empty; calls to the AI service will be rejected");
        }
    }
}
