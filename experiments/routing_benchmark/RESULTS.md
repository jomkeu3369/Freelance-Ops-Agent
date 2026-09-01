# Routing benchmark 결과 — 2026-08-10

## 2026-08-27 Shadow 운영 수집·검토 용량

Agent PostgreSQL에 구독 여부와 무관하게 저장되는 `route.selected`를 별도 human review와 결합하고,
HMAC-SHA256으로 비식별화하는 준비 도구를 구현했다. SSE relay 기반 수집은 구독한 실행만 선택하는
편향이 있어 채택하지 않았다.

20% group holdout과 false automation Wilson 상한 1%를 95% 확률로 만족하려면 traffic 가정에
따라 전체 human review가 11,000~42,000건 필요했다. 예상 혼합 시나리오는 21,000건이며,
100건/일 기준 약 210일이다. 따라서 자연 traffic 표본과 위험 route stratified oversample을
분리하는 review queue가 필요하다.

희소 위험 route 조건에서 자연 50% + risk stratum 50% 배분은 필요한 review를
`42,000 → 11,000`, 73.8% 줄였다. 100건/일 기준 기간도 `420 → 110일`로 줄었다. 자연 비중을
30%로 더 낮추면 traffic-weighted 지표용 자연 holdout이 병목이 되어 18,500건으로 다시 늘었다.
현재 planning 기본값은 50:50이며 실제 traffic prior가 확보되면 재보정한다.

- [상세 수집·용량 보고서](../../docs/testing/routing-shadow-collection-capacity-2026-08-27.md)
- [Plot 기반 표](reports/2026-08-27-shadow-collection-plan/shadow_collection_plan_table.png)
- [Dashboard](reports/2026-08-27-shadow-collection-plan/shadow_collection_plan_dashboard.png)
- [계획 JSON](reports/2026-08-27-shadow-collection-plan/shadow_collection_plan.json)
- [요약 CSV](reports/2026-08-27-shadow-collection-plan/shadow_collection_plan.csv)
- [Risk-stratified plot 표](reports/2026-08-27-review-sampling/review_sampling_table.png)
- [Risk-stratified dashboard](reports/2026-08-27-review-sampling/review_sampling_dashboard.png)

## 2026-08-27 운영 Shadow trace 평가 파이프라인

Prompt나 고객 식별자를 저장하지 않는 SHA-256 기반 JSONL 계약, project/workspace grouped
holdout, Wilson 95% 신뢰구간과 자동 승격 gate를 구현했다. 실제 human-reviewed 운영 trace는
아직 없으므로 frozen 50건을 `POLICY_REPLAY` fixture로 변환해 pipeline과 plot 출력만 검증했다.

고정 holdout은 6건으로 너무 작다. Safe escalation은 이 smoke 표본에서 품질을 유지하며 LLM
rate `100% → 83.3%`, 기록 비용 `$0.005198 → $0.004229`를 보였지만 HUMAN 표본이 1건이고
human review가 아니므로 운영 근거가 아니다. 승격 상태는 `SHADOW_ONLY`다.

- [상세 보고서](../../docs/testing/routing-shadow-trace-pipeline-2026-08-27.md)
- [Plot 기반 표](reports/2026-08-27-shadow-pipeline-smoke/shadow_trace_table.png)
- [Dashboard](reports/2026-08-27-shadow-pipeline-smoke/shadow_trace_dashboard.png)
- [평가 JSON](reports/2026-08-27-shadow-pipeline-smoke/shadow_trace_evaluation.json)
- [요약 CSV](reports/2026-08-27-shadow-pipeline-smoke/shadow_trace_summary.csv)

## 2026-08-27 Local router distribution shift와 OOD gate

Synthetic train batch 1–16과 group holdout batch 17–20으로 model hyperparameter를 선택하고,
독립 synthetic validation에서 confidence와 TF-IDF nearest-train similarity threshold를 정한 뒤
frozen 50건에 한 번 적용했다.

Local router Macro-F1은 group holdout `0.994`, synthetic validation `0.986`이었지만 frozen
test에서는 `0.510`으로 하락했다. OOD p05/p10 gate는 confidence-only cascade보다 품질을
복구했지만 trusted contract-only 기준보다 낮았고 false automation도 개선하지 못했다.

따라서 confidence, TF-IDF OOD와 기존 lane agreement 모두 자동 routing에서 기각한다. Safe
escalation-only는 실행 권한을 확대하지 않는 shadow 후보로만 유지한다. 운영 구조는
`Safety Gate → trusted contract fast path → AD_HOC LLM evaluator`를 유지한다.

- [상세 분포 이동·OOD 보고서](../../docs/testing/routing-distribution-shift-ood-2026-08-27.md)
- [Plot 기반 요약 표](reports/2026-08-27-distribution-shift/distribution_shift_table.png)
- [분포 이동 dashboard](reports/2026-08-27-distribution-shift/distribution_shift_dashboard.png)
- [원시 JSON](reports/2026-08-27-distribution-shift/distribution_shift_evaluation.json)
- [요약 CSV](reports/2026-08-27-distribution-shift/distribution_shift_summary.csv)

