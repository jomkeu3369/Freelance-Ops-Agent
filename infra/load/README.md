# 운영 부하 검증

## 무료 readiness 기준선

```bash
k6 run -e BASE_URL=https://api.freelance-ops.site infra/load/k6-readiness.js
```

5→20→50 RPS로 올리며 오류율, p95와 p99를 측정한다. 이 테스트는 모델을 호출하지 않는다.

## 실제 Agent smoke

```bash
k6 run \
  -e BASE_URL=https://api.freelance-ops.site \
  -e ACCESS_TOKEN=... \
  -e WORKSPACE_ID=... \
  -e PROJECT_ID=... \
  -e ALLOW_PAID_MODEL_CALLS=true \
  infra/load/k6-agent-run-smoke.js
```

기본값은 1 VU·1회이며 유료 호출 확인 변수가 없으면 실행을 거부한다. 운영 부하 테스트는 `VUS`와 `ITERATIONS`를 한 단계씩 올리고 Provider quota와 예산을 함께 확인한다. 토큰과 결과 JSON은 저장소에 남기지 않는다.
