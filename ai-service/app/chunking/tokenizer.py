"""Token counting with the BGE-M3 (XLM-RoBERTa) tokenizer, so chunk sizes match what the embedder and reranker see."""

from __future__ import annotations

import logging
import math
from functools import lru_cache
from typing import Protocol

log = logging.getLogger(__name__)


class TokenCounter(Protocol):
    name: str

    def count(self, text: str) -> int: ...


class HFTokenCounter:
    def __init__(self, model: str):
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        path = hf_hub_download(model, "tokenizer.json")
        self._tok = Tokenizer.from_file(path)
        self._tok.no_truncation()
        self._tok.no_padding()
        self.name = model

    def count(self, text: str) -> int:
        return len(self._tok.encode(text, add_special_tokens=False).ids)


class HeuristicTokenCounter:
    """Fallback when the tokenizer cannot be loaded. Deliberately over-estimates."""

    name = "heuristic"

    def count(self, text: str) -> int:
        khmer = sum(1 for ch in text if "ក" <= ch <= "៿")
        other = len(text) - khmer
        return math.ceil(other / 3.5 + khmer / 1.5)


@lru_cache
def get_token_counter(model: str) -> TokenCounter:
    try:
        return HFTokenCounter(model)
    except Exception as exc:
        log.warning("tokenizer %s unavailable (%s); using heuristic token counts", model, exc)
        return HeuristicTokenCounter()