## 2026-08-27 Operational policy replay

저장된 GPT-5.6 Luna 응답과 hybrid 원시 예측을 이용해 deterministic policy-first와 selective
local cascade를 frozen 50건에서 비교했다. Trusted direct Tool과 PROJECT_ANALYSIS contract를
LLM보다 먼저 적용한 구성은 accuracy `0.760`, Macro-F1 `0.688`을 유지하면서 LLM call rate를
`1.00 → 0.60`, 기록 응답 비용을 `$0.044768 → $0.026580`으로 낮췄다.

새 word/character TF-IDF logistic router는 synthetic validation Macro-F1 `0.988`, 단건 CPU
평균 `2.44 ms`였지만 validation threshold를 frozen test에 적용한 cascade는 accuracy `0.680`,
HUMAN recall `0.600`으로 하락했다. Synthetic validation과 frozen 분포 사이의 차이가 크므로
local 자동 routing에는 사용하지 않는다. 기존 lane agreement cascade도 HUMAN recall `0.500`,
false automation 5건으로 다시 기각했다.

현재 운영 후보는 `Safety Gate → trusted contract fast path → AD_HOC LLM evaluator`다. Local
후보는 shadow/signal-only로 유지한다.

- [상세 연구 보고서](../../docs/testing/routing-operational-policy-replay-2026-08-27.md)
- [Plot 기반 요약 표](reports/2026-08-27-operational-replay/operational_policy_table.png)
- [비교 dashboard](reports/2026-08-27-operational-replay/operational_policy_dashboard.png)
- [원시 JSON](reports/2026-08-27-operational-replay/operational_policy_replay.json)
- [요약 CSV](reports/2026-08-27-operational-replay/operational_policy_summary.csv)

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

- [A1 학습 manifest](reports/2026-08-11-router-head-training/manifest.json)
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

- [라우터 A/B 대시보드](reports/latest/plots/router-ab-dashboard.png)
- [평가 대시보드](reports/latest/plots/router-judge-dashboard.png)
- [라우터 요약 CSV](reports/latest/tables/router_summary.csv)
- [route별 CSV](reports/latest/tables/per_route_metrics.csv)
- [평가 요약 CSV](reports/latest/tables/luna_judge_summary.csv)
- [Pandas 전체 요약 JSON](reports/latest/tables/pandas_summary.json)

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
## 2026-08-27 실서비스 route observation collector

Agent의 run-scoped finite snapshot API와 Spring의 lease/cursor 기반 durable projection을 구현했다.
수집은 SSE 구독과 독립적이고, raw prompt를 저장하지 않으며, review API는 workspace RBAC와
50:50 자연/risk 계층화를 사용한다.

20 claims/cycle, fixed delay 1초 조건의 결정적 부하 모델에서 virtual-thread 동시성 20의 이론
처리량은 snapshot latency 50/100/250/500ms에 각각 1,143/1,091/960/800건/분이었다. 500ms,
400건/분 유입의 1시간 시뮬레이션은 backlog 9건, p95 수집 지연 1.85초였다. 순차 수집은 같은
조건에서 backlog 17,469건으로 실서비스 후보가 아니다.

- [운영 구현·runbook](../../docs/testing/routing-production-shadow-collector-2026-08-27.md)
- [capacity dashboard](reports/2026-08-27-route-collector-capacity/route_collector_capacity_dashboard.png)
- [capacity plot table](reports/2026-08-27-route-collector-capacity/route_collector_capacity_table.png)
- [원시 JSON](reports/2026-08-27-route-collector-capacity/route_collector_capacity.json)

이 결과는 수집 infrastructure의 용량 검증이며 local router의 품질 승격 근거가 아니다. 실제
human-reviewed production trace가 안전성 gate를 통과하기 전 local router는 `SHADOW_ONLY`다.

## 2026-08-27 concurrent review claim lease

예약 없는 FIFO review는 평균 5분 검토에서 reviewer 8명 중복 작업률이 84.1%였고 unique
처리량은 121.0건/일에 그쳤다. 15분 lease와 PostgreSQL `FOR UPDATE SKIP LOCKED`는 중복률을
0%로 낮추고 760.4건/일, 6.28배 처리량을 기록했다. 단일 work item 11,000건 처리 기간은
91일에서 15일로 줄었다. 후속 공통오류 canary 정책의 2.27 vote/gold를 적용하면 11,000 accepted
gold의 예상 기간은 8명 기준 약 33일, 4명 기준 약 66일이다.

- [동시 review 연구 문서](../../docs/testing/routing-review-claim-concurrency-2026-08-27.md)
- [review claim dashboard](reports/2026-08-27-review-claim-capacity/review_claim_capacity_dashboard.png)
- [review claim plot table](reports/2026-08-27-review-claim-capacity/review_claim_capacity_table.png)

## 2026-08-27 risk-weighted review consensus

예상 reviewer 오류율 natural 2%·risk 8%에서 위험 표본 100%와 자연 표본 25%를 blind dual
review하고 불일치만 제3자 adjudication하면 gold당 1.71회 review로 p95 label 오류 0.97%를
달성했다. 자연 10% dual은 p95 1.12%로 1% gate를 넘어서 기각했다.
이 결과는 reviewer 오류 독립 가정의 기준선이며 바로 아래 공통오류 연구가 운영 기본값을 대체한다.

