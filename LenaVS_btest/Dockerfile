FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

WORKDIR /app

# =========================================================
# Dependências básicas do sistema
# =========================================================
# Python3: scripts auxiliares
# FFmpeg: processamento de áudio/vídeo
# CA certificates: conexões HTTPS
#
# Demucs/Torch permanecem fora desta imagem para evitar
# aumento excessivo do consumo de RAM e problemas de cold start.
# =========================================================
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# =========================================================
# Dependências Node.js
# =========================================================
COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

# =========================================================
# Código da aplicação
# =========================================================
COPY . .

# =========================================================
# Sincronizador de letras
# ctc-forced-aligner 1.0.2
# =========================================================
#
# INSTALL_ALIGNER=false por padrão.
#
# Na Render, defina:
#
#   INSTALL_ALIGNER=true
#
# Quando habilitado, será criado:
#
#   /opt/lenavs-aligner
#
# e o ctc-forced-aligner será instalado dentro desse
# ambiente virtual.
#
# O g++ é necessário porque o ctc-forced-aligner precisa
# compilar uma extensão durante a instalação.
# =========================================================
ARG INSTALL_ALIGNER=false

RUN if [ "$INSTALL_ALIGNER" = "true" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends \
        python3-venv \
        python3-pip \
        g++ \
      && rm -rf /var/lib/apt/lists/* \
      && python3 -m venv /opt/lenavs-aligner \
      && /opt/lenavs-aligner/bin/pip install \
        --no-cache-dir \
        --upgrade pip \
      && /opt/lenavs-aligner/bin/pip install \
        --no-cache-dir \
        -r requirements-aligner.txt \
      && mkdir -p /opt/lenavs-aligner/models \
    ; fi

# =========================================================
# Interpretador utilizado pelo alinhador
# =========================================================
#
# Se o ambiente do alinhador existir, usa:
#
#   /opt/lenavs-aligner/bin/python3
#
# Caso contrário, utiliza o Python do sistema.
#
# Isso permite que a aplicação continue iniciando mesmo
# quando INSTALL_ALIGNER estiver desativado.
# =========================================================
RUN printf '#!/bin/sh\n# LenaVS — escolhe o Python do alinhador (venv se existir)\nif [ -x /opt/lenavs-aligner/bin/python3 ]; then\n  exec /opt/lenavs-aligner/bin/python3 "$@"\nfi\nexec python3 "$@"\n' > /usr/local/bin/lenavs-python \
  && chmod +x /usr/local/bin/lenavs-python

# =========================================================
# Configurações do sincronizador
# =========================================================
ENV LYRICS_ALIGN_PYTHON_BIN=/usr/local/bin/lenavs-python \
    LYRICS_ALIGN_SCRIPT=/app/scripts/lyrics_align.py \
    LYRICS_ALIGN_MODEL_DIR=/opt/lenavs-aligner/models \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1

# =========================================================
# Porta da aplicação
# =========================================================
EXPOSE 10000

# =========================================================
# Inicialização
# =========================================================
CMD ["npm", "start"]
