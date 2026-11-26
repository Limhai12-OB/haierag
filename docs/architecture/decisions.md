# Architecture Decision Records

## ADR-001 — Service boundaries

* **Backend (Spring Boot)** is the only public API. It owns identity, authorization, workspaces,
  collections, document metadata, conversations, and the database schema (Flyway).
* **AI service (FastAPI)** performs all AI work: parsing, chunking, embeddings, retrieval, reranking,
  generation, citation mapping, evaluation. It is reachable only on the internal Docker network and
  requires the `X-Internal-Token` shared secret.
* No inference code lives in the backend.

## ADR-002 — Database ownership

Flyway (backend) owns the whole schema. The AI service writes only to the RAG tables
(`document_chunks`, `chunk_embeddings`) and updates processing state columns
(`documents.status/error_message/chunk_count/processed_at`, `document_processing_jobs`).
This avoids shipping large chunk/vector payloads through the backend while keeping one
source of truth for the schema.

## ADR-003 — Asynchronous ingestion via Redis

The backend stores the file in object storage, creates the document/version/job rows, then `LPUSH`es
`{jobId, documentId, versionId}` onto `haierag:ingest:queue`. A worker inside the AI service `BRPOP`s
jobs. Jobs survive restarts because the database job row is authoritative: on start-up the worker
re-enqueues `QUEUED` jobs and marks stale `PROCESSING` jobs for retry.

## ADR-004 — Authorization before retrieval

The backend resolves the chat scope (workspace / collection / document ids) and verifies the caller's
membership **before** calling the AI service. The AI service additionally applies
`workspace_id = :ws` (+ optional collection/document filters) inside every retrieval SQL statement, so a
scope bug in one layer cannot leak chunks across workspaces.

## ADR-005 — Hybrid retrieval with RRF

Vector (pgvector HNSW, cosine) and keyword (PostgreSQL FTS, `english` + `simple` configs) candidate lists
are fused with Reciprocal Rank Fusion: `score = Σ w_i / (k + rank_i)`, `k = 60`. Raw scores are never added.
Khmer has no inter-word spaces, so the FTS parser yields poor tokens; when the query contains Khmer
script, a `pg_trgm` similarity search is used as the keyword channel instead.

## ADR-006 — Memory-constrained inference

* A process-wide semaphore (`MAX_PARALLEL_INFERENCE`, default 1) serialises embedding, reranking and
  generation calls, so ingestion and chat never run heavy inference concurrently.
* The reranker loads on first use and is unloaded after `RERANKER_IDLE_UNLOAD_SECONDS`. It can also be
  unloaded before each generation (`RERANKER_UNLOAD_BEFORE_GENERATION=true`).
* Ollama `keep_alive` is configurable per model.
* Device selection: MPS (fp16) when available (native run), otherwise CPU (fp32). In Docker on macOS,
  the reranker runs on CPU — run the AI service natively for MPS acceleration.

## ADR-007 — Streaming

AI service → backend: SSE (`meta`, `token`, `citations`, `done`, `error`). Backend relays to the browser via
`SseEmitter` on a virtual thread and persists the final assistant message and citations once `done` arrives.

## ADR-008 — Citations

Passages are presented to the LLM as numbered, fenced `<source id="n">` blocks. The model cites `[n]`.
After generation, markers are parsed and validated against the passages actually supplied;
unknown markers are dropped from the stored answer. Citation metadata (document, chunk, page, heading,
excerpt, scores) comes only from database rows, never from model output.

## ADR-009 — Grounding & prompt injection

Document text is untrusted. The system prompt states this; passages are fenced; fence-like sequences
inside passages are neutralised; conversation history is limited and placed before evidence with an
instruction that evidence wins. If no passage passes the relevance threshold, the service answers
"insufficient information" without calling the LLM.

## ADR-010 — JWT

Access tokens: HS256 JWT (15 min) via Spring Security OAuth2 resource server (Nimbus) — no extra JWT
library. Refresh tokens: opaque random 256-bit values, stored as SHA-256 hashes, rotated on every use;
reuse of a revoked token revokes the whole token family.

