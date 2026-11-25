"""Citation extraction and validation (ADR-008).

The model cites passages as [n]. Markers are validated against the passages actually supplied; anything else is
removed from the stored answer. Citation metadata always comes from database rows, never from model output.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.retrieval.service import Passage

# [1]  [1, 2]  [1,2,3]  [Source 1]  [source 2, 3]
_MARKER = re.compile(r"\[(?:sources?\s*)?(\d{1,3}(?:\s*,\s*\d{1,3})*)\]", re.IGNORECASE)


@dataclass
class CitationResult:
    answer: str
    citations: list[dict]
    invalid_markers: list[int]


def excerpt(text: str, limit: int = 400) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    space = cut.rfind(" ")
    return (cut[:space] if space > limit * 0.6 else cut) + "…"


def map_citations(answer: str, passages: list[Passage]) -> CitationResult:
    valid = set(range(1, len(passages) + 1))
    used: list[int] = []
    invalid: list[int] = []

    def repl(m: re.Match) -> str:
        nums = [int(x) for x in re.split(r"\s*,\s*", m.group(1))]
        good = []
        for n in nums:
            if n in valid:
                good.append(n)
                if n not in used:
                    used.append(n)
            elif n not in invalid:
                invalid.append(n)
        return "".join(f"[{n}]" for n in good)

    cleaned = _MARKER.sub(repl, answer)
    cleaned = re.sub(r"[ \t]+([.,;:])", r"\1", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()

    citations = []
    for n in sorted(used):
        p = passages[n - 1]
        citations.append({
            "marker": n,
            "chunkId": str(p.chunk_id),
            "documentId": str(p.document_id),
            "documentName": p.document_name,
            "pageNumber": p.page_start,
            "sectionHeading": p.section_heading,
            "excerpt": excerpt(p.content),
            "retrievalScore": round(p.rrf_score, 6),
            "rerankScore": None if p.rerank_score is None else round(p.rerank_score, 6),
        })
    return CitationResult(cleaned, citations, invalid)
