"""RAG evaluation runner.

Ingests the benchmark corpus into a fresh workspace of the configured database, then measures for each question:
retrieval quality (Recall@K, Precision@K, MRR, NDCG@K) with fusion only and with reranking, latency, and —
optionally — generation: answer correctness (expected phrase present), citation accuracy (cited chunks are
relevant), grounding rate, and correct refusals for absent answers.

Usage (from ai-service/, infrastructure + Ollama running):
    POSTGRES_DB=haierag_test python -m app.evaluation.runner --generate --out ../docs/evaluation/results.md
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time
import uuid
from collections import defaultdict
from datetime import date

from app.container import Container
from app.core.config import get_settings
from app.evaluation import metrics as M
from app.evaluation.benchmark import DOCS, QUESTIONS, BenchQuestion
from app.retrieval.service import Scope

K = 5
REFUSAL_MARKERS = ("not contain", "no information", "not provide", "not mention", "does not specify",
                   "not available", "មិនមានព័ត៌មាន", "មិនមាន")


async def _setup(c: Container) -> tuple[uuid.UUID, dict[str, uuid.UUID]]:
    from tests.fixtures import samples  # sample builders shared with the tests

    uid, wid = uuid.uuid4(), uuid.uuid4()
    async with c.pool.connection() as conn:
        await conn.execute("INSERT INTO users (id, email, password_hash, display_name) VALUES (%s,%s,'x','Eval')",
                           (uid, f"eval-{uid}@local"))
        await conn.execute("INSERT INTO workspaces (id, name, created_by) VALUES (%s,'RAG evaluation',%s)", (wid, uid))
        await conn.commit()
    doc_ids: dict[str, uuid.UUID] = {}
    for d in DOCS:
        data = samples.make_handbook_pdf() if d.builder == "handbook_pdf" else d.text.encode()
        doc_id, ver_id, job_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        key = f"eval/{wid}/{doc_id}/{d.name}"
        await c.storage.put_bytes(key, data, "application/octet-stream")
        async with c.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO documents (id, workspace_id, name, original_filename, content_type, file_type, size_bytes,
                   sha256, status) VALUES (%s,%s,%s,%s,'application/octet-stream',%s,%s,'eval','QUEUED')""",
                (doc_id, wid, d.name, d.name, d.file_type, len(data)))
            await conn.execute(
                """INSERT INTO document_versions (id, document_id, version_number, storage_key, sha256, size_bytes, content_type)
                   VALUES (%s,%s,1,%s,'eval',%s,'application/octet-stream')""", (ver_id, doc_id, key, len(data)))
            await conn.execute("UPDATE documents SET current_version_id=%s WHERE id=%s", (ver_id, doc_id))
            await conn.execute("INSERT INTO document_processing_jobs (id, document_id, version_id) VALUES (%s,%s,%s)",
                               (job_id, doc_id, ver_id))
            await conn.commit()
        outcome = await c.pipeline.process(str(job_id))
        if outcome.status != "COMPLETED":
            raise RuntimeError(f"ingestion of {d.name} failed: {outcome.detail}")
        doc_ids[d.name] = doc_id
    return wid, doc_ids


async def _relevant_chunks(c: Container, q: BenchQuestion, doc_ids: dict[str, uuid.UUID]) -> set[uuid.UUID]:
    if q.doc is None:
        return set()
    async with c.pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT id FROM document_chunks WHERE document_id=%s AND content ILIKE %s",
            (doc_ids[q.doc], f"%{q.phrase}%"))).fetchall()
    rel = {r[0] for r in rows}
    if not rel:
        raise RuntimeError(f"benchmark error: phrase {q.phrase!r} not found in any chunk of {q.doc}")
    return rel


def _avg(xs):
    return round(statistics.fmean(xs), 3) if xs else None


