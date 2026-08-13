# ADR-0014: 단일 RAG의 RAPTOR 계층 검색

- 상태: Accepted
- 결정일: 2026-08-13

## Context

라우팅 모델과 다중 Agent를 적용하기 전에 내부 문서 질의에 대한 단일 RAG 기준선이
필요하다. 일반적인 고정 크기 청크 검색만으로는 프로젝트 전체의 공통 주제나 여러
문서에 흩어진 관계를 포착하기 어렵다. 반대로 요약문만 근거로 사용하면 원문 provenance가
끊어지고 LLM이 만든 표현이 독립적인 사실처럼 인용될 수 있다.

기존 answerability 평가에서는 embedding 유사도와 cluster 중심 거리가 검색 후보 탐색에는
도움이 되지만 답변 가능 여부를 단독으로 판정하기에는 부족했다. 따라서 RAPTOR의 cluster를
답변 허용 gate로 오용하지 않고 계층 탐색에만 사용해야 한다.

## Decision

- 단일 RAG는 원문 leaf 청크를 재귀적으로 embedding, clustering, summarization하여
  여러 추상화 level의 tree를 만드는 RAPTOR 구조를 사용한다.
- 질의 시 leaf와 summary node를 함께 검색하는 collapsed-tree 방식을 첫 기준선으로
  사용한다. 선택된 summary node는 descendant leaf로 다시 해석하며 최종 citation과
  Evidence Ledger는 Spring이 소유한 원문 `document_chunk`만 가리킨다.
- summary node에는 `workspace_id`, index snapshot, level, child node, embedding model,
  summary model과 생성 시점을 기록한다. summary는 `knowledge_source_type`이나 source
  authority를 승격하지 않는다.
- clustering과 summarization은 Python Agent가 담당한다. 원문, RAPTOR node, embedding,
  retrieval eligibility, workspace 권한과 운영 검색 API는 Spring이 소유한다. Python은
  `app` schema를 직접 읽거나 쓰지 않는다.
- 현재 `agent_runtime` 전용 pgvector 연결 관리자는 LangGraph runtime 용도이며 RAPTOR
  업무 지식 저장소로 재사용하지 않는다. Agent는 인증된 Spring internal API를 통해
  ingest 작업과 검색을 요청한다.
- K를 LLM이 자유롭게 결정하지 않는다. 최초 구현은 재현 가능한 target cluster size 기반
  spherical K-means를 사용하고, GMM/BIC 등 cluster 선택 방법은 같은 frozen retrieval
  dataset에서 Recall, nDCG, latency와 비용으로 비교한다.
- 검색 결과의 답변 허용은 평균 cosine이나 cluster 중심 거리로 결정하지 않는다. 기존
  결정대로 원문 evidence에 대한 LLM verifier를 최종 gate로 사용하고 근거가 부족하면
  답변을 거부한다.
- index snapshot은 immutable하게 만들고 원문/parser/embedding/summary/publish-policy
  version을 기록한다. 생성 artifact의 편입은 ADR-0009가 Accepted된 이후 해당 publish
  gate를 따른다.

## 초기 처리 흐름

```text
Spring 문서 ingest·권한 검사
→ 의미 단위 leaf chunk와 provenance 생성
→ Agent RAPTOR tree build 요청
→ 재귀 cluster·summary·embedding
→ Spring immutable index snapshot 저장
→ hybrid leaf/summary 검색
→ summary descendant leaf 복원·dedup·rerank
→ LLM evidence verifier
→ 원문 chunk citation을 포함한 답변 또는 거부
```

## Consequences

장점:

- 세부 청크와 문서 전체 맥락을 같은 검색 경로에서 사용할 수 있다.
- 생성 요약을 탐색 보조물로 제한하면서 최종 답변을 원문까지 추적할 수 있다.
- 라우터나 다중 Agent를 붙이기 전에 독립적인 retrieval·grounding 기준선을 평가할 수 있다.
- clustering, summarizer와 embedding provider를 index contract를 바꾸지 않고 교체할 수 있다.

비용과 제약:

- 문서 ingest 시 여러 level의 요약·embedding 호출 비용이 추가된다.
- 원문 변경 시 영향받은 branch와 snapshot을 다시 만들어야 한다.
- summary node가 검색 결과를 오염하지 않도록 source quota, lineage와 평가가 필요하다.
- Python 코어만으로 운영 RAG가 완성되는 것은 아니며 Spring Knowledge schema와 internal
  ingest/search API가 추가로 필요하다.

## Rejected alternatives

- flat chunk RAG만 사용: 단일 문서의 장거리·다중 주제 맥락을 포착하는 기준선이 부족하다.
- summary를 최종 evidence로 인용: 원문 provenance와 authority를 보장할 수 없어 거부한다.
- LLM이 K와 답변 허용 여부를 모두 결정: 재현성과 calibration이 낮고 기존 benchmark
  결과의 역할 경계를 위반하므로 거부한다.
- Python이 `app.document_chunk`를 직접 관리: ADR-0001과 ADR-0005의 권한·서비스 경계를
  위반하므로 거부한다.
