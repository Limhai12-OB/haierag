"""Hybrid retrieval: vector (pgvector HNSW) + keyword (PostgreSQL FTS, and pg_trgm for Khmer) → RRF → rerank.

Authorization (ADR-004): every SQL statement filters by workspace_id, and optionally collection / document ids,
and only searches the current version of COMPLETED documents. The backend has already verified membership.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from dataclasses import dataclass, field

import numpy as np
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings
from app.core.errors import HaieRagError
from app.parsing.normalize import contains_khmer
from app.providers.base import EmbeddingProvider, RerankerProvider
from app.retrieval.fusion import reciprocal_rank_fusion

log = logging.getLogger(__name__)

_WORD = re.compile(r"(?:[^\W_]|[\u1780-\u17FF\u19E0-\u19FF])+", re.UNICODE)  # \w misses Khmer combining signs


@dataclass
class Scope:
    workspace_id: uuid.UUID
    collection_id: uuid.UUID | None = None
    document_ids: list[uuid.UUID] | None = None


@dataclass
class Passage:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_name: str
    chunk_index: int
    content: str
    page_start: int | None
    page_end: int | None
    section_heading: str | None
    vector_rank: int | None = None
    keyword_rank: int | None = None
    rrf_score: float = 0.0
    rerank_score: float | None = None
    vector_distance: float | None = None

    def to_api(self) -> dict:
        return {
            "chunkId": str(self.chunk_id),
            "documentId": str(self.document_id),
            "documentName": self.document_name,
            "chunkIndex": self.chunk_index,
            "content": self.content,
            "pageStart": self.page_start,
            "pageEnd": self.page_end,
            "sectionHeading": self.section_heading,
            "vectorRank": self.vector_rank,
            "keywordRank": self.keyword_rank,
            "rrfScore": round(self.rrf_score, 6),
            "rerankScore": None if self.rerank_score is None else round(self.rerank_score, 6),
        }


@dataclass
class RetrievalResult:
    passages: list[Passage]
    candidates: int
    timings_ms: dict[str, float] = field(default_factory=dict)
    channels: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    reranked: bool = False


_SELECT = """
    c.id AS chunk_id, c.document_id, d.name AS document_name, c.chunk_index, c.content,
    c.page_start, c.page_end, c.section_heading
