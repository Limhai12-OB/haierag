package com.haierag.auth;

import java.time.Duration;

import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import com.haierag.config.AppProperties;

@Component
public class RefreshCookies {

    public static final String NAME = "haierag_refresh";
    public static final String PATH = "/api/v1/auth";

    private final AppProperties props;

    public RefreshCookies(AppProperties props) {
        this.props = props;
    }

    public ResponseCookie issue(String token) {
        return base(token).maxAge(Duration.ofDays(props.jwt().refreshTtlDays())).build();
    }

    public ResponseCookie clear() {
        return base("").maxAge(Duration.ZERO).build();
    }

    private ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(NAME, value)
                .httpOnly(true)
                .secure(props.isProduction())
                .sameSite("Strict")
                .path(PATH);
    }
}
