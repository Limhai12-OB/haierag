"""Redis-driven ingestion worker (ADR-003).

* BRPOP `haierag:ingest:queue`, process one job at a time (memory budget).
* Startup recovery: stale PROCESSING jobs → QUEUED; every QUEUED job is (re-)enqueued. Duplicates are harmless
  because claiming is atomic in the database.
* A periodic sweep re-enqueues QUEUED jobs whose messages were lost.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time

import redis.asyncio as aioredis
from psycopg_pool import AsyncConnectionPool

from app.ingestion.pipeline import IngestionPipeline

log = logging.getLogger(__name__)


class IngestWorker:
    def __init__(self, pipeline: IngestionPipeline, redis: aioredis.Redis, pool: AsyncConnectionPool, queue: str,
                 sweep_interval: float = 60.0):
        self.pipeline = pipeline
        self.redis = redis
        self.pool = pool
        self.queue = queue
        self.sweep_interval = sweep_interval
        self._task: asyncio.Task | None = None
        self._stopping = False
        self.current_job: str | None = None
        self.processed = 0
        self.failed = 0
        self.last_error: str | None = None

    async def enqueue(self, job_id: str, document_id: str | None = None, version_id: str | None = None) -> None:
        await self.redis.lpush(self.queue, json.dumps({"jobId": job_id, "documentId": document_id, "versionId": version_id}))

    async def recover(self) -> int:
        async with self.pool.connection() as conn:
            await conn.execute(
                """UPDATE document_processing_jobs SET status='QUEUED', stage=NULL,
                          error_message='re-queued after worker restart' WHERE status='PROCESSING'"""
            )
            await conn.execute(
                """UPDATE documents d SET status='QUEUED' FROM document_processing_jobs j
                    WHERE j.document_id = d.id AND j.version_id = d.current_version_id
                      AND j.status='QUEUED' AND d.status='PROCESSING'"""
            )
            rows = await (
                await conn.execute(
                    "SELECT id, document_id, version_id FROM document_processing_jobs WHERE status='QUEUED' ORDER BY created_at"
                )
            ).fetchall()
            await conn.commit()
        for job_id, doc_id, ver_id in rows:
            await self.enqueue(str(job_id), str(doc_id), str(ver_id))
        return len(rows)

    async def _sweep(self) -> None:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    """SELECT id, document_id, version_id FROM document_processing_jobs
                        WHERE status='QUEUED' AND updated_at < now() - interval '2 minutes'"""
                )
            ).fetchall()
        for job_id, doc_id, ver_id in rows:
            await self.enqueue(str(job_id), str(doc_id), str(ver_id))

    async def run(self) -> None:
        try:
            recovered = await self.recover()
            log.info("ingest worker started", extra={"queue": self.queue, "requeued": recovered})
        except Exception:
            log.exception("ingest worker recovery failed")
        last_sweep = time.monotonic()
        while not self._stopping:
            try:
                item = await self.redis.brpop([self.queue], timeout=5)
                if time.monotonic() - last_sweep > self.sweep_interval:
                    last_sweep = time.monotonic()
                    await self._sweep()
                if not item:
                    continue
                try:
                    msg = json.loads(item[1])
                    job_id = str(msg["jobId"])
                except (ValueError, KeyError, TypeError):
                    log.warning("discarding malformed queue message")
                    continue
                self.current_job = job_id
                outcome = await self.pipeline.process(job_id)
                self.current_job = None
                if outcome.status == "COMPLETED":
                    self.processed += 1
                elif outcome.status == "FAILED":
                    self.failed += 1
                    self.last_error = outcome.detail
                elif outcome.status == "RETRY":
                    await asyncio.sleep(5)
                    await self.enqueue(job_id)
            except asyncio.CancelledError:
                break
            except Exception as exc:  # keep the worker alive (Redis/DB blips)
                self.last_error = f"{type(exc).__name__}: {exc}"
                log.exception("ingest worker loop error")
                await asyncio.sleep(3)

    def start(self) -> None:
        self._task = asyncio.create_task(self.run(), name="ingest-worker")

    async def stop(self) -> None:
        self._stopping = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    def snapshot(self) -> dict:
        return {
            "running": bool(self._task and not self._task.done()),
            "currentJob": self.current_job,
            "processed": self.processed,
            "failed": self.failed,
            "lastError": self.last_error,
        }
