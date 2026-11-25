package com.haierag.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.haierag.auth.AuthDtos.AuthResponse;
import com.haierag.auth.AuthDtos.AuthResult;
import com.haierag.auth.AuthDtos.LoginRequest;
import com.haierag.auth.AuthDtos.RegisterRequest;
import com.haierag.auth.AuthDtos.UpdateMeRequest;
import com.haierag.common.ApiException;
import com.haierag.common.RateLimiter;
import com.haierag.user.UserDto;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService auth;
    private final RefreshCookies cookies;
    private final RateLimiter rateLimiter;

    public AuthController(AuthService auth, RefreshCookies cookies, RateLimiter rateLimiter) {
        this.auth = auth;
        this.cookies = cookies;
        this.rateLimiter = rateLimiter;
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest body, HttpServletRequest req) {
        rateLimiter.checkAuth(req.getRemoteAddr());
        return withCookie(HttpStatus.CREATED, auth.register(body, req.getHeader(HttpHeaders.USER_AGENT)));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest body, HttpServletRequest req) {
        rateLimiter.checkAuth(req.getRemoteAddr());
        return withCookie(HttpStatus.OK, auth.login(body, req.getHeader(HttpHeaders.USER_AGENT)));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(@CookieValue(name = RefreshCookies.NAME, required = false) String token,
                                                HttpServletRequest req) {
        rateLimiter.checkAuth(req.getRemoteAddr());
        try {
            return withCookie(HttpStatus.OK, auth.refresh(token, req.getHeader(HttpHeaders.USER_AGENT)));
        } catch (ApiException e) {
            if (e.getStatus() == HttpStatus.UNAUTHORIZED) {
                // Make sure a dead cookie does not linger in the browser.
                throw new ClearCookieException(e);
            }
            throw e;
        }
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@CookieValue(name = RefreshCookies.NAME, required = false) String token) {
        auth.logout(token);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookies.clear().toString()).build();
    }

    @GetMapping("/me")
    public UserDto me(CurrentUser user) {
        return auth.me(user.id());
    }

    @PutMapping("/me")
    public UserDto updateMe(CurrentUser user, @Valid @RequestBody UpdateMeRequest body) {
        return auth.updateMe(user.id(), body.displayName());
    }

    private ResponseEntity<AuthResponse> withCookie(HttpStatus status, AuthResult result) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.SET_COOKIE, cookies.issue(result.refreshToken()).toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(result.response());
    }

    @org.springframework.web.bind.annotation.ExceptionHandler(ClearCookieException.class)
    public ResponseEntity<org.springframework.http.ProblemDetail> handleClearCookie(ClearCookieException e, HttpServletRequest req) {
        return ResponseEntity.status(e.getStatus())
                .header(HttpHeaders.SET_COOKIE, cookies.clear().toString())
                .contentType(org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON)
                .body(com.haierag.common.GlobalExceptionHandler.problem(e.getStatus(), e.getMessage(), req.getRequestURI()));
    }

    /** 401 that also clears the refresh cookie. */
    public static class ClearCookieException extends ApiException {
        public ClearCookieException(ApiException cause) {
            super(cause.getStatus(), cause.getMessage());
        }
    }
}
