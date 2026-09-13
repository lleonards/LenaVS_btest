#!/usr/bin/env bash
# Build script para Render
# Instala dependências Node + Python para o backend da LenaVS
# Sem usar apt-get, para evitar erro de filesystem read-only

set -euo pipefail

echo "📦 Iniciando build da LenaVS Backend..."

export PIP_ROOT_USER_ACTION=ignore
export PYTHONUNBUFFERED=1

# ── Python 3.12 obrigatório para o Lyrics Aligner ───────────────────────────
# O ctc-forced-aligner==1.0.2 DEVE rodar em Python 3.12. No Render, defina
# PYTHON_VERSION=3.12.0 (Environment → Environment Variables) para que o
# ambiente provisione o Python 3.12.
ALIGNER_PYTHON=""

for candidate in python3.12 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if [ "$("$candidate" -c 'import sys; print("%d%02d" % sys.version_info[:2])')" = "0312" ]; then
      ALIGNER_PYTHON="$candidate"
      break
    fi
  fi
done

if [ -z "$ALIGNER_PYTHON" ]; then
  echo "❌ Python 3.12 não encontrado no ambiente do Render."
  echo "O Lyrics Aligner exige Python 3.12. Defina PYTHON_VERSION=3.12.0"
  echo "nas variáveis de ambiente do serviço (Render) e faça o rebuild."
  exit 1
fi

echo "🐍 Python 3.12 encontrado: $ALIGNER_PYTHON ($($ALIGNER_PYTHON --version))"

# Cria um venv dedicado ao Lyrics Aligner (Python 3.12)
python3 -m venv .venv-aligner
. .venv-aligner/bin/activate
python -m pip install --upgrade pip setuptools wheel

if [ -f requirements-aligner.txt ]; then
  echo "📦 Instalando Lyrics Aligner (ctc-forced-aligner==1.0.2 em Python 3.12)..."
  pip install -r requirements-aligner.txt
else
  echo "⚠️ requirements-aligner.txt não encontrado. Pulando dependências do Aligner."
fi

if [ -f requirements-demucs.txt ]; then
  echo "📦 Instalando dependências Python do Demucs..."
  pip install -r requirements-demucs.txt
else
  echo "⚠️ requirements-demucs.txt não encontrado. Pulando dependências Python."
fi

deactivate

# Instala dependências do Node
echo "📦 Instalando dependências do Node.js..."
npm install

echo "✅ Build concluído com sucesso!"
