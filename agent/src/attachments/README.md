# 첨부파일 읽기와 로컬 OCR

API는 위임된 권한을 확인한 뒤 전용 파서 프로세스를 시작한다. 원본과 OCR 이미지는 메모리로 전달하며 디스크에 저장하지 않는다.
추출 내용은 신뢰하지 않는 참고 자료이므로 도구 실행이나 권한 변경의 근거가 될 수 없다. 이 경로는 유료 OCR·모델·임베딩 API를 호출하지 않는다.

## 실행 환경

Docker는 Poppler와 Tesseract, 한글·영문 언어 팩을 설치한다. Python OCR 패키지는 추가하지 않는다.
컨테이너 밖의 Linux 환경에도 `poppler-utils`, `tesseract-ocr`, `tesseract-ocr-eng`, `tesseract-ocr-kor`가 필요하다.
OCR은 자식 프로세스를 함께 종료할 수 있는 POSIX 환경에서만 실행한다. Windows에서도 텍스트 읽기와 이미지 검증은 가능하며
OCR을 사용할 수 없으면 추출 범위 안내에 표시한다. 도구나 언어 팩이 없어도 텍스트 레이어가 있는 PDF와 TXT·CSV 읽기는 유지된다.

## 형식별 처리

- JPG·PNG: 이미지 방향과 투명도를 처리한 뒤 인쇄된 글자를 OCR로 읽는다.
- GIF·움직이는 PNG: 모든 프레임을 검증하고 첫 번째·가운데·마지막의 최대 세 프레임만 OCR로 읽는다. 읽은 번호와 생략한 범위를 표시한다.
- PDF: 기존 텍스트 레이어를 보존하고 최대 세 후보 페이지를 OCR로 읽는다. 텍스트가 비었거나 이미지가 페이지의 25% 이상을 차지하거나,
  제한된 이미지 배치 검사로 판단하지 못한 페이지가 후보가 된다. 제목 아래 스캔 본문과 긴 텍스트 소개 뒤의 스캔도 포함한다.

이미지 배치 검사는 픽셀 대신 배치 메타데이터와 콘텐츠 연산자를 읽으며 인라인 이미지와 중첩된 Form을 포함한다.
검사 한도는 중첩 8단계, Form 방문 64회, 연산자 5,000개, 스트림당 256KiB와 페이지당 1MiB다.
압축 해제 후 바이트를, 파싱 후 연산자를 검사하므로 전처리 비용 자체의 엄격한 한도는 아니다.
공백 토큰이 20,000개를 넘으면 재파싱을 중단하지만 정상 텍스트도 거부할 수 있으며 이전 텍스트 파싱과 압축 해제 비용을 제한하지는 않는다.
최종 경계는 작업자의 CPU·메모리·요청 한도다. 순환 참조와 한도 초과는 `UNKNOWN`이며 스캔이 없다는 뜻이 아니다.
작은 스캔, 주석, 잘린 이미지와 겹침을 놓칠 수 있고 세 항목 표본만 읽으므로 문서 전체나 시각 정보를 검증하지 못한다.

페이지 전체 OCR과 기존 텍스트를 구분한다. OCR 시작 부분이 기존 텍스트와 정확히 일치하면 한 번만 제거하되 공백 차이는 허용한다.
유사 문자열 비교나 숫자만 제거하는 처리는 하지 않는다. 남은 OCR이 기존 텍스트와 겹쳐도 독립적인 확인 근거로 취급하지 않는다.
OCR이 비거나 실패해도 기존 텍스트는 보존한다.

## 옵션과 추출 범위

`ocrLanguage`는 기본 `mixed`(`eng+kor`), `ko`(`kor`), `en`(`eng`)을 지원한다.
`ocrLayout`은 기본 `general`(PSM 3), `singleblock`(PSM 6)을 지원한다. 고정된 인자만 사용하며 자동 언어 판별,
임의 명령 인자와 요청한 언어 팩이 없을 때의 대체 처리는 하지 않는다.

`coverage`는 페이지·프레임 순서대로 기존 텍스트와 이미지 상태, OCR 시도·완료·빈 결과·실패·생략 사유를 기록한다.
빈 정상 결과도 완료된 시도이며 초기화 실패는 어떤 항목도 시도했다고 표시하지 않는다.
첨부파일 하나는 `LocalOcr` 인스턴스의 초기화·이미지 변환·OCR 기한 8초를 공유한다. 도구 실패에도 앞선 결과를 보존하며,
예산을 소진하면 남은 선택 항목은 생략한다. OCR로 글자를 얻으면 `PARTIAL`, 얻지 못하면 `UNSUPPORTED`다.
물체·차트·필기·배치·움직임의 의미는 분석하지 않으므로 전송 전에 미리보기를 확인해야 한다.

파일당 2MiB, 출력 40,000자, PDF 30페이지, 이미지 60프레임, 프레임당 1,600만 픽셀과 전체 3,200만 픽셀을 허용한다.
파서 작업자는 두 개이며 요청 기한 15초, 주소 공간 512MiB, CPU 12초와 파일 쓰기 금지를 적용한다.
OCR은 변당 최대 2,000픽셀, 명령당 3초, 전체 8초와 파이프 출력 한도를 적용한다. 인증 환경 변수는 제거하고 OpenMP 스레드는 하나로 제한한다.
크기 초과는 잘라내지 않고 거부한다. OCR 실패는 이미 읽은 텍스트와 부분 추출 안내를 보존한다.
요청 시간 초과, 취소와 비정상 종료 시 POSIX 프로세스 그룹 전체를 종료한다.

## 검증과 계약 호환성

```sh
uv run --locked pytest tests/test_attachments.py tests/test_attachment_ocr.py tests/test_attachment_coverage.py
uv run --locked ruff check src/attachments tests/test_attachments.py tests/test_attachment_ocr.py tests/test_attachment_coverage.py
uv run --locked mypy --follow-imports=silent src/attachments
```

합성 입력으로 혼합 PDF, 메타데이터 한도, 옵션, 언어 팩 누락, 부분 실패와 과거 JSON을 검사한다.
실제 도구 테스트는 메모리에 인쇄 텍스트를 생성해 PNG·JPG·움직이는 GIF·스캔 PDF를 자원 제한 작업자에서 처리한다.
도구가 없으면 명시적으로 건너뛰므로 Linux 배포 검증에서는 설치 후 실행해야 한다.

과거 JSON에서 OCR 옵션과 범위가 빠졌으면 Python과 Java가 `mixed`, `general`, `[]`를 사용한다.
빈 범위는 과거 메타데이터가 없다는 뜻이며 전체를 읽었다는 뜻이 아니다. 새 필드는 OpenAPI·TypeScript에서 선택적이며
Python은 알 수 없는 필드를 계속 거부한다. SQL 변경은 없지만 이전 Agent는 새 요청 필드를 받을 수 없으므로
Agent·백엔드 계약을 먼저 맞춘 뒤 프런트엔드를 활성화한다. 백엔드는 응답의 OCR 옵션이 요청과 다르면 거부한다.
이전 판독기로 되돌릴 때는 새 대기 데이터를 처리하고 새 START 요청이 이전 판독기로 재전달되지 않도록 하거나 호환 빌드를 사용한다.

참고: [Tesseract 명령](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html),
[Tesseract 설치](https://tesseract-ocr.github.io/tessdoc/Installation.html), [Poppler](https://poppler.freedesktop.org/).
