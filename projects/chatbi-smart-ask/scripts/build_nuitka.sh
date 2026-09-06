#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ -z "${PYTHON_BIN:-}" ]]; then
  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      PYTHON_BIN="$(command -v "$candidate")"
      break
    fi
  done
fi
PYTHON_BIN="${PYTHON_BIN:-python3}"
PYTHON_TAG="$("${PYTHON_BIN}" -c 'import sys; print(f"py{sys.version_info.major}{sys.version_info.minor}")')"
BUILD_VENV="${BUILD_VENV:-${ROOT_DIR}/build/nuitka-venv-${PYTHON_TAG}}"
OUTPUT_DIR="${NUITKA_OUTPUT_DIR:-${ROOT_DIR}/build/nuitka}"

mkdir -p "${OUTPUT_DIR}" "${ROOT_DIR}/build"

if [ ! -x "${BUILD_VENV}/bin/python" ]; then
  "${PYTHON_BIN}" -m venv "${BUILD_VENV}"
fi

"${BUILD_VENV}/bin/python" -m pip install -U pip wheel setuptools
"${BUILD_VENV}/bin/python" -m pip install -r requirements.txt
"${BUILD_VENV}/bin/python" -m pip install -U nuitka ordered-set zstandard

"${BUILD_VENV}/bin/python" -m nuitka \
  --standalone \
  --static-libpython=no \
  --assume-yes-for-downloads \
  --output-dir="${OUTPUT_DIR}" \
  --output-filename=chatbi-smart-ask \
  --include-package=app \
  --include-package=fastapi \
  --include-package=starlette \
  --include-package=uvicorn \
  --include-package=jinja2 \
  --include-package=sqlalchemy \
  --include-package=pymysql \
  --include-package=psycopg \
  --include-data-dir=templates=templates \
  --include-data-dir=static=static \
  --include-data-dir=storage=storage \
  scripts/run_compiled.py

echo "Nuitka build finished: ${OUTPUT_DIR}/run_compiled.dist/chatbi-smart-ask"
