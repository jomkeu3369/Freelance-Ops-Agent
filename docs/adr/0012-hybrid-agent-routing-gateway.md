# ADR-0012: 정책 Gate와 경량 분류기·LLM fallback을 결합한 Agent 라우팅

- 상태: Accepted
- 결정일: 2026-08-10

## Context

Agent 실행 전에 요청을 `DIRECT_TOOL`, `SIMPLE_LLM`, `REACT_AGENT`, `SUPERVISOR`,
`HUMAN_REQUIRED` 중 하나로 보내는 앞단 라우팅이 필요하다. 모든 요청을 무조건 LLM이나
Supervisor에 전달하면 비용과 latency가 증가하고, 권한·고위험 요청을 생성 모델 판단에만
의존하게 된다.

첫 benchmark에서 `LiquidAI/LFM2.5-Encoder-350M-Prompt-Router`를 긴 route 설명과 함께
zero-shot으로 사용한 결과, 균형 test set 50건을 모두 `REACT_AGENT`로 분류했다. Accuracy
0.20, macro-F1 0.067이므로 이 구성은 운영 후보에서 제외한다. 이 결과는 해당 zero-shot
구성이 실패했다는 뜻이며 모든 encoder 분류기가 부적합하다는 뜻은 아니다.

현재 노트북에는 CUDA GPU가 없지만 다른 작업 PC에는 CUDA GPU가 있다. 데이터 검토와
CPU smoke test는 현재 PC에서도 가능하지만, encoder fine-tuning과 full benchmark는 CUDA
작업 PC에서 수행하는 것이 효율적이다.

## Decision

앞단 라우터를 단일 모델이 아니라 다음 단계형 gateway로 구성한다.

```text
사용자 요청
→ Spring 권한·고위험 정책 Gate
→ 프로젝트 전용 경량 분류기
→ confidence가 충분하면 실행 route 확정
→ confidence가 낮으면 GPT-5.6 Terra fallback
→ 여전히 불확실하거나 승인이 필요하면 HUMAN_REQUIRED
```

- Spring은 RBAC, 위임 권한, 비가역 외부 변경, 결제·발행·계약·개인정보 조건을 먼저
  검사한다. Agent 또는 분류기가 이 결정을 완화할 수 없다.
- 기존 LiquidAI zero-shot 구성은 실패 기준선으로 보존하고 추가 LLM Judge 비용을 쓰지
  않는다.
- 새로운 경량 후보 A는 다른 범용 prompt router를 즉시 채택하지 않고, V2 route label이
  부여된 프로젝트 데이터로 학습한 multilingual encoder로 만든다.
- 후보 B는 GPT-5.6 Terra prompt router로 둔다.
- 운영 후보는 A와 B 중 하나만 고르는 구조가 아니라, A의 calibrated confidence가 낮을 때만
  B를 호출하는 hybrid cascade다.
- 분류기는 abstain을 지원해야 하며, confidence threshold는 validation set에서 정한다.
- gold label 기반 accuracy, macro-F1과 route별 recall을 주 평가로 사용한다. LLM Judge는
  label 경계와 rationale groundedness를 분석하는 보조 평가이며 정답을 대체하지 않는다.
- Terra가 router이면서 Judge인 자기평가 결과는 ensemble의 독립 표로 취급하지 않고 참고용
  진단으로 분리한다.

## 평가 설계

다음 네 구성을 같은 frozen test set에서 비교한다.

1. deterministic policy/rule baseline
2. 프로젝트 데이터로 fine-tuning한 encoder A
3. GPT-5.6 Terra router B
4. policy Gate + encoder A + Terra fallback hybrid

필수 지표는 accuracy, macro-F1, route별 precision·recall·F1, `HUMAN_REQUIRED` 누락률,
`SUPERVISOR` 과소 라우팅률, abstain·fallback 비율, p50·p95 latency, throughput, VRAM,
API 비용과 요청 1,000건당 예상 비용이다. test set은 학습과 prompt 조정에 사용하지 않고
한국어 실사용·경계·고위험 요청을 별도 holdout으로 추가한다.

## 실행 환경

- 현재 CPU PC: dataset 검토, label 검증, unit test, 정적 검사, 소형 smoke test, 결과 문서화
- CUDA 작업 PC: encoder fine-tuning, threshold calibration, full inference benchmark,
  batch·VRAM·throughput 측정
- 두 PC는 같은 Git revision, dataset version, seed, Python·Torch lock과 model revision을
  사용한다.
- 결과에는 OS, CPU, GPU 이름, CUDA·driver·Torch version, precision, batch size와 warm-up
  조건을 기록한다.
- CPU와 CUDA latency는 같은 표에서 실행 환경을 명시하고, 하드웨어가 다른 수치를 모델
  성능 차이로만 해석하지 않는다.

## Consequences

### 장점

- 명확한 요청은 로컬에서 빠르고 저렴하게 처리하고 어려운 요청에만 API 비용을 사용한다.
- 권한과 고위험 판단을 생성 모델보다 앞에서 강제할 수 있다.
- encoder, Terra 단독, hybrid의 품질·비용 trade-off를 포트폴리오에서 설명할 수 있다.
- CUDA 작업 PC를 활용해 로컬 모델의 현실적인 학습·처리량을 검증할 수 있다.

### 비용과 제약

- 신뢰할 수 있는 학습·validation·test label을 직접 구축해야 한다.
- threshold와 abstain 정책을 잘못 설정하면 Terra 호출이 과도하거나 위험 요청을 잘못
  자동화할 수 있다.
- 두 PC의 하드웨어 차이 때문에 latency 결과에는 환경 metadata와 반복 측정이 필요하다.
- hybrid는 단일 모델보다 구현과 관측성이 복잡하므로 각 단계의 결정 근거와 fallback 원인을
  trace에 남겨야 한다.

