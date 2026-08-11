# Hybrid routing CUDA benchmark 인수인계

## 목적

CUDA GPU가 있는 작업 PC에서 프로젝트 전용 encoder A를 학습하고, GPT-5.6 Luna B 및
hybrid cascade와 같은 frozen test set으로 비교한다. 세부 결정은
[ADR-0012](../adr/0012-hybrid-agent-routing-gateway.md)를 따른다.

## PC별 역할

| 환경 | 수행 작업 |
|---|---|
| CPU 노트북 | 데이터·label 검토, 테스트, 정적 검사, API router 실행, 결과 해석 |
| CUDA 작업 PC | encoder 학습, calibration, full benchmark, VRAM·throughput 측정 |

## CUDA PC 작업 전 확인

```powershell
nvidia-smi
uv run python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

다음 정보를 결과 JSON에 남긴다.

- Git commit과 dirty worktree 여부
- dataset version과 split hash
- model ID와 revision
- seed, batch size, precision과 warm-up 횟수
- GPU, driver, CUDA와 Torch version
- 학습 시간, peak VRAM, p50·p95 latency와 throughput

## 실험 순서

1. 기존 LiquidAI 결과를 실패 기준선으로 보존한다.
2. 현재 50건 test set을 학습에 사용하지 않는다.
3. 별도의 train·validation 데이터를 구축하고 multilingual encoder를 fine-tuning한다.
4. validation set에서 confidence threshold와 abstain 기준을 결정한다.
5. frozen test set에서 rule, encoder A, Luna B, hybrid를 같은 순서와 seed로 실행한다.
6. `HUMAN_REQUIRED` 누락과 `SUPERVISOR` 과소 분류를 일반 오분류와 별도로 검토한다.
7. Pandas 표, confusion matrix, route별 F1, latency·비용·VRAM 그래프를 생성한다.

## 2026-08-11 실행 상태

- CUDA device와 LiquidAI revision을 `config.json`에 고정했다.
- route별 500건 학습, 100건 검증 데이터와 provenance schema를 생성했다.
- routing head-only 학습과 250·500·1,000·2,500건 learning curve를 완료했다.
- 2,500건 A1은 frozen-test macro-F1 `0.522`, p50 `21.7ms`, inference peak VRAM 약
  `1,404MB`였다.
- 단독 운영 기준에는 미달했으며, 상세 수치는
  [`experiments/routing_benchmark/RESULTS.md`](../../experiments/routing_benchmark/RESULTS.md)에
  기록했다.

## 남은 작업

- 사람 검수 hard-negative와 별도 한국어 holdout을 추가한다.
- confidence calibration 방법과 hybrid fallback threshold를 명세한다.
- `A1 → low-confidence Luna` cascade의 품질·호출률·월 비용을 측정한다.
- Vultr 4GB CPU에서 RSS, cold start, p50·p95와 동시성 1 안정성을 검증한다.

