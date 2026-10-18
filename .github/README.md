# CI/CD 구성

서비스별 검사와 배포는 독립적으로 실행한다. 워크플로·job 이름은 기존 상태 검사와 실행 이력의 식별자로 유지한다. 단계 설명과 운영 주석은 한글로 작성한다.

| 워크플로                         | 책임                                                                      |
| -------------------------------- | ------------------------------------------------------------------------- |
| `actions-ci.yml`                 | 워크플로 문법, 셸, 배포 범위·검사 근거·공통 스크립트의 회귀 검사          |
| `agent-ci.yml`                   | Agent 단위·PostgreSQL·OCR 검사, 모델 배포 기준, SDK·Ruff·mypy·이미지 검사 |
| `backend-ci.yml`                 | Spring·Testcontainers·Flyway 검사와 이미지 검사                           |
| `frontend-ci.yml`                | 타입·단위 검사·린트, 합성 Chromium 시나리오와 미리보기 검색 제외 검사     |
| `contracts-compose-ci.yml`       | OpenAPI·Compose, 인프라 셸·배포·백업·복구·개인 키 설정 검사               |
| `agent-cd.yml`, `backend-cd.yml` | 서비스별 이미지 발행, 운영 환경과 배포 직렬화, 수동 복구 진입점           |
| `production-auto-cd.yml`         | main 변경 범위 분류, 관련 CI 통과 후 Agent→Backend 순서로 배포            |

## 실행 조건

- 서비스 CI는 관련 경로의 PR, 자동 배포의 재사용 호출과 수동 실행을 받는다. 종료된 작업 브랜치의 개별 이름을 실행 조건에 추가하지 않는다.
- Frontend의 main push 검사는 유지한다. 합성 브라우저·미리보기 검사는 같은 저장소의 PR과 수동 실행에서만 수행하며 운영 계정·키를 사용하지 않는다.
- `Actions CI`는 `.github` PR을 검사하고 자동 배포에서도 검증 단계로 호출된다. 자동 배포는 이 검사 실패 뒤 서비스를 교체하지 않는다.
- 서버 서비스와 관계없는 `.github` 설명·프런트엔드 검사 변경은 자동화 검사만 실행한다. 서비스 선택은 `scripts/deployment_scope.py`의 규칙을 따른다.
- PostgreSQL 초기화·인프라 Compose 변경은 계약 검사만 선택하며 운영 DB를 자동 변경하지 않는다. 관련 기준은 [ADR-0024](../docs/adr/0024-independent-backend-agent-delivery.md)와 [ADR-0025](../docs/adr/0025-main-ci-gated-automatic-production-delivery.md)를 따른다.

## 공통 처리

`actions/deploy-service`는 SSH 신뢰 설정·파일 전송·서비스 교체를 묶은 로컬 복합 Action이다. Backend만 기존 PostgreSQL 확장 준비와 공개 readiness 검사를 실행한다. 호출 워크플로의 `production` 환경, `v2-production-deploy` 동시 실행 제한, 서비스별 이미지 태그·권한·복구 스크립트는 그대로 사용한다. 토큰은 원격 표준 입력으로 전달한다.

`scripts/with-frontend-server.sh`는 검사 서버 시작·대기·종료를 담당한다. 검사할 명령과 브라우저 시나리오 목록은 Frontend 워크플로에 둔다. `scripts/verify_database_test_reports.py`는 커밋된 필수 검사 소스와 JUnit XML을 대조하며 누락·생략·실패를 거부한다.

## 로컬 검사

```bash
python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v
shellcheck .github/actions/deploy-service/*.sh .github/scripts/*.sh
actionlint
```

셸 회귀 검사는 SSH·Docker·파일 전송·HTTP를 대체한다. Windows에서는 Git Bash를 사용하며 권한 요청 인자를 확인하고, Ubuntu CI에서는 실제 SSH 파일 권한도 확인한다. 실제 서비스 DB·이미지·배포 검사는 각 서비스 CI/CD와 Contracts CI의 결과로 확인한다.

Actionlint는 `1.7.12`와 다운로드 SHA-256을 함께 고정한다. 배포 구성을 바꾸면 공통 Action·분류 스크립트의 경로 필터도 함께 확인한다. 복합 Action의 입력·경로 사용 방식은 [GitHub 공식 문서](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action)를 따른다.
