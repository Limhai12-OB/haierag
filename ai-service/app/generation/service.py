"""RAG answer generation: retrieve → budget context → stream Qwen3 → validate citations.

Emits a sequence of (event, data) tuples consumed by the SSE endpoint:
meta → token* → citations → done   (or error at any point)
"""

from __future__ import annotations

import contextlib
import logging
import re
import time
from dataclasses import dataclass
from typing import AsyncIterator

from app.chunking.tokenizer import TokenCounter
from app.citations.mapper import map_citations
from app.core.concurrency import InferenceGate
from app.core.config import Settings
from app.core.errors import HaieRagError
from app.generation.prompts import SYSTEM_PROMPT, build_user_message, format_source, insufficient_answer
from app.providers.base import ChatMessage, LLMProvider, RerankerProvider
from app.retrieval.service import Passage, RetrievalService, Scope

log = logging.getLogger(__name__)

TOKEN_SAFETY = 1.15  # bge tokenizer ≠ Qwen tokenizer: leave headroom


@dataclass
class HistoryTurn:
    role: str  # USER | ASSISTANT
    content: str


class ThinkFilter:
    """Removes <think>…</think> blocks from a token stream (defence in depth when thinking is disabled)."""

    def __init__(self) -> None:
        self.buf = ""
        self.inside = False

    def feed(self, text: str) -> str:
        self.buf += text
        out = []
        while self.buf:
            if self.inside:
                end = self.buf.find("</think>")
                if end < 0:
                    self.buf = self.buf[-8:]
                    return "".join(out)
                self.buf = self.buf[end + 8:]
                self.inside = False
            else:
                start = self.buf.find("<think>")
                if start < 0:
                    # keep a possible partial "<think" at the end
                    keep = 0
                    for i in range(1, 7):
                        if self.buf.endswith("<think>"[:i]):
                            keep = i
                    out.append(self.buf[: len(self.buf) - keep])
                    self.buf = self.buf[len(self.buf) - keep:]
                    return "".join(out)
                out.append(self.buf[:start])
                self.buf = self.buf[start + 7:]
                self.inside = True
        return "".join(out)

    def flush(self) -> str:
        rest = "" if self.inside else self.buf
        self.buf = ""
        return rest


_LOOP = re.compile(r"(.{1,40}?)(?:\s*\1){7,}\s*$", re.DOTALL)


def repetition_start(text: str, window: int = 600) -> int | None:
    """If the text ends in a degenerate loop (one short unit repeated 8+ times), return where the repeats begin
    (after keeping one copy of the unit). Small models sometimes loop on Khmer; this stops wasted generation."""
    tail_offset = max(0, len(text) - window)
    m = _LOOP.search(text, tail_offset)
    if not m or len(m.group(0).strip()) < 24 or not re.search(r"\w", m.group(1)):  # skip e.g. table rules
        return None
    return m.start() + len(m.group(1))


def retrieval_query(question: str, history: list[HistoryTurn]) -> str:
    """Short follow-ups ("and the second one?") are expanded with the previous user question."""
    words = len(re.findall(r"\w+", question))
    if words < 6 and history:
        prev = next((h.content for h in reversed(history) if h.role.upper() == "USER"), None)
        if prev:
            return f"{prev}\n{question}"
    return question


