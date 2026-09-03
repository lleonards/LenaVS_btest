FROM node:20-bookworm-slim

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
    ca-certificates \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY requirements-demucs.txt ./
RUN python3 -m pip install --upgrade pip setuptools wheel \
  && python3 -m pip install -r requirements-demucs.txt

# ─── Lyrics Aligner ──────────────────────────────────────────────────────────
# O ctc-forced-aligner==1.0.2 exige Python 3.12. O uv baixa um CPython 3.12
# standalone (não depende de python3.12 do sistema) e a venv .venv-aligner
# isola as dependências, evitando conflito com o Python 3.11 usado pelo
# Demucs. O serviço Node detecta .venv-aligner/bin/python automaticamente.
COPY requirements-lyrics-aligner.txt ./
RUN python3 -m pip install --quiet uv \
  && uv venv --python 3.12 /app/.venv-aligner \
  && /app/.venv-aligner/bin/python -m pip install --upgrade pip setuptools wheel \
  && /app/.venv-aligner/bin/python -m pip install --quiet -r requirements-lyrics-aligner.txt \
  && /app/.venv-aligner/bin/python -c \
     "from importlib.metadata import version; v=version('ctc-forced-aligner'); assert v.startswith('1.'), v; print('ctc-forced-aligner', v, 'OK (Python 3.12)')"

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
