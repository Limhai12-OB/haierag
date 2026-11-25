"""Health checks. Distinguishes "runtime reachable" from "model installed" from "model loaded"."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request

from app.core.errors import HaieRagError
from app.core.security import require_internal_token

router = APIRouter(tags=["health"])


async def _guard(coro, timeout: float = 5.0) -> dict:
    try:
        return await asyncio.wait_for(coro, timeout)
    except HaieRagError as exc:
        return {"status": "down", "detail": exc.message}
    except Exception as exc:
        return {"status": "down", "detail": f"{type(exc).__name__}: {str(exc)[:200]}"}


def _model(st) -> dict:
    if not st.installed:
        status = "down"
    else:
        status = "ok"
    return {"status": status, "model": st.name, "installed": st.installed, "loaded": st.loaded,
            "detail": st.detail or ("loaded in memory" if st.loaded else "installed, loads on first use")}


@router.get("/health/live")
async def live() -> dict:
    return {"status": "ok"}


@router.get("/health", dependencies=[Depends(require_internal_token)])
async def health(request: Request) -> dict:
    c = request.app.state.container

    async def ollama():
        return {"status": "ok", "version": await c.ollama.version(), "baseUrl": c.ollama.base_url}

    async def llm():
        return _model(await c.llm.status())

    async def embedding():
        out = _model(await c.embedder.status())
        out["dimensions"] = c.embedder.dimensions
        return out

    async def reranker():
        if c.reranker is None:
            return {"status": "degraded", "detail": "disabled (RERANKER_ENABLED=false); fused ranking is used"}
        st = await c.reranker.status()
        out = _model(st)
        if not st.installed:
            out["status"] = "degraded"
        return out

    async def postgres():
        async with c.pool.connection(timeout=3) as conn:
            v = await (await conn.execute("SELECT extversion FROM pg_extension WHERE extname='vector'")).fetchone()
        return {"status": "ok" if v else "degraded", "pgvector": v[0] if v else None}

    async def redis():
        await c.redis.ping()
        return {"status": "ok", "queueDepth": await c.redis.llen(c.settings.ingest_queue), "worker": c.worker.snapshot()}

    async def storage():
        exists = await c.storage.ping()
        return {"status": "ok" if exists else "degraded", "bucket": c.storage.bucket,
                "detail": None if exists else "bucket does not exist yet (created by the backend on first start)"}

    names = ["ollama", "llm", "embedding", "reranker", "postgres", "redis", "storage"]
    results = await asyncio.gather(*[_guard(f()) for f in (ollama, llm, embedding, reranker, postgres, redis, storage)])
    components = dict(zip(names, results))
    critical = ("ollama", "llm", "embedding", "postgres")
    if any(components[n]["status"] == "down" for n in critical):
        overall = "down"
    elif any(v["status"] != "ok" for v in components.values()):
        overall = "degraded"
    else:
        overall = "ok"
    return {"status": overall, "components": components, "inference": c.gate.snapshot()}
