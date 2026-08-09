# Agent

FastAPI + LangGraph 서비스가 prompt, Supervisor graph, ReAct loop, HITL checkpoint, OpenAI/Gemini 호출과 AI 평가를 소유한다.

## Local verification

```powershell
uv sync --locked
uv run --locked pytest
uv run --locked ruff check .
uv run --locked mypy
```

Agent는 Spring Boot가 소유한 업무 table을 직접 읽거나 수정하지 않는다. 모든 업무 Tool은 audience-bound delegation token을 사용해 Spring internal REST API를 호출한다.

