# Experiments

운영 코드와 분리된 Agent·retrieval 실험 공간이다. 이 폴더의 결과는 자동 회귀 테스트 통과를 의미하지 않는다.

```text
agent_architectures/  초기 ReAct·Supervisor·swarm 비교 script
requirements/         요구사항 분석 ReAct와 Supervisor prompt prototype
retrieval/            pgvector 등 retrieval 실험
local_archive/        로컬 notebook·FAISS 산출물. Git 추적 금지
```

- 실제 API를 호출하는 실험은 비용, provider, model과 실행 시각을 별도로 기록한다.
- `.env`, API key, 실제 고객 데이터와 생성된 vector index를 commit하지 않는다.
- 자동화 가능한 검증은 해당 서비스의 test suite로 승격한다.
