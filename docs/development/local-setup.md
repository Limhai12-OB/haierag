# Local setup

## Prerequisites
* macOS on Apple Silicon (developed on an M4 with 16 GB), Docker Desktop
* Ollama running natively: `ollama serve` (or the app), then `ollama pull qwen3:4b && ollama pull bge-m3`
* For native development: Java 21, Node 24 + pnpm, Python 3.12

## Configuration
`cp .env.example .env` and replace every `change-me` value. `.env` is git-ignored. Host values in `.env` are for
natively-run services (`localhost`); `docker-compose.yml` overrides them for containers. Containers reach Ollama via
`OLLAMA_DOCKER_BASE_URL=http://host.docker.internal:11434` — never `localhost` inside a container.

## Option A — everything in Docker
```bash
docker compose up -d --build
```
Only `127.0.0.1:3000` (frontend) and `127.0.0.1:8080` (backend) are published. Postgres, Redis, storage and the AI
service are reachable only on the compose network. The backend runs Flyway migrations; the AI service waits for it.

## Option B — native services (recommended for development; MPS reranker)
```bash
# 1. infrastructure, published on 127.0.0.1 only
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis storage

# 2. backend (migrates the schema)
cd backend && set -a && source ../.env && set +a && ./mvnw spring-boot:run

# 3. AI service
cd ai-service && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('BAAI/bge-reranker-v2-m3')"
set -a && source ../.env && set +a && .venv/bin/uvicorn app.main:app --port 8000

# 4. frontend
cd frontend && pnpm install && BACKEND_URL=http://localhost:8080 pnpm dev
```

## Tests
* AI service: `pytest -m "not integration and not model and not llm"` runs the fast unit tests. The full suite
  needs a `haierag_test` database with the schema:
  ```bash
  docker compose exec -T postgres psql -U haierag -d haierag -c 'CREATE DATABASE haierag_test'
  docker compose exec -T postgres psql -U haierag -d haierag_test < backend/src/main/resources/db/migration/V1__init_schema.sql
  ```
  Tests refuse to run against the main `haierag` database.
* Backend: `./mvnw verify` (Testcontainers; Docker required).
* Frontend: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`; `pnpm mock:backend` serves an in-memory API mock.
* End to end: `PYTHONPATH=ai-service ai-service/.venv/bin/python scripts/e2e_verify.py`.
* Evaluation: `cd ai-service && POSTGRES_DB=haierag_test STORAGE_BUCKET=haierag-test .venv/bin/python -m app.evaluation.runner --generate --out ../docs/evaluation/results.md`

## Memory (16 GB)
Defaults: one inference workload at a time (`MAX_PARALLEL_INFERENCE=1`), 8192-token context, embedding batch 8,
rerank batch 4, 20 candidates → 5 passages. Resident models: qwen3:4b ≈ 2.5 GB + bge-m3 ≈ 1.2 GB (Ollama,
`OLLAMA_KEEP_ALIVE`), reranker ≈ 1.1 GB fp16 (unloaded after `RERANKER_IDLE_UNLOAD_SECONDS`; set
`RERANKER_UNLOAD_BEFORE_GENERATION=true` under memory pressure). If a model is missing the service returns
`MODEL_UNAVAILABLE` with the exact `ollama pull` command — it never falls back to a remote provider.

## Troubleshooting
* `/api/v1/system/health` (Settings → System health) shows each component, distinguishing *reachable*,
  *installed* and *loaded*.
* `AI_UNAVAILABLE … not reachable at http://localhost:11434` from a container → use `host.docker.internal`.
* Scanned/image-only PDFs fail with a clear message: OCR is not implemented yet.
