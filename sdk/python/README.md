# Freelance Ops AI Platform SDK

이 SDK는 Python 서비스가 Spring의 인증·workspace RBAC·quota 경계를 거쳐 Agent run을 시작하고 조회하기 위한 최소 client다. Agent 컨테이너를 직접 호출하지 않는다.

```python
from uuid import UUID

from freelance_ops_ai import AIPlatformClient

client = AIPlatformClient("https://api.example.com", access_token=lambda: token)
run = client.start_run(UUID(workspace_id), UUID(project_id), request_payload)
```

SDK는 access token을 저장하거나 로그로 출력하지 않는다. 호출자는 갱신 가능한 token provider를 전달한다.
