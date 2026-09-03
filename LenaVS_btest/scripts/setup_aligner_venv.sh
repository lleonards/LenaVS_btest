#!/usr/bin/env bash
# setup_aligner_venv.sh
# ─────────────────────────────────────────────────────────────────────────────
# Cria o ambiente Python 3.12 do Lyrics Aligner e instala as dependências.
#
# O ctc-forced-aligner==1.0.2 exige Python 3.12. Este script garante que o
# ambiente correto exista (venv dedicada .venv-aligner) e instala
# requirements-lyrics-aligner.txt DENTRO dele — nunca no Python do sistema,
# evitando incompatibilidade entre versão do Python e versão do pacote.
#
# Uso:
#   bash scripts/setup_aligner_venv.sh
#
# Variáveis:
#   LYRICS_ALIGNER_VENV  caminho da venv (padrão: <raiz>/.venv-aligner)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${LYRICS_ALIGNER_VENV:-$ROOT_DIR/.venv-aligner}"
REQUIREMENTS="$ROOT_DIR/requirements-lyrics-aligner.txt"

echo "📦 Lyrics Aligner → ambiente Python 3.12 em: $VENV_DIR"

# 1) Descobre um Python 3.12 disponível (python3.12 > python3 já 3.12 > uv)
PYTHON_312=""
if command -v python3.12 >/dev/null 2>&1; then
  PYTHON_312="$(command -v python3.12)"
elif command -v python3 >/dev/null 2>&1 \
  && [ "$(python3 -c 'import sys; print(1 if sys.version_info >= (3, 12) else 0)' 2>/dev/null || echo 0)" = "1" ]; then
  PYTHON_312="$(command -v python3)"
fi

# 2) Cria a venv se ainda não existir
if [ ! -x "$VENV_DIR/bin/python" ]; then
  if [ -n "$PYTHON_312" ]; then
    echo "🐍 Criando venv com $("$PYTHON_312" --version): $VENV_DIR"
    "$PYTHON_312" -m venv "$VENV_DIR"
  elif command -v uv >/dev/null 2>&1; then
    echo "🐍 python3.12 não encontrado; usando uv para baixar Python 3.12…"
    uv venv --python 3.12 "$VENV_DIR"
  else
    echo "⚠️ python3.12 não encontrado; tentando instalar o uv via pip…"
    if python3 -m pip install --quiet uv; then
      uv venv --python 3.12 "$VENV_DIR"
    else
      echo "❌ Nenhum Python 3.12 encontrado e não foi possível instalar o uv."
      echo "   Opções:"
      echo "   • Instale o Python 3.12 no sistema (https://www.python.org/downloads/)"
      echo "   • Ou instale o uv:  curl -LsSf https://astral.sh/uv/install.sh | sh"
      echo "   Depois execute de novo:  bash scripts/setup_aligner_venv.sh"
      exit 1
    fi
  fi
fi

# 3) Valida a versão do Python da venv (obrigatório >= 3.12)
VENV_PYTHON="$VENV_DIR/bin/python"
VENV_VERSION="$("$VENV_PYTHON" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
MAJOR="${VENV_VERSION%%.*}"
MINOR="${VENV_VERSION#*.}"

if [ "$MAJOR" -lt 3 ] || { [ "$MAJOR" -eq 3 ] && [ "$MINOR" -lt 12 ]; }; then
  echo "❌ A venv em $VENV_DIR usa Python $VENV_VERSION (exigido: 3.12+)."
  echo "   Remova a venv e recrie:  rm -rf $VENV_DIR && bash scripts/setup_aligner_venv.sh"
  exit 1
fi

echo "✅ Python $VENV_VERSION confirmado na venv."

# 4) Instala/atualiza as dependências DENTRO da venv 3.12
"$VENV_PYTHON" -m pip install --quiet --upgrade pip setuptools wheel
"$VENV_PYTHON" -m pip install --quiet -r "$REQUIREMENTS"

# 5) Sanidade final: importa o ctc-forced-aligner e verifica a versão
"$VENV_PYTHON" - <<'PY'
from importlib.metadata import version
installed = version("ctc-forced-aligner")
if not installed.startswith("1."):
    raise SystemExit(f"Versão inesperada do ctc-forced-aligner: {installed} (esperado 1.0.2)")
print(f"✅ ctc-forced-aligner {installed} instalado corretamente no Python 3.12.")
PY

echo "🎉 Ambiente do Lyrics Aligner pronto!"
