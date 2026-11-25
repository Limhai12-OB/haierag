"""Local cross-encoder reranker (BAAI/bge-reranker-v2-m3) via Transformers.

Memory policy (ADR-006): loaded lazily on first use, unloaded after an idle period, optionally unloaded
before each generation. Runs on MPS (fp16) when available, otherwise CPU (fp32).
"""

from __future__ import annotations

import asyncio
import gc
import logging
import time

from app.core.concurrency import InferenceGate
from app.core.config import Settings
from app.core.errors import InferenceBackendError, ModelUnavailableError
from app.providers.base import ModelStatus

log = logging.getLogger(__name__)


def _pick_device(preference: str) -> str:
    import torch

    pref = preference.lower()
    if pref in ("cpu", "mps", "cuda"):
        if pref == "mps" and not torch.backends.mps.is_available():
            log.warning("RERANKER_DEVICE=mps requested but unavailable; using cpu")
            return "cpu"
        if pref == "cuda" and not torch.cuda.is_available():
            return "cpu"
        return pref
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def is_model_cached(model: str) -> bool:
    try:
        from huggingface_hub import try_to_load_from_cache

        path = try_to_load_from_cache(model, "config.json")
        return isinstance(path, str)
    except Exception:  # pragma: no cover - defensive
        return False


class TransformersReranker:
    def __init__(self, settings: Settings, gate: InferenceGate):
        self.model = settings.reranker_model
        self.batch_size = max(1, settings.reranker_batch_size)
        self.max_length = settings.reranker_max_length
        self.idle_unload_seconds = settings.reranker_idle_unload_seconds
        self._device_pref = settings.reranker_device
        self._gate = gate
        self._model = None
        self._tokenizer = None
        self._device: str | None = None
        self._last_used = 0.0
        self._load_lock = asyncio.Lock()
        self._idle_task: asyncio.Task | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _load_sync(self) -> None:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        device = _pick_device(self._device_pref)
        dtype = torch.float16 if device in ("mps", "cuda") else torch.float32
        try:
            tokenizer = AutoTokenizer.from_pretrained(self.model)
            model = AutoModelForSequenceClassification.from_pretrained(self.model, dtype=dtype)
        except OSError as exc:
            raise ModelUnavailableError(
                f"Reranker '{self.model}' could not be loaded ({exc.__class__.__name__}). Download it with: "
                f"python -c \"from huggingface_hub import snapshot_download; snapshot_download('{self.model}')\" "
                "or set RERANKER_ENABLED=false."
            ) from exc
        model.eval()
        try:
            model.to(device)
        except RuntimeError as exc:  # e.g. MPS failure -> CPU fallback
            log.warning("reranker failed on %s, falling back to cpu: %s", device, exc)
            device = "cpu"
            model = model.float().to(device)
        self._tokenizer, self._model, self._device = tokenizer, model, device
        log.info("reranker loaded", extra={"model": self.model, "device": device})

    async def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        async with self._load_lock:
            if self._model is None:
                start = time.perf_counter()
                await asyncio.to_thread(self._load_sync)
                log.info("reranker load time", extra={"seconds": round(time.perf_counter() - start, 2)})
                if self.idle_unload_seconds > 0 and (self._idle_task is None or self._idle_task.done()):
                    self._idle_task = asyncio.create_task(self._idle_watch())

    def _score_sync(self, query: str, passages: list[str]) -> list[float]:
        import torch

        scores: list[float] = []
        with torch.inference_mode():
            for i in range(0, len(passages), self.batch_size):
                batch = passages[i : i + self.batch_size]
                enc = self._tokenizer(
                    [query] * len(batch),
                    batch,
                    padding=True,
                    truncation="only_second",
                    max_length=self.max_length,
                    return_tensors="pt",
                ).to(self._device)
                logits = self._model(**enc, return_dict=True).logits.view(-1).float()
                scores.extend(torch.sigmoid(logits).cpu().tolist())
        return scores

    async def score(self, query: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        async with self._gate.acquire("reranking"):
            await self._ensure_loaded()
            try:
                result = await asyncio.to_thread(self._score_sync, query, passages)
            except RuntimeError as exc:
                raise InferenceBackendError(f"reranker inference failed: {exc}") from exc
            finally:
                self._last_used = time.monotonic()
        return result

    def _unload_sync(self) -> None:
        self._model = None
        self._tokenizer = None
        gc.collect()
        try:
            import torch

            if self._device == "mps":
                torch.mps.empty_cache()
            elif self._device == "cuda":
                torch.cuda.empty_cache()
        except Exception:  # pragma: no cover
            pass

    async def unload(self) -> None:
        async with self._load_lock:
            if self._model is not None:
                await asyncio.to_thread(self._unload_sync)
                log.info("reranker unloaded", extra={"model": self.model})

    async def _idle_watch(self) -> None:
        try:
            while self._model is not None:
                await asyncio.sleep(min(30, self.idle_unload_seconds))
                if self._model is not None and time.monotonic() - self._last_used > self.idle_unload_seconds:
                    await self.unload()
        except asyncio.CancelledError:
            pass

    async def status(self) -> ModelStatus:
        cached = is_model_cached(self.model)
        detail = None
        if not cached:
            detail = "not downloaded — it will be fetched from Hugging Face on first use, or pre-download it"
        return ModelStatus(
            name=self.model,
            installed=cached,
            loaded=self.loaded,
            detail=detail if detail else (f"device={self._device}" if self.loaded else "loads on demand"),
        )

    async def aclose(self) -> None:
        if self._idle_task:
            self._idle_task.cancel()
        await self.unload()
