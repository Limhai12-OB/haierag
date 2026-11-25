"""Shared fixtures.

Markers:
  integration — needs Postgres (haierag_test DB with the Flyway schema), Redis, object storage and Ollama (bge-m3)
  model       — loads the local reranker model
  llm         — runs the local generation model (qwen3:4b); slow
Run unit tests only:  pytest -m "not integration and not model and not llm"
"""

from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio

os.environ.setdefault("POSTGRES_DB", "haierag_test")
os.environ["POSTGRES_DB"] = os.environ.get("TEST_POSTGRES_DB", "haierag_test")
os.environ.setdefault("STORAGE_BUCKET", "haierag-test")
os.environ.setdefault("INGEST_QUEUE", "haierag:test:ingest:queue")
os.environ.setdefault("INTERNAL_API_TOKEN", "test-internal-token")


@pytest.fixture(scope="session")
def settings():
    from app.core.config import get_settings

    get_settings.cache_clear()
    s = get_settings()
    assert s.postgres_db != "haierag", "tests must never run against the main database"
    return s


@pytest.fixture(scope="session")
def token_counter(settings):
    from app.chunking.tokenizer import get_token_counter

    return get_token_counter(settings.tokenizer_model)


async def _services_available(settings) -> str | None:
    import httpx
    import psycopg

    try:
        async with await psycopg.AsyncConnection.connect(settings.postgres_conninfo, connect_timeout=3) as conn:
            row = await (await conn.execute("SELECT to_regclass('public.document_chunks')")).fetchone()
            if row[0] is None:
                return "haierag_test schema missing (apply V1__init_schema.sql)"
    except Exception as exc:
        return f"postgres unavailable: {exc}"
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            tags = (await c.get(f"{settings.ollama_base_url}/api/tags")).json()
        names = {m["name"] for m in tags.get("models", [])}
        if not ({settings.embedding_model, f"{settings.embedding_model}:latest"} & names):
            return f"ollama model {settings.embedding_model} not installed"
    except Exception as exc:
        return f"ollama unavailable: {exc}"
    return None


@pytest_asyncio.fixture
async def container(settings):
    reason = await _services_available(settings)
    if reason:
        pytest.skip(reason)
    from app.container import Container

    c = Container.build(settings)
    await c.start(run_worker=False)
    await c.pool.wait()
    async with c.pool.connection() as conn:
        await conn.execute(
            "TRUNCATE users, workspaces, documents, document_chunks, chunk_embeddings, conversations, audit_logs CASCADE"
        )
        await conn.commit()
    await c.redis.delete(settings.ingest_queue)
    yield c
    await c.close()


class Factory:
    """Creates rows the backend would normally create."""

    def __init__(self, container):
        self.c = container

    async def user(self) -> uuid.UUID:
        uid = uuid.uuid4()
        async with self.c.pool.connection() as conn:
            await conn.execute(
                "INSERT INTO users (id, email, password_hash, display_name) VALUES (%s, %s, 'x', 'Test')",
                (uid, f"{uid}@test.local"),
            )
            await conn.commit()
        return uid

    async def workspace(self, owner: uuid.UUID, name: str = "WS") -> uuid.UUID:
        wid = uuid.uuid4()
        async with self.c.pool.connection() as conn:
            await conn.execute("INSERT INTO workspaces (id, name, created_by) VALUES (%s, %s, %s)", (wid, name, owner))
            await conn.execute(
                "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (%s, %s, 'OWNER')", (wid, owner)
            )
            await conn.commit()
        return wid

    async def collection(self, workspace: uuid.UUID, name: str) -> uuid.UUID:
        cid = uuid.uuid4()
        async with self.c.pool.connection() as conn:
            await conn.execute("INSERT INTO collections (id, workspace_id, name) VALUES (%s, %s, %s)", (cid, workspace, name))
            await conn.commit()
        return cid

    async def document(self, workspace: uuid.UUID, user: uuid.UUID, name: str, file_type: str, data: bytes,
                       collection: uuid.UUID | None = None) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
        """Uploads to storage and creates document/version/job rows like the backend. Returns (doc, version, job)."""
        import hashlib

        doc_id, ver_id, job_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        key = f"workspaces/{workspace}/documents/{doc_id}/v1/{name}"
        await self.c.storage.put_bytes(key, data, "application/octet-stream")
        digest = hashlib.sha256(data).hexdigest()
        async with self.c.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO documents (id, workspace_id, collection_id, name, original_filename, content_type, file_type,
                       size_bytes, sha256, status, uploaded_by) VALUES (%s,%s,%s,%s,%s,'application/octet-stream',%s,%s,%s,'QUEUED',%s)""",
                (doc_id, workspace, collection, name, name, file_type, len(data), digest, user),
            )
            await conn.execute(
                """INSERT INTO document_versions (id, document_id, version_number, storage_key, sha256, size_bytes, content_type, created_by)
                   VALUES (%s,%s,1,%s,%s,%s,'application/octet-stream',%s)""",
                (ver_id, doc_id, key, digest, len(data), user),
            )
            await conn.execute("UPDATE documents SET current_version_id=%s WHERE id=%s", (ver_id, doc_id))
            await conn.execute(
                "INSERT INTO document_processing_jobs (id, document_id, version_id) VALUES (%s,%s,%s)", (job_id, doc_id, ver_id)
            )
            await conn.commit()
        return doc_id, ver_id, job_id


@pytest_asyncio.fixture
async def factory(container):
    return Factory(container)
