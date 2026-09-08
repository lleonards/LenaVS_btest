FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

# Node.js 20 (oficial NodeSource) + ffmpeg + deps de build do ctc-forced-aligner
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    ca-certificates \
    curl \
    build-essential \
  && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# O ctc-forced-aligner 1.0.2 é compilado neste contêiner (extensão C++).
# Garante Python 3.12 — versão obrigatória do Lyrics Aligner.
RUN python3.12 --version

COPY requirements-aligner.txt requirements-demucs.txt ./
RUN python3 -m pip install --upgrade pip setuptools wheel \
  && python3 -m pip install -r requirements-aligner.txt \
  && python3 -m pip install -r requirements-demucs.txt

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
