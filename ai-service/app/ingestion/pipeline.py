"""Document ingestion: claim job → fetch object → parse → normalise → chunk → embed → store → status.

The database job row is authoritative (ADR-003). Claiming is an atomic UPDATE ... WHERE status = 'QUEUED', so
duplicate queue messages and multiple workers are safe. Chunks of a document are replaced atomically, guarded
by `documents.current_version_id` so a superseded version can never overwrite a newer one.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import uuid
from dataclasses import dataclass

import numpy as np
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.chunking.structured import Chunk, ChunkingConfig, StructuredChunker
from app.chunking.tokenizer import get_token_counter
from app.core.config import Settings
from app.core.errors import DocumentParseError, HaieRagError
from app.core.resources import ObjectStorage
from app.parsing.base import get_parser
from app.providers.base import EmbeddingProvider

log = logging.getLogger(__name__)


def embedding_input(document_name: str, chunk: Chunk) -> str:
    """Text actually embedded: a short context header improves retrieval of chunks that lack the document's topic."""
    header = f"Document: {document_name}"
    if chunk.section_heading:
        header += f"\nSection: {chunk.section_heading}"
    return f"{header}\n\n{chunk.content}"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class JobOutcome:
    status: str  # COMPLETED | FAILED | SKIPPED | RETRY
    detail: str | None = None


