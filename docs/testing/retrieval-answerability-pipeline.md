# Retrieval Answerability Pipeline 평가와 도입 결정

> 상태: 실험 완료, 제한적 도입 결정
> 최종 갱신: 2026-08-12
> 대상: PDF/TXT 기반 RAG의 검색 적합성·근거 충분성 판정

## 1. 목적

사용자가 첨부한 PDF/TXT를 청킹해 검색할 때 다음 두 문제를 분리해서 해결한다.

1. 질문과 관련된 문서를 검색할 수 있는가?
2. 검색된 문서만으로 질문에 실제로 답할 수 있는가?

두 번째 문제를 해결하지 못하면 질문과 주제가 유사하지만 답은 없는 문서를 근거로 답변하는
오류가 발생한다. 이 문서는 초기 클러스터 기반 가설부터 Local verifier와 LLM fallback을 포함한
최종 도입 결정까지 기록한다.

## 2. 최초 가설

최초 제안은 다음과 같았다.

1. PDF/TXT를 chunk와 overlap으로 분할한다.
2. chunk embedding을 벡터스토어에 저장한다.
3. LLM 또는 품질 지표로 K를 정하고 K-means clustering을 수행한다.
4. cluster ID와 중심 벡터 정보를 chunk metadata에 저장한다.
5. 질문의 cosine similarity Top-3 평균이 `0.7` 미만이면 답변을 거부한다.
6. `0.7` 이상이면 질문과 검색 chunk가 속한 cluster 중심의 유사도로 예상 답변 품질을 판정한다.

핵심 가설은 질문이 검색 문서 및 cluster 중심과 모두 유사할수록 답변 근거가 충분하다는 것이었다.

## 3. 평가 데이터와 분리 기준

합성 fixture로 구현을 먼저 검증한 뒤 Hugging Face `klue/klue` MRC 표본으로 확대했다.

- 전체 파생 표본: 650건
- train: 300건
- threshold validation: 150건
- frozen test: 200건
- 각 split의 answerable/unanswerable 비율: 50:50
- context hash 기준 split 간 문서 중복 제거
- 문서 650개를 600자 chunk, 150자 overlap으로 분할
- embedding: OpenAI `text-embedding-3-small`, 1,536차원

Frozen test는 모델 학습과 threshold 선택에 사용하지 않았다. KLUE의 `is_impossible`은 원래 짝지어진
context에 답이 없음을 의미하며 전체 corpus 어디에도 우연히 답이 없음을 보장하지는 않는다는 한계가 있다.

## 4. 초기 가설 평가 결과

검색 성능은 다음과 같았다.

- Dense Recall@3: `0.72`
- MRR: `0.642`

답변 가능성 분류 결과는 낮았다.

| 방법 | F1 | FAR | Recall |
|---|---:|---:|---:|
| Top-1 cosine | 0.100 | 0.14 | 0.06 |
| Top-3 cosine 평균 | 0.102 | 0.12 | 0.06 |
| Semantic + BM25 | 0.256 | 0.16 | 0.17 |
| Semantic + cluster | 0.020 | 0.01 | 0.01 |
| Calibrated feature gate | 0.168 | 0.09 | 0.10 |

선택된 K는 2였고 cosine silhouette는 `0.079`였다. Answerable과 unanswerable의 similarity 분포가
거의 겹쳤으며 개별 feature AUC도 약 `0.47~0.57`이었다.

### 초기 가설에 대한 결론

- Cosine similarity는 질문과 문서의 주제 관련성을 측정할 수 있다.
- Cluster 중심 거리는 corpus의 주제 구조를 나타낼 수 있다.
- 두 값 모두 문서 안에 질문의 답이 실제로 존재하는지는 안정적으로 판별하지 못한다.
- 따라서 cluster 중심 유사도를 answerability 또는 예상 답변 품질 gate로 사용하지 않는다.
- Cluster는 corpus 분석, 검색 결과 다양화와 비정상 분포 탐지 용도로만 제한한다.

