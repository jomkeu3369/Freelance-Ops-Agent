# Agent execution routing benchmark

사용자 요청을 실제 실행 전에 어떤 형태로 처리할지 결정하는 router 비교 실험이다.

- A: `LiquidAI/LFM2.5-Encoder-350M-Prompt-Router` + project routing head
- B: route policy prompt + `gpt-5.6-luna` structured output
- Routes: `DIRECT_TOOL`, `SIMPLE_LLM`, `REACT_AGENT`, `SUPERVISOR`, `HUMAN_REQUIRED`
- Evaluators: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.4-nano-2026-03-17`
- Trace: LangSmith project `freelance-ops-routing-benchmark`

## Dataset

각 route 10건, 총 50건의 균형 benchmark를 만든다. 공개 Hugging Face row를 그대로
다른 의미의 label로 간주하지 않고 V2 route policy에 따라 변환하며 원본 dataset, split,
index와 mapping rule을 결과에 보존한다.

- `SupraLabs/Prompt-Routing-Dataset`: `SIMPLE_LLM`
- `rescommons/agent-orchestration-dataset`: `REACT_AGENT`, `HUMAN_REQUIRED`
- V2 routing policy fixture: `DIRECT_TOOL`, `SUPERVISOR`

이 변환 label은 제품 정책 기반 benchmark label이며 원본 dataset 제작자의 공식 label이
아니다. 운영 승격 전에는 한국어 실제 요청을 비식별화해 별도 human-reviewed test set으로
추가해야 한다.

## 평가 항목

- 기준 label 기반 accuracy, macro-F1, route별 precision/recall/F1
- confusion matrix와 paired exact McNemar 검정
- p50·p95 latency, throughput, 모델 load 시간과 parameter memory
- OpenAI router·3개 평가자의 실제 token 사용량과 비용
- 3개 평가자의 다수결 route pass, groundedness, groundlessness, hallucination 판정

LLM-as-a-Judge 평가는 기준 label 기반 정량 평가를 대체하지 않는 보조 신호다. B와 동일한
Luna를 평가자에서 제외해 자기평가를 방지한다.

## 실행

CPU 또는 CUDA Torch 환경에서 실행할 수 있다. 현재 `config.json`은 RTX 5060 Ti CUDA와
2,500건 A1 routing-head checkpoint로 고정되어 있다.

```powershell
uv sync --extra dev
uv run routing-benchmark validate-config

# 유료 합성 데이터 생성과 CUDA routing-head 학습
uv run routing-benchmark generate-training-data --confirm-paid-api
uv run routing-benchmark train-router-a

# 데이터 생성 → A/B → 3-model Judge → Pandas CSV/JSON → Matplotlib 그래프
uv run routing-benchmark --output-dir reports/latest all --confirm-paid-api

# 저장된 결과를 이용한 무료 operational policy replay와 plot·표 생성
uv run routing-benchmark --output-dir reports/2026-08-27-operational-replay operational-replay

# group-aware 모델 선택과 OOD selective gate 평가
uv run routing-benchmark --output-dir reports/2026-08-27-distribution-shift distribution-shift

# 비식별 운영 shadow JSONL을 project/workspace group holdout으로 평가
uv run routing-benchmark --output-dir reports/latest shadow-evaluate --traces <shadow-traces.jsonl>

# route observation과 human review를 HMAC 비식별 trace로 결합
uv run routing-benchmark shadow-prepare --observations <observations.jsonl> --reviews <reviews.jsonl> --trace-output <shadow-traces.jsonl>

# Spring의 고정 cohort export page JSONL을 중간 분리 없이 HMAC trace로 변환
uv run routing-benchmark shadow-export-prepare --pages <export-pages.jsonl> --trace-output <shadow-traces.jsonl>

# 승격 gate에 필요한 review 수와 기간 시뮬레이션
uv run routing-benchmark --output-dir reports/latest collection-plan

# 자연 traffic과 위험 route review quota 배분 최적화
uv run routing-benchmark --output-dir reports/latest review-sampling

# durable Spring collector의 동시성·latency·backlog 용량 모델
uv run routing-benchmark --output-dir reports/latest collector-capacity

# 동시 reviewer의 중복 작업과 claim lease 처리량 비교
uv run routing-benchmark --output-dir reports/latest review-claim-capacity

# 위험/자연 dual review와 adjudication의 label 오류·비용 frontier
uv run routing-benchmark --output-dir reports/latest review-consensus

# reviewer 공통오류와 합의 후 senior audit robustness frontier
uv run routing-benchmark --output-dir reports/latest review-consensus-robustness

# consensus overturn 1% gate의 audit 표본 수와 승인·기각 판정력
uv run routing-benchmark --output-dir reports/latest review-canary-power

# 반복 checkpoint 조회의 optional-stopping과 alpha-spending 비교
uv run routing-benchmark --output-dir reports/latest review-canary-sequential

# 50:50 risk oversampling의 단순 평균 편향과 사후층화 보정 비교
uv run routing-benchmark --output-dir reports/latest review-sampling-bias

