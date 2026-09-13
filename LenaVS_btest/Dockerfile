FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

# ============================================================
# Sistema + Node.js 22 + FFmpeg
# ============================================================
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    ca-certificates \
    curl \
    build-essential \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ============================================================
# Verificação das versões
# ============================================================
RUN python3 --version \
  && node --version \
  && npm --version

# ============================================================
# Dependências Python
# Lyrics Aligner + Demucs
# ============================================================
COPY requirements-aligner.txt requirements-demucs.txt ./

RUN python3 -m pip install --upgrade pip setuptools wheel \
  && python3 -m pip install -r requirements-aligner.txt \
  && python3 -m pip install -r requirements-demucs.txt

# ============================================================
# Dependências Node.js
# ============================================================
COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

# ============================================================
# Código da aplicação
# ============================================================
COPY . .

# ============================================================
# Verificação do Lyrics Aligner
# ============================================================
RUN python3 -c "import sys; print('Python:', sys.version)" \
  && python3 -c "import ctc_forced_aligner; print('ctc_forced_aligner: OK')"

# ============================================================
# Porta do Render
# ============================================================
EXPOSE 10000

# ============================================================
# Inicialização
# ============================================================
CMD ["npm", "start"]
