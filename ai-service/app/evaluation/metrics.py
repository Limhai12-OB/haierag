"""Retrieval and answer metrics for RAG evaluation.

Retrieval metrics work on lists of retrieved ids vs. a set of relevant ids (chunk ids, or document ids when
judging at document level). Graded relevance for NDCG is supported via a {id: gain} mapping.
"""

from __future__ import annotations

import math
from typing import Hashable, Mapping, Sequence


def recall_at_k(retrieved: Sequence[Hashable], relevant: set, k: int) -> float:
    if not relevant:
        return 0.0
    return len(set(retrieved[:k]) & relevant) / len(relevant)


def precision_at_k(retrieved: Sequence[Hashable], relevant: set, k: int) -> float:
    if k <= 0:
        return 0.0
    top = retrieved[:k]
    return sum(1 for r in top if r in relevant) / k


def reciprocal_rank(retrieved: Sequence[Hashable], relevant: set) -> float:
    for i, r in enumerate(retrieved, start=1):
        if r in relevant:
            return 1.0 / i
    return 0.0


def mean_reciprocal_rank(runs: Sequence[tuple[Sequence[Hashable], set]]) -> float:
    return sum(reciprocal_rank(r, rel) for r, rel in runs) / len(runs) if runs else 0.0


def ndcg_at_k(retrieved: Sequence[Hashable], gains: Mapping[Hashable, float], k: int) -> float:
    def dcg(items: Sequence[float]) -> float:
        return sum(g / math.log2(i + 2) for i, g in enumerate(items))

    actual = dcg([gains.get(r, 0.0) for r in retrieved[:k]])
    ideal = dcg(sorted(gains.values(), reverse=True)[:k])
    return actual / ideal if ideal > 0 else 0.0


def citation_accuracy(cited_ids: Sequence[Hashable], relevant: set) -> float:
    """Share of cited sources that are actually relevant (citation precision)."""
    if not cited_ids:
        return 0.0
    return sum(1 for c in cited_ids if c in relevant) / len(cited_ids)


def answer_contains(answer: str, expected_phrases: Sequence[str]) -> float:
    """Cheap answer-correctness proxy: fraction of expected key phrases present (case-insensitive)."""
    if not expected_phrases:
        return 0.0
    a = answer.lower()
    return sum(1 for p in expected_phrases if p.lower() in a) / len(expected_phrases)
