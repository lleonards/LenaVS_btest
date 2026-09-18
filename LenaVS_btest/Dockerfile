FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

WORKDIR /app

# Dependências do sistema: python3 (scripts auxiliares) e ffmpeg (vídeo).
# Demucs/torch foram REMOVIDOS do build para manter a imagem leve e o
# cold start rápido (era a principal causa de HTTP 504 no Render).
# Para habilitar a geração de instrumental, instale demucs no servidor
# e defina as variáveis DEMUCS_* (ver INSTRUCOES_DEPLOY.txt).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

COPY . .

# =========================================================
# Sincronizador de letras (ctc-forced-aligner 1.0.2)
# ---------------------------------------------------------
# Desligado por padrão para manter a imagem leve e o cold start rápido.
# Para habilitar (servidor de 1 CPU / 2 GB de RAM):
#   docker build --build-arg INSTALL_ALIGNER=true .
# e defina no ambiente:
#   LYRICS_ALIGN_PYTHON_BIN=/opt/lenavs-aligner/bin/python3
#   LYRICS_ALIGN_MODEL_DIR=/opt/lenavs-aligner/models
# =========================================================
ARG INSTALL_ALIGNER=false

RUN if [ "$INSTALL_ALIGNER" = "true" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends python3-venv python3-pip \
      && rm -rf /var/lib/apt/lists/* \
      && python3 -m venv /opt/lenavs-aligner \
      && /opt/lenavs-aligner/bin/pip install --no-cache-dir --upgrade pip \
      && /opt/lenavs-aligner/bin/pip install --no-cache-dir -r requirements-aligner.txt \
      && mkdir -p /opt/lenavs-aligner/models ; \
    fi

# Interprete do alinhador: usa o venv quando ele existe (INSTALL_ALIGNER=true),
# senão cai no python3 do sistema — assim a mesma imagem funciona nos dois casos
# e o endpoint responde com uma mensagem clara quando o pacote não está instalado.
RUN printf '#!/bin/sh\n# LenaVS — escolhe o Python do alinhador (venv se existir)\nif [ -x /opt/lenavs-aligner/bin/python3 ]; then\n  exec /opt/lenavs-aligner/bin/python3 "$@"\nfi\nexec python3 "$@"\n' > /usr/local/bin/lenavs-python \
  && chmod +x /usr/local/bin/lenavs-python

ENV LYRICS_ALIGN_PYTHON_BIN=/usr/local/bin/lenavs-python \
    LYRICS_ALIGN_SCRIPT=/app/scripts/lyrics_align.py \
    LYRICS_ALIGN_MODEL_DIR=/opt/lenavs-aligner/models \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1

EXPOSE 10000

CMD ["npm", "start"]
