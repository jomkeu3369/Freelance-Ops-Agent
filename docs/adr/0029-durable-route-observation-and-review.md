# ADR-0029: Routing 관측과 Human Review는 내구성 있는 비동기 projection으로 운영한다

- 상태: Accepted
- 결정일: 2026-08-27
- 관련: [ADR-0028](0028-trusted-contract-routing-fast-path.md)

## Context

라우팅 정책을 실제 traffic으로 평가하려면 모든 `route.selected` 결과와 human gold label이
필요하다. SSE relay나 UI 구독에 수집을 연결하면 사용자가 화면을 열지 않은 run이 누락되어
selection bias가 발생한다. Agent event DB를 Spring이 직접 읽으면 두 서비스의 저장소 경계와
배포 독립성도 깨진다.

운영 승격 기준은 accuracy만이 아니라 위험 route 표본, false automation Wilson 상한,
workspace/project grouped holdout을 요구한다. 따라서 일회성 로그 export가 아니라 재시도와
증분 cursor가 있는 지속적인 수집 경로가 필요하다.

## Decision

- Agent는 run-scoped delegation token으로만 읽을 수 있는 유한 snapshot API를 제공한다.
- Spring은 `agent_run` 생성 transaction 뒤 DB trigger로 별도 수집 queue row를 만든다.
- 수집기는 SSE 구독과 무관하게 queue를 claim하고 `(run_id, event_id)` cursor로 증분 조회한다.
- claim은 2분 lease와 attempt 번호를 사용한다. stale worker의 결과는 저장하지 않는다.
- `(agent_run_id, agent_event_id)` unique key로 at-least-once 전달을 멱등하게 만든다.
- raw prompt와 requirement는 저장하지 않고 명시적 route telemetry allowlist만 projection한다.
- 수집기는 회차당 최대 20건을 Java virtual thread로 병렬 조회한다.
- 기능은 `AGENT_ROUTE_OBSERVATION_COLLECTION_ENABLED=true`일 때만 활성화한다.
- reviewer API는 workspace RBAC의 `agent.route.review` 권한을 요구한다.
- 한 reviewer는 observation마다 immutable blind vote를 한 번만 기록하며 workspace scope를 벗어난
  ID는 404로 숨긴다.
- reviewer는 POST claim으로 15분 lease를 얻는다. PostgreSQL `FOR UPDATE SKIP LOCKED`로
  동시 검토자에게 같은 observation이 배정되지 않게 하고, 만료 전 claim owner만 제출할 수 있다.
- review queue는 자연 traffic과 위험 stratum을 50:50으로 교차 제공한다. 위험 stratum은
  `REACT_AGENT`, `HUMAN_REQUIRED`, 또는 shadow/actual disagreement다.
- 위험 stratum은 두 blind vote가 같아도 100% senior audit하고, 자연 stratum은 기본 50%를
  blind dual review한다. Dual-reviewed natural 중 5%도 합의 후 senior audit해 공통오류를
  측정한다. 비율은 환경 설정으로 조정한다.
- adjudication item은 일반 claim에서 제외하고 OWNER·ADMIN의 `agent.route.adjudicate` 권한과
  별도 claim/context API를 통해서만 최종 판정한다. 반복 claim도 상태별 활성 lease만 반환한다.
- traffic-weighted 품질·비용은 동일 export 기간 전체 observation의 natural/risk prior로
  review holdout을 사후층화해 계산한다. 위험 oversample의 raw count는 route별 안전성 evidence로
  별도 유지한다.
- backlog·oldest lag·성공/재시도·review claim/완료는 workspace label 없는 Micrometer metric으로
  관측한다.
- OWNER·ADMIN 전용 canary aggregate API는 고정 canary 시작 시각과 사전 등록된 14개
  checkpoint와 두 stratum, 총 28 looks의 첫 N개 consensus audit만 사용한다. Bonferroni
  alpha-spending adjusted Wilson
  구간으로 optional stopping을 통제하고, 두 stratum이 모두 `ACCEPT`일 때만 gold 품질 gate를
  통과한다. Reviewer ID와 개별 vote는 응답하지 않는다.
- `data.export` 권한의 평가 export는 최대 90일 `since/until`, 고정 `captured_at snapshot`,
  `(occurred_at, observation_id)` keyset cursor를 사용한다. Snapshot 이후 capture와 review 완료는
  제외해 모든 페이지가 하나의 불변 cohort를 나타내게 한다.
- Routing evaluator 비용은 event 발생 시점에 적용되는 workspace model pricing snapshot으로
  계산한다. 가격 또는 evaluator identity가 불완전하면 0원으로 대체하지 않고 export를 실패시킨다.

## Consequences

### 장점

- UI 접속 여부와 무관한 전체 run 관측이 가능하다.
- Agent/Spring 저장소 경계를 유지하면서 장애 후 cursor 재개가 가능하다.
- 500ms snapshot latency 가정에서도 현재 동시성 20은 약 800건/분의 이론 처리량을 제공한다.
- 희소 위험 route의 evidence 확보량을 자연 표본만 사용할 때보다 73.8% 줄일 수 있다.

### 비용과 제한

- Spring DB에 queue와 allowlisted projection 저장 공간이 추가된다.
- 50:50 review 결과를 그대로 전체 traffic 지표로 평균하면 편향된다.
- 90:10 traffic을 50:50으로 검토한 시뮬레이션에서 단순 accuracy MAE는 5.51%p였고
  사후층화 후 0.27%p였다. 보정 후 effective sample size 감소도 승격 gate에 반영해야 한다.
- 현재 수치는 결정적 부하 모델 결과이며 네트워크 오류·DB lock 경합을 포함한 production
  soak test를 대체하지 않는다.
- 실제 human-reviewed production trace가 승격 gate를 통과하기 전 local/shadow router는
  자동 실행 결정을 내리지 않는다.

## 검증 근거

- [실서비스 Routing 관측·검토 파이프라인](../testing/routing-production-shadow-collector-2026-08-27.md)
- [Shadow Routing 운영 수집·검토 용량 연구](../testing/routing-shadow-collection-capacity-2026-08-27.md)
- [Routing Human Review 동시성 연구](../testing/routing-review-claim-concurrency-2026-08-27.md)
- [Routing Gold Label Consensus 연구](../testing/routing-review-consensus-2026-08-27.md)
- [Routing Review 공통오류 Robustness 연구](../testing/routing-review-consensus-robustness-2026-08-27.md)
- [Routing Review Canary 판정력 연구](../testing/routing-review-canary-power-2026-08-27.md)
- [Routing Review 순차 Canary 판정 연구](../testing/routing-review-canary-sequential-2026-08-27.md)
- [Routing Review 표본 편향 보정 연구](../testing/routing-review-sampling-bias-2026-08-27.md)
- [Routing Review 고정 Cohort Export 연구](../testing/routing-review-export-cohort-2026-08-27.md)
- `experiments/routing_benchmark/reports/2026-08-27-route-collector-capacity/`
