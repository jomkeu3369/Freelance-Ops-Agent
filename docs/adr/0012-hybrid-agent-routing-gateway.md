# ADR-0012: 정책 Gate와 경량 분류기·LLM fallback을 결합한 Agent 라우팅

- 상태: Superseded by [ADR-0015](0015-llm-first-operational-routing.md)
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
→ confidence가 낮으면 GPT-5.6 Luna fallback
→ 여전히 불확실하거나 승인이 필요하면 HUMAN_REQUIRED
```

- Spring은 RBAC, 위임 권한, 비가역 외부 변경, 결제·발행·계약·개인정보 조건을 먼저
  검사한다. Agent 또는 분류기가 이 결정을 완화할 수 없다.
- 기존 LiquidAI zero-shot 구성은 실패 기준선으로 보존하고 추가 LLM Judge 비용을 쓰지
  않는다.
- 새로운 경량 후보 A는 다른 범용 prompt router를 즉시 채택하지 않고, V2 route label이
  부여된 프로젝트 데이터로 학습한 multilingual encoder로 만든다.
- 로컬 후보 A는 label 예시를 검색하는 BM25 lane과 encoder의 semantic route score lane을
  분리하고, 두 lane의 route 순위를 weighted reciprocal-rank fusion(RRF)으로 결합한다.
  서로 다른 BM25 점수와 encoder logit을 직접 더하지 않는다.
- BM25 lane은 versioned 학습 예시의 ID와 label만 반환하며 사용자·workspace 업무 문서를
  route 학습 예시로 자동 편입하지 않는다. 학습·검증·운영 dataset version을 기록한다.
- BM25와 encoder의 1위 route가 불일치하거나 lexical signal이 없거나 calibration threshold를
  통과하지 못하면 로컬 route를 확정하지 않고 LLM fallback으로 abstain한다.
- 위 boundary 조건은 예외 없이 LLM evaluator로 전달한다. LLM evaluator가 거부·timeout·schema
  오류를 반환하거나 스스로 abstain하면 `HUMAN_REQUIRED`로 fail-closed한다.
- LLM evaluator는 one-shot, 무도구, `store=false`, strict structured output으로 실행한다.
  사용자 요청은 instruction이 아닌 untrusted data field로 격리하고, prompt 조작을 탐지한
  verdict는 자동 실행 route로 사용할 수 없다.
- evaluator 출력은 route, abstain, 제한된 reason code와 보조 confidence만 허용한다. 자유
  서술 field를 두지 않아 private system prompt나 사용자 입력을 되말할 출력 통로를 줄인다.
- evaluator system prompt 원문은 repository, OpenAPI, API response, 일반 application log와
  LangSmith trace에 기록하지 않는다. 배포 secret manager로 주입하고 승인된 prompt version과
  SHA-256만 run trace에 기록한다. hash 불일치 시 evaluator를 시작하지 않는다.
- route catalog와 JSON schema의 route 순서는 요청 hash로 결정적으로 회전하여 위치 편향을
  줄인다. 이는 무편향을 보장하지 않으므로 route별 recall, 언어·길이·위험군 slice와 순서
  permutation test를 release gate에 포함한다.
- RRF의 `k`, lane weight, fused score share와 margin threshold는 validation set에서 정하며
  test set을 보고 조정하지 않는다. RRF 점수 자체를 확률로 해석하지 않는다.
- 후보 B는 GPT-5.6 Luna prompt router로 둔다. 기존 GPT-5.4 nano보다 높은 품질을 목표로
  하되 API latency와 비용을 별도로 측정한다.
- 운영 후보는 A와 B 중 하나만 고르는 구조가 아니라, A의 calibrated confidence가 낮을 때만
  B를 호출하는 hybrid cascade다.
- 분류기는 abstain을 지원해야 하며, confidence threshold는 validation set에서 정한다.
- gold label 기반 accuracy, macro-F1과 route별 recall을 주 평가로 사용한다. LLM Judge는
  label 경계와 rationale groundedness를 분석하는 보조 평가이며 정답을 대체하지 않는다.
- Luna는 router B이므로 Judge에서 제외한다. Judge panel은 GPT-5.6 Sol, GPT-5.6 Terra,
  GPT-5.4 nano의 독립 3종으로 구성하고 다수결로 집계한다.

## 평가 설계

다음 네 구성을 같은 frozen test set에서 비교한다.

1. deterministic policy/rule baseline
2. BM25-only example router
3. 프로젝트 데이터로 fine-tuning한 encoder-only A
4. BM25 + encoder weighted RRF
5. GPT-5.6 Luna router B
6. policy Gate + RRF local router + Luna fallback hybrid

필수 지표는 accuracy, macro-F1, route별 precision·recall·F1, `HUMAN_REQUIRED` 누락률,
`SUPERVISOR` 과소 라우팅률, abstain·fallback 비율, p50·p95 latency, throughput, VRAM,
API 비용과 요청 1,000건당 예상 비용이다. test set은 학습과 prompt 조정에 사용하지 않고
한국어 실사용·경계·고위험 요청을 별도 holdout으로 추가한다.

LLM evaluator는 여기에 prompt injection 성공률, private prompt leakage 0건, malformed output,
route-order permutation 일관성, 언어·문장 길이·민감도 slice별 성능 차이를 추가 측정한다.
시스템 프롬프트가 비공개라는 사실을 보안성의 유일한 근거로 사용하지 않는다.

## 실행 환경

- 현재 CPU PC: dataset 검토, label 검증, unit test, 정적 검사, 소형 smoke test, 결과 문서화
- CUDA 작업 PC: encoder fine-tuning, threshold calibration, full inference benchmark,
  batch·VRAM·throughput 측정
- 운영 배포 후보 환경: CPU 기반 Vultr RAM 4GB. 모델만 적재되는지 확인하는 것으로 끝내지
  않고 OS와 API process를 포함한 RSS, cold start, 동시성 1의 p95 latency를 측정한다.
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

