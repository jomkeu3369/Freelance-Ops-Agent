FROM python:3.12-slim

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

COPY src ./src

ENV TZ=Asia/Seoul
ENTRYPOINT ["poetry", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]