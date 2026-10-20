# Freelance Ops AI Platform SDK

Python에서 Spring 공개 API로 Agent 실행을 시작·조회·취소하는 동기 클라이언트다. 인증·작업 공간 권한·실행 한도는 Spring이 확인한다. Agent 내부 API를 직접 호출하지 않는다. 운영 시 추가 Python 패키지는 필요하지 않다.

## 설치와 사용

Python 3.11 이상에서 저장소 루트 기준으로 설치한다.

```sh
python -m pip install ./sdk/python
```

토큰을 발급·갱신하는 코드는 호출하는 프로그램에서 관리한다. 아래 예제는 환경 변수에 설정한 기존 실행을 조회한다.

```python
import os
from uuid import UUID

from freelance_ops_ai import AIPlatformClient

client = AIPlatformClient(
    "https://api.example.com", access_token=lambda: os.environ["ACCESS_TOKEN"]
)
run = client.get_run(UUID(os.environ["WORKSPACE_ID"]), UUID(os.environ["RUN_ID"]))
```

| 메서드 | 인자와 동작 |
| --- | --- |
| `start_run(workspace_id, project_id, payload)` | 프로젝트의 새 실행을 요청한다. 검토한 시작 요청의 JSON 본문을 전달한다. |
| `get_run(workspace_id, run_id)` | 작업 공간에 속한 실행을 조회한다. |
| `cancel_run(workspace_id, run_id)` | 실행 취소를 요청한다. 빈 JSON 객체를 전송한다. |

시작 요청의 모델·비용 확인·한도는 서버 정책에 맞춰 준비해야 한다. SDK는 해당 값을 대신 결정하지 않는다. 현재 정책은 [개인 AI 연결 안내](../../docs/frontend/BYOK_CONNECTIONS.md)와 [Backend 안내](../../backend/README.md)를 따른다. 재개·SSE·토큰 발급 메서드는 제공하지 않는다.

## 요청과 오류 처리

- 매 호출마다 `access_token` 함수를 다시 호출한다. 토큰 앞뒤 공백을 제거하고 빈 값이면 HTTP 요청 전에 `ValueError`를 낸다. 토큰 값은 클라이언트 속성에 저장하거나 로그로 출력하지 않는다.
- JSON은 UTF-8로 보내며 `Authorization`, `Content-Type`, 새 `traceparent` 헤더를 붙인다. 기본 HTTP 시간 제한은 30초다.
- 성공 응답은 JSON 객체로 반환한다. 빈 본문은 기존 방식대로 `{}`로 반환하고, JSON이나 UTF-8이 잘못됐거나 객체가 아니면 `AIPlatformError(502, "INVALID_RESPONSE")`를 낸다.
- HTTP 오류는 `AIPlatformError.status`와 `.code`로 처리한다. JSON 오류 코드가 없거나 JSON·UTF-8 형식이 잘못되면 `UNKNOWN`을 사용하며 원래 HTTP 상태를 유지한다. 원문 오류 본문은 예외 메시지에 넣지 않는다. 기존 오류 문자열의 `status=`·`code=` 형식도 유지한다.
- 연결 실패·시간 초과 등 HTTP 응답을 받지 못한 오류는 표준 라이브러리 예외로 전달한다. SDK는 요청을 자동 재시도하지 않는다.

## 코드 구성과 호환 경로

| 파일 | 책임 |
| --- | --- |
| `freelance_ops_ai/client.py` | 공개 API 경로, 토큰·추적 헤더, JSON 요청·응답 |
| `freelance_ops_ai/transport.py` | HTTP 전송, 응답 자원 해제, 사용자 전송 구현의 인터페이스 |
| `freelance_ops_ai/errors.py` | HTTP 상태와 플랫폼 오류 코드 |

기존 `from freelance_ops_ai import AIPlatformClient, AIPlatformError`를 유지한다. `freelance_ops_ai.client`에서 가져오던 `AIPlatformError`, `Transport`, `TransportResponse`, `UrlLibTransport`도 같은 클래스를 다시 제공한다. 생성자와 세 공개 메서드의 인자·기본값은 유지한다.

전송을 대체할 때는 기존처럼 생성자의 `transport` 인자에 `request(method, url, headers, body)`를 구현한 객체를 넘긴다. 결과는 `TransportResponse(status, body)`로 반환한다.

## 검사

`sdk/python`에서 실행한다. HTTP 응답은 대체하며 실제 계정이나 모델을 호출하지 않는다.

```sh
python -m unittest discover -s tests -v
```

같은 검사는 `Agent CI`에서도 실행한다. `pyproject.toml`의 Hatchling은 배포 파일을 만드는 빌드 도구이며 런타임 의존성이 아니다.
