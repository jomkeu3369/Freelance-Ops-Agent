# OCR 구조 수정 검증 — 2026-10-07

후속 전체 CI 검증: 이 문서의 559개는 선택한 로컬 검사이며 전체 DB/native 무스킵 검증 또는 merge 준비 완료를 뜻하지 않는다. 기존 Agent/backend/frontend/contracts CI에 해당 작업 브랜치만 허용해 전체 검증을 추가한다. 결과는 정확한 작업 SHA의 GitHub Actions job 및 JUnit evidence gate로 확인한다. 아래의 run0 기록은 그 시점의 과거 SHA에 대한 조회다. 모델 후보의 탈락 결론은 유지하며 재실험하지 않는다.

운영 기준 소스 `988d7581e857ec74c0415a269939a9681d8c920a`와 수정 소스 `aa1fa8bc1707d7c8763d7ac8dd153f6eb79cfc34`를 각각 실제 `agent/Dockerfile`로 빌드했다. 격리 작업 브랜치 `codex/ocr-language-layout-coverage-20261007`만 변경했으며 main, 로그인 작업 브랜치, 운영 서버·DB·인증·비용 설정은 변경하지 않았다. 설계 및 배포 순서는 [설계 보고서](ocr-coverage-design-2026-10-07.md)를 따른다.

## 결과

기본 설정의 기존 19개 입력(18개 이미지와 30페이지 PDF)은 각 3회, 총 57쌍의 비교에서 텍스트·status·성공 여부·오류가 동일했다. 하이브리드 PDF의 스캔 본문 누락은 별도 합성 대조 자료에서 복구됐다. 기본 언어 `eng+kor`와 PSM 3을 유지하고, 요청에 명시된 `ko/en/mixed`, `general/singleblock`만 허용한다. 자동 엔진 전환이나 자동 언어 추정은 추가하지 않았다.

| 합성 PDF, 각 3회 | 기존 CER / WER | 수정 CER / WER | reader 중앙값 기존 → 수정 |
| --- | --- | --- | --- |
| 스캔만 있음 | 0% / 0% | 0% / 0% | 0.913 → 0.889초 |
| 제목 + 큰 스캔 본문 | 96.05% / 96.15% | 0% / 0% | 0.357 → 0.909초 |
| 긴 native 서문 + 큰 스캔 본문 | 8.88% / 12.20% | 0% / 0% | 0.368 → 0.916초 |
| native 텍스트만 있음 | 0% / 0% | 0% / 0% | 0.366 → 0.361초 |
| native 텍스트 + 작은 로고 | 0% / 0% | 0% / 0% | 0.354 → 0.356초 |
| native OCR layer + 같은 스캔 | 0% / 0% | 0% / 0% | 0.348 → 0.903초 |

마지막 대조는 중복 본문을 추가하지 않았지만 큰 raster 검사·OCR 비용이 늘었다. 긴 서문 대조의 native 서문은 합성 invisible text이므로, 실제 문서에서 OCR/native 중복을 일반적으로 해소했다는 의미는 아니다. 추가 OCR은 원래 텍스트와 구분해 보이고, 문자 포함 native 전체와 일치하는 OCR 선두 부분만 공백 토큰 비교로 1회 제거한다. 숫자만 있는 native, fuzzy matching, 전역 반복 제거는 사용하지 않는다. 남는 겹침은 preview에 명시한다.

| 입력, 각 3회 | 기본 mixed / PSM 3 CER | 명시 옵션 CER | 명시 옵션 WER |
| --- | --- | --- | --- |
| 깨끗한 한글 | 65.98% | ko / PSM 6: 0% | 0% |
| 작은 한글 | 74.23% | ko / PSM 6: 0% | 0% |
| 깨끗한 한글 | 65.98% | mixed / PSM 6: 25.77% | 133.33% |
| 깨끗한 혼합 | 24.17% | mixed / PSM 6: 23.33% | 125% |
| 작은 혼합 | 55% | mixed / PSM 6: 30% | 115% |
| 90도 회전 혼합 | 89.17% | mixed / PSM 6: 116.67% | 320% |

CER/WER에는 삽입 오류가 포함되어 100%를 넘을 수 있다. 동일 문구 반복은 시간 측정 반복이지 독립 문서 수가 아니다. 기존 자료는 독립 원문 3개를 변형한 좁은 합성 자료이므로 엔진 교체 근거로 일반화하지 않는다. PSM 6의 회전 자료 악화와 mixed 한글 분절 오류 때문에 기본값을 일괄 변경하지 않는다.

## 읽기 범위와 오류

