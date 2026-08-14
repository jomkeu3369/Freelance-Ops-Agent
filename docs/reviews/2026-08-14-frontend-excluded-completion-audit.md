# 프론트엔드 제외 V2 완성도 감사

> 감사일: 2026-08-14  
> 기준 commit: `69b33ba` + 현재 working tree  
> 범위: Spring Backend, Python Agent, 계약, 데이터·평가, 운영 기반  
> 제외: React/Next.js 화면, 반응형 UI, Vercel 화면 배포

## 결론

프론트엔드를 제외한 **코드 구현 완성도는 90%**로 평가한다. 초기 재감사 시점의
추정치는 약 83%였고, 이번 작업에서 다음 P0·P1 공백을 보완했다.

- 실제 RS256 위임 token을 사용하는 Internal Tool MockMvc 통합 테스트
- 동일 token의 Spring client → Agent HTTP → Spring Tool HTTP 왕복 계약 테스트
- OpenAI·Gemini 공통 strict schema 기반 bounded ReAct Tool loop
- Tool allowlist, 입력 schema, 동일 호출 반복 차단, model·Tool·token·retry hard budget
- `REACT_AGENT`·`SUPERVISOR` 운영 executor 연결과 실제 web research 호출 비용 차감
- PostgreSQL 연결을 완전히 닫고 새 runtime 인스턴스로 HITL을 재개하는 CI 통합 테스트
- V2 명세 14.4 지표 19종과 route별 recall을 자동 집계하는 versioned 평가 리포터

이 90%는 **운영 출시 완료율**이 아니다. 현재 PC의 Docker Testcontainers로 Backend의
PostgreSQL 통합 테스트는 실행했지만, Agent의 process-restart HITL 테스트는 별도 DB URL이
없어 로컬에서 실행하지 못했다. GitHub CI 결과도 commit·push 전이므로 아직 존재하지 않는다.
운영 검증 완료도는 이보다 낮게 봐야 한다.

## 산정 기준

각 영역은 V2 명세의 phase 완료 조건, Accepted ADR, 현재 source와 자동 테스트를 대조해
가중치를 부여했다. 구현 의도나 STATUS의 과거 기록만으로는 완료 처리하지 않았다.

| 영역 | 가중치 | 획득 | 현재 증거 | 주요 잔여 공백 |
|---|---:|---:|---|---|
| 아키텍처·보안·멀티테넌시 | 15 | 15.0 | 서비스 경계, workspace RBAC, local auth, key rotation, fail-closed delegation, ArchUnit·보안 테스트 | 원격 secret history scan |
| CRM·견적·Outcome 업무 도메인 | 20 | 19.5 | Client→Project→Requirement→immutable Quotation→Outcome, 결정적 Java 계산, evidence/assumption DB 제약 | 실제 사용자 E2E와 일부 reconciliation |
| Knowledge·Evidence·RAPTOR | 15 | 12.5 | pgvector+FTS RRF, provenance, workspace 격리, Agent RAPTOR tree build | RAPTOR snapshot의 Spring publish·collapsed-tree retrieval |
| Agent·Tool·HITL runtime | 25 | 23.5 | FastAPI/OpenAPI, provider 고정, bounded ReAct, Tool client/server, SSE, hard budget, PostgreSQL store/checkpoint, HTTP 왕복 | 실제 CI PostgreSQL 결과, Spring 상태 reconciliation |
| 평가·calibration·Outcome loop | 10 | 8.0 | routing/retrieval 실험, Outcome 저장, 19개 명세 지표 자동 리포터와 Wilson 95% 구간 | V1~V2 6개 baseline을 동일 frozen set으로 실행 |
| Web research·비용·운영 | 10 | 8.5 | Tavily/direct/PDF, SSRF·injection 방어, quota·비용 원장, Vultr Compose·backup/CD | Tavily·Crawl4AI·direct 동일 corpus benchmark와 restore drill |
| Proposal·선택적 integration | 5 | 3.5 | 만료·폐기 가능한 proposal token, 공개 최소 응답, 고객 decision | PDF export와 우선 MCP connector |
| **합계** | **100** | **90.5 → 90** |  |  |

