FROM ghcr.io/astral-sh/uv:0.11.26 AS uv

FROM python:3.12-slim

WORKDIR /app
COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src src
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 appuser
USER appuser
EXPOSE 8000
CMD ["uv", "run", "--no-dev", "uvicorn", "freelance_ops_agent.main:app", "--host", "0.0.0.0", "--port", "8000"]