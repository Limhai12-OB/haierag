"""Reciprocal Rank Fusion (ADR-005): score(d) = Σ_i w_i / (k + rank_i(d)), ranks are 1-based.

Only ranks are combined — raw scores from different systems (cosine distance, ts_rank, trigram similarity)
are not comparable and are never added.
"""

from __future__ import annotations

from typing import Hashable, Sequence


def reciprocal_rank_fusion(
    ranked_lists: Sequence[Sequence[Hashable]],
    weights: Sequence[float] | None = None,
    k: int = 60,
) -> list[tuple[Hashable, float]]:
    if k <= 0:
        raise ValueError("k must be positive")
    weights = list(weights) if weights is not None else [1.0] * len(ranked_lists)
    if len(weights) != len(ranked_lists):
        raise ValueError("weights and ranked_lists must have the same length")
    scores: dict[Hashable, float] = {}
    first_seen: dict[Hashable, int] = {}
    order = 0
    for items, w in zip(ranked_lists, weights):
        seen: set[Hashable] = set()
        for rank, item in enumerate(items, start=1):
            if item in seen:  # duplicates within one list count once, at their best rank
                continue
            seen.add(item)
            scores[item] = scores.get(item, 0.0) + w / (k + rank)
            if item not in first_seen:
                first_seen[item] = order
                order += 1
    # deterministic: score desc, then first appearance
    return sorted(scores.items(), key=lambda kv: (-kv[1], first_seen[kv[0]]))
