# syntax=docker/dockerfile:1
FROM node:20-bullseye

# Install Python tooling for ingestion pipeline compatibility
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 python3-venv python3-pip python3-dev \
       build-essential git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies first (leverages layer caching)
COPY api/package*.json ./api/
RUN cd api \
  && npm install --production=false

# Copy pipeline requirements and set up a Python venv
COPY lg_pipeline/requirements.txt ./lg_pipeline/requirements.txt
RUN python3 -m venv /app/venv \
  && /app/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /app/venv/bin/pip install --no-cache-dir -r /app/lg_pipeline/requirements.txt

# Copy application sources
COPY api ./api
COPY lg_pipeline ./lg_pipeline

ENV PATH="/app/venv/bin:${PATH}"
ENV PIPELINE_ROOT=/app/lg_pipeline
ENV PIPELINE_PYTHON=/app/venv/bin/python

WORKDIR /app/api
EXPOSE 8787

CMD ["npm", "run", "start"]
