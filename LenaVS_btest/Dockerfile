FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# ============================================================
# Dependências do sistema
# ============================================================
# Python + ferramentas de compilação necessárias para o
# ctc-forced-aligner 1.0.2 + FFmpeg para processamento de áudio.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python3-venv \
    python3-pip \
    build-essential \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*


# ============================================================
# Ambiente isolado do alinhador
# ============================================================

ARG INSTALL_ALIGNER=true

RUN if [ "$INSTALL_ALIGNER" = "true" ]; then \
      python3 -m venv /opt/aligner \
      && /opt/aligner/bin/python -m pip install --upgrade \
           pip \
           setuptools \
           wheel; \
    fi


# ============================================================
# PyTorch CPU
# ============================================================

RUN if [ "$INSTALL_ALIGNER" = "true" ]; then \
      /opt/aligner/bin/python -m pip install \
        torch==2.2.2 \
        torchaudio==2.2.2 \
        --index-url https://download.pytorch.org/whl/cpu; \
    fi


# ============================================================
# CTC Forced Aligner
# ============================================================

RUN if [ "$INSTALL_ALIGNER" = "true" ]; then \
      /opt/aligner/bin/python -m pip install \
        --no-cache-dir \
        -v \
        "ctc-forced-aligner[torch]==1.0.2"; \
    fi


# Python usado pelo backend para executar o alinhador
ENV ALIGNER_PYTHON_BIN=/opt/aligner/bin/python


# ============================================================
# Modelo
# ============================================================
#
# IMPORTANTE:
# Primeiro vamos fazer o build funcionar.
# O modelo NÃO será baixado durante o build neste momento.
#
# Depois que o build passar, podemos decidir como carregar
# o modelo sem estourar os 2 GB de RAM do Render.
#

ARG ALIGNMENT_PREFETCH_MODEL=false
ARG ALIGNMENT_MODEL=MahmoudAshraf/mms-300m-1130-forced-aligner

RUN if [ "$INSTALL_ALIGNER" = "true" ] && [ "$ALIGNMENT_PREFETCH_MODEL" = "true" ]; then \
      /opt/aligner/bin/python -c "\
import torch; \
from ctc_forced_aligner import load_alignment_model; \
torch.set_num_threads(1); \
load_alignment_model( \
    'cpu', \
    dtype=torch.float32, \
    model_path='$ALIGNMENT_MODEL' \
); \
print('Modelo de alinhamento carregado com sucesso');"; \
    fi


# ============================================================
# Dependências do Node
# ============================================================

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi


# ============================================================
# Código da aplicação
# ============================================================

COPY . .


# ============================================================
# Render
# ============================================================

EXPOSE 10000

CMD ["npm", "start"]
