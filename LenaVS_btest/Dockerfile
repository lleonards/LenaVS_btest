FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    build-essential \
    curl \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

ARG NODE_VERSION=22.14.0
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
  | tar -xJ --strip-components=1 -C /usr/local

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY requirements-demucs.txt ./
RUN python -m pip install --upgrade pip setuptools wheel \
  && python -m pip install -r requirements-demucs.txt \
  && python -c "import ctc_forced_aligner; print('ctc-forced-aligner 1.0.2 disponível')"

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
