FROM python:3.12-slim AS builder
ENV PYTHONUNBUFFERED=1
WORKDIR /src
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential cmake pkg-config \
    && rm -rf /var/lib/apt/lists/*
RUN pip install "poetry==1.6.1"
RUN poetry config virtualenvs.in-project true
COPY pyproject.toml poetry.lock* ./
RUN poetry install --no-root --no-dev


FROM python:3.12-slim AS runner

ENV PYTHONUNBUFFERED=1

WORKDIR /src

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY app ./app
COPY pyproject.toml ./pyproject.toml 
COPY --from=builder /src/.venv /src/.venv

ENV PATH="/src/.venv/bin:$PATH"
ENV TZ=Asia/Seoul
ENTRYPOINT ["/src/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]