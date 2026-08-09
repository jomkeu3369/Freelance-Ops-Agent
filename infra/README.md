# Infrastructure

V2의 로컬 인프라는 `compose.v2.yaml`을 기준으로 한다.

- PostgreSQL + pgvector가 유일한 운영 database다.
- `app`과 `agent_runtime` schema는 서로 다른 role이 소유한다.
- Backend만 host port를 공개한다.
- Agent는 Docker internal network에서만 접근한다.

```powershell
docker compose -f compose.v2.yaml config
docker compose -f compose.v2.yaml up --build
```

기존 `docker-compose.yaml`과 `docker-compose.infra.yaml`은 V1 재현 기준선이며 V2에서 사용하지 않는다.

