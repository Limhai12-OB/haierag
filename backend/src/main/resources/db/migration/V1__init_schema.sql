-- =====================================================================
-- HaieRag initial schema
-- Owner: backend (Flyway). The AI service writes only to document_chunks,
-- chunk_embeddings and processing-state columns (see ADR-002).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Generic updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Users & access
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           varchar(320) NOT NULL,
    password_hash   varchar(255) NOT NULL,
    display_name    varchar(120) NOT NULL,
    system_role     varchar(16)  NOT NULL DEFAULT 'USER' CHECK (system_role IN ('ADMIN', 'USER')),
    enabled         boolean      NOT NULL DEFAULT true,
    last_login_at   timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));

CREATE TABLE refresh_tokens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash      varchar(64)  NOT NULL UNIQUE,          -- SHA-256 hex of the opaque token
    family_id       uuid         NOT NULL,                 -- rotation chain; reuse revokes the family
    expires_at      timestamptz  NOT NULL,
    revoked_at      timestamptz,
    replaced_by_id  uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
    user_agent      varchar(512),
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ix_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX ix_refresh_tokens_family ON refresh_tokens (family_id);

CREATE TABLE workspaces (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            varchar(120) NOT NULL,
    description     varchar(1000),
    created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);

-- Workspace roles. The system-wide ADMIN role lives on users.system_role.
CREATE TABLE workspace_members (
    workspace_id    uuid         NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id         uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role            varchar(16)  NOT NULL CHECK (role IN ('OWNER', 'MEMBER', 'VIEWER')),
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX ix_workspace_members_user ON workspace_members (user_id);

CREATE TABLE invitations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid         NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    email           varchar(320) NOT NULL,
    role            varchar(16)  NOT NULL CHECK (role IN ('OWNER', 'MEMBER', 'VIEWER')),
    token_hash      varchar(64)  NOT NULL UNIQUE,
    status          varchar(16)  NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
    invited_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    expires_at      timestamptz  NOT NULL,
    accepted_at     timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ix_invitations_workspace ON invitations (workspace_id);
CREATE INDEX ix_invitations_email ON invitations (lower(email));

-- ---------------------------------------------------------------------
-- Knowledge organisation
-- ---------------------------------------------------------------------
CREATE TABLE collections (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid         NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name            varchar(120) NOT NULL,
    description     varchar(1000),
    created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_collections_ws_name ON collections (workspace_id, lower(name));

CREATE TABLE documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id        uuid          NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    collection_id       uuid REFERENCES collections (id) ON DELETE SET NULL,
    name                varchar(255)  NOT NULL,
    original_filename   varchar(255)  NOT NULL,
    content_type        varchar(128)  NOT NULL,
    file_type           varchar(16)   NOT NULL CHECK (file_type IN ('PDF', 'DOCX', 'XLSX', 'PPTX', 'TXT', 'MARKDOWN', 'CSV')),
    size_bytes          bigint        NOT NULL CHECK (size_bytes >= 0),
    sha256              varchar(64)   NOT NULL,
    status              varchar(16)   NOT NULL DEFAULT 'UPLOADED'
                            CHECK (status IN ('UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
    error_message       varchar(2000),
    page_count          integer,
    chunk_count         integer       NOT NULL DEFAULT 0,
    current_version_id  uuid,          -- FK added after document_versions exists
    uploaded_by         uuid REFERENCES users (id) ON DELETE SET NULL,
    processed_at        timestamptz,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_documents_ws_status ON documents (workspace_id, status);
CREATE INDEX ix_documents_collection ON documents (collection_id);
CREATE INDEX ix_documents_ws_created ON documents (workspace_id, created_at DESC);

CREATE TABLE document_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid          NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    version_number  integer       NOT NULL,
    storage_key     varchar(512)  NOT NULL,
    sha256          varchar(64)   NOT NULL,
    size_bytes      bigint        NOT NULL,
    content_type    varchar(128)  NOT NULL,
    created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (document_id, version_number)
);
ALTER TABLE documents
    ADD CONSTRAINT fk_documents_current_version
    FOREIGN KEY (current_version_id) REFERENCES document_versions (id) ON DELETE SET NULL;

CREATE TABLE document_processing_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid          NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    version_id      uuid          NOT NULL REFERENCES document_versions (id) ON DELETE CASCADE,
    status          varchar(16)   NOT NULL DEFAULT 'QUEUED'
                        CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
    stage           varchar(32),   -- PARSING / CHUNKING / EMBEDDING / STORING
    attempts        integer       NOT NULL DEFAULT 0,
    error_message   varchar(2000),
    metrics         jsonb         NOT NULL DEFAULT '{}'::jsonb,   -- timings, counts
    started_at      timestamptz,
    finished_at     timestamptz,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_jobs_document ON document_processing_jobs (document_id);
CREATE INDEX ix_jobs_status ON document_processing_jobs (status, created_at);

-- ---------------------------------------------------------------------
-- RAG storage
-- ---------------------------------------------------------------------
CREATE TABLE document_chunks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid          NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    version_id      uuid          NOT NULL REFERENCES document_versions (id) ON DELETE CASCADE,
    workspace_id    uuid          NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE, -- denormalised for isolation filters
    chunk_index     integer       NOT NULL,
    content         text          NOT NULL,
    content_hash    varchar(64)   NOT NULL,
    token_count     integer       NOT NULL,
    page_start      integer,
    page_end        integer,
    section_heading varchar(500),
    metadata        jsonb         NOT NULL DEFAULT '{}'::jsonb,
    tsv             tsvector GENERATED ALWAYS AS (
                        setweight(to_tsvector('english'::regconfig, coalesce(section_heading, '')), 'A') ||
                        setweight(to_tsvector('english'::regconfig, content), 'B') ||
                        setweight(to_tsvector('simple'::regconfig, content), 'C')
                    ) STORED,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (version_id, chunk_index)
);
CREATE INDEX ix_chunks_document ON document_chunks (document_id);
CREATE INDEX ix_chunks_workspace ON document_chunks (workspace_id);
CREATE INDEX ix_chunks_tsv ON document_chunks USING gin (tsv);
-- Character-trigram index: keyword channel for scripts without word spacing (Khmer).
CREATE INDEX ix_chunks_trgm ON document_chunks USING gin (content gin_trgm_ops);

CREATE TABLE chunk_embeddings (
    chunk_id        uuid PRIMARY KEY REFERENCES document_chunks (id) ON DELETE CASCADE,
    workspace_id    uuid          NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    model           varchar(128)  NOT NULL,
    dimensions      integer       NOT NULL CHECK (dimensions = 1024),
    content_hash    varchar(64)   NOT NULL,
    embedding       vector(1024)  NOT NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_chunk_embeddings_hnsw ON chunk_embeddings USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
CREATE INDEX ix_chunk_embeddings_ws ON chunk_embeddings (workspace_id);
-- Reuse embeddings for identical content (reprocessing, duplicate uploads).
CREATE INDEX ix_chunk_embeddings_hash ON chunk_embeddings (model, content_hash);

-- ---------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------
CREATE TABLE conversations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid          NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id         uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title           varchar(200)  NOT NULL,
    scope_type      varchar(16)   NOT NULL DEFAULT 'WORKSPACE' CHECK (scope_type IN ('WORKSPACE', 'COLLECTION', 'DOCUMENTS')),
    collection_id   uuid REFERENCES collections (id) ON DELETE SET NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_conversations_user_ws ON conversations (user_id, workspace_id, updated_at DESC);

CREATE TABLE conversation_documents (
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    document_id     uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, document_id)
);

CREATE TABLE messages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     uuid          NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    role                varchar(16)   NOT NULL CHECK (role IN ('USER', 'ASSISTANT')),
    content             text          NOT NULL,
    status              varchar(16)   NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('STREAMING', 'COMPLETED', 'FAILED')),
    model               varchar(128),
    prompt_tokens       integer,
    completion_tokens   integer,
    latency_ms          integer,
    metadata            jsonb         NOT NULL DEFAULT '{}'::jsonb,   -- timings, retrieval stats, grounded flag
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_messages_conversation ON messages (conversation_id, created_at);

CREATE TABLE message_citations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id          uuid          NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    marker              integer       NOT NULL,        -- the [n] used in the answer
    chunk_id            uuid REFERENCES document_chunks (id) ON DELETE SET NULL,
    document_id         uuid REFERENCES documents (id) ON DELETE SET NULL,
    document_name       varchar(255)  NOT NULL,
    page_number         integer,
    section_heading     varchar(500),
    excerpt             text          NOT NULL,
    retrieval_score     double precision,
    rerank_score        double precision,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (message_id, marker)
);
CREATE INDEX ix_message_citations_document ON message_citations (document_id);

