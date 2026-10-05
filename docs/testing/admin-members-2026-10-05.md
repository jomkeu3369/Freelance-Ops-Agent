# 관리자 회원·로그인 조회

기준: `cfcaeb939129e290e7fbd8ae115414d44f361e5f`.
관리자 화면은 `/admin/members`에 있으며 기존 `/admin` 한도 검토와 `/admin/notices`로 연결된다.

## API와 권한

모든 API는 인증된 UUID 사용자와 DB의 활성 `MEMBERS_READ` 권한을 매 요청마다 확인한다.
workspace OWNER/ADMIN, JWT 역할, FREE_USAGE_ADMIN 또는 NOTICES_ADMIN만으로는 회원을 조회할 수 없다.
계정 비활성화·인증 대기·권한 회수는 즉시 거부한다. 검증한 계정/권한 행을 트랜잭션 종료까지 잠근다.
V46은 capability의 허용 값만 추가하며 어떤 계정에도 권한을 부여하지 않는다.

| API | 내용 |
| --- | --- |
| `GET /api/v2/admin/members?q=&status=&page=0&size=25` | 이메일/이름의 문자 그대로 검색, UUID 일치, 상태 필터, 신규 가입 순 목록 |
| `GET /api/v2/admin/members/summary` | 전체·로그인 가능·인증 대기·최근 7일 가입·최근 7일 로그인한 고유 회원 수 |
| `GET /api/v2/admin/members/{id}` | 계정 메타데이터와 기록된 최근 로그인 |
| `GET /api/v2/admin/login-events?userId=&page=0&size=25` | 전체 또는 회원별 성공한 인증 기록 |
| `GET /api/v2/admin/member-audit-events?page=0&size=25` | 기존 주간 크레딧·이전 월간 한도의 변경/초기화 원본 감사 기록 |

목록은 0부터 시작하는 페이지, 1~100건 크기, 최대 100자 검색을 받는다.
상태는 `ACTIVE`, `DISABLED`, `PENDING_VERIFICATION` 또는 전체다.
동일 시각 항목은 UUID로 순서를 확정한다. 화면은 25건 단위이며 갱신 시 서버를 재조회한다.

## 수집 범위

- 성공한 비밀번호 로그인과 인증 없이 가입 세션이 발급되는 개발 경로를 세션 발급과 같은 트랜잭션으로 기록한다.
- 이벤트는 임의 UUID, 사용자 UUID, 방식(`PASSWORD`/`REGISTRATION`), 시각만 보관한다.
- 실패한 로그인, 토큰 갱신, 이메일 확인만 한 행위는 로그인 이벤트를 만들지 않는다.
- 기록 시작 시각을 V46에서 남긴다. 과거 세션이나 가입 시각으로 로그인 기록을 추정하지 않는다.
- IP, User-Agent, 비밀번호/해시, API 키, 세션 토큰, 개인 채팅, 프로젝트 내용은 관리자 응답에 포함하지 않는다.
- 성공 로그인 이벤트 보존 기간의 운영 정책은 아직 정해지지 않았다. 자동 삭제 작업은 포함하지 않는다.
- 회원 삭제·정지·권한 부여 API는 제공하지 않는다. 현재 페이지의 동작은 모두 GET이다.

## 과금 경계

기존 `/admin`의 FREE_USAGE_ADMIN 인가, 변경 전 확인, 낙관적 버전 검사와 원자적 감사 기록을 유지한다.
이 작업에서 실제 한도 수정·일괄 초기화·운영 데이터 변경은 실행하지 않는다.
과거 정수 크레딧과 월간 횟수를 USD 또는 새 비율로 환산하지 않는다.
회원별 신규 USD 사용량은 별도 작업의 `PlatformUsageService` 조회 계약과 통합한다.

## 검증

- AuthService 단위 검사: 가입/로그인 기록, 실패/refresh 제외.
- AdminMemberService 단위 검사: 모든 조회의 우선 인가, 권한 없는 경우 데이터 조회 금지, 페이지/검색/상태 제한.
- AdminMemberPostgresTest: 임시 PostgreSQL에 생성한 가상 회원만 사용. 권한·검색·페이지·통계·롤백·비밀정보 제외·감사 불변성 검사.
- Chrome Playwright: 가상 API 응답으로 검색·페이지·회원별 로그인·403·권한 회수·감사·모바일·세션 만료 후 늦은 응답 검증.
- 실제 외부 API, 운영 데이터, 이메일, 운영 배포는 사용하지 않는다.

이 Windows 환경은 Docker daemon이 없어 PostgreSQL 통합 검사를 건너뛴다.
Gradle test worker는 저장소 README의 ASCII 드라이브 우회로 실행한다.
최종 실행 결과와 원격 SHA는 작업 결과 보고에 기록한다.
