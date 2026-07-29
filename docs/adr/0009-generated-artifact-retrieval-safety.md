# ADR-0009: 생성 Artifact의 검색 자격과 재귀 오염 방지

- 상태: Proposed
- 제안일: 2026-07-29

## Context

V2는 요구사항, 기술명세와 견적 artifact를 생성하고 과거 프로젝트를
pgvector로 검색한다. LLM 생성 초안을 검증 없이 검색 corpus에 다시 넣으면
오류와 편향이 반복되고, near-duplicate 생성물이 원본과 희귀 사례를
검색 결과에서 밀어낼 수 있다.

이는 model weight를 반복 학습할 때 발생하는 고전적 model collapse와
동일하지 않지만 retrieval corpus contamination, citation laundering과
self-reinforcing feedback를 통해 시스템 품질을 장기적으로 저하시킬 수
있다.

## Proposed Decision

- artifact의 영속 저장과 retrieval publish를 분리한다.
- 모든 LLM 생성물은 기본적으로 `DRAFT` 또는 `QUARANTINED`이며
  `retrieval_eligible=false`로 시작한다.
- schema, root evidence, 개인정보·권한, 중복·lineage 검증과 필요한 HITL
  승인을 통과한 artifact만 versioned index snapshot에 publish한다.
- 고객 원문, 공식 source, 결정적 Tool 결과, actual outcome와 AI-derived
  artifact를 별도 retrieval pool과 authority level로 관리한다.
- AI-derived artifact는 다른 AI artifact만 인용해 evidence를 충족할 수
  없고 원 고객 입력, 공식 snapshot, 결정적 Tool 또는 actual outcome까지
  역추적되어야 한다.
- 현재 run에서 생성한 artifact를 같은 run의 retrieval 대상으로 사용하지
  않는다.
- content hash와 lineage-aware near-duplicate 정책으로 같은 주장과
  paraphrase가 다수의 독립 source처럼 집계되지 않게 한다.
- index는 snapshot, embedding model, parser version과 publish policy
  version을 기록하고 regression evaluation 실패 시 rollback한다.
- vectorstore 내용을 자동 fine-tuning dataset으로 전환하지 않는다.
- retrieval eligibility는 Spring의 결정적 policy와 approval transaction이
  소유하며 LLM이 직접 설정하지 못한다.

세부 lifecycle, metadata, 초기 quota와 감시 지표는
[`LLM 생성 자료 재사용과 재귀 오염 위험 검토`](../reviews/2026-07-29-generated-artifact-recursion-risk-review.md)를
따른다.

## Consequences

장점:

- 생성 초안의 오류가 자동으로 다음 run의 근거가 되는 loop를 차단한다.
- artifact를 audit·revision 목적으로 보존하면서 검색 품질을 별도로
  통제할 수 있다.
- 오염된 artifact와 descendant를 식별하고 index를 rollback할 수 있다.
- actual outcome와 사람의 수정이 높은 authority를 유지한다.

비용:

- artifact lifecycle, provenance, lineage와 index snapshot schema가
  추가된다.
- publish gate와 human approval로 검색 반영이 지연될 수 있다.
- source pool별 retrieval과 dedup 평가가 복잡해진다.
- 기존 artifact를 migration할 때 origin과 root evidence를 재분류해야 한다.

## Rejected alternatives

- 모든 생성 문서를 즉시 embedding: 구현은 단순하지만 재귀 오염과
  citation laundering을 통제할 수 없어 거부한다.
- AI 생성 문서를 전부 폐기: 승인된 명세와 실제 프로젝트 학습 효과까지
  잃으므로 거부한다.
- LLM에게 publish 여부를 판단하게 함: 같은 생성기가 자기 결과를 승인하는
  순환이므로 거부한다.
- 생성 text detector만으로 차단: provenance를 대체할 만큼 신뢰할 수 있는
  보안 경계가 아니므로 거부한다.
