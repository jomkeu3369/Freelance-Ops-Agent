# 실제 모델의 픽셀 펫 생성과 화면 검증

검증일은 2026-10-19이며, 구현은 [PR #90](https://github.com/jomkeu3369/Freelance-Ops-Agent/pull/90)의 `12ba19c` 기준이다. 이 기록은 소스·모델 호출·합성 계정 화면의 근거다. 운영 배포 완료를 뜻하지 않는다.

## 실제 모델 출력

기존 세 동물 조합 대신 OpenAI Responses의 구조화 출력으로 32×32 픽셀 외형과 성향을 생성했다. 이미지 생성 API를 호출한 결과는 아니다. 모델이 만든 색상표·픽셀 행을 검증한 뒤 SVG로 그린다.

| 항목 | 확인 결과 |
| --- | --- |
| 입력 | 꼼꼼하게 실현 가능성을 판단하는 펭귄 |
| 모델 | `gpt-6.1-sol`, LOW, 기본 서비스 등급 |
| 호출 | 1회, 재시도 없음, 도구 없음 |
| 사전 금액 상한 | USD 0.10 |
| 사용량 | 입력 912토큰, 출력 1,441토큰 |
| 저장소 요율표로 계산한 비용 | USD 0.01623400. 제공사 청구서 확정 금액과 구분한다. |
| 생성 결과 | 종 `펭귄`, 이름 `꼼꼼이`. 남색 몸·하얀 배·주황색 부리와 발을 직접 확인했다. |

정규화한 원본 출력은 [공유 fixture](../../contracts/fixtures/pixel-pet-profile.json)에 보존했다. SHA-256은 `8422e67bbf1abe85d49fd2d19fef8251a36ae8be32907b702fc26d680612aaae`다. Python 검증·Java 왕복·브라우저 렌더링에서 같은 데이터를 사용한다. API 키와 인증 정보는 포함하지 않는다.

실제 호출은 제공자 어댑터·출력 검증·로컬 금액 상한을 통과했다. 운영 계정의 전체 HTTP 경로·청구서·모든 동물의 생성 품질을 한 번의 출력으로 보장하지 않는다. 자동 검사는 추가 유료 호출을 하지 않는다.

## 화면과 조작

계정·API 응답은 합성 데이터이며 외형은 위 실제 모델 출력이다. Next.js 운영 빌드를 로컬 Chrome에서 확인했다. 개발 표시가 있는 화면을 최종 근거로 사용하지 않는다.

| 화면 | 촬영 근거 |
| --- | --- |
| 설명 입력 | [데스크톱](../assets/pixel-pets/input.png) |
| 실제 요청 대기 | [로딩](../assets/pixel-pets/generating.png) |
| 생성 결과·저장 선택 | [데스크톱](../assets/pixel-pets/result.png), [390px](../assets/pixel-pets/mobile.png), [320×568px](../assets/pixel-pets/compact.png) |

- 목록과 생성 화면을 분리하고 하단의 같은 위치에서 생성·대기·저장을 진행한다. 1,440·1,024·390·320px, 밝은·어두운 테마에서 버튼 위치 차이 2px 미만, 높이 44px 이상, 가로 넘침 없음을 확인했다.
- 입력·생성 중·완료 단계의 키보드 초점과 좁은 화면의 이름 표시를 검사했다. 영문 조작 요소와 동작 줄이기 설정도 확인했다.
- 응답 유실·중복 클릭·닫기·새로고침 뒤에는 같은 생성 ID를 조회한다. `UNKNOWN` 결과를 확인할 때 모델을 다시 호출하지 않는다. 실패는 설명을 보존하며 새 생성은 명시적으로 시작한다.
- 저장 재전송·개수 한도·보관·복원·삭제·수정 이력·오래된 목록 응답·다른 계정·작업 공간 격리와 기존 견적 흐름을 함께 검사했다.

## 실행한 검사

| 범위 | 결과와 근거 |
| --- | --- |
| Agent Linux 전체 | 699개 통과. PostgreSQL·OCR 필수 검사 생략 없음, Ruff·mypy·모델 배포 기준·Python SDK·이미지 검사 통과. [CI 39196991554](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/39196991554) |
| Backend Linux 전체 | 696개 통과, 실패·생략 0. 신규 생성 PostgreSQL 검사 7개와 전체 Flyway 검사 포함. 이미지 검사 통과. [CI 39196991575](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/39196991575) |
| Frontend 로컬 | 단위 506개·타입·린트·운영 빌드 통과. 생성·관리·동료 표시·견적 흐름의 Chrome 검사 53개 통과. |
| OpenAPI·인프라·자동화 | 양방향 계약·참조·Compose·배포/복구 회귀와 워크플로 검사 통과. [계약 CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/39196991565), [자동화 CI](https://github.com/jomkeu3369/Freelance-Ops-Agent/actions/runs/39196991585) |

Windows 로컬 Agent 검사는 672개 통과·27개 생략이었다. 생략된 DB·POSIX OCR 검사는 위 Linux CI에서 실행했다. 로컬 Docker Desktop의 엔진 HTTP 500 때문에 Backend DB 검사는 Linux CI 근거를 사용했다. 초기 실패한 테스트용 서명 설정과 사용량 합계 타입은 수정 후 전체 검사를 다시 통과했다.

## 운영 반영 조건

[ADR-0045](../adr/0045-generated-pixel-pets.md)와 [사용 안내](../frontend/CUSTOM_AGENT_PETS.md)를 따른다. Agent → V50 포함 Backend → Frontend 순서로 배포하며 기존 API와 저장 동료는 보존한다. 기본 제공 AI와 서버 모델의 금액 상한이 활성화돼 있어야 생성할 수 있다. Vercel Preview만 배포한 상태에서는 새 Backend 생성 API가 운영에 없으므로 전체 생성 경로를 사용할 수 없다. 운영 반영은 [ADR-0010](../adr/0010-designer-first-frontend-vercel.md)의 Preview 승인 후 진행한다.
