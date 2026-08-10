# Infrastructure

V2의 로컬 환경은 PostgreSQL 인프라와 애플리케이션 Compose를 분리한다.

- PostgreSQL + pgvector가 유일한 운영 database다.
- `app`과 `agent_runtime` schema는 서로 다른 role이 소유한다.
- Backend만 host port를 공개한다.
- Agent는 Docker internal network에서만 접근한다.

```powershell
docker compose -f docker-compose-infra.yaml config
docker compose -f docker-compose.yaml config
docker compose -f docker-compose-infra.yaml up -d --wait
docker compose -f docker-compose.yaml up --build -d --wait
```

`docker-compose-infra.yaml`이 PostgreSQL과 공유 network·volume을 생성하고, `docker-compose.yaml`의 Agent와 Backend가 해당 external network에 연결된다. 반드시 infra를 먼저 기동한다. V1 Compose는 `legacy/v1/`에 보존한다.

