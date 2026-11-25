"""Composition root: builds providers and services once per process (dependency injection by construction)."""

from __future__ import annotations

from dataclasses import dataclass

import redis.asyncio as aioredis
from psycopg_pool import AsyncConnectionPool

from app.chunking.tokenizer import get_token_counter
from app.core.concurrency import InferenceGate
from app.core.config import Settings
from app.core.resources import ObjectStorage, create_pool, create_redis
from app.generation.service import ChatService
from app.ingestion.pipeline import IngestionPipeline
from app.providers.ollama import OllamaClient, OllamaEmbeddingProvider, OllamaLLMProvider
from app.reranking.transformers_reranker import TransformersReranker
from app.retrieval.service import RetrievalService
from app.workers.ingest_worker import IngestWorker


@dataclass
class Container:
    settings: Settings
    pool: AsyncConnectionPool
    redis: aioredis.Redis
    storage: ObjectStorage
    gate: InferenceGate
    ollama: OllamaClient
    embedder: OllamaEmbeddingProvider
    llm: OllamaLLMProvider
    reranker: TransformersReranker | None
    retrieval: RetrievalService
    chat: ChatService
    pipeline: IngestionPipeline
    worker: IngestWorker

    @classmethod
    def build(cls, settings: Settings) -> "Container":
        pool = create_pool(settings)
        redis = create_redis(settings)
        storage = ObjectStorage(settings)
        gate = InferenceGate(settings.max_parallel_inference)
        ollama = OllamaClient(settings)
        embedder = OllamaEmbeddingProvider(settings, ollama, gate)
        llm = OllamaLLMProvider(settings, ollama)
        reranker = TransformersReranker(settings, gate) if settings.reranker_enabled else None
        retrieval = RetrievalService(settings, pool, embedder, reranker)
        chat = ChatService(settings, retrieval, llm, reranker, get_token_counter(settings.tokenizer_model), gate)
        pipeline = IngestionPipeline(settings, pool, storage, embedder)
        worker = IngestWorker(pipeline, redis, pool, settings.ingest_queue)
        return cls(settings, pool, redis, storage, gate, ollama, embedder, llm, reranker, retrieval, chat, pipeline, worker)

    async def start(self, run_worker: bool) -> None:
        await self.pool.open(wait=False)
        if run_worker:
            self.worker.start()

    async def close(self) -> None:
        await self.worker.stop()
        if self.reranker is not None:
            await self.reranker.aclose()
        await self.ollama.aclose()
        await self.redis.aclose()
        await self.pool.close()
