FROM ghcr.io/astral-sh/uv:0.11.26 AS uv

FROM python:3.12-slim

WORKDIR /app
COPY --from=uv /uv /uvx /bin/
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src src
COPY resources resources
COPY alembic.ini alembic.ini
COPY migrations migrations
COPY docker-entrypoint.sh docker-entrypoint.sh
RUN uv sync --frozen --no-dev
RUN chmod +x docker-entrypoint.sh

RUN useradd --system --uid 10001 appuser
USER appuser
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["uv", "run", "--no-dev", "uvicorn", "main:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8000"]
