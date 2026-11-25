package com.haierag.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.haierag.audit.AuditService;
import com.haierag.auth.AuthDtos.AuthResponse;
import com.haierag.auth.AuthDtos.AuthResult;
import com.haierag.auth.AuthDtos.LoginRequest;
import com.haierag.auth.AuthDtos.RegisterRequest;
import com.haierag.common.ApiException;
import com.haierag.config.AppProperties;
import com.haierag.user.User;
import com.haierag.user.UserDto;
import com.haierag.user.UserRepository;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    /** Used to equalise timing when the email is unknown. */
    private final String dummyHash;

    private final UserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final PasswordEncoder passwordEncoder;
    private final JwtEncoder jwtEncoder;
    private final AppProperties props;
    private final AuditService audit;

    public AuthService(UserRepository users, RefreshTokenRepository refreshTokens, PasswordEncoder passwordEncoder,
                       JwtEncoder jwtEncoder, AppProperties props, AuditService audit) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.passwordEncoder = passwordEncoder;
        this.jwtEncoder = jwtEncoder;
        this.props = props;
        this.audit = audit;
        this.dummyHash = passwordEncoder.encode(TokenHashing.newOpaqueToken());
    }

    @Transactional
    public AuthResult register(RegisterRequest req, String userAgent) {
        String email = normalizeEmail(req.email());
        if (users.existsByEmailIgnoreCase(email)) {
            throw ApiException.conflict("An account with this email already exists");
        }
        String bootstrap = props.bootstrapAdminEmail();
        String role = bootstrap != null && !bootstrap.isBlank() && normalizeEmail(bootstrap).equals(email) ? "ADMIN" : "USER";
        User user = new User(email, passwordEncoder.encode(req.password()), req.displayName().trim(), role);
        user.setLastLoginAt(Instant.now());
        users.saveAndFlush(user);
        audit.record(user.getId(), null, "auth.register", "USER", user.getId(), Map.of("systemRole", role));
        if ("ADMIN".equals(role)) {
            log.info("Bootstrap admin account registered (id={})", user.getId());
        }
        return issue(user, UUID.randomUUID(), userAgent);
    }

    @Transactional(noRollbackFor = ApiException.class)
    public AuthResult login(LoginRequest req, String userAgent) {
        String email = normalizeEmail(req.email());
        Optional<User> found = users.findByEmailIgnoreCase(email);
        if (found.isEmpty()) {
            passwordEncoder.matches(req.password(), dummyHash);
            audit.record(null, null, "auth.login_failed", "USER", null, Map.of("reason", "unknown_email"));
            throw invalidCredentials();
        }
        User user = found.get();
        if (!passwordEncoder.matches(req.password(), user.getPasswordHash()) || !user.isEnabled()) {
            audit.record(user.getId(), null, "auth.login_failed", "USER", user.getId(),
                    Map.of("reason", user.isEnabled() ? "bad_password" : "disabled"));
            throw invalidCredentials();
        }
        user.setLastLoginAt(Instant.now());
        audit.record(user.getId(), null, "auth.login", "USER", user.getId(), Map.of());
        return issue(user, UUID.randomUUID(), userAgent);
    }

    /**
     * Rotates a refresh token. Presenting an already-rotated (revoked) token is treated as theft:
     * the whole family is revoked. The revocation must commit even though we answer 401.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public AuthResult refresh(String rawToken, String userAgent) {
        if (rawToken == null || rawToken.isBlank()) {
            throw ApiException.unauthorized("Missing refresh token");
        }
        RefreshToken token = refreshTokens.findByTokenHashForUpdate(TokenHashing.sha256Hex(rawToken))
                .orElseThrow(() -> ApiException.unauthorized("Invalid refresh token"));
        Instant now = Instant.now();
        if (token.getRevokedAt() != null) {
            int revoked = refreshTokens.revokeFamily(token.getFamilyId(), now);
            log.warn("Refresh token reuse detected for user {}; revoked {} token(s) in family", token.getUserId(), revoked);
            audit.record(token.getUserId(), null, "auth.refresh_reuse", "USER", token.getUserId(),
                    Map.of("familyId", token.getFamilyId().toString()));
            throw ApiException.unauthorized("Refresh token has been revoked");
        }
        if (token.getExpiresAt().isBefore(now)) {
            token.setRevokedAt(now);
            throw ApiException.unauthorized("Refresh token expired");
        }
        User user = users.findById(token.getUserId()).filter(User::isEnabled)
                .orElseThrow(() -> ApiException.unauthorized("Account disabled"));
        AuthResult result = issue(user, token.getFamilyId(), userAgent);
        RefreshToken replacement = refreshTokens.findByTokenHash(TokenHashing.sha256Hex(result.refreshToken())).orElseThrow();
        token.setRevokedAt(now);
        token.setReplacedById(replacement.getId());
        return result;
    }

    @Transactional
    public void logout(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            return;
        }
        refreshTokens.findByTokenHash(TokenHashing.sha256Hex(rawToken)).ifPresent(t -> {
            refreshTokens.revokeFamily(t.getFamilyId(), Instant.now());
            audit.record(t.getUserId(), null, "auth.logout", "USER", t.getUserId(), Map.of());
        });
    }

    @Transactional(readOnly = true)
    public UserDto me(UUID userId) {
        return users.findById(userId).map(UserDto::of).orElseThrow(() -> ApiException.unauthorized("Unknown user"));
    }

    @Transactional
    public UserDto updateMe(UUID userId, String displayName) {
        User user = users.findById(userId).orElseThrow(() -> ApiException.unauthorized("Unknown user"));
        user.setDisplayName(displayName.trim());
        users.flush();
        return UserDto.of(user);
    }

    private AuthResult issue(User user, UUID familyId, String userAgent) {
        Instant now = Instant.now();
        Duration ttl = Duration.ofMinutes(props.jwt().accessTtlMinutes());
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("haierag")
                .subject(user.getId().toString())
                .issuedAt(now)
                .expiresAt(now.plus(ttl))
                .id(UUID.randomUUID().toString())
                .claim("email", user.getEmail())
                .claim("role", user.getSystemRole())
                .build();
        String access = jwtEncoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();

        String raw = TokenHashing.newOpaqueToken();
        String ua = userAgent == null ? null : userAgent.substring(0, Math.min(512, userAgent.length()));
        refreshTokens.saveAndFlush(new RefreshToken(user.getId(), TokenHashing.sha256Hex(raw), familyId,
                now.plus(Duration.ofDays(props.jwt().refreshTtlDays())), ua));
        return new AuthResult(new AuthResponse(access, "Bearer", ttl.toSeconds(), UserDto.of(user)), raw);
    }

    private static ApiException invalidCredentials() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
    }

    static String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(java.util.Locale.ROOT);
    }
}
