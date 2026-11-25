# RAG evaluation results — 2026-11-25

Settings: `{"llm": "qwen3:4b", "embedding": "bge-m3", "reranker": "BAAI/bge-reranker-v2-m3", "chunk_size": 200, "overlap": 40, "rrf_k": 60, "retrieval_top_k": 20}`  
K = 5; corpus ingestion took 0.9 s.

## Retrieval (answerable questions)

| Group | n | Hit@K fused | Hit@K reranked | MRR fused | MRR reranked | NDCG@K fused | NDCG@K reranked | Precision@K reranked |
|---|---|---|---|---|---|---|---|---|
| ALL | 21 | 1.0 | 1.0 | 0.968 | 1.0 | 0.976 | 1.0 | 0.2 |
| cat=fact | 13 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 |
| cat=long | 2 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 |
| cat=similar | 3 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 |
| cat=table | 3 | 1.0 | 1.0 | 0.778 | 1.0 | 0.833 | 1.0 | 0.2 |
| lang=en | 12 | 1.0 | 1.0 | 0.944 | 1.0 | 0.958 | 1.0 | 0.2 |
| lang=km | 5 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 |
| lang=mixed | 4 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 |

## Absent-answer questions (retrieval)

| id | lang | passages after rerank threshold | top rerank score |
|---|---|---|---|
| ab1 | en | 0 | None |
| ab2 | en | 0 | None |
| ab3 | km | 0 | None |

## Latency

* Retrieval (embed + vector + keyword + RRF): median 32 ms
* Retrieval + rerank: median 881 ms (first call includes reranker load)

## Per-question detail

| id | lang | cat | top doc (reranked) | RR fused | RR reranked | answer ok | answer (truncated) |
|---|---|---|---|---|---|---|---|
| en1 | en | fact | en_handbook.pdf | 1.0 | 1.0 | None |  |
| en2 | en | fact | en_handbook.pdf | 1.0 | 1.0 | None |  |
| en3 | en | fact | en_handbook.pdf | 1.0 | 1.0 | None |  |
| en4 | en | fact | en_handbook.pdf | 1.0 | 1.0 | None |  |
| tb1 | en | table | en_handbook.pdf | 1.0 | 1.0 | None |  |
| tb2 | en | table | price_list.csv | 1.0 | 1.0 | None |  |
| tb3 | en | table | price_list.csv | 0.3333333333333333 | 1.0 | None |  |
| lg1 | en | long | agv_manual.md | 1.0 | 1.0 | None |  |
| lg2 | en | long | agv_manual.md | 1.0 | 1.0 | None |  |
| sm1 | en | similar | support_premium.txt | 1.0 | 1.0 | None |  |
| sm2 | en | similar | support_standard.txt | 1.0 | 1.0 | None |  |
| sm3 | en | similar | support_standard.txt | 1.0 | 1.0 | None |  |
| km1 | km | fact | km_hr_policy.md | 1.0 | 1.0 | None |  |
| km2 | km | fact | km_hr_policy.md | 1.0 | 1.0 | None |  |
| km3 | km | fact | km_hr_policy.md | 1.0 | 1.0 | None |  |
| km4 | km | fact | km_hr_policy.md | 1.0 | 1.0 | None |  |
| km5 | km | fact | km_hr_policy.md | 1.0 | 1.0 | None |  |
| mx1 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | None |  |
| mx2 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | None |  |
| mx3 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | None |  |
| mx4 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | None |  |
| ab1 | en | absent | None | – | – | None |  |
| ab2 | en | absent | None | – | – | None |  |
| ab3 | km | absent | None | – | – | None |  |