## ADR-011 — Object storage: RustFS

`minio/minio` community images are no longer published on Docker Hub, so the compose stack uses **RustFS**
(`rustfs/rustfs:1.0.6`, S3-compatible, Apache-2.0), as allowed by the spec. All clients speak plain S3
(path-style, region `us-east-1`), so MinIO or any S3 store can be swapped back in via `STORAGE_ENDPOINT`.

## ADR-012 — Qwen3 reasoning is requested and discarded

The installed `qwen3:4b` is the 2507 *thinking* variant: its chat template always opens a `<think>` block, so
`think: false` does not disable reasoning — it only stops Ollama from separating it, and the reasoning then leaks
into the answer (observed in testing, including quoting injected text from a document). Prefilling an empty
`<think></think>` does not stop it either. The AI service therefore calls Ollama with `think: true`
(`LLM_THINKING=true`), streams only `message.content`, and discards `message.thinking`. Consequences:
* Time-to-first-answer-token includes hidden reasoning (several seconds on an M4).
* `LLM_MAX_OUTPUT_TOKENS` (default 2048) includes reasoning tokens; an empty answer yields `GENERATION_EMPTY`.
* Models without thinking support are detected (`does not support thinking`) and called with `think: false`.
* Defence in depth: a stray `</think>` in the final answer truncates everything before it.

## ADR-013 — Keyword channel details

* English FTS uses an **OR** query of the question's content words (stop-words removed) over a stored
  `tsvector` that combines `english` (stemmed, heading-weighted) and `simple` (unstemmed) configurations;
  ranking is `ts_rank_cd`. AND semantics (`websearch_to_tsquery`) missed most natural-language questions.
* Khmer has no inter-word spaces. Verified in pgvector/pg17: `pg_trgm` treats Khmer letters and combining signs
  as word characters (`word_similarity` 0.62 for related phrases, 0 for unrelated), so when a query contains
  Khmer script a trigram `word_similarity` channel (`<%`, threshold `TRIGRAM_THRESHOLD`) is added. Python's `\w`
  does **not** match Khmer combining signs; term extraction explicitly includes U+1780–U+17FF.
* With N keyword channels, each gets weight `RRF_KEYWORD_WEIGHT / N`, so adding the trigram channel does not
  outweigh the vector channel.

## ADR-014 — Relevance gate before generation

After reranking, passages scoring below `RERANK_MIN_SCORE` (sigmoid probability, default 0.05) are dropped.
If none remain, the service answers "not enough information" **without calling the LLM** (no hallucination
risk, ~1 s instead of ~10 s). Without a reranker there is no calibrated score, so no gate is applied.

## ADR-015 — Chunk embedding input and reuse

The embedded text is `Document: <name>\nSection: <heading>\n\n<chunk>`; the stored chunk content stays clean.
Embeddings are keyed by `(model, sha256(embedding input))` and reused on reprocessing or duplicate content.

## ADR-016 — Reasoning budget with forced answer

Real usage (broad questions like "what is X?" over presentation PDFs) showed qwen3:4b reasoning for the entire
2048-token output budget (~75–80 s) and returning no answer in most requests. The LLM provider now caps hidden
reasoning at `LLM_THINKING_BUDGET` tokens (default 512): when the cap is hit — or the output budget ends before
any answer text — the chat stream is closed (Ollama cancels it) and a raw ChatML continuation is sent to
`/api/generate` containing the partial reasoning and a closed `</think>`, so the model writes the answer
immediately. Only applied to ChatML (`qwen*`) models. Verified: the user's three failing questions now answer
(21–32 s to first token); e2e 33/33. Lower the budget for speed, raise it for harder questions.

## ADR-017 — Explicit answer language and repetition guard (2026-11-25)

**Context:** Khmer questions over English documents were answered in English: the sources and the English
forced-answer bridge (ADR-016) outweighed the "answer in the question's language" rule. With Khmer enforced, the 4B
model sometimes loops on a single word until the output budget is spent.
**Decision:** When the question contains Khmer, the user message ends with an explicit "write the whole answer in
Khmer" directive, and the forced-answer bridge says the same. Generation stops when the answer ends in one short unit
repeated 8+ times; the stored answer keeps one copy and ends with "…".
**Consequences:** Khmer questions get Khmer answers (names and numbers stay as in the sources). Wording quality is
still limited by qwen3:4b's Khmer.

