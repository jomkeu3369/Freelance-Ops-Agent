# 운영 부하 검증

## Readiness 기준선

```bash
k6 run --no-usage-report --summary-export output/k6-readiness.json \
  -e BASE_URL=http://127.0.0.1:18080 infra/load/k6-readiness.js
```

5→20→50 RPS로 올리며 80초 동안 오류율, p95와 p99를 측정한다. 기본 대상은 loopback이며 모델을 호출하지 않는다. 결과 디렉터리는 실행 전에 생성한다. 원격 서버는 테스트 대상·부하 범위가 정해진 경우에만 `BASE_URL`로 명시한다.

HTTP 오류율 0.5% 미만, p95 500ms 미만, p99 1,000ms 미만, body의 `status=UP`, 요청 누락 0건을 모두 요구한다. JSON이 아닌 응답이나 HTTP 200의 `DOWN`도 실패다. 이는 health endpoint의 응답 성능이며 DB·LLM 업무 처리량을 뜻하지 않는다.

## 합성 데이터 기반 업무 API 기준선

```bash
k6 run --no-usage-report --summary-trend-stats 'avg,min,med,max,p(90),p(95),p(99)' \
  --summary-export output/k6-business.json \
  -e BASE_URL=http://127.0.0.1:18080 -e PEAK_RPS=50 \
  infra/load/k6-business-readiness.js
```

별도 일회용 PostgreSQL에 연결한 loopback Spring API만 허용한다. 이 suite는 setup에서 합성 계정·workspace 2개, 고객 2개, 프로젝트 31개를 생성하므로 기존 개발 DB에 실행하지 않는다. 종료 후 검증 환경의 DB 전체를 폐기한다. 토큰은 실행 메모리에서만 사용하며 결과·로그·metric tag에는 저장하지 않는다. Agent·provider API는 호출하지 않는다.

- 140초 동안 5→20→`PEAK_RPS`로 증가하고 최고 부하를 60초 유지한다. `PEAK_RPS`는 1~100 정수다.
- `/me`, 프로젝트 목록·검색·상세, 고객 목록과 다른 workspace·다른 workspace resource·비인증 접근을 각각 같은 비율로 호출한다.
- 8개 경로 중 정상 업무 조회가 5개, 예상 401/404가 3개다. 따라서 최고 50 RPS는 정상 조회 약 31.25 RPS + 접근 차단 약 18.75 RPS의 **혼합 트래픽**이다.
- 정상 응답은 fixture identity와 workspace를 확인한다. 검색은 30개 중 1개만 일치하도록 검증하고 거부 응답에는 fixture 비공개 marker·토큰·요구사항·stack trace가 없는지 확인한다.
- 각 경로가 실제 호출되어야 하며 각 API별 p95 <500ms, p99 <1,000ms를 요구한다. 전체 HTTP 오류율 <1%, checks 100%, dropped iteration 0건도 필요하다. 예상 401/404만 요청별 성공 응답으로 인정한다.

이 지연 기준은 초기 로컬 점검 기준이며 사용자 규모에 맞춰 확정한 운영 SLO가 아니다. 작은 fixture, 짧은 실행, 정상 조회 중심의 결과를 대규모 DB·로그인·견적 쓰기·SSE·실모델 동시 처리·운영 장기 안정성으로 일반화하지 않는다. setup 등록 요청의 비용은 `scenario:business` latency에서 제외한다.

자동 통과/실패는 check 표시만으로 결정되지 않으므로 [k6 thresholds](https://grafana.com/docs/k6/latest/using-k6/thresholds/)를 함께 사용한다.

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

기본값은 1 VU·1회이며 유료 호출 확인 변수가 없으면 실행을 거부한다. 현재 script는 run 접수 202만 확인하며 완료·HITL·견적 품질을 판정하지 않는다. 운영 부하 테스트는 `VUS`와 `ITERATIONS`를 한 단계씩 올리고 Provider quota와 예산을 함께 확인한다. 토큰과 결과 JSON은 저장소에 남기지 않는다.
