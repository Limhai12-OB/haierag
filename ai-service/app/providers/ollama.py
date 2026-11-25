"""Ollama runtime: local generation (qwen3:4b) and embeddings (bge-m3).

No remote fallback: if Ollama or a model is missing we raise a clear, actionable error.
"""

from __future__ import annotations

import json
import logging
import math
from typing import AsyncIterator

import httpx

from app.core.concurrency import InferenceGate
from app.core.config import Settings
from app.core.errors import EmbeddingValidationError, InferenceBackendError, ModelUnavailableError
from app.generation.prompts import KHMER_DIRECTIVE
from app.providers.base import ChatMessage, GenerationChunk, ModelStatus

log = logging.getLogger(__name__)


def _matches(model: str, names: set[str]) -> bool:
    return model in names or (":" not in model and f"{model}:latest" in names)


class OllamaClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.keep_alive = settings.ollama_keep_alive
        self._client = client or httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(settings.ollama_timeout_seconds, connect=5.0),
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def _unreachable(self, exc: Exception) -> InferenceBackendError:
        return InferenceBackendError(
            f"Ollama is not reachable at {self.base_url} ({type(exc).__name__}). "
            "Start it with `ollama serve` (or the Ollama app). From Docker on macOS use "
            "http://host.docker.internal:11434, not localhost."
        )

    async def version(self) -> str:
        try:
            r = await self._client.get("/api/version", timeout=3.0)
            r.raise_for_status()
            return r.json().get("version", "unknown")
        except httpx.HTTPError as exc:
            raise self._unreachable(exc) from exc

    async def installed_models(self) -> set[str]:
        try:
            r = await self._client.get("/api/tags", timeout=5.0)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise self._unreachable(exc) from exc
        return {m["name"] for m in r.json().get("models", [])}

    async def loaded_models(self) -> set[str]:
        try:
            r = await self._client.get("/api/ps", timeout=5.0)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise self._unreachable(exc) from exc
        return {m["name"] for m in r.json().get("models", [])}

    async def model_status(self, model: str) -> ModelStatus:
        installed = _matches(model, await self.installed_models())
        loaded = installed and _matches(model, await self.loaded_models())
        detail = None if installed else f"not installed — run `ollama pull {model}`"
        return ModelStatus(name=model, installed=installed, loaded=loaded, detail=detail)

    def _raise_for_model_error(self, status_code: int, body: str, model: str) -> None:
        if status_code == 404 or "not found" in body.lower():
            raise ModelUnavailableError(f"Model '{model}' is not available in Ollama. Run `ollama pull {model}`.")
        if "memory" in body.lower():
            raise InferenceBackendError(
                f"Ollama could not load '{model}' due to memory pressure: {body[:200]}. "
                "Close other model workloads or reduce LLM_CONTEXT_LENGTH."
            )
        raise InferenceBackendError(f"Ollama error {status_code} for '{model}': {body[:300]}")

    async def embed(self, model: str, texts: list[str]) -> list[list[float]]:
        try:
            r = await self._client.post(
                "/api/embed",
                json={"model": model, "input": texts, "keep_alive": self.keep_alive, "truncate": True},
            )
        except httpx.HTTPError as exc:
            raise self._unreachable(exc) from exc
        if r.status_code != 200:
            self._raise_for_model_error(r.status_code, r.text, model)
        return r.json().get("embeddings", [])

    async def stream_chat(self, model: str, messages: list[dict], options: dict, think: bool) -> AsyncIterator[dict]:
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "think": think,
            "options": options,
            "keep_alive": self.keep_alive,
        }
        try:
            async with self._client.stream("POST", "/api/chat", json=payload) as r:
                if r.status_code != 200:
                    body = (await r.aread()).decode(errors="replace")
                    self._raise_for_model_error(r.status_code, body, model)
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    if "error" in data:
                        self._raise_for_model_error(500, str(data["error"]), model)
                    yield data
        except httpx.HTTPError as exc:
            raise self._unreachable(exc) from exc


    async def stream_generate_raw(self, model: str, prompt: str, options: dict) -> AsyncIterator[dict]:
        """Raw completion (no chat template) — used to force an answer after a capped reasoning phase."""
        payload = {"model": model, "prompt": prompt, "raw": True, "stream": True, "options": options,
                   "keep_alive": self.keep_alive}
        try:
            async with self._client.stream("POST", "/api/generate", json=payload) as r:
                if r.status_code != 200:
                    body = (await r.aread()).decode(errors="replace")
                    self._raise_for_model_error(r.status_code, body, model)
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    if "error" in data:
                        self._raise_for_model_error(500, str(data["error"]), model)
                    yield data
        except httpx.HTTPError as exc:
            raise self._unreachable(exc) from exc


