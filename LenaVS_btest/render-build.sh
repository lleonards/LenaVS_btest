#!/usr/bin/env bash
# Build script para Render
# Instala dependências Node + Python para o backend da LenaVS
# Sem usar apt-get, para evitar erro de filesystem read-only

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${PROJECT_ROOT}"

echo "📦 Iniciando build da LenaVS Backend..."

export PIP_ROOT_USER_ACTION=ignore
export PYTHONUNBUFFERED=1

# A sincronização automática exige exatamente Python 3.12. Em um serviço
# nativo do Render, instala uma cópia portátil dentro do próprio projeto.
PYTHON_BIN="${PYTHON312_BIN:-}"
if [[ -n "${PYTHON_BIN}" ]] \
  && [[ ! -x "${PYTHON_BIN}" ]] \
  && command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v "${PYTHON_BIN}")"
fi

if [[ -z "${PYTHON_BIN}" ]] || ! "${PYTHON_BIN}" --version 2>&1 | grep -qE '^Python 3\.12\.'; then
  PYTHON_BIN="$(bash scripts/ensure_python312.sh | tail -n 1)"
fi

if [[ ! -x "${PYTHON_BIN}" ]] || ! "${PYTHON_BIN}" --version 2>&1 | grep -qE '^Python 3\.12\.'; then
  echo "❌ Não foi possível preparar o Python 3.12 para o Render." >&2
  exit 1
fi

echo "🐍 Python encontrado: $("$PYTHON_BIN" --version)"
export PYTHON312_BIN="${PYTHON_BIN}"
export PATH="$(dirname "${PYTHON_BIN}"):${PATH}"

# Atualiza pip e instala dependências Python do Demucs
if [ -f requirements-demucs.txt ]; then
  echo "📦 Instalando dependências Python do Demucs..."
  "$PYTHON_BIN" -m pip install --upgrade pip setuptools wheel
  "$PYTHON_BIN" -m pip install -r requirements-demucs.txt
  "$PYTHON_BIN" -c "import ctc_forced_aligner; print('✅ ctc-forced-aligner 1.0.2 disponível')"
else
  echo "⚠️ requirements-demucs.txt não encontrado. Pulando dependências Python."
fi

# Instala dependências do Node
echo "📦 Instalando dependências do Node.js..."
npm install
node --check src/server.js

echo "✅ Build concluído com sucesso!"
