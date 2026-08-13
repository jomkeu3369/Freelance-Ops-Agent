# Hybrid Router 단독 평가 — 2026-08-13

## 목적

운영 후보인 `BM25 + LiquidAI A1 encoder + weighted RRF + disagreement gate`가 LLM evaluator 없이 어느 정도의 route 품질과 안전성을 제공하는지 확인한다. pgvector와 RAG corpus는 이 분류 단계에 관여하지 않는다.

## 평가 조건

- 데이터: 사람이 검토한 기존 frozen route test 50건
- 구성: 5개 route별 10건의 균형 표본
- route: `DIRECT_TOOL`, `SIMPLE_LLM`, `REACT_AGENT`, `SUPERVISOR`, `HUMAN_REQUIRED`
- BM25 corpus: 생성 학습 데이터 2,500건
- encoder: `LiquidAI/LFM2.5-Encoder-350M-Prompt-Router` 고정 revision과 A1 2,500건 routing head
- frozen test와 BM25 corpus의 exact prompt overlap: 0건
- 실행 환경: Agent venv의 CPU PyTorch; CUDA 미감지
- LLM evaluator: 호출하지 않음

## 결과

| 모델 | Accuracy | Macro-F1 |
|---|---:|---:|
| BM25 | 0.660 | 0.601 |
| LiquidAI A1 encoder | 0.360 | 0.339 |
| RRF | 0.540 | 0.488 |

현재 encoder는 BM25보다 유의하게 낮았다. paired exact McNemar에서 BM25만 정답인 경우는 16건, encoder만 정답인 경우는 1건이며 `p=0.000275`였다. RRF는 encoder보다 유의하게 나았지만(`p=0.003906`), BM25보다 낮았고 BM25 대비 차이는 표본 50건에서 `p=0.070313`이었다.

### Route별 RRF F1

| Route | Precision | Recall | F1 |
|---|---:|---:|---:|
| DIRECT_TOOL | 0.529 | 0.900 | 0.667 |
| SIMPLE_LLM | 0.421 | 0.800 | 0.552 |
| REACT_AGENT | 0.000 | 0.000 | 0.000 |
| SUPERVISOR | 1.000 | 0.800 | 0.889 |
| HUMAN_REQUIRED | 1.000 | 0.200 | 0.333 |

`REACT_AGENT`를 한 건도 맞히지 못했고 `HUMAN_REQUIRED` recall도 0.2에 그쳤다. 평균 수치와 관계없이 현재 모델을 실행 route 결정권자로 사용할 수 없는 결과다.

## Lane 일치도와 신호 상관

- BM25와 encoder top-1 일치율: 0.42
- Cohen's kappa: 0.267
- Cramér's V: 0.453
- fused share와 RRF 정답 여부의 상관: 0.393
- margin과 RRF 정답 여부의 상관: 0.333

두 lane은 약하게 일치한다. fused share와 margin은 정답과 양의 관계가 있지만 표본이 50건뿐이고 calibration split이 아니므로 현재 값으로 운영 threshold를 정할 수 없다.

## Selective gate 결과와 안전 실패

- 자동 수락: 21/50, coverage 0.42
- LLM fallback 대상: 29/50, fallback rate 0.58
- 자동 수락 표본 accuracy: 0.8095
- fallback 사유: 29건 모두 `LANE_DISAGREEMENT`

자동 수락 accuracy만 보면 개선처럼 보이지만 route별로 분석하면 안전하지 않다.

| 실제 route | 자동 수락 수 | 자동 수락 정답 수 |
|---|---:|---:|
| SIMPLE_LLM | 5 | 5 |
| DIRECT_TOOL | 8 | 7 |
| SUPERVISOR | 4 | 4 |
| HUMAN_REQUIRED | 4 | 1 |

실제 `HUMAN_REQUIRED`인데 두 lane이 같은 오답에 동의한 3건이 `SIMPLE_LLM` 또는 `DIRECT_TOOL`로 자동 수락됐다. 따라서 lane agreement는 안전한 확신의 충분조건이 아니다. 현 상태에서 경계 요청만 LLM evaluator로 보내면 이 오류를 잡을 수 없다.

## 성능

- 모델 로드: 4.18초(로컬 cache warm 상태)
- 평균 추론: 266.63ms/query
- p50: 258.50ms/query
- p95: 329.28ms/query

이는 CPU 결과다. 기존 CUDA A1 benchmark와 직접 비교할 때는 장치 차이를 구분해야 한다.

## 결론

현재 hybrid router는 운영 도입 기준을 충족하지 못한다. 특히 `REACT_AGENT`와 `HUMAN_REQUIRED` 실패 때문에 RRF 가중치나 단일 threshold 조정만으로 해결됐다고 볼 수 없다.

현재 단계의 도입 원칙은 다음과 같다.

1. 로컬 BM25·encoder·RRF 결과는 trace와 보조 feature로만 사용한다.
2. 새 모델이 별도 frozen test에서 승격 기준을 통과하기 전에는 lane agreement 요청까지 LLM route evaluator가 검증한다.
3. `HUMAN_REQUIRED` recall과 false automation을 전체 accuracy보다 우선한다.
4. `REACT_AGENT ↔ SIMPLE_LLM`, `REACT_AGENT ↔ HUMAN_REQUIRED` hard negative를 보강하고 encoder를 재학습한다.
5. calibration set에서 route별 threshold를 정한 뒤 untouched test에서 재평가한다.
6. 운영 승격은 최소 route별 F1 0.70, `HUMAN_REQUIRED` recall 0.95와 false automation 상한을 함께 만족할 때만 검토한다.

## 산출물

- [`hybrid_router_evaluation.json`](../../experiments/routing_benchmark/reports/2026-08-13-hybrid-rrf/hybrid_router_evaluation.json)
- [`confusion_matrices.png`](../../experiments/routing_benchmark/reports/2026-08-13-hybrid-rrf/confusion_matrices.png)
- [`hybrid_router_dashboard.png`](../../experiments/routing_benchmark/reports/2026-08-13-hybrid-rrf/hybrid_router_dashboard.png)
- 실행 스크립트: [`evaluate_hybrid_router.py`](../../agent/scripts/evaluate_hybrid_router.py)
