# Agent execution routing benchmark

사용자 요청을 실제 실행 전에 어떤 형태로 처리할지 결정하는 router 비교 실험이다.

- A: `LiquidAI/LFM2.5-Encoder-350M-Prompt-Router` zero-shot encoder router
- B: route policy prompt + `gpt-5.4-nano-2026-03-17` structured output
- Routes: `DIRECT_TOOL`, `SIMPLE_LLM`, `REACT_AGENT`, `SUPERVISOR`, `HUMAN_REQUIRED`
- Judges: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`
- Trace: LangSmith project `freelance-ops-routing-benchmark`

## Dataset

각 route 10건, 총 50건의 균형 benchmark를 만든다. 공개 Hugging Face row를 그대로
다른 의미의 label로 간주하지 않고 V2 route policy에 따라 변환하며 원본 dataset, split,
index와 mapping rule을 결과에 보존한다.

- `SupraLabs/Prompt-Routing-Dataset`: `SIMPLE_LLM`, `REACT_AGENT` 후보
- `rescommons/agent-orchestration-dataset`: `SUPERVISOR`, `HUMAN_REQUIRED` 후보
- V2 deterministic Tool policy fixture: `DIRECT_TOOL`

이 변환 label은 제품 정책 기반 benchmark label이며 원본 dataset 제작자의 공식 label이
아니다. 운영 승격 전에는 한국어 실제 요청을 비식별화해 별도 human-reviewed test set으로
추가해야 한다.

## 실행

CUDA 13.2 Torch가 설치된 기존 실험 환경을 사용하는 예시다.

```powershell
$env:PYTHONPATH="..\routing_benchmark\src"
..\classification_benchmark\.venv\Scripts\python.exe -m routing_benchmark.cli validate-config

# 데이터 생성 → A/B → 세 Judge → Matplotlib 그래프 자동 생성
..\classification_benchmark\.venv\Scripts\python.exe -m routing_benchmark.cli `
  --output-dir reports/latest all --confirm-paid-api
```

`all`이 끝나면 다음 파일이 자동으로 생성된다.

- `reports/latest/router_ab.json`
- `reports/latest/judge_ab.json`
- `reports/latest/plots/router-ab-dashboard.png`
- `reports/latest/plots/router-judge-dashboard.png`

API key와 LangSmith 설정은 `experiments/.env`에서 자동으로 읽는다. 실제 고객 데이터는
LangSmith로 보내지 않고 공개 benchmark와 프로젝트 fixture만 사용한다.

