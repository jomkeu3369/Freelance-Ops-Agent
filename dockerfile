FROM python:3.12
ENV PYTHONUNBUFFERED=1

WORKDIR /src

RUN pip install "poetry==1.6.1"

COPY pyproject.toml* poetry.lock* ./
COPY api ./api
COPY migrations ./migrations
COPY faiss_db ./faiss_db

RUN poetry config virtualenvs.in-project true
RUN if [ -f pyproject.toml ]; then poetry install --no-root; fi

ENV TZ Asia/Seoul
ENTRYPOINT ["poetry", "run", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--reload", "--log-level", "debug"]