"""


def _scope_sql(scope: Scope, params: dict) -> str:
    """Filters shared by all channels. `c` = document_chunks, `d` = documents."""
    params["ws"] = scope.workspace_id
    sql = " c.workspace_id = %(ws)s AND d.workspace_id = %(ws)s AND d.status = 'COMPLETED' AND c.version_id = d.current_version_id"
    if scope.collection_id is not None:
        params["col"] = scope.collection_id
        sql += " AND d.collection_id = %(col)s"
    if scope.document_ids is not None:
        params["docs"] = list(scope.document_ids)
        sql += " AND d.id = ANY(%(docs)s)"
    return sql


_STOPWORDS = frozenset(
    """a about above after again against all am an and any are as at be because been before being below between both
    but by can could did do does doing down during each few for from further had has have having he her here hers him
    his how i if in into is it its itself just me more most my no nor not of off on once only or other our ours out
    over own same she should so some such than that the their theirs them then there these they this those through to
    too under until up very was we were what when where which while who whom why will with would you your yours
    tell explain describe please give list show according document documents""".split()
)


def keyword_terms(query: str, limit: int = 32) -> list[str]:
    terms = []
    for w in _WORD.findall(query.lower()):
        if w in _STOPWORDS:
            continue
        if (len(w) > 1 or w.isdigit()) and w not in terms:
            terms.append(w)
    return terms[:limit]


class RetrievalService:
    def __init__(self, settings: Settings, pool: AsyncConnectionPool, embedder: EmbeddingProvider,
                 reranker: RerankerProvider | None):
        self.s = settings
        self.pool = pool
        self.embedder = embedder
        self.reranker = reranker if settings.reranker_enabled else None

    # ------------------------------------------------------------------ channels
    async def vector_search(self, qvec: np.ndarray, scope: Scope, limit: int) -> list[Passage]:
        params: dict = {"q": qvec, "limit": limit}
        where = _scope_sql(scope, params)
        async with self.pool.connection() as conn:
            async with conn.transaction():
                await conn.execute(f"SET LOCAL hnsw.ef_search = {int(self.s.hnsw_ef_search)}")
                # iterative scans keep filtered HNSW queries from returning too few rows (pgvector >= 0.8)
                await conn.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
                async with conn.cursor(row_factory=dict_row) as cur:
                    await cur.execute(
                        f"""SELECT {_SELECT}, e.embedding <=> %(q)s AS distance
                              FROM chunk_embeddings e
                              JOIN document_chunks c ON c.id = e.chunk_id
                              JOIN documents d ON d.id = c.document_id
                             WHERE e.workspace_id = %(ws)s AND {where}
                             ORDER BY e.embedding <=> %(q)s
                             LIMIT %(limit)s""",
                        params,
                    )
                    rows = await cur.fetchall()
        rows.sort(key=lambda r: r["distance"])  # relaxed_order may return slightly unordered rows
        out = []
        for rank, r in enumerate(rows, start=1):
            dist = r.pop("distance")
            out.append(Passage(**r, vector_rank=rank, vector_distance=float(dist)))
        return out

    async def fts_search(self, query: str, scope: Scope, limit: int) -> list[Passage]:
        terms = keyword_terms(query)
        if not terms:
            return []
        # OR semantics (questions rarely contain every term verbatim); ts_rank_cd rewards matching more/closer terms.
        tsquery = " | ".join(terms)
        params: dict = {"tsq": tsquery, "limit": limit}
        where = _scope_sql(scope, params)
        async with self.pool.connection() as conn:
            async with conn.cursor(row_factory=dict_row) as cur:
                await cur.execute(
                    f"""WITH q AS (SELECT to_tsquery('english', %(tsq)s) || to_tsquery('simple', %(tsq)s) AS tsq)
                        SELECT {_SELECT}, ts_rank_cd(c.tsv, q.tsq, 32) AS rank
                          FROM document_chunks c JOIN documents d ON d.id = c.document_id, q
                         WHERE c.tsv @@ q.tsq AND {where}
                         ORDER BY rank DESC, c.id
                         LIMIT %(limit)s""",
                    params,
                )
                rows = await cur.fetchall()
        return [Passage(**{k: v for k, v in r.items() if k != "rank"}, keyword_rank=i) for i, r in enumerate(rows, start=1)]

    async def trigram_search(self, query: str, scope: Scope, limit: int) -> list[Passage]:
        """Keyword channel for unspaced scripts (Khmer): character-trigram word similarity."""
        params: dict = {"q": query.strip(), "limit": limit}
        where = _scope_sql(scope, params)
        async with self.pool.connection() as conn:
            async with conn.transaction():
                await conn.execute(
                    f"SET LOCAL pg_trgm.word_similarity_threshold = {float(self.s.trigram_threshold)}"
                )
                async with conn.cursor(row_factory=dict_row) as cur:
                    await cur.execute(
                        f"""SELECT {_SELECT}, word_similarity(%(q)s, c.content) AS sim
                              FROM document_chunks c JOIN documents d ON d.id = c.document_id
                             WHERE %(q)s <%% c.content AND {where}
                             ORDER BY sim DESC, c.id
                             LIMIT %(limit)s""",
                        params,
                    )
                    rows = await cur.fetchall()
        return [Passage(**{k: v for k, v in r.items() if k != "sim"}, keyword_rank=i) for i, r in enumerate(rows, start=1)]

    # ------------------------------------------------------------------ pipeline
    async def retrieve(self, query: str, scope: Scope, top_k: int | None = None, rerank: bool = True) -> RetrievalResult:
        timings: dict[str, float] = {}
        warnings: list[str] = []
        k_candidates = self.s.retrieval_top_k
        final_k = top_k or self.s.rerank_top_k

        t = time.perf_counter()
        qvec = np.asarray((await self.embedder.embed([query]))[0], dtype=np.float32)
        timings["embed_query"] = round((time.perf_counter() - t) * 1000, 1)

        t = time.perf_counter()
        vector_hits = await self.vector_search(qvec, scope, k_candidates)
        timings["vector"] = round((time.perf_counter() - t) * 1000, 1)

        t = time.perf_counter()
        keyword_lists: list[list[Passage]] = []
        if keyword_terms(query):
            keyword_lists.append(await self.fts_search(query, scope, k_candidates))
        if contains_khmer(query):
            keyword_lists.append(await self.trigram_search(query, scope, k_candidates))
        timings["keyword"] = round((time.perf_counter() - t) * 1000, 1)

        by_id: dict[uuid.UUID, Passage] = {}
        for p in vector_hits:
            by_id[p.chunk_id] = p
        for lst in keyword_lists:
            for p in lst:
                existing = by_id.get(p.chunk_id)
                if existing is None:
                    by_id[p.chunk_id] = p
                elif p.keyword_rank is not None and (existing.keyword_rank is None or p.keyword_rank < existing.keyword_rank):
                    existing.keyword_rank = p.keyword_rank

        ranked = [[p.chunk_id for p in vector_hits]] + [[p.chunk_id for p in lst] for lst in keyword_lists]
        kw_w = self.s.rrf_keyword_weight / max(1, len(keyword_lists)) if keyword_lists else 0.0
        weights = [self.s.rrf_vector_weight] + [kw_w] * len(keyword_lists)
        fused = reciprocal_rank_fusion(ranked, weights, k=self.s.rrf_k)[:k_candidates]
        candidates = []
        for cid, score in fused:
            p = by_id[cid]
            p.rrf_score = score
            candidates.append(p)
        channels = {"vector": len(vector_hits), **{f"keyword_{i}": len(l) for i, l in enumerate(keyword_lists)}}

        reranked = False
        if rerank and self.reranker is not None and candidates:
            t = time.perf_counter()
            try:
                scores = await self.reranker.score(query, [self._rerank_text(p) for p in candidates])
                for p, sc in zip(candidates, scores):
                    p.rerank_score = float(sc)
                candidates.sort(key=lambda p: p.rerank_score, reverse=True)
                kept = [p for p in candidates if p.rerank_score >= self.s.rerank_min_score]
                reranked = True
                passages = kept[:final_k]
            except HaieRagError as exc:
                warnings.append(f"reranker unavailable, using fused ranking: {exc.message}")
                log.warning("reranker failed; falling back to RRF order", extra={"code": exc.code})
                passages = candidates[:final_k]
            timings["rerank"] = round((time.perf_counter() - t) * 1000, 1)
        else:
            passages = candidates[:final_k]

        return RetrievalResult(passages, len(candidates), timings, channels, warnings, reranked)

    @staticmethod
    def _rerank_text(p: Passage) -> str:
        return f"{p.section_heading}\n{p.content}" if p.section_heading and p.section_heading not in p.content[:200] else p.content
