FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_ROOT_USER_ACTION=ignore \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    ALIGNER_PYTHON_BIN=/app/.venv-aligner/bin/python \
    ALIGNER_LANGUAGE=por \
    ALIGNER_BATCH_SIZE=4

# Dependências do sistema
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

# Confirma que o container está realmente usando Python 3.12
RUN python3.12 --version

# ============================================================
# AMBIENTE DO LYRICS ALIGNER
# ============================================================

# Cria exatamente o ambiente virtual esperado pelo Aligner
RUN python3.12 -m venv /app/.venv-aligner

# Atualiza ferramentas de instalação dentro do venv
RUN /app/.venv-aligner/bin/python -m pip install --upgrade \
    pip \
    setuptools \
    wheel

# Copia somente os requirements Python primeiro
COPY requirements-aligner.txt requirements-demucs.txt ./

# Instala o Lyrics Aligner dentro do venv dedicado
RUN /app/.venv-aligner/bin/python -m pip install \
    -r requirements-aligner.txt

# Verificação OBRIGATÓRIA:
# Se o pacote não estiver instalado ou não puder ser importado,
# o próprio build da Render falhará aqui.
RUN /app/.venv-aligner/bin/python -c \
    "import sys; print('Python usado pelo Aligner:', sys.executable); print('Versão:', sys.version); import ctc_forced_aligner; print('✅ ctc_forced_aligner instalado e importado com sucesso')"

# Instala as dependências do Demucs no Python principal.
# Mantemos separado do ambiente do Aligner.
RUN python3.12 -m pip install --upgrade pip setuptools wheel \
  && python3.12 -m pip install -r requirements-demucs.txt

# ============================================================
# NODE.JS / BACKEND
# ============================================================

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev

# ============================================================
# CÓDIGO DA APLICAÇÃO
# ============================================================

COPY . .

# Confirma que o script do Aligner existe
RUN test -f /app/scripts/align_lyrics.py \
  && echo "✅ scripts/align_lyrics.py encontrado"

# Confirma novamente o ambiente final
RUN /app/.venv-aligner/bin/python -c \
    "import ctc_forced_aligner; print('✅ Verificação final do Lyrics Aligner OK')"

EXPOSE 10000

CMD ["npm", "start"]