async def run(generate: bool, only: set[str] | None = None) -> dict:
    settings = get_settings()
    c = Container.build(settings)
    await c.start(run_worker=False)
    await c.pool.wait()
    try:
        t = time.perf_counter()
        wid, doc_ids = await _setup(c)
        ingest_s = round(time.perf_counter() - t, 1)
        scope = Scope(wid)
        rows = []
        for q in [q for q in QUESTIONS if not only or q.lang in only or q.id in only]:
            relevant = await _relevant_chunks(c, q, doc_ids)
            row = {"id": q.id, "lang": q.lang, "category": q.category, "question": q.question}
            for mode, rerank in (("fused", False), ("reranked", True)):
                t = time.perf_counter()
                res = await c.retrieval.retrieve(q.question, scope, top_k=K, rerank=rerank)
                ms = (time.perf_counter() - t) * 1000
                ids = [p.chunk_id for p in res.passages]
                row[mode] = {
                    "latency_ms": round(ms, 1),
                    "n": len(ids),
                    "top_doc": res.passages[0].document_name if res.passages else None,
                    "top_score": (res.passages[0].rerank_score if rerank else res.passages[0].rrf_score) if res.passages else None,
                }
                if relevant:
                    row[mode].update({
                        "recall": M.recall_at_k(ids, relevant, K),
                        "hit": float(bool(set(ids[:K]) & relevant)),
                        "precision": M.precision_at_k(ids, relevant, K),
                        "rr": M.reciprocal_rank(ids, relevant),
                        "ndcg": M.ndcg_at_k(ids, {r: 1.0 for r in relevant}, K),
                    })
            if generate:
                events = {}
                answer_tokens = []
                t = time.perf_counter()
                async for ev, data in c.chat.stream_answer(q.question, scope, []):
                    if ev == "token":
                        answer_tokens.append(data["text"])
                    else:
                        events[ev] = data
                total_ms = (time.perf_counter() - t) * 1000
                done = events.get("done", {})
                answer = done.get("answer") or "".join(answer_tokens)
                cited = [uuid.UUID(x["chunkId"]) for x in events.get("citations", {}).get("citations", [])]
                gen = {"answer": answer[:400], "e2e_ms": round(total_ms), "grounded": done.get("grounded"),
                       "error": events.get("error"), "timings": done.get("timingsMs")}
                if q.category == "absent":
                    gen["correct_refusal"] = any(m in answer.lower() for m in REFUSAL_MARKERS) or not done.get("grounded")
                else:
                    gen["answer_correct"] = M.answer_contains(answer, [q.phrase])
                    cited_docs = {cid for cid in cited}
                    async with c.pool.connection() as conn:
                        doc_of = dict(await (await conn.execute(
                            "SELECT id, document_id FROM document_chunks WHERE id = ANY(%s)", (list(cited_docs),))).fetchall()) if cited else {}
                    gen["citation_accuracy"] = M.citation_accuracy(
                        [doc_of.get(x) for x in cited], {doc_ids[q.doc]}) if cited else 0.0
                row["generation"] = gen
            rows.append(row)
            print(json.dumps({k: row[k] for k in ("id", "fused", "reranked")}, ensure_ascii=False, default=str))
        return {"ingest_seconds": ingest_s, "rows": rows, "k": K, "settings": {
            "llm": settings.llm_model, "embedding": settings.embedding_model, "reranker": settings.reranker_model,
            "chunk_size": settings.chunk_size, "overlap": settings.chunk_overlap, "rrf_k": settings.rrf_k,
            "retrieval_top_k": settings.retrieval_top_k}}
    finally:
        await c.close()