class OllamaEmbeddingProvider:
    """bge-m3 embeddings via Ollama, batched, gated, retried and dimension-validated."""

    def __init__(self, settings: Settings, client: OllamaClient, gate: InferenceGate):
        self.model = settings.embedding_model
        self.dimensions = settings.embedding_dimensions
        self.batch_size = max(1, settings.embedding_batch_size)
        self.max_retries = max(1, settings.embedding_max_retries)
        self._client = client
        self._gate = gate

    def _validate(self, vectors: list[list[float]], expected: int) -> None:
        if len(vectors) != expected:
            raise EmbeddingValidationError(f"expected {expected} embeddings, got {len(vectors)}")
        for v in vectors:
            if len(v) != self.dimensions:
                raise EmbeddingValidationError(
                    f"embedding dimension {len(v)} != configured {self.dimensions} for model {self.model}"
                )
            if not all(math.isfinite(x) for x in v):
                raise EmbeddingValidationError("embedding contains NaN/Inf values")

    async def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        import asyncio

        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                async with self._gate.acquire("embedding"):
                    vectors = await self._client.embed(self.model, batch)
                self._validate(vectors, len(batch))
                return vectors
            except (ModelUnavailableError, EmbeddingValidationError):
                raise
            except InferenceBackendError as exc:
                last_exc = exc
                if attempt < self.max_retries:
                    delay = 0.5 * 2 ** (attempt - 1)
                    log.warning("embedding batch failed, retrying", extra={"attempt": attempt, "delay_s": delay})
                    await asyncio.sleep(delay)
        assert last_exc is not None
        raise last_exc

    async def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self.batch_size):
            out.extend(await self._embed_batch(texts[i : i + self.batch_size]))
        return out

    async def status(self) -> ModelStatus:
        return await self._client.model_status(self.model)


FORCE_ANSWER = "\n\nI have enough information. I will now write the final answer, citing sources as [n].\n</think>\n\n"
FORCE_ANSWER_KM = ("\n\nI have enough information. The question is in Khmer, so I will now write the final answer "
                   "entirely in Khmer (ភាសាខ្មែរ), citing sources as [n].\n</think>\n\n")


def chatml_prompt(messages: list[dict], reasoning: str) -> str:
    """Qwen ChatML prompt ending in a closed <think> block, so the model continues with the answer."""
    parts = [f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages]
    last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    force = FORCE_ANSWER_KM if KHMER_DIRECTIVE in last_user else FORCE_ANSWER
    return "".join(parts) + f"<|im_start|>assistant\n<think>\n{reasoning.strip()}{force}"


