# 문서 안내

현재 사용 안내와 과거 설계·검증 기록을 함께 보관한다. 문서의 날짜나 테스트 수만으로 지금 배포된 기능을 판단하지 않는다.

## 먼저 읽을 문서

| 필요한 내용                   | 문서                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 제품 소개와 로컬 시작         | [저장소 README](../README.md), [Backend](../backend/README.md), [Agent](../agent/README.md), [Frontend](../frontend/README.md)                 |
| 제품 범위와 도메인 규칙       | [V2 명세](V2_SPECIFICATION.md)                                                                                                                 |
| 기술 선택과 변경 이유         | [설계 결정 기록](adr/README.md)                                                                                                                |
| 현재 화면·개인 키·동료 설정   | [프런트엔드 안내](frontend/README.md)                                                                                                          |
| 배포·롤백·백업·복구           | [인프라 안내](../infra/README.md)                                                                                                              |
| CI/CD 구성과 검사 조건       | [워크플로 안내](../.github/CI_CD.md)                                                                                                           |
| 장애 대응과 운영 기준         | [AI Gateway](operations/RUNBOOK_AI_GATEWAY.md), [비동기 실행](operations/RUNBOOK_ASYNC_AGENT_RUNTIME.md), [SLO](operations/AI_PLATFORM_SLO.md) |
| 실험·회귀 검사와 검증 한계    | [검증 기록](testing/README.md)                                                                                                                 |
| 포트폴리오와 공개 화면의 출처 | [기술 사례](portfolio/README.md), [제품 근거](portfolio/product-evidence.md)                                                                   |

## 현재 구현을 읽는 기준

서비스 코드의 현재 계약을 설명한다. 운영 설정값·실제 제공사 이용 권한·배포 버전은 별도로 확인한다.

- 새 분석·개인 키 연결은 **OpenAI만 허용**한다. `GEMINI`는 과거 실행·가격·연결 기록을 읽기 위해 남아 있다. 설정 파일에 Gemini 항목이 있다는 이유로 새 호출을 허용하지 않는다.
- 신규 기본 제공 AI의 사용량은 **USD 예약·정산 원장**과 `/api/v2/me/ai-usage`로 조회한다. 이전 월간 횟수·주간 고정 크레딧 API는 과거 기록과 관리 호환용이다. 운영 비용 지출은 기본 비활성이며, 문서의 예시 한도는 실제 계정의 제공량을 약속하지 않는다.
- 개인 키 실행은 별도 호출·토큰·시간 예산을 사용한다. 현재 경로는 로컬 라우팅과 키워드 검색을 사용하며 플랫폼 키로 자동 전환하거나 추가 유료 검색·임베딩을 호출하지 않는다.
- 나만의 동료는 실제 모델로 픽셀 외형·성향을 생성하고 공통 USD 한도로 예약·정산한다. 입력·생성 중·결과 화면을 구분하고 과거 SVG 동료도 읽는다. 예산 없는 이전 생성 경로와 별도 견적 가정 생성은 차단한다. [동료 사용 안내](frontend/CUSTOM_AGENT_PETS.md)를 따른다.
- 첨부파일은 원본을 보관하지 않고 제한된 텍스트 추출과 로컬 OCR을 제공한다. 읽지 못한 페이지·프레임이 있으며, 이미지의 의미나 전체 문서를 이해했다고 표시하지 않는다.
- `deepagents`는 개발·비교 실험 의존성이다. 운영 부문 실행은 현재 LangGraph와 자체 제한 실행기를 사용한다. [목표 구조](architecture/deep-agents-target-architecture.md)와 연구용 스케줄러의 승격 조건은 구현·운영 승인과 구분한다.

확인 위치는 `Provider`, `AIConnectionService`, `PlatformUsageService`, `ByokExecutionService`, `CustomAgentPetService`, `QuotationAssumptionService`, `agent/src/attachments`와 각 서비스 README다.

## 기록을 보존하는 이유

- `adr/`: 채택·보류·대체 관계를 남긴 설계 기록이다. 채택된 설계도 모든 기능의 구현 완료를 뜻하지 않는다.
- `architecture/`, `implementation/`: 목표 구조와 단계별 구현 기록이다. 연구 결과와 실제 실행 경로를 구분해 읽는다.
- `testing/`, `reviews/`: 당시 코드·환경에서 실행한 검사와 남은 한계다. 생략·미실행·실패는 이후 성공 결과로 덮어쓰지 않는다.
- `assets/`, `testing/ocr-rapidocr-repro/`: 화면 출처와 실험 재현 자료다. 오래됐거나 현재 README에서 빠졌다는 이유로 제거하지 않는다.
- `portfolio/`: 위 기록을 연결한 사례 설명이다. 합성 데이터·로컬 실험·운영 배포의 근거를 각각 밝힌다.

`docs/STATUS.md`는 Git에서 제외한 로컬 작업 기록이다. 공개 문서에 개인 경로, 임시 파일 정리 내역이나 세션 진행 상황을 반복해서 남기지 않는다.
