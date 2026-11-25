"""Structure-aware chunking.

Strategy
1. Segments are split into *units*: paragraphs, or table row-blocks. Units larger than the chunk size are split
   at sentence boundaries (Latin `.!?`, Khmer `។ ៕`, newlines); a single over-long sentence is split by tokens.
2. Units are packed greedily into chunks of at most `chunk_size` tokens.
3. A new section heading closes the current chunk once it holds at least `min_tokens`, so chunks rarely span
   sections; tiny sections are merged forward instead of producing fragments.
4. Overlap: the next chunk starts with trailing *sentences* (never partial sentences) of the previous chunk,
   up to `overlap` tokens, but only within the same section.
Every chunk keeps page range and section heading for citations.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from app.chunking.tokenizer import TokenCounter
from app.parsing.base import Segment

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?។៕])\s+|(?<=[។៕])|\n+")


@dataclass
class Chunk:
    index: int
    content: str
    token_count: int
    page_start: int | None
    page_end: int | None
    section_heading: str | None
    metadata: dict = field(default_factory=dict)

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.content.encode("utf-8")).hexdigest()


@dataclass
class _Unit:
    text: str
    tokens: int
    page: int | None
    heading: str | None
    kind: str
    sentences: list[str] | None = None  # for overlap


@dataclass
class ChunkingConfig:
    chunk_size: int = 800
    overlap: int = 120
    min_tokens: int = 80

    def __post_init__(self) -> None:
        if self.chunk_size < 50:
            raise ValueError("chunk_size must be >= 50 tokens")
        if not 0 <= self.overlap < self.chunk_size // 2:
            raise ValueError("overlap must be >= 0 and < chunk_size / 2")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if s and s.strip()]


class StructuredChunker:
    name = "structured-v1"

    def __init__(self, counter: TokenCounter, config: ChunkingConfig):
        self.counter = counter
        self.cfg = config

    # ------------------------------------------------------------------ units
    def _hard_split(self, text: str) -> list[str]:
        """Split an over-long sentence into pieces of <= chunk_size tokens (by words, else characters)."""
        words = text.split(" ")
        pieces, cur = [], []
        for w in words:
            candidate = " ".join(cur + [w])
            if cur and self.counter.count(candidate) > self.cfg.chunk_size:
                pieces.append(" ".join(cur))
                cur = [w]
            else:
                cur.append(w)
        if cur:
            pieces.append(" ".join(cur))
        out = []
        for p in pieces:  # unspaced scripts (Khmer) can still be too long: split by characters
            while self.counter.count(p) > self.cfg.chunk_size:
                lo, hi = 1, len(p)
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    if self.counter.count(p[:mid]) <= self.cfg.chunk_size:
                        lo = mid
                    else:
                        hi = mid - 1
                out.append(p[:lo])
                p = p[lo:]
            if p:
                out.append(p)
        return out

    def _units(self, segments: list[Segment]) -> list[_Unit | Segment]:
        """Returns units interleaved with heading segments (which act as boundaries)."""
        out: list[_Unit | Segment] = []
        heading: str | None = None
        for seg in segments:
            if seg.kind == "heading":
                heading = seg.text
                out.append(seg)
                continue
            if seg.kind == "table":
                tokens = self.counter.count(seg.text)
                if tokens <= self.cfg.chunk_size:
                    out.append(_Unit(seg.text, tokens, seg.page, heading, "table"))
                else:  # split rows, repeating the table header
                    lines = seg.text.split("\n")
                    head, rows = lines[:2], lines[2:]
                    cur: list[str] = []
                    for row in rows:
                        candidate = "\n".join(head + cur + [row])
                        if cur and self.counter.count(candidate) > self.cfg.chunk_size:
                            text = "\n".join(head + cur)
                            out.append(_Unit(text, self.counter.count(text), seg.page, heading, "table"))
                            cur = [row]
                        else:
                            cur.append(row)
                    if cur:
                        text = "\n".join(head + cur)
                        out.append(_Unit(text, self.counter.count(text), seg.page, heading, "table"))
                continue
            for para in re.split(r"\n\s*\n", seg.text):
                para = para.strip()
                if not para:
                    continue
                tokens = self.counter.count(para)
                sentences = split_sentences(para)
                if tokens <= self.cfg.chunk_size:
                    out.append(_Unit(para, tokens, seg.page, heading, "text", sentences))
                    continue
                # pieces leave room for the overlap prefix the next chunk will carry
                limit = self.cfg.chunk_size - self.cfg.overlap
                cur_s: list[str] = []
                for sent in sentences:
                    pieces = self._hard_split(sent) if self.counter.count(sent) > self.cfg.chunk_size else [sent]
                    for piece in pieces:
                        candidate = " ".join(cur_s + [piece])
                        if cur_s and self.counter.count(candidate) > limit:
                            text = " ".join(cur_s)
                            out.append(_Unit(text, self.counter.count(text), seg.page, heading, "text", list(cur_s)))
                            cur_s = [piece]
                        else:
                            cur_s.append(piece)
                if cur_s:
                    text = " ".join(cur_s)
                    out.append(_Unit(text, self.counter.count(text), seg.page, heading, "text", list(cur_s)))
        return out

    # ------------------------------------------------------------------ packing
    def chunk(self, segments: list[Segment]) -> list[Chunk]:
        cfg, count = self.cfg, self.counter.count
        chunks: list[Chunk] = []
        cur: list[_Unit] = []

        def text_of(units: list[_Unit]) -> str:
            return "\n\n".join(u.text for u in units)

        def emit(units: list[_Unit]) -> None:
            body = [u for u in units if u.kind not in ("heading", "overlap")]
            if not body:
                return
            content = text_of(units)
            pages = [u.page for u in units if u.page is not None]
            headings = list(dict.fromkeys(u.heading for u in units if u.heading))
            first = next(u for u in units if u.kind != "overlap")
            chunks.append(
                Chunk(
                    index=len(chunks),
                    content=content,
                    token_count=count(content),
                    page_start=min(pages) if pages else None,
                    page_end=max(pages) if pages else None,
                    section_heading=first.heading,
                    metadata={"headings": headings, "kinds": sorted({u.kind for u in body}), "chunker": self.name},
                )
            )

        def overlap_from(prev: list[_Unit], heading: str | None) -> list[_Unit]:
            last = prev[-1] if prev else None
            if cfg.overlap <= 0 or last is None or last.kind != "text" or not last.sentences or last.heading != heading:
                return []
            picked: list[str] = []
            for sent in reversed(last.sentences):
                if count(" ".join([sent] + picked)) > cfg.overlap:
                    break
                picked.insert(0, sent)
            if not picked:
                return []
            text = " ".join(picked)
            return [_Unit(text, count(text), last.page, last.heading, "overlap", picked)]

        for item in self._units(segments):
            if isinstance(item, Segment):  # a heading: close the chunk at the section boundary if it is big enough
                if cur and count(text_of(cur)) >= cfg.min_tokens:
                    emit(cur)
                    cur = []
                unit = _Unit(item.text, count(item.text), item.page, item.text, "heading")
            else:
                unit = item
            if cur and count(text_of(cur + [unit])) > cfg.chunk_size:
                carry: list[_Unit] = []
                while cur and cur[-1].kind == "heading":  # a heading belongs with the content after it
                    carry.insert(0, cur.pop())
                emit(cur)
                ov = [] if carry else overlap_from(cur, unit.heading)
                cur = carry + ov
                if cur and count(text_of(cur + [unit])) > cfg.chunk_size:
                    # drop the overlap first; if the heading text still doesn't fit, the heading survives only
                    # as section metadata (unit.heading) rather than inline text.
                    cur = carry if count(text_of(carry + [unit])) <= cfg.chunk_size else []
            cur.append(unit)
        emit(cur)
        for i, c in enumerate(chunks):
            c.index = i
        return chunks
