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
    ca-certificates \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY requirements-demucs.txt ./
RUN python3 -m pip install --upgrade pip setuptools wheel \
  && python3 -m pip install --break-system-packages -r requirements-demucs.txt

COPY requirements-whisperx.txt ./
RUN python3 -m pip install --break-system-packages -r requirements-whisperx.txt

COPY . .

ENV WHISPERX_ENABLED=1 \
    WHISPERX_PYTHON=python3 \
    WHISPERX_MODEL=small \
    WHISPERX_DEVICE=cpu \
    WHISPERX_COMPUTE_TYPE=int8 \
    WHISPERX_TIMEOUT_MS=1500000

EXPOSE 10000

CMD ["npm", "start"]