def summarize(result: dict) -> str:
    rows = result["rows"]
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        if r["category"] != "absent":
            groups[f"lang={r['lang']}"].append(r)
            groups[f"cat={r['category']}"].append(r)
            groups["ALL"].append(r)
    out = [f"# RAG evaluation results — {date.today().isoformat()}", "",
           f"Settings: `{json.dumps(result['settings'])}`  ", f"K = {result['k']}; corpus ingestion took {result['ingest_seconds']} s.", "",
           "## Retrieval (answerable questions)", "",
           "| Group | n | Hit@K fused | Hit@K reranked | MRR fused | MRR reranked | NDCG@K fused | NDCG@K reranked | Precision@K reranked |",
           "|---|---|---|---|---|---|---|---|---|"]
    for g in ["ALL"] + sorted(k for k in groups if k != "ALL"):
        rs = groups[g]
        out.append(f"| {g} | {len(rs)} | {_avg([r['fused']['hit'] for r in rs])} | {_avg([r['reranked']['hit'] for r in rs])} | "
                   f"{_avg([r['fused']['rr'] for r in rs])} | {_avg([r['reranked']['rr'] for r in rs])} | "
                   f"{_avg([r['fused']['ndcg'] for r in rs])} | {_avg([r['reranked']['ndcg'] for r in rs])} | "
                   f"{_avg([r['reranked']['precision'] for r in rs])} |")
    absent = [r for r in rows if r["category"] == "absent"]
    out += ["", "## Absent-answer questions (retrieval)", "",
            "| id | lang | passages after rerank threshold | top rerank score |", "|---|---|---|---|"]
    for r in absent:
        ts = r["reranked"]["top_score"]
        out.append(f"| {r['id']} | {r['lang']} | {r['reranked']['n']} | {None if ts is None else round(ts, 3)} |")
    lat_f = [r["fused"]["latency_ms"] for r in rows]
    lat_r = [r["reranked"]["latency_ms"] for r in rows]
    out += ["", "## Latency", "", f"* Retrieval (embed + vector + keyword + RRF): median {statistics.median(lat_f):.0f} ms",
            f"* Retrieval + rerank: median {statistics.median(lat_r):.0f} ms (first call includes reranker load)"]
    if rows and "generation" in rows[0]:
        ans = [r for r in rows if r["category"] != "absent"]
        out += ["", "## Generation", "",
                "| Group | n | Answer correct | Citation accuracy | Grounded |", "|---|---|---|---|---|"]
        for g in ["ALL"] + sorted(k for k in groups if k != "ALL"):
            rs = groups[g]
            out.append(f"| {g} | {len(rs)} | {_avg([r['generation']['answer_correct'] for r in rs])} | "
                       f"{_avg([r['generation']['citation_accuracy'] for r in rs])} | "
                       f"{_avg([1.0 if r['generation']['grounded'] else 0.0 for r in rs])} |")
        out += ["", f"* Correct refusals on absent questions: {sum(1 for r in absent if r['generation']['correct_refusal'])}/{len(absent)}",
                f"* End-to-end answer time: median {statistics.median([r['generation']['e2e_ms'] for r in rows]) / 1000:.1f} s"]
        firsts = [r["generation"]["timings"].get("first_token") for r in rows if r["generation"].get("timings")]
        firsts = [f for f in firsts if f]
        if firsts:
            out.append(f"* Generation time to first answer token (incl. hidden reasoning): median {statistics.median(firsts) / 1000:.1f} s")
    out += ["", "## Per-question detail", "", "| id | lang | cat | top doc (reranked) | RR fused | RR reranked | answer ok | answer (truncated) |",
            "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        g = r.get("generation", {})
        ok = g.get("answer_correct", g.get("correct_refusal"))
        ans = (g.get("answer") or "").replace("\n", " ").replace("|", "\\|")[:140]
        out.append(f"| {r['id']} | {r['lang']} | {r['category']} | {r['reranked']['top_doc']} | {r['fused'].get('rr', '–')} | "
                   f"{r['reranked'].get('rr', '–')} | {ok} | {ans} |")
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--generate", action="store_true", help="also evaluate answer generation (slow)")
    ap.add_argument("--out", default=None, help="write a markdown report here")
    ap.add_argument("--json", default=None, help="write raw results JSON here")
    ap.add_argument("--only", default=None, help="comma-separated question ids or langs (en,km,mixed)")
    args = ap.parse_args()
    result = asyncio.run(run(args.generate, set(args.only.split(",")) if args.only else None))
    report = summarize(result)
    print(report)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(report)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2, default=str)


if __name__ == "__main__":
    main()
