FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Python + FFmpeg
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Alinhador
ARG INSTALL_ALIGNER=true

RUN if [ "$INSTALL_ALIGNER" = "true" ]; then \
      python3 -m venv /opt/aligner \
      && /opt/aligner/bin/python -m pip install --upgrade pip setuptools wheel \
      && /opt/aligner/bin/python -m pip install \
           torch==2.2.2 \
           torchaudio==2.2.2 \
           --index-url https://download.pytorch.org/whl/cpu \
      && /opt/aligner/bin/python -m pip install \
           --no-cache-dir \
           "ctc-forced-aligner[torch]==1.0.2"; \
    fi

ENV ALIGNER_PYTHON_BIN=/opt/aligner/bin/python

# Modelo
ARG ALIGNMENT_PREFETCH_MODEL=false
ARG ALIGNMENT_MODEL=MahmoudAshraf/mms-300m-1130-forced-aligner

RUN if [ "$INSTALL_ALIGNER" = "true" ] && [ "$ALIGNMENT_PREFETCH_MODEL" = "true" ]; then \
      /opt/aligner/bin/python -c "\
import torch; \
from ctc_forced_aligner import load_alignment_model; \
torch.set_num_threads(1); \
load_alignment_model('cpu', dtype=torch.float32, model_path='$ALIGNMENT_MODEL'); \
print('Modelo de alinhamento carregado com sucesso');"; \
    fi

# Node
COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
