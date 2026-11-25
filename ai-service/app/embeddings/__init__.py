"""Embedding providers live in app.providers (OllamaEmbeddingProvider); this package re-exports them."""
from app.providers.ollama import OllamaEmbeddingProvider

__all__ = ["OllamaEmbeddingProvider"]
