#!/usr/bin/env bash
#
# Render's native runtime does not always expose python3.12. This bootstrap
# downloads Astral's portable CPython 3.12 build into the project directory so
# the build and the running web service use the exact same interpreter.
#
# Docker deployments do not need this script because Dockerfile starts from
# python:3.12-slim-bookworm.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_ROOT="${PYTHON312_ROOT:-${PROJECT_ROOT}/.runtime/python312}"
PYTHON_BIN="${PYTHON_ROOT}/bin/python3.12"

if [[ -x "${PYTHON_BIN}" ]] && "${PYTHON_BIN}" --version 2>&1 | grep -qE '^Python 3\.12\.'; then
  echo "🐍 Python 3.12 já está disponível em ${PYTHON_BIN}"
  printf '%s\n' "${PYTHON_BIN}"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "❌ curl é necessário para baixar o Python 3.12 automaticamente." >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "❌ tar é necessário para instalar o Python 3.12 automaticamente." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64)
    PYTHON_ARCH="x86_64"
    ;;
  aarch64|arm64)
    PYTHON_ARCH="aarch64"
    ;;
  *)
    echo "❌ Arquitetura não suportada pelo bootstrap do Python 3.12: $(uname -m)" >&2
    exit 1
    ;;
esac

echo "📦 Python 3.12 não encontrado. Baixando uma distribuição portátil para o projeto…"

release_json="$(curl --retry 3 --retry-delay 2 -fsSL \
  https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest)"

download_url="$(printf '%s' "${release_json}" \
  | grep -oE "https://[^\\\"]+cpython-3\\.12\\.[^\\\"]+-${PYTHON_ARCH}-unknown-linux-gnu-install_only\\.tar\\.gz" \
  | head -n 1 || true)"

# Fallback para uma release conhecida caso a API do GitHub esteja temporariamente
# indisponível ou altere o formato do payload.
if [[ -z "${download_url}" ]]; then
  download_url="https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-${PYTHON_ARCH}-unknown-linux-gnu-install_only.tar.gz"
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

archive_path="${tmp_dir}/python312.tar.gz"
install_path="${tmp_dir}/python312"

curl --retry 3 --retry-delay 2 -fL "${download_url}" -o "${archive_path}"
mkdir -p "${install_path}"
tar -xzf "${archive_path}" --strip-components=1 -C "${install_path}"

if [[ ! -x "${install_path}/bin/python3.12" ]]; then
  echo "❌ O pacote baixado não contém bin/python3.12." >&2
  exit 1
fi

rm -rf "${PYTHON_ROOT}"
mkdir -p "$(dirname "${PYTHON_ROOT}")"
mv "${install_path}" "${PYTHON_ROOT}"

if ! "${PYTHON_BIN}" --version 2>&1 | grep -qE '^Python 3\.12\.'; then
  echo "❌ A instalação automática não produziu Python 3.12." >&2
  exit 1
fi

"${PYTHON_BIN}" -m ensurepip --upgrade >/dev/null 2>&1 || true
echo "✅ Python 3.12 instalado em ${PYTHON_BIN}"
printf '%s\n' "${PYTHON_BIN}"