"""Internal API used by the backend. Requires X-Internal-Token; never published outside the Docker network."""

from __future__ import annotations

import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sse_starlette.sse import EventSourceResponse

from app.core.errors import HaieRagError
from app.core.security import require_internal_token
from app.generation.service import HistoryTurn
from app.retrieval.service import Scope

router = APIRouter(prefix="/internal/v1", dependencies=[Depends(require_internal_token)], tags=["internal"])


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ScopeIn(CamelModel):
    workspace_id: uuid.UUID
    collection_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] | None = Field(default=None, max_length=200)

    def to_scope(self) -> Scope:
        return Scope(self.workspace_id, self.collection_id, self.document_ids or None)


class RetrieveRequest(ScopeIn):
    query: str = Field(min_length=1, max_length=4000)
    top_k: int | None = Field(default=None, ge=1, le=50)
    rerank: bool = True


class HistoryItem(CamelModel):
    role: Literal["USER", "ASSISTANT"]
    content: str = Field(max_length=20000)


class ChatRequest(ScopeIn):
    question: str = Field(min_length=1, max_length=4000)
    history: list[HistoryItem] = Field(default_factory=list, max_length=50)


class EmbeddingRequest(CamelModel):
    texts: list[str] = Field(min_length=1, max_length=64)


class FetchUrlRequest(CamelModel):
    url: str = Field(min_length=1, max_length=2048)
    max_bytes: int = Field(ge=1, le=1024 * 1024 * 1024)


def _http_error(exc: HaieRagError) -> HTTPException:
    return HTTPException(exc.status_code, {"code": exc.code, "message": exc.message})


@router.post("/embeddings")
async def embeddings(body: EmbeddingRequest, request: Request) -> dict:
    c = request.app.state.container
    try:
        vectors = await c.embedder.embed(body.texts)
    except HaieRagError as exc:
        raise _http_error(exc) from exc
    return {"model": c.embedder.model, "dimensions": c.embedder.dimensions, "embeddings": vectors}


@router.post("/retrieve")
async def retrieve(body: RetrieveRequest, request: Request) -> dict:
    c = request.app.state.container
    try:
        result = await c.retrieval.retrieve(body.query, body.to_scope(), body.top_k, body.rerank)
    except HaieRagError as exc:
        raise _http_error(exc) from exc
    return {
        "passages": [p.to_api() for p in result.passages],
        "candidates": result.candidates,
        "channels": result.channels,
        "reranked": result.reranked,
        "warnings": result.warnings,
        "timingsMs": result.timings_ms,
    }


@router.post("/chat")
async def chat(body: ChatRequest, request: Request) -> EventSourceResponse:
    c = request.app.state.container
    history = [HistoryTurn(h.role, h.content) for h in body.history]

    async def events():
        try:
            async for event, data in c.chat.stream_answer(body.question, body.to_scope(), history):
                if await request.is_disconnected():
                    break
                yield {"event": event, "data": json.dumps(data, ensure_ascii=False)}
        except Exception as exc:  # never leak internals into the stream
            import logging

            logging.getLogger(__name__).exception("chat stream failed")
            yield {"event": "error", "data": json.dumps({"code": "INTERNAL_ERROR", "message": f"generation failed ({type(exc).__name__})"})}

    return EventSourceResponse(events(), ping=15)


@router.post("/ingest/jobs/{job_id}", status_code=202)
async def enqueue_job(job_id: uuid.UUID, request: Request) -> dict:
    await request.app.state.container.worker.enqueue(str(job_id))
    return {"enqueued": str(job_id)}


@router.get("/config")
async def config(request: Request) -> dict:
    s = request.app.state.container.settings
    keys = [
        "llm_model", "llm_context_length", "llm_temperature", "llm_max_output_tokens", "llm_thinking",
        "embedding_model", "embedding_dimensions", "embedding_batch_size",
        "reranker_enabled", "reranker_model", "reranker_batch_size", "reranker_max_length", "reranker_device",
        "reranker_idle_unload_seconds", "reranker_unload_before_generation", "rerank_min_score",
        "retrieval_top_k", "rerank_top_k", "rrf_k", "rrf_vector_weight", "rrf_keyword_weight",
        "chunk_size", "chunk_overlap", "max_parallel_inference",
    ]
    return {to_camel(k): getattr(s, k) for k in keys}


@router.post("/fetch-url")
async def fetch_url_endpoint(body: FetchUrlRequest, request: Request) -> dict:
    """Downloads a user-supplied link with SSRF protection (ADR-018); the backend stores it like an upload."""
    import base64

    from app.web.fetcher import fetch_url

    # UrlImportError propagates to the domain-error handler: 422 problem+json with a stable `code`.
    page = await fetch_url(body.url, request.app.state.container.settings, body.max_bytes)
    return {"url": page.url, "fileType": page.file_type, "contentType": page.content_type, "title": page.title,
            "sizeBytes": len(page.data), "data": base64.b64encode(page.data).decode("ascii")}
