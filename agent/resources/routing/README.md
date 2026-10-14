# 로컬 라우팅 자료

`graph.router`의 선택적 로컬 비교 평가에서 사용하는 배포 자료다.

- `examples.jsonl`: BM25 실행 경로 예제
- `head.safetensors`: 버전이 고정된 LiquidAI 경로 분류 가중치

학습 코드와 후보 결과는 `experiments/routing_benchmark`에 둔다. 검증을 통과한 자료만 이
디렉터리로 승격해 운영 코드가 실험 디렉터리에 의존하지 않도록 한다.

현재 가중치의 학습 이력과 데이터셋 해시는
`experiments/routing_benchmark/reports/2026-08-11-router-head-training/manifest.json`에 있다.
