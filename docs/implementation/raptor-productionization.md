# RAPTOR Productionization

> 기준일: 2026-09-01
> 상태: Spring publish·collapsed-tree retrieval 구현, PostgreSQL CI 검증 대기

## 트랜잭션 경계

RAPTOR build는 외부 embedding·요약 호출이 포함되므로 DB 트랜잭션 안에서 Agent를 호출하지 않는다.

```text
REQUIRES_NEW begin
→ BUILDING snapshot과 원문 fingerprint 커밋
→ transaction 없이 Agent build 호출
→ REQUIRES_NEW publish
   → workspace row lock
   → 현재 원문 fingerprint 재검증
   → node graph와 provenance 검증
   → node 저장
   → 이전 snapshot SUPERSEDED
   → 신규 snapshot PUBLISHED와 active pointer 교체
→ 실패 시 REQUIRES_NEW fail
```

Publish의 node 저장, 이전 snapshot 상태 변경과 active pointer 교체는 한 transaction에서 처리한다.
Agent 장애나 timeout은 열린 DB transaction을 보유하지 않으며, 원문이 build 도중 변경되면 결과를
publish하지 않고 snapshot을 `FAILED`로 종료한다. Workspace row lock은 같은 workspace에서 동시에 끝난
build가 active pointer를 서로 덮어쓰는 것을 직렬화한다.

## 저장과 검색

- `raptor_index_snapshot`: immutable build 단위와 model·원문 fingerprint
- `raptor_node`: leaf·summary node, embedding, child lineage와 원문 provenance
- `raptor_active_snapshot`: workspace별 현재 publish된 snapshot
- 검색은 기존 FTS·leaf vector 결과에 active snapshot의 collapsed-tree 결과를 RRF로 결합한다.
- summary node가 선택되어도 최종 결과는 descendant `document_chunk`만 반환한다.

## 검증

- coordinator에 transaction이 없고 `begin`, `publish`, `fail`만 `REQUIRES_NEW`인지 자동 검사한다.
- Agent 호출이 `begin`과 `publish` 사이에 위치하는지 호출 순서 테스트로 고정한다.
- summary 선택 결과가 원문 leaf chunk로 복원되는지 검색 테스트로 검증한다.
- 실제 PostgreSQL migration과 workspace/snapshot 동시 publish 검증은 Docker가 있는 CI에서 수행한다.
