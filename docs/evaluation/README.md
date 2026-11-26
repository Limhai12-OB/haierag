# RAG evaluation — English & Khmer (2026-11-25)

Runner: `ai-service/app/evaluation/runner.py`. Corpus and questions: `ai-service/app/evaluation/benchmark.py`.
Hardware: MacBook Pro M4, 16 GB. Models: qwen3:4b (Ollama 0.40.11), bge-m3, BAAI/bge-reranker-v2-m3 (MPS fp16).

**Corpus (7 documents):** English PDF handbook with a table (4 pages), Khmer HR policy, mixed Khmer-English IT
guide, two near-identical English support plans (Standard vs Premium), a CSV price list, a ~30-section maintenance
manual with facts deep inside. **Questions (24):** 12 English (facts, tables, long-document, near-duplicate
terminology), 5 Khmer, 4 mixed, 3 with no answer in the corpus (2 English, 1 Khmer).
Relevance = chunks of the expected document containing the expected phrase.

## Results

Raw reports: [default config, with generation](results-default-generation.md) ·
[200-token chunks, retrieval only](results-chunk200-retrieval.md) ·
[Khmer/mixed re-run](results-km-mixed-generation-v2.md) ·
[section-aware chunking + contextual rerank, retrieval only (2026-11-26)](results-structured-v2-retrieval.md):
same reranked scores (Hit@5 = MRR = 1.0), fused MRR 0.93 → 0.95, absent answers still 3/3 declined (ADR-019)

### Retrieval, K = 5 (answerable questions)
| | Hit@5 fused | Hit@5 reranked | MRR fused | MRR reranked |
|---|---|---|---|---|
| All, 800-token chunks (n=21) | 0.95 | 1.00 | 0.93 | 1.00 |
| All, 200-token chunks (n=21) | 1.00 | 1.00 | 0.97 | 1.00 |
| Khmer (n=5) | 1.00 | 1.00 | 1.00 | 1.00 |
| Mixed KM-EN (n=4), 800-token chunks | 0.75 | 1.00 | 0.75 | 1.00 |

* The reranker fixed every ranking miss of the fused list (table lookups, a mixed English question against a
  Khmer-dominant document).
* All 3 absent-answer questions had every candidate below `RERANK_MIN_SCORE`, so the system answered "not enough
  information" without calling the LLM.
* Latency: retrieval (embed + vector + FTS/trigram + RRF) median ~35–55 ms; with reranking of 20 candidates
  ~1.0–1.2 s on MPS.

### Generation (qwen3:4b)
| | Answer correct | Citation accuracy | Grounded |
|---|---|---|---|
| English (n=12) | 1.00 | 0.96 | 1.00 |
| Khmer (n=5) | 1.00 | 0.80 | 1.00 |
| Mixed (n=4) | 0.75 | 0.63 | 0.75 |
| Absent answers | 3/3 correctly declined | | |

Median time to first answer token ≈ 14 s, median end-to-end ≈ 14 s (single user, nothing else running).

## Limitations (honest reading)

1. **The benchmark is small and easy.** 7 short documents; each Khmer document is only a few chunks, so
   Hit@5 = 1.0 says the pipeline works, not that Khmer retrieval is solved. A realistic benchmark needs dozens of
   long Khmer documents with overlapping topics (e.g. several ministries' policies) and native-speaker-written
   questions with paraphrases. The runner supports extending `benchmark.py`.
2. **Khmer keyword search** relies on character trigrams (no Khmer word segmenter). It works for questions that
   reuse document wording; paraphrased questions depend on bge-m3 embeddings alone. A Khmer word segmenter
   (e.g. khmer-nltk) feeding the FTS index is the next improvement to evaluate.
3. **qwen3:4b is the thinking variant.** It always reasons (hidden), which
   * dominates latency (14 s median, up to ~65 s on some Khmer questions), and
   * on Khmer/mixed questions occasionally spends the whole output budget reasoning and returns no answer
     (`GENERATION_EMPTY`; 1 of 9 Khmer/mixed questions in each of two runs; raising the budget to 3072 only made
     answers slower). The user sees a clear error and can regenerate.
   A non-thinking Qwen3 4B instruct build would likely remove both issues; it is a model-choice decision and has
   not been evaluated here.
4. **Citation accuracy < 1** on Khmer/mixed is mostly the model citing two sources where one is the relevant
   chunk and the other is a neighbouring chunk from the same document; all citations are real retrieved chunks
   (invalid markers are removed before storage).
5. Answer correctness is measured by expected-phrase matching, not by an LLM judge or human rating.