-- ---------------------------------------------------------------------
-- System & evaluation
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
    id              bigserial PRIMARY KEY,
    actor_id        uuid REFERENCES users (id) ON DELETE SET NULL,
    workspace_id    uuid REFERENCES workspaces (id) ON DELETE SET NULL,
    action          varchar(64)   NOT NULL,
    entity_type     varchar(64),
    entity_id       uuid,
    details         jsonb         NOT NULL DEFAULT '{}'::jsonb,
    ip_address      varchar(64),
    created_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_logs_ws_created ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX ix_audit_logs_actor ON audit_logs (actor_id, created_at DESC);

CREATE TABLE model_configurations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key      varchar(64)   NOT NULL UNIQUE,  -- e.g. 'retrieval', 'generation'
    value           jsonb         NOT NULL,
    updated_by      uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE rag_evaluation_datasets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    uuid REFERENCES workspaces (id) ON DELETE CASCADE,
    name            varchar(200)  NOT NULL,
    description     varchar(2000),
    items           jsonb         NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE rag_evaluation_results (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id      uuid          NOT NULL REFERENCES rag_evaluation_datasets (id) ON DELETE CASCADE,
    config          jsonb         NOT NULL DEFAULT '{}'::jsonb,
    metrics         jsonb         NOT NULL DEFAULT '{}'::jsonb,
    per_question    jsonb         NOT NULL DEFAULT '[]'::jsonb,
    started_at      timestamptz   NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    updated_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_eval_results_dataset ON rag_evaluation_results (dataset_id, created_at DESC);

-- updated_at triggers
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'refresh_tokens', 'workspaces', 'workspace_members', 'invitations', 'collections',
        'documents', 'document_versions', 'document_processing_jobs', 'document_chunks', 'chunk_embeddings',
        'conversations', 'messages', 'message_citations', 'model_configurations',
        'rag_evaluation_datasets', 'rag_evaluation_results'
    ] LOOP
        EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
    END LOOP;
END $$;
