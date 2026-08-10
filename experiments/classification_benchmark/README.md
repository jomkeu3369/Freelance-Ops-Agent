# Requirement classifier A/B benchmark

Hugging Face의 FR/NFR 요구사항 데이터로 두 encoder를 같은 조건에서 fine-tuning하고,
정확도·F1·속도·메모리·추정 compute 비용을 비교한다. 이어서 서로 다른 OpenAI 모델
3개가 각 예측의 정답성 및 groundedness를 독립 평가하고 다수결/중앙값으로 집계한다.

## 실험 계약

- Dataset: `limsc/fr-nfr-classification` (956 rows, train/val/test 제공)
- A: `distilbert/distilbert-base-uncased`
- B: `microsoft/MiniLM-L12-H384-uncased`
- Labels: `FUNCTIONAL`, `NON_FUNCTIONAL`
- 통계: paired exact McNemar + macro-F1 bootstrap 95% CI
- Judge: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`
- Judge 집계: 2/3 pass 다수결, score 중앙값, disagreement 표준편차
- Groundlessness: `1 - median(groundedness_score) / 4`

Judge는 classifier의 정량 평가를 대체하지 않는다. 기준 label 기반 accuracy/F1가 1차
결과이고, LLM judge는 모호성·근거 부족 분석을 위한 2차 신호다.

## 설치 (PowerShell)

`experiments/classification_benchmark`에서 독립 가상환경을 사용한다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m ensurepip --upgrade
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

RTX 5060 Ti를 포함한 NVIDIA GPU 환경에서는 PyPI 기본 설치가 CPU wheel을 선택할 수 있다.
이 저장소의 Windows/Python 3.12 검증 환경은 공식 CUDA 13.2 wheel을 사용한다.

```powershell
.\.venv\Scripts\python.exe -m pip install --force-reinstall --no-deps `
  torch==2.13.0 --index-url https://download.pytorch.org/whl/cu132
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

기본 config는 `device=cuda`를 강제하므로 CUDA가 없으면 CPU로 조용히 전환하지 않고 즉시
실패한다. CPU benchmark가 필요할 때만 별도 config에서 `device`를 `cpu`로 명시한다.

기존 `.venv-transformers`에서 `No module named pip`가 발생했다면 해당 환경의 Python으로
`-m ensurepip --upgrade`를 먼저 실행하면 된다. 이 프로젝트는 `gtts`를 설치하지 않으므로
기존 환경의 `click` 충돌과 격리된다.

## 실행

```powershell
# 빠른 설정 검증 (다운로드/API 호출 없음)
.\.venv\Scripts\python.exe -m requirement_benchmark.cli validate-config

# 유료 호출 전에 예상 call 수와 token 가정 기반 비용 확인
.\.venv\Scripts\python.exe -m requirement_benchmark.cli estimate-judge-cost

# Hugging Face dataset/model 다운로드, fine-tuning, A/B 결과 생성
.\.venv\Scripts\python.exe -m requirement_benchmark.cli local-ab

# 파이프라인 smoke test: 64 train / 32 validation / 32 test, 1 epoch
.\.venv\Scripts\python.exe -m requirement_benchmark.cli `
  --config smoke-config.json --output-dir reports/smoke local-ab

# 유료 OpenAI Judge 호출. config의 sample 수와 가격 snapshot을 먼저 검토한다.
.\.venv\Scripts\python.exe -m requirement_benchmark.cli judge-ab `
  --local-report reports/latest/local_ab.json `
  --confirm-paid-api
```

평가가 끝나면 `matplotlib.pyplot` 기반 PNG 그래프를 생성한다.

```powershell
.\.venv\Scripts\python.exe -m requirement_benchmark.cli plot-report `
  --local-report reports/gpu-full/local_ab.json `
  --judge-report reports/gpu-full-paired/judge_ab.json `
  --plot-dir reports/gpu-full-paired/plots
```

중단되거나 표본 계약이 변경된 Judge run은 기존 결과를 재사용할 수 있다. A/B는 반드시
같은 prediction ID를 사용하며 model 목록까지 일치하는 기존 verdict만 재사용한다.

```powershell
.\.venv\Scripts\python.exe -m requirement_benchmark.cli judge-ab `
  --local-report reports/latest/local_ab.json `
  --resume-report reports/latest/judge_ab.json `
  --confirm-paid-api
```

결과는 `reports/latest/local_ab.json`, `reports/latest/judge_ab.json`에 생성되며 git에서
제외된다. `BENCHMARK_COMPUTE_USD_PER_HOUR`를 지정해야 로컬 학습 비용 추정치가 0이 아닌
값으로 계산된다. API 비용은 응답의 실제 input/output token usage와 날짜가 기록된 가격
snapshot으로 계산한다.

full run은 CPU에서 오래 걸릴 수 있다. 실행 중에는 모델·epoch 진행 상황을 출력하며 각
모델 완료 시 `partial_<model>.json`을 먼저 저장한다. smoke 결과는 성능 결론에 사용하지
않고 설치와 end-to-end 연결 검증에만 사용한다.

## LangSmith

`.env.example`의 환경변수를 PowerShell 세션에 설정한다. `LANGSMITH_TRACING=true`이면
wrapped OpenAI client가 각 judge 호출의 입력·출력·token usage·latency를 기록한다.
또는 `.env.example`을 `.env`로 복사해 값을 입력하면 CLI가 시작할 때 자동으로 로드한다.
요구사항 문장이 외부 SaaS trace로 전송되므로 실제 고객 데이터 대신 공개 benchmark만
사용한다. 프로젝트의 민감 데이터에는 tracing을 그대로 적용하지 않는다.

## 해석 기준

- F1 bootstrap CI가 0을 포함하면 A/B 우열을 확정하지 않는다.
- McNemar `p < 0.05`는 동일 test row에 대한 오류율 차이의 근거다.
- 더 빠르고 작은 모델이 F1 차이 없이 비슷하면 운영 후보로 우선한다.
- Judge disagreement가 크면 자동 승자를 정하지 않고 해당 sample을 사람이 검토한다.
- 가격은 변할 수 있으므로 유료 실행 전에 `pricing/` snapshot을 공식 가격표와 대조한다.