class ChatService:
    def __init__(self, settings: Settings, retrieval: RetrievalService, llm: LLMProvider,
                 reranker: RerankerProvider | None, counter: TokenCounter, gate: InferenceGate):
        self.s = settings
        self.retrieval = retrieval
        self.llm = llm
        self.reranker = reranker
        self.counter = counter
        self.gate = gate

    def _tokens(self, text: str) -> int:
        return int(self.counter.count(text) * TOKEN_SAFETY) + 4

    def build_messages(self, question: str, passages: list[Passage], history: list[HistoryTurn]) -> tuple[list[ChatMessage], list[Passage]]:
        budget = self.s.llm_context_length - self.s.llm_max_output_tokens - self._tokens(SYSTEM_PROMPT) - 64

        sources: list[str] = []
        used: list[Passage] = []
        q_cost = self._tokens(build_user_message(question, []))
        remaining = budget - q_cost
        for p in passages:
            n = len(used) + 1
            block = format_source(n, p.document_name, p.content, p.page_start, p.page_end, p.section_heading)
            cost = self._tokens(block)
            if cost > remaining:
                if not used and remaining > 200:  # always try to keep at least one (truncated) passage
                    ratio = remaining / cost
                    content = p.content[: int(len(p.content) * ratio * 0.9)]
                    block = format_source(n, p.document_name, content, p.page_start, p.page_end, p.section_heading)
                    sources.append(block)
                    used.append(p)
                    remaining -= self._tokens(block)
                break
            sources.append(block)
            used.append(p)
            remaining -= cost

        hist_msgs: list[ChatMessage] = []
        for turn in reversed(history[-self.s.history_max_messages:]):
            content = turn.content
            max_chars = self.s.history_message_max_tokens * 3
            if len(content) > max_chars:
                content = content[:max_chars] + " …"
            cost = self._tokens(content)
            if cost > remaining:
                break
            remaining -= cost
            hist_msgs.insert(0, ChatMessage("assistant" if turn.role.upper() == "ASSISTANT" else "user", content))

        messages = [ChatMessage("system", SYSTEM_PROMPT), *hist_msgs, ChatMessage("user", build_user_message(question, sources))]
        return messages, used

    async def stream_answer(self, question: str, scope: Scope, history: list[HistoryTurn]) -> AsyncIterator[tuple[str, dict]]:
        t_start = time.perf_counter()
        try:
            result = await self.retrieval.retrieve(retrieval_query(question, history), scope)
        except HaieRagError as exc:
            yield "error", {"code": exc.code, "message": exc.message}
            return

        timings = dict(result.timings_ms)
        timings["retrieval_total"] = round((time.perf_counter() - t_start) * 1000, 1)

        if not result.passages:
            answer = insufficient_answer(question)
            yield "meta", {"retrieval": {"candidates": result.candidates, "passages": 0, "timingsMs": timings,
                                         "channels": result.channels, "reranked": result.reranked, "warnings": result.warnings}}
            yield "token", {"text": answer}
            yield "citations", {"citations": []}
            yield "done", {"answer": answer, "grounded": False, "model": None, "promptTokens": None,
                           "completionTokens": None, "timingsMs": timings, "reason": "NO_RELEVANT_PASSAGES"}
            return

        messages, used = self.build_messages(question, result.passages, history)
        yield "meta", {"retrieval": {"candidates": result.candidates, "passages": len(used), "timingsMs": timings,
                                     "channels": result.channels, "reranked": result.reranked, "warnings": result.warnings}}

        if self.s.reranker_unload_before_generation and self.reranker is not None:
            await self.reranker.unload()

        answer_parts: list[str] = []
        think = ThinkFilter()
        prompt_tokens = completion_tokens = None
        t_gen = time.perf_counter()
        first_token_ms = None
        looped_at: int | None = None
        try:
            async with self.gate.acquire("generation") as waited:
                timings["generation_queue"] = round(waited * 1000, 1)
                async with contextlib.aclosing(self.llm.stream_chat(messages)) as stream:
                    async for chunk in stream:
                        text = think.feed(chunk.text) if chunk.text else ""
                        if text:
                            if first_token_ms is None:
                                first_token_ms = round((time.perf_counter() - t_gen) * 1000, 1)
                            answer_parts.append(text)
                            yield "token", {"text": text}
                            looped_at = repetition_start("".join(answer_parts))
                            if looped_at is not None:
                                log.warning("repetition loop detected; stopping generation")
                                break  # aclosing() closes the Ollama stream, which cancels generation
                        if chunk.done:
                            prompt_tokens, completion_tokens = chunk.prompt_tokens, chunk.completion_tokens
            tail = think.flush()
            if tail:
                answer_parts.append(tail)
                yield "token", {"text": tail}
        except HaieRagError as exc:
            yield "error", {"code": exc.code, "message": exc.message}
            return

        timings["generation"] = round((time.perf_counter() - t_gen) * 1000, 1)
        if first_token_ms is not None:
            timings["first_token"] = first_token_ms
        timings["total"] = round((time.perf_counter() - t_start) * 1000, 1)

        answer = "".join(answer_parts)
        if looped_at is not None:
            answer = answer[:looped_at].rstrip() + " …"
            timings["stopped_repetition"] = True
        if "</think>" in answer:  # reasoning leaked without an opening tag: keep only the final answer
            answer = answer.rsplit("</think>", 1)[1]
        if not answer.strip():
            yield "error", {"code": "GENERATION_EMPTY",
                            "message": "The model produced no answer (it may have used its whole output budget on "
                                       "reasoning). Increase LLM_MAX_OUTPUT_TOKENS or ask a narrower question."}
            return
        mapped = map_citations(answer.strip(), used)
        if mapped.invalid_markers:
            log.warning("removed invalid citation markers", extra={"invalid": mapped.invalid_markers})
        yield "citations", {"citations": mapped.citations}
        yield "done", {
            "answer": mapped.answer,
            "grounded": bool(mapped.citations),
            "model": self.llm.model,
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "timingsMs": timings,
            "invalidCitationMarkers": mapped.invalid_markers,
        }
