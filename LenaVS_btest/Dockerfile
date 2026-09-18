# =========================================================
# LenaVS Backend — Dockerfile completo
# ---------------------------------------------------------
# Tudo funciona no MESMO container (Render, 1 CPU / 2 GB RAM):
#   ├── Node 22 + Express
#   ├── FFmpeg
#   ├── Demucs + PyTorch (CPU)  -> "Criar instrumental com IA"
#   └── ctc-forced-aligner 1.0.2 -> "Sincronizar automaticamente"
#
# As tarefas pesadas (Demucs e CTC) NUNCA rodam ao mesmo tempo:
# há um lock serial em src/utils/heavyTaskLock.js usado pelos dois
# serviços. Dentro de cada processo, as threads também ficam
# limitadas a 1 (variáveis OMP/MKL/OPENBLAS/NUMEXPR abaixo).
#
# Build:
#   docker build -t lenavs-backend .
#   (o alinhador é instalado por padrão; INSTALL_ALIGNER=true é
#    aceito e mantido por compatibilidade com a Render)
# =========================================================

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

WORKDIR /app

# ---------------------------------------------------------
# Dependências do sistema
#   ffmpeg          -> vídeo/áudio (sempre usado)
#   python3 + venv  -> ambientes virtuais do Demucs e do CTC
#   build-essential -> g++ exigido pela extensão C++ do
#                      ctc-forced-aligner (erro "x86_64-linux-gnu-g++ not found")
# ---------------------------------------------------------
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ffmpeg \
    build-essential \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------
# Dependências Node (produção)
# ---------------------------------------------------------
COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

COPY . .

# ---------------------------------------------------------
# Demucs + PyTorch (CPU) — venv dedicado /opt/lenavs-demucs
# ---------------------------------------------------------
# torch 2.5.1 (CPU): demucs 4.1.0 exige torch>=2.1; ficamos abaixo
# de 2.6 porque a partir daí o torch.load usa weights_only=True e
# quebra o carregamento dos modelos do Demucs.
# NÃO REMOVER: o "Criar instrumental com IA" depende deste venv.
RUN python3 -m venv /opt/lenavs-demucs \
  && /opt/lenavs-demucs/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/lenavs-demucs/bin/pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch==2.5.1 torchaudio==2.5.1 \
  && /opt/lenavs-demucs/bin/pip install --no-cache-dir \
      --index-url https://pypi.org/simple \
      -r requirements-demucs.txt

# ---------------------------------------------------------
# Sincronizador de letras (ctc-forced-aligner 1.0.2)
# ---------------------------------------------------------
# venv isolado em /opt/lenavs-aligner para não conflitar com as
# versões de numpy/torch do Demucs. O build-essential instalado
# acima fornece o g++ necessário para compilar a extensão C++.
# Mantido o gate INSTALL_ALIGNER (a Render pode continuar usando
# INSTALL_ALIGNER=true; o padrão agora é true, já que a 1 CPU /
# 2 GB do plano suporta as duas IAs de forma serial).
ARG INSTALL_ALIGNER=true

RUN if [ "$INSTALL_ALIGNER" = "true" ]; then \
      python3 -m venv /opt/lenavs-aligner \
      && /opt/lenavs-aligner/bin/pip install --no-cache-dir --upgrade pip \
      && /opt/lenavs-aligner/bin/pip install --no-cache-dir \
          --index-url https://pypi.org/simple \
          -r requirements-aligner.txt \
      && mkdir -p /opt/lenavs-aligner/models ; \
    fi

# Interprete do alinhador: usa o venv quando ele existe (INSTALL_ALIGNER=true),
# senão cai no python3 do sistema — assim a mesma imagem funciona nos dois casos
# e o endpoint responde com uma mensagem clara quando o pacote não está instalado.
RUN printf '#!/bin/sh\n# LenaVS — escolhe o Python do alinhador (venv se existir)\nif [ -x /opt/lenavs-aligner/bin/python3 ]; then\n  exec /opt/lenavs-aligner/bin/python3 "$@"\nfi\nexec python3 "$@"\n' > /usr/local/bin/lenavs-python \
  && chmod +x /usr/local/bin/lenavs-python

# ---------------------------------------------------------
# Variáveis de ambiente
# ---------------------------------------------------------
ENV DEMUCS_PYTHON_BIN=/opt/lenavs-demucs/bin/python3 \
    DEMUCS_DEVICE=cpu \
    LYRICS_ALIGN_PYTHON_BIN=/usr/local/bin/lenavs-python \
    LYRICS_ALIGN_SCRIPT=/app/scripts/lyrics_align.py \
    LYRICS_ALIGN_MODEL_DIR=/opt/lenavs-aligner/models \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1

EXPOSE 10000

CMD ["npm", "start"]
