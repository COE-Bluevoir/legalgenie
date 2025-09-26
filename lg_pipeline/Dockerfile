# syntax=docker/dockerfile:1
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cpu

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential curl git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY lg_pipeline/requirements.txt ./
RUN pip install --upgrade pip setuptools wheel \
  && pip install -r requirements.txt

COPY lg_pipeline .

EXPOSE 8000
CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8000"]
