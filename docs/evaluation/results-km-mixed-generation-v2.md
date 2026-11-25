# RAG evaluation results — 2026-11-25

Settings: `{"llm": "qwen3:4b", "embedding": "bge-m3", "reranker": "BAAI/bge-reranker-v2-m3", "chunk_size": 800, "overlap": 120, "rrf_k": 60, "retrieval_top_k": 20}`  
K = 5; corpus ingestion took 0.6 s.

## Retrieval (answerable questions)

| Group | n | Hit@K fused | Hit@K reranked | MRR fused | MRR reranked | NDCG@K fused | NDCG@K reranked | Precision@K reranked |
|---|---|---|---|---|---|---|---|---|
| ALL | 9 | 0.889 | 1.0 | 0.889 | 1.0 | 0.889 | 1.0 | 0.2 |
| cat=fact | 9 | 0.889 | 1.0 | 0.889 | 1.0 | 0.889 | 1.0 | 0.2 |
| lang=km | 5 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 |
| lang=mixed | 4 | 0.75 | 1.0 | 0.75 | 1.0 | 0.75 | 1.0 | 0.2 |

## Absent-answer questions (retrieval)

| id | lang | passages after rerank threshold | top rerank score |
|---|---|---|---|
| ab3 | km | 0 | None |

## Latency

* Retrieval (embed + vector + keyword + RRF): median 85 ms
* Retrieval + rerank: median 1284 ms (first call includes reranker load)

## Generation

| Group | n | Answer correct | Citation accuracy | Grounded |
|---|---|---|---|---|
| ALL | 9 | 0.889 | 0.722 | 0.889 |
| cat=fact | 9 | 0.889 | 0.722 | 0.889 |
| lang=km | 5 | 1.0 | 0.8 | 1.0 |
| lang=mixed | 4 | 0.75 | 0.625 | 0.75 |

* Correct refusals on absent questions: 1/1
* End-to-end answer time: median 28.7 s
* Generation time to first answer token (incl. hidden reasoning): median 25.9 s

## Per-question detail

| id | lang | cat | top doc (reranked) | RR fused | RR reranked | answer ok | answer (truncated) |
|---|---|---|---|---|---|---|---|
| km1 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | បុគ្គលិកពេញម៉ោងទទួលបានការឈប់សម្រាកប្រចាំឆ្នាំចំនួន ២១ ថ្ងៃ [1][2] |
| km2 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | ១០ ថ្ងៃ [1][2] |
| km3 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | ម៉ោងធ្វើការធម្មតាចាប់ផ្តើមនៅម៉ោង ៨ ព្រឹក [1] |
| km4 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | ប្រាក់រង្វាន់ប្រចាំឆ្នាំត្រូវបានបើកនៅខែធ្នូ [1]. |
| km5 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | ពាក្យសម្ងាត់ត្រូវផ្លាស់ប្តូររៀងរាល់ ៩០ ថ្ងៃម្តង [1]. |
| mx1 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | 1.0 | ត្រូវប្រើកម្មវិធី WireGuard សម្រាប់ VPN [1][2] |
| mx2 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | 0.0 |  |
| mx3 | mixed | fact | mixed_it_guide.md | 0.0 | 1.0 | 1.0 | The authenticator app used for MFA is Microsoft Authenticator [1]. |
| mx4 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | 1.0 | The printer at position 3 is named PRN-3F-01 [1]. |
| ab3 | km | absent | None | – | – | True | ឯកសារដែលមានមិនមានព័ត៌មានគ្រប់គ្រាន់ដើម្បីឆ្លើយសំណួរនេះទេ។ សូមសាកល្បងសួរម្ដងទៀតដោយប្រើពាក្យផ្សេង ពង្រីកវិសាលភាពនៃការសន្ទនា ឬផ្ទុកឯកសារដែលពាក់ |