- [Consensus 연구 문서](../../docs/testing/routing-review-consensus-2026-08-27.md)
- [Consensus dashboard](reports/2026-08-27-review-consensus/review_consensus_dashboard.png)
- [Consensus plot table](reports/2026-08-27-review-consensus/review_consensus_table.png)

## 2026-08-27 shared reviewer-error robustness

Reviewer 오류 중 natural 10%, risk 25%가 동일 오답으로 공유되는 예상 시나리오에서 기존
natural dual 25%·risk dual 100% 정책은 p95 label 오류 `2.06%`로 실패했다. 최소 통과 정책은
natural dual 50%·risk senior audit 100%로 `2.26 reviews/gold`, p95 `0.95%`였다.

운영 canary는 자연 공통오류를 식별하기 위해 dual-reviewed natural의 5%도 senior audit한다.
비용은 `2.27 reviews/gold`, p95 오류는 `0.95%`다.

- [Robustness 연구 문서](../../docs/testing/routing-review-consensus-robustness-2026-08-27.md)
- [Robustness dashboard](reports/2026-08-27-review-consensus-robustness/review_consensus_robustness_dashboard.png)
- [Robustness plot table](reports/2026-08-27-review-consensus-robustness/review_consensus_robustness_table.png)

## 2026-08-27 canary audit decision power

Consensus overturn 1% gate를 Wilson 95% 구간으로 판정할 때 오류 0건은 381 audit에서 승인할 수
있지만, 실제 overturn 0.5%를 95% 확률로 승인하려면 약 5,000건이 필요했다. 실제 1.5%를
95% 확률로 기각하는 데는 약 7,500건이 필요했다. 구간이 gate와 겹치면 `INCONCLUSIVE`이며
승격 근거로 사용할 수 없다.

- [Canary 판정력 연구 문서](../../docs/testing/routing-review-canary-power-2026-08-27.md)
- [Canary power dashboard](reports/2026-08-27-review-canary-power/review_canary_power_dashboard.png)
- [Canary power plot table](reports/2026-08-27-review-canary-power/review_canary_power_table.png)

## 2026-08-27 sequential canary decision safety

14개 audit checkpoint에서 일반 Wilson 95% 판정을 반복하면 실제 overturn 1% 경계의 한 stratum
누적 판정 확률이 `32.75%`까지 증가했다. 14 checkpoint와 두 stratum의 28 looks에 Bonferroni
alpha-spending을 적용하면 한 stratum은 `2.51%`, 전체 family-wise 상한은 5% 이내가 된다. 안전한
0.5% 정책의 중앙 판정 시점은 1,500건에서 5,000건으로 늦어지지만 운영 기본값은 오판 통제를
우선한다.

- [순차 Canary 연구 문서](../../docs/testing/routing-review-canary-sequential-2026-08-27.md)
- [Sequential dashboard](reports/2026-08-27-review-canary-sequential/review_canary_sequential_dashboard.png)
- [Sequential plot table](reports/2026-08-27-review-canary-sequential/review_canary_sequential_table.png)

## 2026-08-27 review sampling bias correction

실제 traffic natural/risk 비율이 90:10인데 review를 50:50으로 배분한 2,000회 시뮬레이션에서
단순 평균 accuracy MAE는 `0.05512`, Macro-F1 MAE는 `0.03152`였다. 전체 observation prior로
사후층화하면 각각 `0.00273`, `0.00362`로 감소했다. 이에 따라 shadow trace schema 1.1은
population prior, review inclusion probability와 inverse weight를 기록하고, grouped holdout
scorecard는 가중 confusion matrix·비용·latency와 Kish effective sample size를 사용한다.

- [표본 편향 보정 연구 문서](../../docs/testing/routing-review-sampling-bias-2026-08-27.md)
- [Sampling bias dashboard](reports/2026-08-27-review-sampling-bias/review_sampling_bias_dashboard.png)
- [Sampling bias plot table](reports/2026-08-27-review-sampling-bias/review_sampling_bias_table.png)

## 2026-08-27 fixed-cohort review export

페이지 크기 1,000에서 100만 observation을 export하면 offset pagination의 누적 scan work는
keyset의 `500.5배`다. 10,000건 export 중 late capture 200건이 들어오는 2,000회 시뮬레이션에서
snapshot 없는 moving keyset은 평균 89.8건을 시작 cohort 밖에서 포함하고 최종 population의
110.2건을 누락했다. 고정 `captured_at` snapshot은 snapshot 기준 누락·혼입이 모두 0이었다.

- [고정 Cohort Export 연구 문서](../../docs/testing/routing-review-export-cohort-2026-08-27.md)
- [Export capacity dashboard](reports/2026-08-27-route-review-export-capacity/route_review_export_capacity_dashboard.png)
- [Export capacity plot table](reports/2026-08-27-route-review-export-capacity/route_review_export_capacity_table.png)
