"""Typed application settings, loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(_REPO_ENV), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "HaieRag"
    app_env: str = "development"
    log_level: str = "INFO"

    # --- infrastructure ---
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "haierag"
    postgres_user: str = "haierag"
    postgres_password: str = ""
    postgres_pool_max: int = 8

    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""
    ingest_queue: str = "haierag:ingest:queue"

    storage_endpoint: str = "http://localhost:9000"
    storage_access_key: str = ""
    storage_secret_key: str = ""
    storage_bucket: str = "haierag-documents"
    storage_region: str = "us-east-1"

    internal_api_token: str = ""

    # --- Ollama ---
    ollama_base_url: str = "http://localhost:11434"
    ollama_keep_alive: str = "5m"
    ollama_timeout_seconds: float = 300.0

    llm_model: str = "qwen3:4b"
    llm_context_length: int = 8192
    llm_temperature: float = 0.2
    llm_max_output_tokens: int = 2048  # includes hidden reasoning tokens
    # true: ask Ollama to separate reasoning from the answer (required for qwen3:4b-2507, which always thinks);
    # the reasoning is discarded. Falls back to false automatically for models without thinking support.
    llm_thinking: bool = True
    # Max hidden reasoning tokens before the answer is forced (qwen/ChatML models). 0 = unlimited.
    llm_thinking_budget: int = 512

    embedding_model: str = "bge-m3"
    embedding_dimensions: int = 1024
    embedding_batch_size: int = 8
    embedding_max_retries: int = 3

    # --- reranker ---
    reranker_enabled: bool = True
    reranker_model: str = "BAAI/bge-reranker-v2-m3"
    reranker_batch_size: int = 4
    reranker_max_length: int = 1024
    reranker_device: str = "auto"  # auto | mps | cpu | cuda
    reranker_idle_unload_seconds: int = 300
    reranker_unload_before_generation: bool = False
    rerank_min_score: float = 0.05

    # --- retrieval ---
    retrieval_top_k: int = 20          # candidates per channel and after fusion
    rerank_top_k: int = 5              # passages sent to the LLM
    rrf_k: int = 60
    rrf_vector_weight: float = 1.0
    rrf_keyword_weight: float = 1.0
    hnsw_ef_search: int = 100
    trigram_threshold: float = 0.2

    # --- chunking ---
    chunk_size: int = 800
    chunk_overlap: int = 120
    chunk_min_tokens: int = 80
    tokenizer_model: str = "BAAI/bge-m3"

    # --- ingestion ---
    max_parallel_inference: int = 1
    max_upload_size_mb: int = 50
    ingest_max_attempts: int = 3
    ingest_worker_enabled: bool = True

    # --- chat ---
    history_max_messages: int = 6
    history_message_max_tokens: int = 300

    @field_validator("embedding_dimensions")
    @classmethod
    def _dims(cls, v: int) -> int:
        if v != 1024:
            # The schema stores vector(1024); a different model needs a migration.
            raise ValueError("EMBEDDING_DIMENSIONS must be 1024 to match the vector(1024) column")
        return v

    @property
    def postgres_conninfo(self) -> str:
        from psycopg.conninfo import make_conninfo

        return make_conninfo(
            host=self.postgres_host,
            port=self.postgres_port,
            dbname=self.postgres_db,
            user=self.postgres_user,
            password=self.postgres_password,
            application_name="haierag-ai",
        )

    @property
    def storage_netloc(self) -> tuple[str, bool]:
        parsed = urlparse(self.storage_endpoint)
        return parsed.netloc or parsed.path, parsed.scheme == "https"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def settings_field_names() -> list[str]:
    return list(Settings.model_fields)


__all__ = ["Settings", "get_settings", "Field"]