class OllamaLLMProvider:
    """Qwen3 via Ollama.

    Reasoning budget (ADR-016): thinking models are streamed with think=true; if the hidden reasoning exceeds
    LLM_THINKING_BUDGET tokens (or the output budget runs out before any answer text), the stream is cut and a
    raw ChatML continuation with a closed <think> block forces the model to write the answer. Only applied to
    ChatML (qwen*) models; other models just run with their normal settings.
    """

    def __init__(self, settings: Settings, client: OllamaClient):
        self.model = settings.llm_model
        self.context_length = settings.llm_context_length
        self.temperature = settings.llm_temperature
        self.max_output_tokens = settings.llm_max_output_tokens
        self.thinking = settings.llm_thinking
        self.thinking_budget = settings.llm_thinking_budget
        self._supports_thinking: bool | None = None
        self._client = client

    @property
    def _can_force(self) -> bool:
        return self.model.lower().startswith("qwen")

    def _options(self, num_predict: int) -> dict:
        return {"temperature": self.temperature, "num_ctx": self.context_length, "num_predict": num_predict}

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[GenerationChunk]:
        payload = [{"role": m.role, "content": m.content} for m in messages]
        # Thinking-capable models (qwen3:4b-2507 always reasons) must run with think=true so Ollama returns the
        # reasoning in `message.thinking` instead of leaking it into the answer. Reasoning is never shown.
        think = self.thinking if self._supports_thinking is not False else False
        try:
            async for chunk in self._stream(payload, think):
                yield chunk
        except InferenceBackendError as exc:
            if think and "does not support thinking" in exc.message:
                self._supports_thinking = False
                async for chunk in self._stream(payload, False):
                    yield chunk
            else:
                raise

    async def _stream(self, payload: list[dict], think: bool) -> AsyncIterator[GenerationChunk]:
        reasoning: list[str] = []
        reasoning_tokens = 0
        answered = False
        final: dict | None = None
        budget = self.thinking_budget if (think and self._can_force and self.thinking_budget > 0) else None

        stream = self._client.stream_chat(self.model, payload, self._options(self.max_output_tokens), think)
        try:
            async for data in stream:
                msg = data.get("message") or {}
                if msg.get("thinking"):
                    reasoning.append(msg["thinking"])
                    reasoning_tokens += 1  # Ollama streams ~one token per chunk
                    if budget is not None and not answered and reasoning_tokens >= budget:
                        break  # closing the stream cancels generation in Ollama
                text = msg.get("content", "")
                if text:
                    answered = True
                    if not data.get("done"):
                        yield GenerationChunk(text=text)
                if data.get("done"):
                    final = data
                    if text:
                        yield GenerationChunk(text=text)
        finally:
            await stream.aclose()

        if final is not None and answered:
            yield GenerationChunk(done=True, prompt_tokens=final.get("prompt_eval_count"),
                                  completion_tokens=final.get("eval_count"),
                                  extra={"done_reason": final.get("done_reason"), "reasoning_tokens": reasoning_tokens})
            return
        if not (think and self._can_force):
            yield GenerationChunk(done=True, extra={"done_reason": (final or {}).get("done_reason")})
            return

        # Reasoning hit the budget (or used up the output) before any answer: force the answer.
        log.info("reasoning budget reached; forcing answer", extra={"reasoning_tokens": reasoning_tokens})
        text_reasoning = "".join(reasoning)
        if len(text_reasoning) > 6000:  # keep the continuation prompt inside the context window
            text_reasoning = text_reasoning[:6000]
        prompt = chatml_prompt(payload, text_reasoning)
        answer_budget = max(256, min(1024, self.max_output_tokens))
        last: dict = {}
        async for data in self._client.stream_generate_raw(self.model, prompt, self._options(answer_budget)):
            text = data.get("response", "")
            if text:
                yield GenerationChunk(text=text)
            if data.get("done"):
                last = data
        yield GenerationChunk(done=True, prompt_tokens=last.get("prompt_eval_count"),
                              completion_tokens=(last.get("eval_count") or 0) + reasoning_tokens,
                              extra={"done_reason": last.get("done_reason"), "reasoning_tokens": reasoning_tokens,
                                     "forced_answer": True})

    async def status(self) -> ModelStatus:
        return await self._client.model_status(self.model)
