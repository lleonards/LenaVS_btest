# Node 22 + Python 3.11 (bookworm-slim) — roda o backend Node e os
# processos Python (Demucs + WhisperX) no MESMO container, sem precisar
# mexer em nada nas configurações da Render.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    libsndfile1 \
    libgomp1 \
    ca-certificates \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY requirements-whisperx.txt ./
RUN python3 -m pip install --upgrade pip setuptools wheel \
  && python3 -m pip install -r requirements-whisperx.txt

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