30페이지 PDF는 원래 제한대로 1·15·30페이지만 OCR했다. 수정 결과는 30개의 coverage 항목을 반환한다. 영어 10페이지 중 1개, 한글 10페이지 중 0개, 혼합 10페이지 중 2개를 시도했다. 샘플링에서 제외된 27개를 정확도 성공으로 세지 않는다. 이 PDF의 전체 CER/WER는 계산하지 않았다. 집계 CSV의 빈 CER/WER는 기준 문자열을 지정하지 않았다는 뜻이며 0%가 아니다.

전체 비교는 171회(기존 75회, 수정 96회)다. 36MP 이미지의 `UNREADABLE_FILE` 6회는 각 버전에서 3회씩 발생한 입력 한도 거절이다. 유효한 15도 회전 이미지의 빈 OCR 결과는 호출 완료·텍스트 없음으로 기록되고, 문서 전체를 읽었다고 간주하지 않는다. 현재 비교에서 native timeout, CPU kill, OOM을 관측하지 않았으며, 이것이 모든 입력의 자원 안전을 증명하지는 않는다.

per-page/frame coverage는 native/raster 상태, OCR 시도·완료·결과, 사유를 분리한다. 초기화 실패는 실제 unit OCR을 시도한 것으로 표시하지 않는다. native 및 앞선 OCR 텍스트는 정상 처리되는 부분 실패에서 보존된다. worker/API hard kill과 문자 한도 초과는 기존처럼 오류 종료할 수 있다. 기존 저장 JSON의 누락 필드는 mixed/general/빈 coverage로 호환되며 빈 coverage를 완전한 읽기 증거로 해석하지 않는다.

## 환경 및 측정

- Windows 5FPC098의 기존 Docker Desktop Linux/WSL2 x86_64, CPU quota 1, 컨테이너 메모리 640MiB, pids 256, root filesystem read-only, `/tmp` 256MiB, network none, app UID 10001. 모든 OCR 평가를 순차 실행했다.
- source Dockerfile의 Python 3.12.15, Debian trixie, Tesseract 5.5.0-1+b1, Poppler 25.03.0-5+deb13u4, Pillow 12.3.0, pypdf 6.16.1. eng/kor traineddata 1:4.1.0-2. 운영에 배포된 이미지 digest는 확인하지 못했으므로 동일 소스 Dockerfile 재빌드 조건의 결과다.
- eng SHA256 `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`; kor SHA256 `6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2`.
- worker AS 512MiB, CPU 12초, FSIZE 0, API 15초, native command 3초, attachment OCR shared budget 8초, max OCR 3units, OMP 1 유지. 수정 비교의 `/proc` worker/native 관측 242건은 모두 AS/CPU/FSIZE 설정과 일치했다. 20ms 주기 관측은 매우 짧은 프로세스를 놓칠 수 있다.
- 2MiB/file, 6files/8MiB total, 40k chars, PDF 30pages, image 60frames, 16MP/frame·32MP aggregate, max edge 2000, worker 2slots는 변경하지 않았다.
- `reader_wall_sec`는 실제 `run_reader` 호출부터 worker 완료까지다. worker 생성, 엔진 언어 확인, 매회 새 native Tesseract의 모델 초기화, PDF 렌더·이미지 전처리를 포함한다. 별도 parent 시간은 API 모듈 import·시험 wrapper까지 포함한다. phase별 초기화 시간은 이번 reader 비교에서 분해 측정하지 않았다. 초기화 시간 칸의 0은 측정하지 않은 placeholder여서 초기화 무료라는 뜻이 아니다. 새 프로세스 실행을 cold process로 기록하며 OS 파일 cache를 비우지는 않았다.
- CER: 공백을 한 칸으로 정규화한 문자 edit distance / reference 문자수; WER: 같은 텍스트의 공백 word edit distance / reference word수. Page/Frame/native/additional OCR 표지 줄만 제거한다. 대소문자·문장부호·숫자는 그대로 비교한다. p95는 nearest rank이며 n=3에서는 최대값이다. 선택·제외 사유는 정확도와 별도로 집계했다.

## 검증 및 재현 자료

Python focused 100, frontend unit 355, Java 관련 81회가 모두 통과했다. Ruff, mypy(관련 7파일), TypeScript typecheck, ESLint도 통과했다. Java21/Gradle9.6.1에서 모든 main/test class가 compile됐다. Next.js 16.3.6 production build(webpack) 및 production UI attachment browser 23개도 통과했다(1.5분). 새 OCR 옵션/coverage/취소 2개와 기존 21개를 포함한다.

선택한 테스트 총 559개이며 저장소 전체 테스트라는 뜻은 아니다. Python은 `test_attachment_coverage.py`39/`test_attachment_ocr.py`26/`test_attachments.py`35, 100개 모두 pass/skip0(기존 FastAPI TestClient deprecation warning1개). Java는 ArchitectureTest8/AgentRunGatewayServiceTest18/AgentRunHistoryServiceTest42/ChatAttachmentServiceTest13, 81개 pass/skip0다. frontend `npm test` 전체 unit355 pass/skip0, attachment browser23 pass다. 실제 OCR 171회 비교와 candidate 자원 probe는 이 단위/브라우저 시험 개수와 별도다.