## 5. Local verifier 개선 실험

검색 후 `question + candidate chunk`를 동시에 읽는 cross-encoder를 도입했다.

### 학습 구성

- 기반 모델: `klue/roberta-small`
- KLUE-MRC 원본 train: 17,554건
- Positive: 정답 문자열이 포함된 chunk
- Negative: 동일 문서의 답 없는 chunk 및 `is_impossible` 관련 context
- 최종 균형 pair: positive 11,765 + negative 11,765
- 총 23,530 pair
- 학습: 2 epoch, max length 384
- GPU: NVIDIA GeForce RTX 5060 Ti

### 결과

| 모델 | F1 | FAR | Recall |
|---|---:|---:|---:|
| 기존 Semantic + BM25 | 0.256 | 0.16 | 0.17 |
| KLUE QA reader | 0.333 | 0.10 | 0.22 |
| 균형 학습 cross-encoder | 0.374 | 0.13 | 0.26 |

Local verifier는 기존 feature gate보다 개선됐지만 단독 운영 기준에는 미달했다. F1 최적 threshold에서는
F1 `0.650`, Recall `0.80`까지 상승했지만 FAR도 `0.66`으로 상승했다.

## 6. Hybrid retrieval과 selective policy

Dense embedding과 BM25의 순위를 reciprocal rank fusion으로 결합했다. Local verifier는 모든 문항을
강제로 이진 분류하지 않고 validation에서 선택한 두 threshold로 세 구간을 만든다.

```text
score >= accept threshold  → Local accept 후보
score <= reject threshold  → Local reject 후보
그 사이                    → LLM evidence verifier
```

Accept와 reject threshold는 validation 150건에서 FAR/FRR의 90% Wilson upper bound가 각각 `0.10`
이하가 되도록 선택했다.

### Top-K 비교

| 구성 | Retrieval | Local coverage | LLM fallback | FAR | FRR | Accept precision |
|---|---:|---:|---:|---:|---:|---:|
| Hybrid Top-3 + cross-encoder | Recall@3 0.82 | 0.195 | 0.805 | 0.04 | 0.07 | 0.733 |
| Hybrid Top-5 + cross-encoder | Recall@5 0.87 | 0.170 | 0.830 | 0.04 | 0.03 | 0.750 |
| Hybrid Top-10 + cross-encoder | Recall@10 0.91 | 0.165 | 0.835 | 0.03 | 0.04 | 0.800 |

Top-5는 retrieval recall, verifier latency와 후보 문맥량의 균형점이다. RTX 5060 Ti 기준 Local verifier
추론 시간은 약 `11.9ms/query`였다. 그러나 자동 허용 precision `0.75`는 최종 답변 허용 기준으로
부족하다.

## 7. Local ensemble 평가

Cross-encoder와 KLUE-MRC QA reader가 모두 accept 또는 reject에 동의할 때만 로컬에서 처리했다.

- Retrieval Recall@5: `0.87`
- Local coverage: `0.03`
- LLM fallback: `0.97`
- Local accept precision: `1.0`
- FAR: `0`
- FRR: `0.01`
- 추론 시간: 약 `59.5ms/query`

안전성은 높아졌지만 200건 중 194건을 LLM에 전달하므로 효율 개선 효과가 거의 없다. 일반 KLUE
모델을 겹치는 것만으로는 실제 업무 도메인의 Local verifier를 대체할 수 없다.

## 8. 최종 도입 결정

현재 도입 구조는 다음과 같다.

```text
PDF/TXT parsing and chunking
  → OpenAI embedding
  → Dense + BM25 RRF Top-5 retrieval
  → Local cross-encoder reranking and risk signal
  → LLM evidence verifier
  → verified chunks only answer generation
  → post-generation groundedness check
  → answer or refusal
```

### 구성요소별 책임