## ADR-018 — Importing web pages and linked files (2026-11-25)

**Context:** Users want to add knowledge from a link, not only from uploaded files. Fetching user-supplied URLs on
the server is a classic SSRF risk: in this stack a link could otherwise reach Ollama (`host.docker.internal:11434`),
Postgres, Redis, storage, the backend's actuator, or a cloud metadata endpoint.
**Decision:**
* The **AI service** downloads the link (`POST /internal/v1/fetch-url`, internal token); the **backend** then stores
  and queues it exactly like an upload (same storage, validation, versions, reprocess, delete, audit
  `document.import_url`). `documents.source_url` keeps the final URL; web pages get `file_type = 'HTML'` (V2).
* SSRF rules: http/https only; no credentials in the URL; the host is resolved and **every** address must be
  public (loopback, RFC 1918, link-local, CGNAT, ULA, multicast, reserved, IPv4-mapped/6to4 forms all refused);
  the connection goes to the **validated IP** with Host header + TLS SNI/certificate verification on the hostname
  (no DNS-rebinding window); redirects are followed manually (≤ 5) and each hop is re-validated; proxy env vars are
  ignored; 20 s total, `MAX_UPLOAD_SIZE_MB` cap enforced while streaming; 10 imports/minute/user.
  `URL_IMPORT_ALLOW_PRIVATE=true` disables the address check for intranet use on a trusted network.
* Web pages: trafilatura extracts the main content as markdown (headings + tables kept, menus/footers/ads dropped),
  wiki "[edit]" links and footnote markers ("[4]") are removed (they would be confused with HaieRag's [n]
  citations), then the markdown parser builds sections. If the article extractor captures less than half of the
  page's visible text (one-page sites: portfolios, landing/product pages — e.g. 7% on a real portfolio), a
  structural full-page walk is used instead (`parsing/html_blocks.py`: all visible text in order, headings/lists/
  tables kept; scripts, styles, nav, forms and hidden elements dropped). Pages with < 40 characters of text fail with a clear
  message (JavaScript-rendered or login-only pages).
**Consequences:** No JavaScript rendering and no authenticated sources (private Google Docs, Notion). Imports are
snapshots: reprocess re-reads the stored copy; importing again creates a new document. The AI service needs
outbound internet access for this feature only (models stay local).

## ADR-019 — Section-aware chunking (structured-v2) and contextual reranking (2026-11-26)

**Context:** "List all projects" on a one-page portfolio returned none of the project names. Each subsection
had become its own ~100-token chunk. Chunks after the first did not
contain the word "project". The cross-encoder saw only chunk text, so the Projects chunk scored below
`RERANK_MIN_SCORE` for "projects in <name>'s portfolio": the person is named only in the document title.
**Decision:**
* Chunker `structured-v2`: a heading closes the current chunk only if it is a sibling or a higher-level section.
  Deeper subsections are packed with their parent section up to `CHUNK_SIZE`. A level used once at the top (the
  document title) is not a section root. Headings without a level (some PDFs) still always split, and slides and
  sheets are siblings, so their behaviour is unchanged.
* Each chunk stores its heading path (`metadata.section_path`, e.g. "Projects › More projects › Gamma"), and
  the embedding header uses it.
* Reranker input = `Document: <name>` + section heading + chunk text, matching the context the embedding gets.
* Prompt rule: list/count questions must include every matching item from the sources. The forced-answer budget
  went from 1024 to 1536 tokens, because Khmer lists need more tokens.
**Consequences:** The portfolio's projects are now in one chunk, which ranks first, and all four are listed in English
and in Khmer. On the benchmark ([results](../evaluation/results-structured-v2-retrieval.md)), Hit@5 and MRR after
reranking stay 1.0, fused MRR rose from 0.93 to 0.95, and the 3 absent-answer questions are still declined.
Existing documents keep their old chunks until reprocessed.