소수점 합계는 과도한 정밀도를 피하기 위해 90%로 내림 표기한다.

## 이번 검증 결과

| 검증 | 결과 | 해석 |
|---|---|---|
| Backend 전체 Gradle | 91건, 실패 0, 오류 0, skip 0 | pgvector migration과 PostgreSQL Testcontainers 5건까지 실제 통과 |
| 신규 Internal Tool JWT HTTP | 3건 통과 | signature·audience·run binding·감사·Controller 경계 검증 |
| 신규 delegation 왕복 | 1건 통과 | 실제 loopback Agent HTTP와 Spring Tool MockMvc를 동일 token으로 통과 |
| Agent 전체 pytest | 총 152건: 151건 통과, PostgreSQL 재시작 1건 skip | DB URL이 없는 현재 PC에서는 재시작 통합 테스트 미실행 |
| ReAct·provider·executor 대상 | 24건 통과 | OpenAI/Gemini schema, allowlist, 반복·예산, 운영 연결 검증 |
| 평가 리포터 | 4건 통과 | 19개 지표, null 처리, Wilson 구간, JSONL loader 검증 |
| Agent Ruff·strict mypy | 전체 `src`·`tests` Ruff 통과, strict mypy 52개 source 통과 | 현재 working tree 전체 정적 검증 완료 |
| OpenAPI 공식 validator | 2개 계약 통과 | Agent internal API와 Spring Tool API |
| 실제 PostgreSQL | Backend 통합 5건 통과, Agent restart 1건 미실행 | Backend Flyway·pgvector·JPA·RBAC는 검증, Agent 재시작은 CI 증거 필요 |

## 90%에 포함하지 않은 항목

아래 항목은 코드 일부가 있더라도 완료 증거가 부족하므로 남은 10%에 둔다.

1. GitHub CI에서 PostgreSQL process-restart HITL test가 실제 통과한 결과
2. RAPTOR node의 Spring-owned immutable snapshot publish와 collapsed-tree retrieval
3. V1 FAISS, 단순 LLM, 단일 Agent, 계층형 Agent를 같은 frozen dataset으로 비교한 회귀 보고서
4. Tavily·Crawl4AI·direct fetch의 동일 corpus 품질·freshness·비용 benchmark
5. Vultr staging 기동, TLS, backup restore drill과 rollback 실증
6. 최소 10~20건 유료 검증 또는 중단 사유 기록
7. Proposal PDF와 우선순위 MCP connector

## 다음 우선순위

| 순서 | 작업 | 완료 증거 |
|---:|---|---|
| 1 | 현재 변경을 검토·commit한 뒤 CI 실행 | PostgreSQL 재시작 test 포함 모든 필수 check green |
| 2 | Spring RAPTOR snapshot publish·검색 | workspace/snapshot 격리 Testcontainers와 leaf citation 복원 |
| 3 | section 14.4 frozen evaluation 실행 | dataset·prompt·model version과 19개 metric JSON 보존 |
| 4 | Web provider 동일 corpus benchmark | 성공률·freshness·p95·비용 비교표 |
| 5 | Vultr staging/restore drill | runbook 실행 로그와 복구 검증 |

## 평가 리포터 실행

```powershell
cd agent
$env:PYTHONPATH='src'
uv run --locked python -m evaluation `
  --input path\to\frozen-cases.jsonl `
  --output path\to\evaluation-report.json `
  --dataset-version frozen-v1 `
  --evaluated-at 2026-08-14T00:00:00+09:00
```

측정값이 없는 지표는 `0`이나 성공으로 처리하지 않고 `value: null`, `denominator: 0`으로
남긴다. 이 원칙을 유지해야 작은 표본이나 미수집 데이터를 90% 달성 근거로 오용하지 않는다.
