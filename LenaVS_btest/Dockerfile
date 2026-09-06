FROM python:3.12-slim-bookworm AS python312

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    ALIGNER_PYTHON_BIN=python3.12

WORKDIR /app

COPY --from=python312 /usr/local /usr/local

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    build-essential \
    fonts-dejavu-core \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY requirements-demucs.txt requirements-aligner.txt ./
RUN python3.12 -m pip install --upgrade pip setuptools wheel \
  && python3.12 -m pip install -r requirements-demucs.txt -r requirements-aligner.txt

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
