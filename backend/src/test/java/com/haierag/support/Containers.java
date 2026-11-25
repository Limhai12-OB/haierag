package com.haierag.support;

import java.time.Duration;

import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Singleton containers shared by all integration tests (started once per JVM). */
public final class Containers {

    public static final String S3_ACCESS_KEY = "testaccess";
    public static final String S3_SECRET_KEY = "testsecret-0123456789";

    public static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
            DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("haierag")
            .withUsername("haierag")
            .withPassword("haierag");

    public static final GenericContainer<?> REDIS = new GenericContainer<>(DockerImageName.parse("redis:7.4-alpine"))
            .withExposedPorts(6379);

    public static final GenericContainer<?> S3 = new GenericContainer<>(DockerImageName.parse("rustfs/rustfs:1.0.6"))
            .withEnv("RUSTFS_ACCESS_KEY", S3_ACCESS_KEY)
            .withEnv("RUSTFS_SECRET_KEY", S3_SECRET_KEY)
            .withEnv("RUSTFS_VOLUMES", "/data")
            .withEnv("RUSTFS_CONSOLE_ENABLE", "false")
            .withExposedPorts(9000)
            .waitingFor(Wait.forHttp("/health").forPort(9000).withStartupTimeout(Duration.ofSeconds(90)));

    static {
        POSTGRES.start();
        REDIS.start();
        S3.start();
    }

    private Containers() {
    }

    public static String s3Endpoint() {
        return "http://" + S3.getHost() + ":" + S3.getMappedPort(9000);
    }
}
