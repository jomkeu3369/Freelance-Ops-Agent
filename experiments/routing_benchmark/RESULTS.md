# Routing benchmark 결과 — 2026-08-10

## 결론

50건의 균형 데이터셋에서 prompt 기반 `gpt-5.4-nano` 라우터가 LiquidAI zero-shot
encoder 라우터보다 정확했지만, 두 모델 모두 운영 라우터로 채택하기에는 부족했다.

- LiquidAI: accuracy `0.20`, macro-F1 `0.067`
- GPT-5.4 nano: accuracy `0.72`, macro-F1 `0.661`
- paired exact McNemar: `p=0.0001564`

GPT-5.4 nano의 우위는 이 표본에서 통계적으로 유의했다. 그러나 GPT-5.4 nano도
`REACT_AGENT` 10건을 한 건도 맞히지 못하고 대부분 `HUMAN_REQUIRED`로 분류했다.
따라서 현재 결론은 GPT-5.4 nano의 즉시 운영 승격이 아니라 route policy와 gold label을
재검토한 다음 별도 한국어 실사용 test set으로 재평가해야 한다는 것이다.

## Pandas 집계

| 항목 | LiquidAI encoder | GPT-5.4 nano |
|---|---:|---:|
| Accuracy | 0.200 | 0.720 |
| Macro-F1 | 0.067 | 0.661 |
| p50 latency | 1,132 ms | 2,181 ms |
| p95 latency | 1,262 ms | 5,571 ms |
| Throughput | 0.886 req/s | 0.371 req/s |
| 50건 라우팅 비용 | USD 0 | USD 0.010634 |
| 1,000건 환산 라우팅 비용 | USD 0 | USD 0.212678 |

LiquidAI는 API 비용이 없고 p50 기준 약 1.9배 빨랐지만, 모든 입력을
`REACT_AGENT`로 예측해 실질적인 분류 기능을 하지 못했다. 측정 장치는 CPU였으며 모델
parameter memory는 약 `1,354 MB`였다. 최종 실행의 모델 load 시간은 로컬 캐시 기준
`2.21초`이므로 최초 다운로드 시간과 혼동하면 안 된다.

GPT-5.4 nano의 route별 F1은 `DIRECT_TOOL 0.947`, `SIMPLE_LLM 0.909`,
`REACT_AGENT 0.000`, `SUPERVISOR 0.824`, `HUMAN_REQUIRED 0.625`였다.

## GPT-5.6 Luna 평가

각 라우터에서 동일한 route별 균형 표본 20건을 선택해 GPT-5.6 Luna 단일 평가자로
판정했다.

| 항목 | LiquidAI encoder | GPT-5.4 nano |
|---|---:|---:|
| Route pass rate | 0.20 | 0.70 |
| Mean groundedness | 1.00 | 0.9125 |
| Groundless rate | 0.00 | 0.0875 |
| Hallucination rate | 0.00 | 0.10 |
| Luna 평가 비용 | USD 0.004266 | USD 0.004557 |

Luna는 GPT-5.4 nano의 두 예측에서 사용자 입력에 없는 비가역성, 본인 확인, 권한 검토
등을 근거로 추가한 점을 unsupported claim으로 판정했다. Luna 40회 전체 비용은
`USD 0.008823`, 평균 응답 시간은 `3.50초`였다. Luna 평가는 gold label 기반 평가를
대체하지 않는 보조 지표이며, 단일 평가자의 편향 가능성이 있다.

최종 보고서 실행의 라우터와 Luna 합계 API 비용은 `USD 0.019457`이었다. 재현 확인을
위해 같은 조건으로 한 차례 더 실행했으므로 이번 작업 중 실제 API 사용액은 약
`USD 0.039039`다. 첫 실행의 GPT-5.4 nano accuracy는 `0.74`, 최종 실행은 `0.72`로,
원격 생성 모델의 실행 간 변동성도 확인됐다.

## 그래프와 수치 파일

- [라우터 A/B 대시보드](artifacts/2026-08-10/router-ab-dashboard.png)
- [GPT-5.6 Luna 평가 대시보드](artifacts/2026-08-10/router-judge-dashboard.png)
- [라우터 요약 CSV](artifacts/2026-08-10/router_summary.csv)
- [route별 CSV](artifacts/2026-08-10/per_route_metrics.csv)
- [Luna 요약 CSV](artifacts/2026-08-10/luna_judge_summary.csv)
- [Pandas 전체 요약 JSON](artifacts/2026-08-10/pandas_summary.json)

## 제한사항과 다음 실험

- 데이터는 route별 10건, 총 50건으로 작다.
- 공개 Hugging Face row의 원래 label이 아니라 V2 정책에 맞게 사람이 mapping한 label이다.
- `DIRECT_TOOL`과 `SUPERVISOR`는 프로젝트 고정 fixture이고 나머지는 공개 데이터다.
- 한국어 실사용 요청, 경계 사례, 공격적 입력을 포함한 별도 holdout set이 필요하다.
- LiquidAI에는 현재 긴 route 설명을 zero-shot으로 제공했다. label 문구 최적화나 학습 없이
  모델 자체의 일반 성능을 단정할 수 없다.
- GPT-5.4 nano는 고위험 정책을 과도하게 적용했다. 특히 bounded write Tool과 실제 human
  approval이 필요한 작업의 경계를 prompt와 label에서 더 명시해야 한다.
- 다음 비교에서도 데이터, seed, 모델 snapshot, 평가 코드는 고정하고 라우터 구성만 바꾼다.