class IngestionPipeline:
    def __init__(self, settings: Settings, pool: AsyncConnectionPool, storage: ObjectStorage, embedder: EmbeddingProvider):
        self.settings = settings
        self.pool = pool
        self.storage = storage
        self.embedder = embedder

    # ------------------------------------------------------------------ job state helpers
    async def _claim(self, job_id: str) -> dict | None:
        async with self.pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    """
                    UPDATE document_processing_jobs j
                       SET status = 'PROCESSING', stage = 'PARSING', attempts = attempts + 1,
                           started_at = now(), finished_at = NULL, error_message = NULL
                     WHERE j.id = %s AND j.status = 'QUEUED'
                 RETURNING j.id, j.document_id, j.version_id, j.attempts
                    """,
                    (job_id,),
                )
                job = await cur.fetchone()
                if job is None:
                    return None
                await cur.execute(
                    """
                    SELECT d.id, d.workspace_id, d.name, d.file_type, d.current_version_id,
                           v.storage_key, v.size_bytes
                      FROM documents d JOIN document_versions v ON v.id = %s AND v.document_id = d.id
                     WHERE d.id = %s
                    """,
                    (job["version_id"], job["document_id"]),
                )
                doc = await cur.fetchone()
                if doc is None:
                    await cur.execute(
                        "UPDATE document_processing_jobs SET status='FAILED', error_message=%s, finished_at=now() WHERE id=%s",
                        ("document or version no longer exists", job_id),
                    )
                    return None
                await cur.execute(
                    "UPDATE documents SET status = 'PROCESSING', error_message = NULL WHERE id = %s AND current_version_id = %s",
                    (doc["id"], job["version_id"]),
                )
            await conn.commit()
        return {**job, "doc": doc}

    async def _stage(self, job_id: str, stage: str, metrics: dict | None = None) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                "UPDATE document_processing_jobs SET stage = %s, metrics = metrics || %s WHERE id = %s",
                (stage, Jsonb(metrics or {}), job_id),
            )
            await conn.commit()

    async def _fail(self, job: dict, message: str, retry: bool) -> None:
        message = message[:1900]
        async with self.pool.connection() as conn:
            if retry:
                await conn.execute(
                    "UPDATE document_processing_jobs SET status='QUEUED', stage=NULL, error_message=%s WHERE id=%s",
                    (f"retrying after error: {message}", job["id"]),
                )
                await conn.execute(
                    "UPDATE documents SET status='QUEUED' WHERE id=%s AND current_version_id=%s",
                    (job["document_id"], job["version_id"]),
                )
            else:
                await conn.execute(
                    "UPDATE document_processing_jobs SET status='FAILED', error_message=%s, finished_at=now() WHERE id=%s",
                    (message, job["id"]),
                )
                await conn.execute(
                    "UPDATE documents SET status='FAILED', error_message=%s WHERE id=%s AND current_version_id=%s",
                    (message, job["document_id"], job["version_id"]),
                )
            await conn.commit()

    # ------------------------------------------------------------------ main entry
    async def process(self, job_id: str) -> JobOutcome:
        job = await self._claim(job_id)
        if job is None:
            return JobOutcome("SKIPPED", "job not claimable (already processed, running, or missing)")
        doc = job["doc"]
        t0 = time.perf_counter()
        timings: dict[str, float] = {}
        log.info("ingestion started", extra={"job_id": job_id, "document_id": str(doc["id"]), "attempt": job["attempts"]})
        try:
            if doc["current_version_id"] != job["version_id"]:
                await self._fail(job, "superseded by a newer document version", retry=False)
                return JobOutcome("SKIPPED", "superseded")

            # 1. fetch
            data = await self.storage.get_bytes(doc["storage_key"], self.settings.max_upload_size_mb * 1024 * 1024)
            timings["fetch_ms"] = round((time.perf_counter() - t0) * 1000)

            # 2-4. parse, normalise, chunk (CPU-bound: off the event loop)
            t = time.perf_counter()
            parsed = await asyncio.to_thread(get_parser(doc["file_type"]).parse, data, doc["name"])
            timings["parse_ms"] = round((time.perf_counter() - t) * 1000)
            await self._stage(job_id, "CHUNKING", {"segments": len(parsed.segments)})

            t = time.perf_counter()
            chunker = StructuredChunker(
                get_token_counter(self.settings.tokenizer_model),
                ChunkingConfig(self.settings.chunk_size, self.settings.chunk_overlap, self.settings.chunk_min_tokens),
            )
            chunks = await asyncio.to_thread(chunker.chunk, parsed.segments)
            timings["chunk_ms"] = round((time.perf_counter() - t) * 1000)
            if not chunks:
                raise DocumentParseError("No content could be extracted from the document")
            await self._stage(job_id, "EMBEDDING", {"chunks": len(chunks)})

            # 5. embed (reusing vectors for identical inputs)
            t = time.perf_counter()
            inputs = [embedding_input(doc["name"], c) for c in chunks]
            hashes = [sha256(x) for x in inputs]
            vectors, reused = await self._embed_with_reuse(inputs, hashes)
            timings["embed_ms"] = round((time.perf_counter() - t) * 1000)
            await self._stage(job_id, "STORING", {"embedded": len(chunks) - reused, "reused_embeddings": reused})

            # 6. store atomically
            t = time.perf_counter()
            stored = await self._store(job, doc, parsed.page_count, chunks, hashes, vectors)
            timings["store_ms"] = round((time.perf_counter() - t) * 1000)
            timings["total_ms"] = round((time.perf_counter() - t0) * 1000)
            if not stored:
                return JobOutcome("SKIPPED", "superseded during processing")
            await self._finish(job_id, {
                "timings_ms": timings, "chunks": len(chunks), "reused_embeddings": reused,
                "page_count": parsed.page_count, "parser": parsed.metadata,
            })
            log.info("ingestion completed", extra={"job_id": job_id, "chunks": len(chunks), **timings})
            return JobOutcome("COMPLETED")
        except HaieRagError as exc:
            retry = exc.transient and job["attempts"] < self.settings.ingest_max_attempts
            log.warning("ingestion failed", extra={"job_id": job_id, "code": exc.code, "retry": retry})
            await self._fail(job, exc.message, retry)
            return JobOutcome("RETRY" if retry else "FAILED", exc.message)
        except Exception as exc:  # unexpected: record a safe message, keep details in logs
            log.exception("ingestion crashed", extra={"job_id": job_id})
            await self._fail(job, f"Internal processing error ({type(exc).__name__})", retry=False)
            return JobOutcome("FAILED", str(exc))

    async def _embed_with_reuse(self, inputs: list[str], hashes: list[str]) -> tuple[list[np.ndarray], int]:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    """SELECT DISTINCT ON (content_hash) content_hash, embedding FROM chunk_embeddings
                        WHERE model = %s AND content_hash = ANY(%s)""",
                    (self.embedder.model, list(set(hashes))),
                )
            ).fetchall()
        known = {h: v for h, v in rows}
        missing = [i for i, h in enumerate(hashes) if h not in known]
        fresh = await self.embedder.embed([inputs[i] for i in missing]) if missing else []
        new_by_hash = {hashes[i]: np.asarray(v, dtype=np.float32) for i, v in zip(missing, fresh)}
        vectors = [known.get(h) if h in known else new_by_hash[h] for h in hashes]
        return vectors, len(hashes) - len(missing)

    async def _store(self, job, doc, page_count, chunks: list[Chunk], hashes, vectors) -> bool:
        async with self.pool.connection() as conn:
            async with conn.transaction():
                locked = await (
                    await conn.execute(
                        "SELECT 1 FROM documents WHERE id = %s AND current_version_id = %s FOR UPDATE",
                        (doc["id"], job["version_id"]),
                    )
                ).fetchone()
                if not locked:
                    await conn.execute(
                        "UPDATE document_processing_jobs SET status='FAILED', error_message='superseded', finished_at=now() WHERE id=%s",
                        (job["id"],),
                    )
                    return False
                await conn.execute("DELETE FROM document_chunks WHERE document_id = %s", (doc["id"],))
                ids = [uuid.uuid4() for _ in chunks]
                async with conn.cursor() as cur:
                    await cur.executemany(
                        """INSERT INTO document_chunks (id, document_id, version_id, workspace_id, chunk_index, content,
                               content_hash, token_count, page_start, page_end, section_heading, metadata)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        [
                            (ids[i], doc["id"], job["version_id"], doc["workspace_id"], c.index, c.content, c.content_hash,
                             c.token_count, c.page_start, c.page_end, (c.section_heading or None) and c.section_heading[:500],
                             Jsonb(c.metadata))
                            for i, c in enumerate(chunks)
                        ],
                    )
                    await cur.executemany(
                        """INSERT INTO chunk_embeddings (chunk_id, workspace_id, model, dimensions, content_hash, embedding)
                           VALUES (%s,%s,%s,%s,%s,%s)""",
                        [
                            (ids[i], doc["workspace_id"], self.embedder.model, self.embedder.dimensions, hashes[i], vectors[i])
                            for i in range(len(chunks))
                        ],
                    )
                await conn.execute(
                    """UPDATE documents SET status='COMPLETED', error_message=NULL, chunk_count=%s, page_count=%s,
                              processed_at=now() WHERE id=%s""",
                    (len(chunks), page_count, doc["id"]),
                )
        return True

    async def _finish(self, job_id: str, metrics: dict) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(
                """UPDATE document_processing_jobs SET status='COMPLETED', stage=NULL, finished_at=now(),
                          metrics = metrics || %s WHERE id=%s""",
                (Jsonb(json.loads(json.dumps(metrics, default=str))), job_id),
            )
            await conn.commit()
