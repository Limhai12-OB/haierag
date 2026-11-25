# HaieRag AI service. In Docker on macOS the reranker runs on CPU (no MPS in Linux VMs);
# run the service natively for Apple Silicon acceleration (see docs/development/local-setup.md).
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models/hf
WORKDIR /app

COPY requirements.txt .
# CPU-only torch wheels keep the image small (no CUDA).
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY app ./app
RUN useradd --create-home --uid 10001 app && mkdir -p /models/hf && chown -R app /models /app
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
