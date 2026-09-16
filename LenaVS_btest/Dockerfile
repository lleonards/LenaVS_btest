FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependências do sistema: python3 + venv (alinhador), ffmpeg (vídeo e
# conversão do áudio para 16 kHz mono usado na sincronização de letras).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ffmpeg \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ────────────────────────────────────────────────────────────────────────────
# Alinhador forçado (ctc-forced-aligner==1.0.2) em um venv ISOLADO.
# Isolado de propósito: as dependências do alinhador (torch CPU) não se
# misturam com o runtime do Node e podem ser removidas sem afetar o resto.
#
# Para gerar uma imagem MENOR (sem o alinhador), compile com:
#     docker build --build-arg INSTALL_ALIGNER=false .
# ─────────────────────────────────────────────────────────────────────────────
ARG INSTALL_ALIGNER=true

RUN if [ "$INSTALL_ALIGNER" = "true" ]; then \
      python3 -m venv /opt/aligner \
      && /opt/aligner/bin/pip install --upgrade pip \
      && /opt/aligner/bin/pip install torch==2.2.2 torchaudio==2.2.2 \
           --index-url https://download.pytorch.org/whl/cpu \
      && /opt/aligner/bin/pip install "ctc-forced-aligner[torch]==1.0.2" \
      && rm -rf /root/.cache/pip; \
    fi

ENV ALIGNER_PYTHON_BIN=/opt/aligner/bin/python3

# Pré-baixa o modelo de alinhamento (~1,2 GB) para o cache do container.
# Sem isso, a PRIMEIRA sincronização do usuário faria o download em tempo real.
# Deixe ALIGNMENT_PREFETCH_MODEL=false para pular (build mais rápido e menor).
ARG ALIGNMENT_PREFETCH_MODEL=true
ARG ALIGNMENT_MODEL=MahmoudAshraf/mms-300m-1130-forced-aligner

RUN if [ "$INSTALL_ALIGNER" = "true" ] && [ "$ALIGNMENT_PREFETCH_MODEL" = "true" ]; then \
      /opt/aligner/bin/python3 -c "\
import os, torch; \
from ctc_forced_aligner import load_alignment_model; \
torch.set_num_threads(1); \
m, t = load_alignment_model('cpu', dtype=torch.float32, model_path='$ALIGNMENT_MODEL'); \
print('modelo de alinhamento em cache');" \
      || echo "Aviso: pré-download do modelo falhou; ele será baixado na 1a sincronizacao."; \
    fi

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

COPY . .

EXPOSE 10000

CMD ["npm", "start"]