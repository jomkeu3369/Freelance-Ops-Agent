# Agent execution routing benchmark

사용자 요청을 실제 실행 전에 어떤 형태로 처리할지 결정하는 router 비교 실험이다.

- A: `LiquidAI/LFM2.5-Encoder-350M-Prompt-Router` zero-shot encoder router
- B: route policy prompt + `gpt-5.4-nano-2026-03-17` structured output
- Routes: `DIRECT_TOOL`, `SIMPLE_LLM`, `REACT_AGENT`, `SUPERVISOR`, `HUMAN_REQUIRED`
- Evaluator: `gpt-5.6-luna` 단일 모델
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
- OpenAI router·Luna 평가자의 실제 token 사용량과 비용
- Luna의 route pass, groundedness, groundlessness, hallucination 판정

Luna 평가는 기준 label 기반 정량 평가를 대체하지 않는 보조 신호다. 이번 범위에서는 다른
LLM 평가자를 추가하거나 다수결을 사용하지 않는다.

## 실행

CPU 또는 CUDA Torch 환경에서 실행할 수 있다. 현재 `config.json`은 재현 가능한 CPU
측정으로 고정되어 있다.

```powershell
uv sync --extra dev
uv run routing-benchmark validate-config

# 데이터 생성 → A/B → Luna 평가 → Pandas CSV/JSON → Matplotlib 그래프
uv run routing-benchmark --output-dir reports/latest all --confirm-paid-api
```

`all`이 끝나면 다음 파일이 자동으로 생성된다.

- `reports/latest/router_ab.json`
- `reports/latest/judge_ab.json`
- `reports/latest/plots/router-ab-dashboard.png`
- `reports/latest/plots/router-judge-dashboard.png`
- `reports/latest/tables/router_summary.csv`
- `reports/latest/tables/per_route_metrics.csv`
- `reports/latest/tables/luna_judge_summary.csv`
- `reports/latest/tables/pandas_summary.json`

`routing_benchmark/reports/`는 최종 실행의 재현 근거로 Git에 포함한다. 보고서에는 공개
benchmark prompt와 모델의 판정 근거가 포함되므로 실제 고객 데이터로 실행한 결과를 이
경로에 저장하면 안 된다. 로컬 절대 경로와 secret도 결과 schema에 기록하지 않는다.

API key와 LangSmith 설정은 `experiments/.env`에서 자동으로 읽는다. 실제 고객 데이터는
LangSmith로 보내지 않고 공개 benchmark와 프로젝트 fixture만 사용한다.

2026-08-10 실행 결과와 제한사항은 [`RESULTS.md`](RESULTS.md)에 기록했다.

