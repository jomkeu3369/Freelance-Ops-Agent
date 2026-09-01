# Local routing resources

`graph.router`의 optional local shadow가 사용하는 배포 snapshot이다.

- `examples.jsonl`: BM25 route examples
- `head.safetensors`: pinned LiquidAI routing head

학습 코드와 후보 결과는 `experiments/routing_benchmark`에 둔다. 검증을 통과한 snapshot만 이
디렉터리로 승격해 운영 코드가 실험 디렉터리에 의존하지 않도록 한다.

현재 head의 학습 이력과 dataset hash는
`experiments/routing_benchmark/reports/2026-08-11-router-head-training/manifest.json`에 있다.
