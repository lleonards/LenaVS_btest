#!/usr/bin/env bash
# Build script para Render
# Instala dependências Node + Python para o backend da LenaVS
# Sem usar apt-get, para evitar erro de filesystem read-only

set -euo pipefail

echo "📦 Iniciando build da LenaVS Backend..."

export PIP_ROOT_USER_ACTION=ignore
export PYTHONUNBUFFERED=1

# A sincronização automática exige exatamente Python 3.12.
PYTHON_BIN="${PYTHON312_BIN:-python3.12}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "❌ Python 3.12 não encontrado no ambiente do Render."
  echo "Use o Dockerfile incluído ou configure PYTHON312_BIN para um interpretador Python 3.12."
  exit 1
fi

echo "🐍 Python encontrado: $("$PYTHON_BIN" --version)"

# Atualiza pip e instala dependências Python do Demucs
if [ -f requirements-demucs.txt ]; then
  echo "📦 Instalando dependências Python do Demucs..."
  "$PYTHON_BIN" -m pip install --upgrade pip setuptools wheel
  "$PYTHON_BIN" -m pip install -r requirements-demucs.txt
else
  echo "⚠️ requirements-demucs.txt não encontrado. Pulando dependências Python."
fi

# Instala dependências do Node
echo "📦 Instalando dependências do Node.js..."
npm install

echo "✅ Build concluído com sucesso!"
