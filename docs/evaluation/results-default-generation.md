# RAG evaluation results — 2026-11-25

Settings: `{"llm": "qwen3:4b", "embedding": "bge-m3", "reranker": "BAAI/bge-reranker-v2-m3", "chunk_size": 800, "overlap": 120, "rrf_k": 60, "retrieval_top_k": 20}`  
K = 5; corpus ingestion took 0.3 s.

## Retrieval (answerable questions)

| Group | n | Hit@K fused | Hit@K reranked | MRR fused | MRR reranked | NDCG@K fused | NDCG@K reranked | Precision@K reranked |
|---|---|---|---|---|---|---|---|---|
| ALL | 21 | 0.952 | 1.0 | 0.929 | 1.0 | 0.935 | 1.0 | 0.2 |
| cat=fact | 13 | 0.923 | 1.0 | 0.923 | 1.0 | 0.923 | 1.0 | 0.2 |
| cat=long | 2 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 |
| cat=similar | 3 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 |
| cat=table | 3 | 1.0 | 1.0 | 0.833 | 1.0 | 0.877 | 1.0 | 0.2 |
| lang=en | 12 | 1.0 | 1.0 | 0.958 | 1.0 | 0.969 | 1.0 | 0.2 |
| lang=km | 5 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.2 |
| lang=mixed | 4 | 0.75 | 1.0 | 0.75 | 1.0 | 0.75 | 1.0 | 0.2 |

## Absent-answer questions (retrieval)

| id | lang | passages after rerank threshold | top rerank score |
|---|---|---|---|
| ab1 | en | 0 | None |
| ab2 | en | 0 | None |
| ab3 | km | 0 | None |

## Latency

* Retrieval (embed + vector + keyword + RRF): median 54 ms
* Retrieval + rerank: median 1235 ms (first call includes reranker load)

## Generation

| Group | n | Answer correct | Citation accuracy | Grounded |
|---|---|---|---|---|
| ALL | 21 | 0.952 | 0.857 | 0.952 |
| cat=fact | 13 | 0.923 | 0.769 | 0.923 |
| cat=long | 2 | 1.0 | 1.0 | 1.0 |
| cat=similar | 3 | 1.0 | 1.0 | 1.0 |
| cat=table | 3 | 1.0 | 1.0 | 1.0 |
| lang=en | 12 | 1.0 | 0.958 | 1.0 |
| lang=km | 5 | 1.0 | 0.8 | 1.0 |
| lang=mixed | 4 | 0.75 | 0.625 | 0.75 |

* Correct refusals on absent questions: 3/3
* End-to-end answer time: median 14.4 s
* Generation time to first answer token (incl. hidden reasoning): median 13.7 s

## Per-question detail

| id | lang | cat | top doc (reranked) | RR fused | RR reranked | answer ok | answer (truncated) |
|---|---|---|---|---|---|---|---|
| en1 | en | fact | en_handbook.pdf | 1.0 | 1.0 | 1.0 | Full-time employees receive 21 days of paid annual leave per calendar year [1][2]. |
| en2 | en | fact | en_handbook.pdf | 1.0 | 1.0 | 1.0 | The required VPN client for remote access is WireGuard. This is specified in the Information Security section of the company handbook, which |
| en3 | en | fact | en_handbook.pdf | 1.0 | 1.0 | 1.0 | Parental leave for the primary caregiver is 90 calendar days [1]. |
| en4 | en | fact | en_handbook.pdf | 1.0 | 1.0 | 1.0 | Expense receipts must be submitted within 30 days of returning from a trip [1]. |
| tb1 | en | table | en_handbook.pdf | 1.0 | 1.0 | 1.0 | The hotel limit per night in Singapore is 260 USD [1]. |
| tb2 | en | table | price_list.csv | 1.0 | 1.0 | 1.0 | The unit price of the Lidar Sensor 10 is 1450 USD [1]. |
| tb3 | en | table | price_list.csv | 0.5 | 1.0 | 1.0 | The product with a 36-month warranty is the Motion Controller 500 (product code NR-CTL-500) [1]. |
| lg1 | en | long | agv_manual.md | 1.0 | 1.0 | 1.0 | The AGV drive motor must be replaced after 12,000 operating hours [1]. |
| lg2 | en | long | agv_manual.md | 1.0 | 1.0 | 1.0 | AGV batteries should be stored at 40 to 60 percent charge [1]. |
| sm1 | en | similar | support_premium.txt | 1.0 | 1.0 | 1.0 | The first response time for critical incidents on the Premium Support Plan is within 1 hour, available at any time of day [1]. |
| sm2 | en | similar | support_standard.txt | 1.0 | 1.0 | 1.0 | The first response time for critical incidents on the Standard Support Plan is within 8 business hours [1]. |
| sm3 | en | similar | support_standard.txt | 1.0 | 1.0 | 1.0 | The Standard Support Plan commits to 99.5% uptime per month [1]. |
| km1 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | បុគ្គលិកពេញម៉ោងទទួលបានការឈប់សម្រាកប្រចាំឆ្នាំចំនួន ២១ ថ្ងៃ [1][2] |
| km2 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | ការឈប់សម្រាកឈឺអាចមានបានដល់ ១០ ថ្ងៃក្នុងមួយឆ្នាំ [1][2] |
| km3 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | ម៉ោងធ្វើការធម្មតាចាប់ផ្តើមនៅម៉ោង ៨ ព្រឹក [1] |
| km4 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | ខែធ្នូ [1] |
| km5 | km | fact | km_hr_policy.md | 1.0 | 1.0 | 1.0 | ពាក្យសម្ងាត់ត្រូវផ្លាស់ប្តូររៀងរាល់ ៩០ ថ្ងៃ [1] |
| mx1 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | 1.0 | ត្រូវប្រើកម្មវិធី WireGuard សម្រាប់ VPN [1][2] |
| mx2 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | 1.0 | Laptop ស្តង់ដារគឺ MacBook Air M3 [1] |
| mx3 | mixed | fact | mixed_it_guide.md | 0.0 | 1.0 | 1.0 | The authenticator app used for MFA is Microsoft Authenticator [1]. |
| mx4 | mixed | fact | mixed_it_guide.md | 1.0 | 1.0 | 0.0 |  |
| ab1 | en | absent | None | – | – | True | The available documents do not contain enough information to answer this question. Try rephrasing the question, widening the chat scope, or  |
| ab2 | en | absent | None | – | – | True | The available documents do not contain enough information to answer this question. Try rephrasing the question, widening the chat scope, or  |
| ab3 | km | absent | None | – | – | True | ឯកសារដែលមានមិនមានព័ត៌មានគ្រប់គ្រាន់ដើម្បីឆ្លើយសំណួរនេះទេ។ សូមសាកល្បងសួរម្ដងទៀតដោយប្រើពាក្យផ្សេង ពង្រីកវិសាលភាពនៃការសន្ទនា ឬផ្ទុកឯកសារដែលពាក់ |
