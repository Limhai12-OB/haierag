package com.haierag.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
public abstract class IntegrationTest {

    public static final String INTERNAL_TOKEN = "test-internal-token";
    public static final String ADMIN_EMAIL = "admin@haierag.test";

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", Containers.POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", Containers.POSTGRES::getUsername);
        r.add("spring.datasource.password", Containers.POSTGRES::getPassword);
        r.add("spring.data.redis.host", Containers.REDIS::getHost);
        r.add("spring.data.redis.port", () -> Containers.REDIS.getMappedPort(6379));
        r.add("spring.data.redis.password", () -> "");
        r.add("haierag.storage.endpoint", Containers::s3Endpoint);
        r.add("haierag.storage.access-key", () -> Containers.S3_ACCESS_KEY);
        r.add("haierag.storage.secret-key", () -> Containers.S3_SECRET_KEY);
        r.add("haierag.storage.bucket", () -> "haierag-test");
        r.add("haierag.ai.base-url", StubAiServer::baseUrl);
        r.add("haierag.ai.internal-token", () -> INTERNAL_TOKEN);
        r.add("haierag.jwt.secret", () -> "integration-test-secret-integration-test-secret");
        r.add("haierag.max-upload-size-mb", () -> 1);
        r.add("haierag.bootstrap-admin-email", () -> ADMIN_EMAIL);
        r.add("haierag.rate-limit.auth-per-minute", () -> 10_000);
        r.add("haierag.rate-limit.chat-per-minute", () -> 10_000);
    }

    @Autowired
    protected MockMvc mvc;
    @Autowired
    protected JsonMapper json;
    @Autowired
    protected JdbcClient jdbc;
    @Autowired
    protected StringRedisTemplate redis;
    @LocalServerPort
    protected int port;

    @BeforeEach
    void resetStub() {
        StubAiServer.CHAT_REQUESTS.clear();
    }

    /** A registered user with a valid access token. */
    public record TestUser(UUID id, String email, String token) {
        public String bearer() {
            return "Bearer " + token;
        }
    }

    protected TestUser register(String prefix) throws Exception {
        String email = prefix + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
        return registerEmail(email);
    }

    protected TestUser registerEmail(String email) throws Exception {
        MvcResult res = mvc.perform(post("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", email, "password", "correct-horse-9",
                                "displayName", "Test " + email.substring(0, email.indexOf('@'))))))
                .andExpect(status().isCreated()).andReturn();
        JsonNode body = json.readTree(res.getResponse().getContentAsString());
        return new TestUser(UUID.fromString(body.get("user").get("id").asString()), email,
                body.get("accessToken").asString());
    }

    protected JsonNode body(MvcResult res) throws Exception {
        return json.readTree(res.getResponse().getContentAsString());
    }

    protected <B extends AbstractMockHttpServletRequestBuilder<B>> B auth(B b, TestUser u) {
        return b.header("Authorization", u.bearer());
    }

    protected String jsonOf(Object o) {
        return json.writeValueAsString(o);
    }

    protected UUID createWorkspace(TestUser owner, String name) throws Exception {
        MvcResult res = mvc.perform(auth(post("/api/v1/workspaces"), owner).contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("name", name))))
                .andExpect(status().isCreated()).andReturn();
        return UUID.fromString(body(res).get("id").asString());
    }

    protected void addMember(TestUser owner, UUID ws, TestUser member, String role) throws Exception {
        mvc.perform(auth(post("/api/v1/workspaces/" + ws + "/members"), owner).contentType(MediaType.APPLICATION_JSON)
                        .content(jsonOf(Map.of("email", member.email(), "role", role))))
                .andExpect(status().isCreated());
    }
}
