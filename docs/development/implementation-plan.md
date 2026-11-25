# HaieRag — Implementation Plan

Status legend: ✅ done & verified · 🟡 in progress · ⬜ not started

## Environment findings (2026-11-24)

| Item | Found |
|---|---|
| Repository | Empty — greenfield |
| Java | OpenJDK 21.0.13 (Maven 3.10.1 via wrapper cache, Spring Boot 4.1.3 cached) |
| Node / pnpm | Node 24.22, pnpm 12.16 |
| Python | 3.12.16 (used for the AI service venv) |
| Docker | 29.9, 8 GB VM memory |
| Ollama | 0.40.11 native; `qwen3:4b` (2507 thinking variant), `bge-m3` pulled 2026-11-25 |
| Hardware | Apple M4, 16 GB unified memory |

## Phase 1 — Foundation

1. Monorepo layout, `.gitignore`, `.env.example`, `README.md`.
2. `docker-compose.yml`: postgres (pgvector/pg17), redis, minio, ai-service, backend, frontend.
   Only frontend (3000) and backend (8080) are published, bound to `127.0.0.1`; MinIO console optional.
3. Flyway schema covering all entities in the spec (users → evaluation tables).
4. Spring Boot skeleton: security, JWT, error model, OpenAPI, health.
5. FastAPI skeleton: settings, providers, health (reachable vs model-available).
6. Next.js skeleton with Tailwind + shadcn-style components.
7. Verification: `docker compose up`, health endpoints green, backend ↔ AI service call works.

## Phase 2 — Local AI integration
Ollama LLM + embedding providers, transformers reranker (lazy load / idle unload, MPS → CPU fallback),
inference semaphore (`MAX_PARALLEL_INFERENCE`), model health checks.

## Phase 3 — Ingestion
Upload (validation, size, magic bytes) → MinIO → `documents`/`document_versions`/`document_processing_jobs`
→ Redis queue → AI worker: parse → normalize → chunk → embed (batch 8, dedup by content hash) → store → status.

## Phase 4 — Retrieval
pgvector HNSW cosine search + PostgreSQL FTS (english + simple) + trigram fallback for Khmer,
RRF fusion, reranking, workspace/collection/document scope filters applied in SQL.

## Phase 5 — RAG chat
Conversations/messages, grounded prompt with untrusted-data fencing, streaming SSE
(AI service → backend → browser), citation validation, persistence of message citations.

## Phase 6 — Frontend product
Auth, dashboard, workspaces, collections, documents, document details/chunks, chat with citation previews, settings/health.

## Phase 7–8
Evaluation framework + benchmark dataset (EN/KM/mixed/tables/absent answers), reprocessing, monitoring,
security review, docs.

## First milestone — end-to-end vertical slice
Upload PDF → extract → chunk → BGE-M3 → pgvector → hybrid retrieve → rerank → Qwen3 → citations,
verified with a real sample PDF and questions with known answers (see `docs/development/verification-log.md`).

## Status (2026-11-25)

| Phase | Status | Evidence |
|---|---|---|
| 1 Foundation | ✅ | `docker compose up -d --build`: 6 services healthy; only 127.0.0.1:3000/8080 published |
| 2 Local AI | ✅ | `/health` distinguishes reachable/installed/loaded; inference gate; reranker lazy load + idle unload (MPS/CPU) |
| 3 Ingestion | ✅ | 7 formats; Redis queue worker; status/stage/metrics; embedding reuse; superseded-version guard |
| 4 Retrieval | ✅ | pgvector HNSW (iterative scan) + FTS + Khmer trigram → RRF → rerank → relevance gate; scope filters in SQL |
| 5 RAG chat | ✅ | SSE AI→backend→browser; citations validated + persisted; regenerate; injection test |
| 6 Frontend | 🟡 | All screens built, 50 tests, build/lint/typecheck pass; **not yet exercised in a real browser** |
| 7 Advanced | 🟡 | Evaluation runner + benchmark done (docs/evaluation); evaluation dashboard UI, invitations, versioning beyond v1, OCR not started |
| 8 Quality/docs | 🟡 | README, local setup, ADR-001…015, API contracts; formal security review not done |

Verification
* ai-service: 50 tests (39 unit, 11 integration incl. real bge-m3 / reranker / qwen3:4b) — pass
* backend: `./mvnw verify` 20 tests (Testcontainers) — pass
* frontend: `pnpm test` 50 tests, typecheck, lint, build — pass
* `scripts/e2e_verify.py`: 33/33 against native services and 33/33 against the Docker stack via the frontend proxy

Known issues / next
* qwen3:4b thinking variant: ~10–20 s to first token; occasional empty answers on Khmer/mixed questions
  (GENERATION_EMPTY). Evaluate a non-thinking Qwen3 4B instruct build (ADR-012, docs/evaluation).
* Khmer: no word segmentation in FTS; benchmark too small to bound Khmer quality.
* Frontend needs a real-browser pass (Chrome automation could not reach localhost from this machine).
* Not implemented: invitations flow, user disable, document versions > 1, OCR, evaluation dashboard UI,
  metrics endpoint (Prometheus) — structured JSON logs and per-request timings exist.
