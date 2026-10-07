FROM codex-ocr-coverage-candidate-20261007:latest
USER root
ENV PYTHONDONTWRITEBYTECODE=1 UV_NO_CACHE=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY candidate-lock.txt /opt/feasibility/candidate-lock.txt
RUN uv pip install --python /app/.venv/bin/python --index-url https://pypi.org/simple --require-hashes --no-deps -r /opt/feasibility/candidate-lock.txt
COPY models/ /opt/rapidmodels/
COPY model-manifest.json /opt/feasibility/model-manifest.json
COPY native_probe.py worker_probe.py driver_probe.py /opt/feasibility/
USER appuser
ENTRYPOINT ["/app/.venv/bin/python", "-I", "/opt/feasibility/driver_probe.py"]
