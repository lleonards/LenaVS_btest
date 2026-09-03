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

# Lyrics Aligner: cria a venv dedicada Python 3.12 e instala
# requirements-lyrics-aligner.txt DENTRO dela (ctc-forced-aligner==1.0.2).
if [ -f requirements-lyrics-aligner.txt ]; then
  echo "📦 Configurando ambiente Python 3.12 do Lyrics Aligner..."
  bash scripts/setup_aligner_venv.sh || {
    echo "⚠️ Não foi possível configurar a venv do Lyrics Aligner."
    echo "   A instalação continua, mas a sincronização automática ficará indisponível."
  }
else
  echo "⚠️ requirements-lyrics-aligner.txt não encontrado. Pulando dependências do Lyrics Aligner."
fi

# Instala dependências do Node
echo "📦 Instalando dependências do Node.js..."
npm install

echo "✅ Build concluído com sucesso!"
