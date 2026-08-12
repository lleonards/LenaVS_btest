#!/usr/bin/env bash
# Build script para Render
# Instala dependências Node + Python para o backend da LenaVS
# Sem usar apt-get, para evitar erro de filesystem read-only

set -euo pipefail

echo "📦 Iniciando build da LenaVS Backend..."

export PIP_ROOT_USER_ACTION=ignore
export PYTHONUNBUFFERED=1

# Verifica se Python existe no ambiente
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ python3 não encontrado no ambiente do Render."
  echo "Configure o serviço para usar um ambiente com Python disponível, ou mude a estratégia do deploy do Demucs."
  exit 1
fi

echo "🐍 Python encontrado: $(python3 --version)"

# Atualiza pip e instala dependências Python do Demucs
if [ -f requirements-demucs.txt ]; then
  echo "📦 Instalando dependências Python do Demucs..."
  python3 -m pip install --upgrade pip setuptools wheel
  python3 -m pip install -r requirements-demucs.txt
else
  echo "⚠️ requirements-demucs.txt não encontrado. Pulando dependências Python."
fi

# Instala dependências do Node
echo "📦 Instalando dependências do Node.js..."
npm install

echo "✅ Build concluído com sucesso!"