# 고정 snapshot keyset export의 scan work와 cohort 재현성 비교
uv run routing-benchmark --output-dir reports/latest review-export-capacity
```

동일 데이터셋·동일 모델의 기존 B 결과를 재사용할 때는
`--cached-router-b-report <router_ab.json>`을 지정한다. 코드는 case ID·prompt·route policy·
model ID가 모두 같을 때만 재사용한다. Judge는 6개 병렬 호출과
`judge_items.partial.jsonl` 체크포인트로 중단 후 재개할 수 있다.

`all`이 끝나면 다음 파일이 자동으로 생성된다.

- `reports/latest/router_ab.json`
- `reports/latest/judge_ab.json`
- `reports/latest/plots/router-ab-dashboard.png`
- `reports/latest/plots/router-judge-dashboard.png`
- `reports/latest/tables/router_summary.csv`
- `reports/latest/tables/per_route_metrics.csv`
- `reports/latest/tables/judge_panel_summary.csv`
- `reports/latest/tables/pandas_summary.json`

`operational-replay`는 저장된 Luna·hybrid 결과와 synthetic train/validation을 사용해 유료 API
호출 없이 policy-first·selective cascade를 비교한다. JSON, CSV, dashboard plot과 PNG 표를
지정한 output directory에 기록한다.

`distribution-shift`는 synthetic 생성 batch를 분리해 local model을 선택하고 confidence와
nearest-train similarity gate를 frozen test에 적용한다. 결과에는 risk–coverage plot, OOD
분포 plot, CSV와 PNG 요약 표가 포함된다.

`shadow-evaluate`는 prompt 원문을 허용하지 않는 JSONL schema를 검증하고 project 우선,
workspace fallback 그룹 holdout에서 actual·local full·safe escalation 정책을 비교한다. Wilson
신뢰구간과 운영 승격 gate, JSON, CSV, dashboard plot 및 PNG 표를 함께 기록한다.

`shadow-prepare`는 별도 observation/review JSONL을 workspace scope로 검증한 뒤 환경변수의
32-byte 이상 key로 HMAC-SHA256 비식별화한다. `collection-plan`은 route traffic과 일일 human
review 처리량별 structural gate 도달 확률·기간을 Monte Carlo로 계산해 plot과 표를 기록한다.
`review-sampling`은 자연 traffic holdout을 보존하면서 위험 route를 oversample하는 allocation을
비교한다. `collector-capacity`는 Spring의 20건 claim, 1초 fixed delay, virtual-thread 동시성을
동일하게 모델링해 snapshot latency와 유입률별 capacity, 1시간 backlog, p95 수집 지연을
JSON·CSV·dashboard·PNG 표로 기록한다. `review-claim-capacity`는 예약 없는 FIFO review와
15분 lease + PostgreSQL SKIP LOCKED를 동시 reviewer 수·평균 review 시간별로 비교한다.
`review-consensus`는 reviewer 오류 시나리오별 risk/natural dual-review 비율을 비교하고 p95
accepted-label 오류 1% gate를 통과하는 최소비용 정책을 선택한다.
`review-consensus-robustness`는 동일한 주변 오류율에서 reviewer가 같은 오답을 공유하는
공통모드 오류와 합의 후 senior audit 비율을 탐색해 최소비용 정책과 관측 가능한 canary
정책을 함께 기록한다.
`review-canary-power`는 실제 consensus overturn rate별로 Wilson 상·하한이 1% gate를
통과하거나 기각할 확률을 Monte Carlo로 계산해 95% 판정력에 필요한 audit 표본 수를 기록한다.
`review-canary-sequential`은 14개 고정 checkpoint와 risk/natural 두 stratum의 총 28 looks에서
일반 95% 구간 반복 조회와 Bonferroni alpha-spending을 비교해 family-wise 오판 확률과 판정
지연을 기록한다.
`review-sampling-bias`는 실제 traffic 90:10과 review 50:50의 차이로 생기는 accuracy,
Macro-F1, HUMAN_REQUIRED recall, false automation 편향을 반복 시뮬레이션하고 population prior를
사용한 사후층화 보정의 MAE와 p95 오차를 JSON·CSV·dashboard·PNG 표로 기록한다.
`review-export-capacity`는 offset과 keyset pagination의 누적 scan work, export 중 late capture가
moving cohort에 만드는 누락·혼입, 고정 `captured_at` snapshot의 재현성을 시뮬레이션한다.

`routing_benchmark/reports/`는 최종 실행의 재현 근거로 Git에 포함한다. 보고서에는 공개
benchmark prompt와 모델의 판정 근거가 포함되므로 실제 고객 데이터로 실행한 결과를 이
경로에 저장하면 안 된다. 로컬 절대 경로와 secret도 결과 schema에 기록하지 않는다.

API key와 LangSmith 설정은 `experiments/.env`에서 자동으로 읽는다. 실제 고객 데이터는
LangSmith로 보내지 않고 공개 benchmark와 프로젝트 fixture만 사용한다.

2026-08-10 실행 결과와 제한사항은 [`RESULTS.md`](RESULTS.md)에 기록했다.
현재 `reports/latest`는 GPT-5.4 nano historical baseline이다.
GPT-5.6 Luna 결과로 해석하지 않으며, 새 유료 실행이 완료된 뒤 별도 날짜 artifact로 보존한다.
