"""Provider interfaces. Pipelines depend on these protocols, never on a concrete runtime."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import AsyncIterator, Protocol, runtime_checkable


@dataclass
class ChatMessage:
    role: str  # system | user | assistant
    content: str


@dataclass
class GenerationChunk:
    text: str = ""
    done: bool = False
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class ModelStatus:
    name: str
    installed: bool
    loaded: bool
    detail: str | None = None


@runtime_checkable
class EmbeddingProvider(Protocol):
    model: str
    dimensions: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...

    async def status(self) -> ModelStatus: ...


@runtime_checkable
class LLMProvider(Protocol):
    model: str

    def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[GenerationChunk]: ...

    async def status(self) -> ModelStatus: ...


@runtime_checkable
class RerankerProvider(Protocol):
    model: str

    async def score(self, query: str, passages: list[str]) -> list[float]:
        """Relevance probability in [0, 1] for each passage, same order as input."""
        ...

    async def status(self) -> ModelStatus: ...

    async def unload(self) -> None: ...
