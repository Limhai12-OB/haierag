"""Process-wide inference gate (ADR-006).

All heavy inference (embedding batches, reranking, generation) acquires this gate so that on a 16 GB machine
only `MAX_PARALLEL_INFERENCE` workloads run at once. Embedding acquires per batch, so an interactive chat request
can interleave with a long ingestion job instead of waiting for the whole document.
"""

from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from typing import AsyncIterator


class InferenceGate:
    def __init__(self, limit: int):
        self._limit = max(1, limit)
        self._sem = asyncio.Semaphore(self._limit)
        self._waiting = 0
        self._active: dict[str, int] = {}

    @property
    def limit(self) -> int:
        return self._limit

    def snapshot(self) -> dict:
        return {"limit": self._limit, "waiting": self._waiting, "active": dict(self._active)}

    @asynccontextmanager
    async def acquire(self, workload: str) -> AsyncIterator[float]:
        """Yields the time (seconds) spent waiting for the gate."""
        start = time.perf_counter()
        self._waiting += 1
        try:
            await self._sem.acquire()
        finally:
            self._waiting -= 1
        waited = time.perf_counter() - start
        self._active[workload] = self._active.get(workload, 0) + 1
        try:
            yield waited
        finally:
            self._active[workload] -= 1
            if not self._active[workload]:
                del self._active[workload]
            self._sem.release()
