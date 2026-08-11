# Router A 재학습 및 승격 계획

## 목적

현재 `LiquidAI/LFM2.5-Encoder-350M-Prompt-Router` zero-shot 결과는 모든 요청을
`REACT_AGENT`로 분류했으므로 운영 후보로 사용할 수 없다. 다만 API 비용이 없고 로컬
latency가 낮다는 장점이 있어, 프로젝트 route 데이터로 한 차례 재학습한 뒤 최종 기각 여부를
판단한다. 운영 배포 목표는 CPU 기반 Vultr RAM 4GB다.

## 데이터 분리

- 기존 `reports/latest/routing_dataset.json` 50건은 frozen test로 유지한다.
- 학습 데이터와 validation 데이터에는 frozen test 문장이나 단순 paraphrase를 넣지 않는다.
- 각 route를 균형 있게 수집하고 한국어·영어, 짧은 요청·장문 요청, 경계 사례를 포함한다.
- `REACT_AGENT`와 `HUMAN_REQUIRED`, `REACT_AGENT`와 `SUPERVISOR`처럼 혼동하기 쉬운
  route 쌍을 집중적으로 보강한다.
- 각 row에는 `prompt`, `label`, `language`, `risk_level`, `source`, `label_reason`,
  `split`, `dataset_version`을 기록한다.
- 실제 고객 문장은 비식별화하고 학습·trace·Git에 개인정보나 secret을 남기지 않는다.

2026-08-11 실행에서는 route당 학습 500건, validation 100건의 Terra 합성 데이터를
사용했다. frozen test와 exact overlap은 없지만 validation도 합성이므로 다음 단계에서
사람 검수 holdout으로 일반화 성능을 다시 확인해야 한다.

## 2026-08-11 실행 판정

- 2,500건 A1: validation macro-F1 `0.518`, frozen-test macro-F1 `0.522`
- frozen-test accuracy `0.540`, HUMAN_REQUIRED recall `0.800`
- route별 최저 F1: REACT_AGENT `0.190`, SUPERVISOR `0.333`
- CUDA p50 `21.7ms`, peak inference VRAM 약 `1,404MB`
- 결론: 단독 운영 승격 보류. 현재 승격 기준에는 미달한다.

학습 곡선이 2,500건에서도 상승 중이므로 바로 기각하지 않고, 경계 사례의 사람 검수
hard-negative와 calibration/cascade 실험을 한 차례 수행한다. 이 실험에서도 각 route F1과
HUMAN_REQUIRED 기준을 넘지 못하면 LiquidAI를 기각한다.

## 학습 절차

1. 현재 zero-shot checkpoint와 결과를 A0 baseline으로 보존한다.
2. LiquidAI custom routing head의 `logits`에 대해 5개 route cross-entropy 학습을 수행한다.
   일반 `AutoModelForSequenceClassification`로 임의 교체하지 않는다.
3. RTX 5060 Ti에서 mixed precision으로 학습하고 seed, model revision, 데이터 버전,
   hyperparameter를 결과에 기록한다.
4. validation set에서 confidence calibration과 abstain threshold를 정한다.
5. frozen test는 최종 A1 평가에 한 번만 사용하고, 결과를 본 뒤 prompt나 데이터를 수정하지
   않는다.
6. A1, GPT-5.6 Luna B, `A1 → low-confidence Luna` hybrid를 같은 test set에서 비교한다.

## 승격·기각 기준

아래 값은 운영 전 합의가 필요한 제안 기준이다.

- macro-F1 `>= 0.80`
- `HUMAN_REQUIRED` recall `>= 0.95`
- 각 route F1 `>= 0.70`
- validation과 test 사이 macro-F1 하락 `<= 0.10`
- 4GB VPS에서 OS와 API process를 포함해 안정적으로 기동하고 OOM이 없어야 함
- target VPS 동시성 1에서 cold start, RSS, p50·p95 latency를 반복 측정

A1이 기준을 충족하지 못하면 LiquidAI 모델은 기각한다. 그다음 후보는 작은 multilingual
encoder에 5-class head를 학습하는 방식으로 제한한다. 우선 검토 후보는
`intfloat/multilingual-e5-small`과
`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`이며, 모델 크기·라이선스·
한국어 성능을 확인한 뒤 하나를 선택해 GPT-5.6 Luna와 동일 조건으로 A/B 평가한다.

## B 모델 변경 영향

Router B는 `gpt-5.4-nano-2026-03-17`에서 `gpt-5.6-luna`로 변경한다. 기존 실행과 같은
token 수를 사용한다고 가정하면 공식 단가 기준 50건 비용은 약 `$0.051748`, 1,000건당
약 `$1.03496`로 예상된다. 이는 실제 재실행 전 추정치이며 응답 token 수에 따라 달라진다.
Luna의 품질 개선 여부와 p95 latency는 새 실행 결과로 판단한다.
