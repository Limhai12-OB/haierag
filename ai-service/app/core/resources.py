"""Shared infrastructure clients: Postgres pool, Redis, object storage."""

from __future__ import annotations

import asyncio
import io

import redis.asyncio as aioredis
from minio import Minio
from pgvector.psycopg import register_vector_async
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings


async def _configure(conn: AsyncConnection) -> None:
    await register_vector_async(conn)


def create_pool(settings: Settings) -> AsyncConnectionPool:
    return AsyncConnectionPool(
        settings.postgres_conninfo,
        min_size=1,
        max_size=settings.postgres_pool_max,
        configure=_configure,
        open=False,
        kwargs={"autocommit": False},
    )


def create_redis(settings: Settings) -> aioredis.Redis:
    return aioredis.Redis(
        host=settings.redis_host,
        port=settings.redis_port,
        password=settings.redis_password or None,
        decode_responses=True,
        socket_connect_timeout=5,
    )


class ObjectStorage:
    """Thin async wrapper over the (blocking) MinIO S3 client; works with RustFS and MinIO."""

    def __init__(self, settings: Settings):
        netloc, secure = settings.storage_netloc
        self.bucket = settings.storage_bucket
        self._client = Minio(
            netloc,
            access_key=settings.storage_access_key,
            secret_key=settings.storage_secret_key,
            secure=secure,
            region=settings.storage_region,
        )

    async def get_bytes(self, key: str, max_bytes: int) -> bytes:
        def _get() -> bytes:
            stat = self._client.stat_object(self.bucket, key)
            if stat.size is not None and stat.size > max_bytes:
                raise ValueError(f"object exceeds the {max_bytes} byte limit")
            resp = self._client.get_object(self.bucket, key)
            try:
                return resp.read()
            finally:
                resp.close()
                resp.release_conn()

        return await asyncio.to_thread(_get)

    async def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        def _put() -> None:
            if not self._client.bucket_exists(self.bucket):
                self._client.make_bucket(self.bucket)
            self._client.put_object(self.bucket, key, io.BytesIO(data), len(data), content_type=content_type)

        await asyncio.to_thread(_put)

    async def ping(self) -> bool:
        return await asyncio.to_thread(self._client.bucket_exists, self.bucket)
