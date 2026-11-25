-- Executed once when the postgres volume is first created.
-- Extensions are also created (idempotently) by Flyway V1.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
