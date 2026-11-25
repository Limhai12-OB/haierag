package com.haierag.storage;

import java.net.URI;
import java.nio.file.Path;
import java.util.Collection;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import com.haierag.config.AppProperties;

import jakarta.annotation.PreDestroy;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.BucketAlreadyOwnedByYouException;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.S3Exception;

/** S3-compatible object storage (RustFS in dev/prod, path-style addressing). */
@Service
public class StorageService {

    private static final Logger log = LoggerFactory.getLogger(StorageService.class);

    private final S3Client s3;
    private final String bucket;

    public StorageService(AppProperties props) {
        AppProperties.Storage cfg = props.storage();
        this.bucket = cfg.bucket();
        this.s3 = S3Client.builder()
                .endpointOverride(URI.create(cfg.endpoint()))
                .region(Region.of(cfg.region() == null || cfg.region().isBlank() ? "us-east-1" : cfg.region()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(cfg.accessKey(), cfg.secretKey() == null ? "" : cfg.secretKey())))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
                .httpClientBuilder(UrlConnectionHttpClient.builder()
                        .connectionTimeout(java.time.Duration.ofSeconds(5))
                        .socketTimeout(java.time.Duration.ofSeconds(60)))
                .build();
    }

    public String bucket() {
        return bucket;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void ensureBucketOnStartup() {
        try {
            ensureBucket();
        } catch (RuntimeException e) {
            log.error("Object storage bucket '{}' could not be verified/created: {}", bucket, e.toString());
        }
    }

    public void ensureBucket() {
        try {
            s3.headBucket(b -> b.bucket(bucket));
        } catch (NoSuchBucketException e) {
            create();
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                create();
            } else {
                throw e;
            }
        }
    }

    private void create() {
        try {
            s3.createBucket(b -> b.bucket(bucket));
            log.info("Created object storage bucket '{}'", bucket);
        } catch (BucketAlreadyOwnedByYouException e) {
            // created concurrently
        }
    }

    public void put(String key, Path file, String contentType) {
        s3.putObject(b -> b.bucket(bucket).key(key).contentType(contentType), RequestBody.fromFile(file));
    }

    public ResponseInputStream<GetObjectResponse> get(String key) {
        return s3.getObject(b -> b.bucket(bucket).key(key));
    }

    public boolean exists(String key) {
        try {
            s3.headObject(b -> b.bucket(bucket).key(key));
            return true;
        } catch (S3Exception e) {
            if (e.statusCode() == 404) {
                return false;
            }
            throw e;
        }
    }

    /** Deletes objects one by one (avoids DeleteObjects checksum headers some S3 clones reject). */
    public void delete(Collection<String> keys) {
        for (String key : keys) {
            try {
                s3.deleteObject(b -> b.bucket(bucket).key(key));
            } catch (S3Exception e) {
                if (e.statusCode() != 404) {
                    throw e;
                }
            }
        }
    }

    public void ping() {
        s3.headBucket(b -> b.bucket(bucket));
    }

    @PreDestroy
    void close() {
        s3.close();
    }
}
