# Routing benchmark 결과 — 2026-08-10

## 2026-08-11 A1 재학습 및 최종 평가

GPT-5.6 Terra로 route별 학습 500건과 검증 100건을 생성하고 정규화·중복 제거해
학습 2,500건, 검증 500건을 확정했다. 기존 50건 frozen test와 exact prompt overlap은
0건이다. LiquidAI encoder 본체는 고정하고 routing head만 RTX 5060 Ti BF16으로
재학습했다.

| 학습 건수 | 검증 Macro-F1 |
|---:|---:|
| 250 | 0.330 |
| 500 | 0.330 |
| 1,000 | 0.372 |
| 2,500 | 0.518 |

데이터를 늘릴수록 성능이 계속 상승했지만, 2,500건에서도 제안 승격 기준 0.80에는
미달했다. 2,500건 학습은 202.6초, peak CUDA memory는 약 919MB였다.

| 항목 | LiquidAI A0 | LiquidAI A1 | GPT-5.6 Luna B |
|---|---:|---:|---:|
| Accuracy | 0.200 | 0.540 | 0.760 |
| Macro-F1 | 0.067 | 0.522 | 0.688 |
| p50 latency | 50.2 ms | 21.7 ms | 2,040.5 ms |
| p95 latency | 143.1 ms | 26.2 ms | 4,045.0 ms |
| 50건 라우팅 비용 | $0 | $0 | $0.044768 |
| Judge route pass | 0.15 | 0.45 | 1.00 |
| Judge groundedness | 0.771 | 0.829 | 0.988 |

A1 route별 F1은 `DIRECT_TOOL 0.720`, `SIMPLE_LLM 0.750`, `REACT_AGENT 0.190`,
`SUPERVISOR 0.333`, `HUMAN_REQUIRED 0.615`다. A0보다 실질적으로 개선됐지만 모든 route
F1 0.70 및 HUMAN_REQUIRED recall 0.95 기준을 충족하지 못한다. Luna 대비 paired exact
McNemar는 A1만 정답 3건, Luna만 정답 14건, `p=0.01273`으로 Luna 우위가 유의했다.

3-model Judge 120회에서 A1/Luna route pass는 `0.45/1.00`, groundless rate는
`0.1708/0.0125`, hallucination rate는 모두 `0`이었다. Judge 비용은 Sol `$0.222190`,
Terra `$0.102290`, nano `$0.009661`, 합계 `$0.334141`이다.

따라서 A1을 단독 운영 라우터로 승격하지 않는다. 다만 학습량 증가에 따른 상승 추세와
약 94배의 p50 latency 이점이 있어 모델을 즉시 폐기하지도 않는다. 다음 실험은
`REACT_AGENT↔HUMAN_REQUIRED`, `REACT_AGENT↔SUPERVISOR` 경계의 사람 검수 hard-negative를
추가하고, confidence calibration을 적용한 `A1 → Luna fallback` cascade를 평가한다.
그 결과도 기준 미달이면 LiquidAI를 기각하고 multilingual-e5-small 계열로 교체한다.

합성 데이터 생성 보고서에 기록된 성공 호출 비용은 `$2.958668`이다. 중단된 초기 생성과
평가 재시도의 실제 청구액은 이 로컬 집계에 포함되지 않을 수 있으므로 최종 비용은 provider
billing을 기준으로 확인한다.

- [학습 곡선](checkpoints/a1/learning-curve.png)
- [A1 체크포인트 manifest](checkpoints/a1/manifest.json)
- [A1/B A/B 그래프](reports/2026-08-11-a1-vs-luna/plots/router-ab-dashboard.png)
- [3-model Judge 그래프](reports/2026-08-11-a1-vs-luna/plots/router-judge-dashboard.png)
- [A1/B 결과 JSON](reports/2026-08-11-a1-vs-luna/router_ab.json)
- [Judge 결과 JSON](reports/2026-08-11-a1-vs-luna/judge_ab.json)

> 2026-08-11 결정: 아래 수치는 기존 zero-shot A와 GPT-5.4 nano B의 historical baseline이다.
> 다음 실험에서는 프로젝트 데이터로 fine-tuning한 A와 GPT-5.6 Luna B를 비교한다. A는
> 재학습 후에도 승인 기준을 넘지 못할 때만 기각하며, 실패 시 4GB VPS에 적합한 다른
> multilingual encoder 후보를 동일한 frozen test set에서 Luna와 비교한다.

## 2026-08-11 A0 vs GPT-5.6 Luna 실행

RTX 5060 Ti에서 재학습 전 LiquidAI A0와 GPT-5.6 Luna B를 50건으로 비교하고, route별
균형 표본 20건을 GPT-5.6 Sol·Terra·GPT-5.4 nano 3종 Judge로 평가했다.

| 항목 | LiquidAI A0 | GPT-5.6 Luna B |
|---|---:|---:|
| Accuracy | 0.200 | 0.760 |
| Macro-F1 | 0.067 | 0.688 |
| p50 latency | 50 ms | 2,041 ms |
| p95 latency | 143 ms | 4,045 ms |
| 50건 라우팅 비용 | USD 0 | USD 0.044768 |
| Judge route pass | 0.15 | 1.00 |
| Judge groundedness | 0.771 | 0.992 |

Luna는 기존 GPT-5.4 nano baseline의 accuracy `0.72`, macro-F1 `0.661`보다 각각 `0.04`,
`0.027` 개선됐다. 그러나 `REACT_AGENT` recall과 F1은 여전히 `0`이며, 10건 중 7건을
`HUMAN_REQUIRED`, 3건을 `SIMPLE_LLM`으로 분류했다. 따라서 전체 accuracy 상승만으로
운영 승격할 수 없다. `DIRECT_TOOL`과 `SUPERVISOR` F1은 `1.0`, `SIMPLE_LLM`은 `0.8`,
`HUMAN_REQUIRED`는 `0.64`였다.

A0는 다시 모든 입력을 `REACT_AGENT`로 분류했다. CUDA에서는 p50 `50 ms`, p95 `143 ms`,
peak VRAM 약 `1,404 MB`로 속도와 로컬 비용의 장점은 확인됐지만 분류기로서 사용할 수
없다. 이번 결과는 재학습 전 A0 기준선이며 A1 기각 판정에 사용하지 않는다.

paired exact McNemar 검정은 A만 정답 10건, B만 정답 38건, `p=0.0000617`이었다. Judge
panel은 B의 route pass를 `1.0`으로 평가했지만 gold exact accuracy는 `0.76`이므로, 이는
정답 대체가 아니라 route 경계의 정책적 허용 가능성을 보여주는 보조 신호로만 해석한다.

Judge 120회 비용은 Sol `$0.221170`, Terra `$0.101570`, nano `$0.010064`, 합계
`$0.332804`였다. Luna 라우팅 비용을 포함한 이번 실행의 총 OpenAI 비용은 약
`$0.377572`다.

- [A/B 그래프](reports/2026-08-11-luna/plots/router-ab-dashboard.png)
- [3-model Judge 그래프](reports/2026-08-11-luna/plots/router-judge-dashboard.png)
- [라우터 결과 JSON](reports/2026-08-11-luna/router_ab.json)
- [Judge 결과 JSON](reports/2026-08-11-luna/judge_ab.json)
- [CSV·Pandas 집계](reports/2026-08-11-luna/tables/)

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