| 구성요소 | 책임 | 사용하지 않는 용도 |
|---|---|---|
| Dense embedding | 의미 기반 후보 검색 | 답변 가능성 최종 판정 |
| BM25 | 고유명사·숫자·키워드 보완 | 단독 품질 gate |
| Cluster | corpus 분석·검색 다양화 | 답변 품질 예측 |
| Local verifier | reranking·위험도·후보 축소 | 현재 단계의 최종 accept |
| LLM evidence verifier | 근거 충분성·모순·복수 chunk 판정 | 외부 지식 기반 추측 |
| Answer generator | 검증된 근거 내 답변과 인용 | 검증되지 않은 사실 추가 |
| Groundedness checker | 생성 주장과 근거 재대조 | 비공개 chain-of-thought 저장 |

Local verifier가 높은 점수를 반환해도 현재는 LLM verifier를 생략하지 않는다. 실제 업무 도메인의
frozen test를 통과한 뒤에만 명백한 구간부터 Local accept를 단계적으로 허용한다.

## 9. 비용 예상과 현재 blocker

Hybrid Top-5 + cross-encoder는 frozen test 200건 중 166건을 LLM fallback 대상으로 분류했다.
문자 수 기반 token 추정과 `gpt-5.4-nano` 단가를 사용하면 약 `$0.026/test 200건`이다. Local ensemble은
194건, 약 `$0.030/test 200건`으로 예상된다. 이는 추정값이며 실제 운영에서는 provider usage token과
가격 snapshot으로 집계해야 한다.

LLM evaluator 실행 코드는 구현했지만 현재 `experiments/.env`에 저장된 OpenAI API key가 401
`invalid_api_key`를 반환하므로 실제 LLM verdict A/B는 완료되지 않았다. 해당 호출에서 비용은 발생하지 않았다.

## 10. 운영 데이터와 승격 기준

실제 계약서·견적서·요구사항에서 다음 label을 축적한다.

```text
question
retrieved chunk IDs and texts
document type and source
SUPPORTED | PARTIALLY_SUPPORTED | CONTRADICTED | NOT_FOUND | MULTI_CHUNK_REQUIRED
evidence chunk IDs
LLM verifier verdict
human final verdict
```

Workspace와 원본 문서 단위로 train/validation/test를 분리하고 숫자, 날짜, 단위, 부정, 예외 조항,
복수 문서 질문과 동일 주제 hard negative를 포함한다.

Local accept 승격 기준은 다음과 같다.

- 별도 domain frozen test 기준 accept precision `>= 0.95`
- FAR `<= 0.05`
- Recall `>= 0.70`
- Local coverage `>= 0.40`
- source·문서 유형별 성능 편차 검토
- calibration 이후 test에서 기준 유지
- 근거 없는 답변에 대한 생성 후 검증 통과

기준 미달 시 Local verifier는 reranking과 telemetry에만 사용하고 LLM verifier를 계속 호출한다.

## 11. 구현과 결과 위치

- 실험 요약: `experiments/retrieval_benchmark/PIPELINE_RESULTS.md`
- Hybrid pipeline: `experiments/retrieval_benchmark/run_hybrid_pipeline_benchmark.py`
- Local ensemble: `experiments/retrieval_benchmark/run_local_ensemble_benchmark.py`
- Full KLUE verifier: `experiments/retrieval_benchmark/run_full_klue_verifier.py`
- QA reader benchmark: `experiments/retrieval_benchmark/run_qa_reader_benchmark.py`
- LLM verifier benchmark: `experiments/retrieval_benchmark/run_llm_answerability_benchmark.py`
- 파생 dataset: `experiments/retrieval_benchmark/data/klue_mrc_answerability_650.jsonl`

관련 Python 테스트 17건과 Ruff, Python compile 검사를 통과했다. 모델 weight, embedding cache와 평가
산출물은 Git에 포함하지 않고 `.uv-cache`와 로컬 visualization 디렉터리에 보관한다.
