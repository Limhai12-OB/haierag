# HaieRag

A self-hosted AI knowledge base with Retrieval-Augmented Generation. Upload documents (or import web pages and
linked files) into workspaces and collections, ask questions in English or Khmer, and get grounded answers with verifiable citations.
**All inference is local** (Ollama + a local reranker); nothing is sent to cloud AI APIs.

| Component | Tech | Responsibility |
|---|---|---|
| `frontend/` | Next.js, React, TypeScript, Tailwind, shadcn/ui, TanStack Query | UI; same-origin proxy to the backend |
| `backend/` | Java 21, Spring Boot 4, Spring Security, JPA, Flyway | Auth, RBAC, workspaces, documents, conversations, SSE relay, the DB schema |
| `ai-service/` | Python 3.12, FastAPI | Parsing, chunking, embeddings, hybrid retrieval, reranking, generation, citations, evaluation |
| Postgres + pgvector | `pgvector/pgvector:pg17` | App data, chunks, 1024-d vectors (HNSW), full-text + trigram indexes |
| Redis | `redis:7.4` | Ingestion queue, rate limiting |
| Object storage | RustFS (S3 API) | Original files |
| Ollama (native macOS) | `qwen3:4b`, `bge-m3` | Generation, embeddings |
| Reranker | `BAAI/bge-reranker-v2-m3` via Transformers | Cross-encoder reranking (MPS / CPU) |

Query pipeline: question → bge-m3 query embedding → pgvector search + PostgreSQL FTS (+ trigram channel for Khmer)
→ Reciprocal Rank Fusion → bge-reranker-v2-m3 → relevance gate → grounded prompt → qwen3:4b (streamed)
→ citation markers validated against the supplied passages → persisted with the message.

## Quick start (macOS, Apple Silicon)

```bash
ollama pull qwen3:4b && ollama pull bge-m3      # Ollama must be running natively
cp .env.example .env                             # then replace every change-me value (openssl rand -base64 48)
docker compose up -d --build                     # postgres, redis, storage, backend, ai-service, frontend
open http://localhost:3000
```

In Docker the reranker runs on CPU and downloads its model (~2.3 GB) on first use. For Apple Silicon (MPS)
acceleration run the AI service natively — see [docs/development/local-setup.md](docs/development/local-setup.md).

## Documentation
* [Local setup & development](docs/development/local-setup.md)
* [Architecture decisions (ADRs)](docs/architecture/decisions.md)
* [API contracts](docs/api/contracts.md) — OpenAPI UI at `http://localhost:8080/swagger-ui.html`
* [Evaluation results & Khmer limitations](docs/evaluation/README.md)
* [Implementation plan & status](docs/development/implementation-plan.md)

## Verifying
```bash
(cd ai-service && .venv/bin/python -m pytest)          # unit + integration (needs infra + Ollama)
(cd backend && ./mvnw verify)                           # unit + Testcontainers integration tests
(cd frontend && pnpm test && pnpm typecheck && pnpm lint)
PYTHONPATH=ai-service ai-service/.venv/bin/python scripts/e2e_verify.py   # full workflow via the public API
```
