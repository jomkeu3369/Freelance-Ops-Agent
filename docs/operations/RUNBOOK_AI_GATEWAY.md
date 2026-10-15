# AI Gateway 장애 대응

## 증상과 즉시 조치

| 증상           | 신호                               | 먼저 확인할 항목                  |
| -------------- | ---------------------------------- | --------------------------------- |
| 요청 급증      | `GATEWAY_CAPACITY_EXCEEDED`        | 동시 호출·Spring 요청 제한·CPU    |
| 제공사 장애    | `PROVIDER_FAILURE`, `CIRCUIT_OPEN` | 429/5xx·제공사 상태·이용 한도     |
| 모델 정책 오류 | `MODEL_NOT_ALLOWED`                | 배포 허용 목록·선택 모델·가격표   |
| 비용 증가      | 토큰·호출 수 증가                  | 실행 예산·재개·재시도·미확정 예약 |
| 지연 증가      | p95 목표 초과                      | 제공사 지연·네트워크·동시 실행    |

새 배포와 모델·프롬프트 변경을 멈추고 trace ID로 Spring 실행·Agent 로그·활성화한 추적 메타데이터를 대조한다. 제공사 장애를 다른 모델로 자동 전환해 숨기지 않는다. 과부하에서는 요청 제한과 배치·유료 검사 유입을 줄인다. 특정 배포 직후 시작됐다면 해당 서비스의 직전 성공 태그로 복구한다.

프롬프트·고객 입력·API 키·JWT 원문은 로그·이슈에 옮기지 않는다. 개인 키 실행에는 플랫폼 키를 대신 사용하지 않는다. 예약·미확정 비용은 [원장 계약](../testing/platform-usage-api-2026-10-05.md)에 따라 대조하며 장애만으로 수동 환불하지 않는다.

## 진단

호스트에서는 컨테이너 상태와 해당 서비스 로그를 확인한다. 아래 이름은 현재 운영 Compose 프로젝트의 기본 이름이며 실제 `docker ps` 결과와 대조한다.

```sh
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
docker logs --since 20m --timestamps freelance-ops-v2-production-agent-1
```

메트릭 조회는 Docker 내부 네트워크에 연결된 진단 환경에서 실행한다. 일반 호스트 셸에서는 `agent` 서비스 이름을 해석할 수 없다. 배포 설정의 `AGENT_GATEWAY_METRICS_ENABLED`와 인증 토큰이 필요하다. 토큰 값 자체를 명령 이력에 입력하지 않는다.

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $AGENT_GATEWAY_METRICS_BEARER_TOKEN" \
  http://agent:8000/internal/v1/platform/metrics
```

메트릭 설정은 [관측 안내](../../infra/observability/README.md), 서비스별 배포·롤백 명령은 [인프라 안내](../../infra/README.md)를 따른다.

## 복구 확인

- Agent `/health/readiness`와 Spring readiness를 각각 확인한다. Agent `/health`는 프로세스 생존만 검사한다.
- 15분간 제공사 실패·요청 거절·대기열을 [SLO 목표](AI_PLATFORM_SLO.md)와 비교한다.
- 명시적으로 허용한 소규모 실행을 한 번 수행해 종료 상태와 사용량 원장을 확인한다. `k6-agent-run-smoke.js`는 202 접수만 검사하므로 완료·품질의 근거로 사용하지 않는다.
- 감지 시각·영향 범위·원인·완화·재발 방지·검증 결과를 남긴다.

복구를 위해 이용 한도·장애 격리를 동시에 해제하거나 근거 없이 DB·볼륨을 삭제하지 않는다.
