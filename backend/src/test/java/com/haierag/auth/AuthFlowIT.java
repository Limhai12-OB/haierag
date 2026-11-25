package com.haierag.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;

import jakarta.servlet.http.Cookie;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import com.haierag.support.IntegrationTest;

class AuthFlowIT extends IntegrationTest {

    private MvcResult registerRaw(String email, String password) throws Exception {
        return mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("email", email, "password", password, "displayName", "Alice"))))
                .andReturn();
    }

    private static Cookie refreshCookie(MvcResult res) {
        Cookie c = res.getResponse().getCookie(RefreshCookies.NAME);
        assertThat(c).as("refresh cookie").isNotNull();
        return c;
    }

    private MvcResult refresh(Cookie cookie) throws Exception {
        return mvc.perform(post("/api/v1/auth/refresh").cookie(new Cookie(RefreshCookies.NAME, cookie.getValue())))
                .andReturn();
    }

    @Test
    void registerLoginRefreshRotationReuseDetectionAndLogout() throws Exception {
        String email = "alice-" + UUID.randomUUID().toString().substring(0, 8) + "@Example.test";

        MvcResult reg = registerRaw(email, "correct-horse-9");
        assertThat(reg.getResponse().getStatus()).isEqualTo(201);
        assertThat(body(reg).get("tokenType").asString()).isEqualTo("Bearer");
        assertThat(body(reg).get("expiresIn").asLong()).isEqualTo(900);
        assertThat(body(reg).get("user").get("email").asString()).isEqualTo(email.toLowerCase());
        assertThat(body(reg).get("user").get("systemRole").asString()).isEqualTo("USER");
        String setCookie = reg.getResponse().getHeader("Set-Cookie");
        assertThat(setCookie).contains("haierag_refresh=").contains("HttpOnly").contains("SameSite=Strict")
                .contains("Path=/api/v1/auth").doesNotContain("Secure");

        // duplicate (case-insensitive)
        assertThat(registerRaw(email.toUpperCase(), "correct-horse-9").getResponse().getStatus()).isEqualTo(409);

        // wrong password -> 401 problem
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("email", email, "password", "wrong-password"))))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.title").value("Unauthorized"));

        MvcResult login = mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("email", email, "password", "correct-horse-9"))))
                .andExpect(status().isOk()).andReturn();
        String access = body(login).get("accessToken").asString();
        Cookie c1 = refreshCookie(login);

        mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + access))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(email.toLowerCase()))
                .andExpect(jsonPath("$.displayName").value("Alice"));
        mvc.perform(put("/api/v1/auth/me").header("Authorization", "Bearer " + access)
                        .contentType(MediaType.APPLICATION_JSON).content(jsonOf(Map.of("displayName", "Alice B"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.displayName").value("Alice B"));

        // rotation: c1 -> c2
        MvcResult r1 = refresh(c1);
        assertThat(r1.getResponse().getStatus()).isEqualTo(200);
        Cookie c2 = refreshCookie(r1);
        assertThat(c2.getValue()).isNotEqualTo(c1.getValue());
        assertThat(body(r1).get("accessToken").asString()).isNotBlank();

        // c2 -> c3 works
        MvcResult r2 = refresh(c2);
        assertThat(r2.getResponse().getStatus()).isEqualTo(200);
        Cookie c3 = refreshCookie(r2);

        // reuse of c1 (already rotated) -> 401 and the whole family is revoked
        MvcResult reuse = refresh(c1);
        assertThat(reuse.getResponse().getStatus()).isEqualTo(401);
        assertThat(reuse.getResponse().getHeader("Set-Cookie")).contains("Max-Age=0");
        assertThat(refresh(c3).getResponse().getStatus()).as("descendant revoked after reuse").isEqualTo(401);
        long active = jdbc.sql("select count(*) from refresh_tokens where revoked_at is null and family_id = "
                        + "(select family_id from refresh_tokens where token_hash = ?)")
                .param(TokenHashing.sha256Hex(c1.getValue())).query(Long.class).single();
        assertThat(active).isZero();

        // new login -> logout revokes the family and clears the cookie
        MvcResult login2 = mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("email", email, "password", "correct-horse-9"))))
                .andExpect(status().isOk()).andReturn();
        Cookie c4 = refreshCookie(login2);
        mvc.perform(post("/api/v1/auth/logout").cookie(new Cookie(RefreshCookies.NAME, c4.getValue())))
                .andExpect(status().isNoContent())
                .andExpect(header().string("Set-Cookie", org.hamcrest.Matchers.containsString("Max-Age=0")));
        assertThat(refresh(c4).getResponse().getStatus()).isEqualTo(401);

        // audit trail for login
        long logins = jdbc.sql("select count(*) from audit_logs a join users u on u.id = a.actor_id "
                + "where lower(u.email) = lower(?) and a.action = 'auth.login'").param(email).query(Long.class).single();
        assertThat(logins).isEqualTo(2);
    }

    @Test
    void validationErrorsAreProblemJsonWithFieldErrors() throws Exception {
        mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("email", "not-an-email", "password", "short", "displayName", "X"))))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.errors.password").exists())
                .andExpect(jsonPath("$.errors.email").exists());
    }

    @Test
    void protectedEndpointsRequireAToken() throws Exception {
        mvc.perform(get("/api/v1/auth/me")).andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
        mvc.perform(get("/api/v1/workspaces").header("Authorization", "Bearer not-a-jwt"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh")).andExpect(status().isUnauthorized());
    }

    @Test
    void bootstrapAdminGetsAdminRoleAndAdminEndpointsAreGuarded() throws Exception {
        TestUser admin;
        Long existing = jdbc.sql("select count(*) from users where lower(email) = ?").param(ADMIN_EMAIL)
                .query(Long.class).single();
        if (existing == 0) {
            admin = registerEmail(ADMIN_EMAIL);
        } else {
            MvcResult login = mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                    .content(jsonOf(Map.of("email", ADMIN_EMAIL, "password", "correct-horse-9")))).andReturn();
            admin = new TestUser(null, ADMIN_EMAIL, body(login).get("accessToken").asString());
        }
        TestUser user = register("plain");
        mvc.perform(get("/api/v1/auth/me").header("Authorization", admin.bearer()))
                .andExpect(jsonPath("$.systemRole").value("ADMIN"));
        mvc.perform(get("/api/v1/admin/users").header("Authorization", admin.bearer())).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].email").exists());
        mvc.perform(get("/api/v1/admin/jobs").header("Authorization", admin.bearer())).andExpect(status().isOk());
        mvc.perform(get("/api/v1/admin/users").header("Authorization", user.bearer())).andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));

        // ADMIN can read any workspace, but not modify it
        UUID ws = createWorkspace(user, "Private");
        mvc.perform(get("/api/v1/workspaces/" + ws).header("Authorization", admin.bearer()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("VIEWER"));
        mvc.perform(put("/api/v1/workspaces/" + ws).header("Authorization", admin.bearer())
                        .contentType(MediaType.APPLICATION_JSON).content(jsonOf(Map.of("name", "Hijacked"))))
                .andExpect(status().isNotFound());
    }
}
