#!/usr/bin/env bash
# Build script para Render
# Instala dependências Node + Python para o backend da LenaVS.
# A sincronização automática exige Python 3.12; em Render isso é garantido
# pelo Dockerfile deste backend.

set -euo pipefail

echo "📦 Iniciando build da LenaVS Backend..."

export PIP_ROOT_USER_ACTION=ignore
export PYTHONUNBUFFERED=1

# Verifica se o interpretador exigido existe no ambiente
PYTHON_BIN="${ALIGNER_PYTHON_BIN:-python3.12}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "❌ Python 3.12 não encontrado no ambiente do Render."
  echo "Use o Dockerfile incluído no backend para garantir o runtime correto."
  exit 1
fi

PYTHON_VERSION="$("$PYTHON_BIN" --version 2>&1)"
case "$PYTHON_VERSION" in
  "Python 3.12"*) ;;
  *)
    echo "❌ O serviço precisa executar com Python 3.12. Encontrado: $PYTHON_VERSION"
    exit 1
    ;;
esac
echo "🐍 Python encontrado: $PYTHON_VERSION"

echo "📦 Instalando dependências Python do Demucs e do ctc-forced-aligner 1.0.2..."
"$PYTHON_BIN" -m pip install --upgrade pip setuptools wheel
"$PYTHON_BIN" -m pip install -r requirements-demucs.txt -r requirements-aligner.txt

# Instala dependências do Node
echo "📦 Instalando dependências do Node.js..."
npm ci

echo "✅ Build concluído com sucesso!"
