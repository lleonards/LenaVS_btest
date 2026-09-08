FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    ALIGNER_PYTHON_BIN=/usr/local/bin/python3.12 \
    ALIGNER_LANGUAGE=por \
    ALIGNER_BATCH_SIZE=4 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1

# Node.js 20 + FFmpeg + dependências necessárias
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    ca-certificates \
    curl \
    build-essential \
    g++ \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Confirma Python 3.12
RUN python3 --version \
  && python3.12 --version

# Instala dependências Python do Lyrics Aligner e Demucs
COPY requirements-aligner.txt requirements-demucs.txt ./

RUN python3 -m pip install --upgrade pip setuptools wheel \
  && python3 -m pip install --no-cache-dir -r requirements-aligner.txt \
  && python3 -m pip install --no-cache-dir -r requirements-demucs.txt

# Garante que o módulo do Aligner está realmente disponível
RUN python3 -c "import sys; print('Python:', sys.version); import ctc_forced_aligner; print('ctc_forced_aligner instalado com sucesso:', ctc_forced_aligner.__file__)"

# Instala dependências Node.js
COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

# Copia o backend
COPY . .

EXPOSE 10000

CMD ["npm", "start"]