저장소 CI와 같은 `openapi-spec-validator`로 Agent internal 및 Spring tool OpenAPI 계약 2개 모두 OK를 확인했다. 검사 컨테이너의 read-only home/noexec 임시 도구 경로 문제는 임시 `/tmp` 도구 경로와 module 실행으로 해결했으며 호스트·운영 환경을 변경하지 않았다. 최종 변경 Python lint와 oversized fixture 변경 후 frontend lint도 통과했다.

구조 수정 및 검증 백업 SHA `2e487d253db1a4efd7fe6bdd3fefd40d8b5d9e2f`에 대해 GitHub Actions REST 조회(`head_sha` filter, 2026-10-07 14:23 KST) 결과 run0개를 확인했다. Agent/backend/frontend/contracts의 기존 push branch 필터에 이 작업 브랜치가 없고 PR/수동 CI 실행을 생성하지 않았다. **이 보고서의 pass는 로컬 Linux Docker 검사 결과이며 원격 CI 통과를 주장하지 않는다.**

개발 UI 검사에서는 기존 preview 코드의 Strict Mode effect 재실행을 test fixture가 1회만 가정한 5개 실패와 2MiB buffer CDP 전달 시간 초과 1개를 확인했다. preview 코드는 기준 main과 동일하며 production UI에서는 5개 모두 통과했다. oversized fixture는 실제 파일 선택 경로로 바꾸어 동일 2MiB+1byte 입력을 검증했고 production에서 2.6초에 통과했다. 개발 모드 fixture의 1회 가정 자체는 변경하지 않았다. UI 전용 환경은 Node22.23.3/Playwright1.63.0/Chromium153, CPU1·memory3GiB, ephemeral writable filesystem, 외부 요청 abort fixture, Docker bridge였다. OCR 평가의 640MiB·read-only·network none 조건과 다르다. 초기 2GiB 컨테이너 부족 및 1GiB Node heap 부족도 검사 환경 실패로 구분하고 작업 전용 컨테이너만 종료했다.

테스트에는 실제 Linux worker에서의 제목·긴 서문 hybrid, Form/inline image/cycle, metadata byte/visited-op 한도, 120,000개 짧은 PDF 연산자의 제한 처리, missing language/tool/budget, 옛 JSON 호환, option 검증·staging 전 거절, 취소·late response가 포함된다. PDF bytes 검사와 visited-op 검사 일부는 decompression 또는 ContentStream parsing 후 적용된다. dense stream preflight를 추가했지만 native extraction·decompression의 엄격한 메모리 상한이라고 주장하지 않으며 worker의 최종 자원 한도가 적용된다.

PostgreSQL/Flyway 및 실 인증 서비스 통합, 전체 unrelated 테스트는 이번 검증에 포함하지 않았다. 실제 사용자 문서·유료 API는 사용하지 않았고 운영 entrypoint의 DB migration을 실행하지 않았다. UI 테스트는 외부 요청을 abort하는 합성 fixture와 별도 검사 환경을 사용한다. OCR network none 조건과 구분한다.

공개 가능한 수치와 input SHA256은 [비교 CSV](ocr-coverage-comparison-2026-10-07.csv)에 있다. 작업 폴더에는 원시 CSV/JSON, fixed comparison plan, 합성 입력, Docker build metadata, 검사 XML/log와 `harness/compare_images.py`, `trial.py`, `prepare_comparison.py`, `summarize_comparison.py`를 보관한다. 원문·인증 메타데이터·개인 정책은 Git 백업에 포함하지 않는다. 재현은 Library ZIP을 공식 경로로 materialize한 후 고정 입력의 SHA256을 검증하고 두 소스 이미지를 빌드해 수행한다.

원자료는 공식 Library materialization의 Windows `os.setxattr` 실패 후, 명시적인 이 PC 목적지로 지원 흐름을 1회 재시도하여 Ubuntu WSL에서 materialize하고 Windows에서 ZIP 읽기 및 72개 파일 존재를 확인했다. ZIP SHA256 `ca8b0b18ae0022fd3017b0b186406f7054000f49b76390719fe6f86b74749015`. 과거 Windows 63회 실패는 POSIX LocalOcr 차단 결과이며 WASM CER/WER를 Linux 결과에 합산하지 않았다. 출력 Library prepared-upload는 이 환경의 지원 오류로 완료되지 않았으므로 Library 저장 성공이나 파일 ID를 주장하지 않는다. 로컬 결과 및 Git 보고서 링크로 전달한다.
