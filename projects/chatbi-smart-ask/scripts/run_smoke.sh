#!/usr/bin/env bash
set -euo pipefail

# 全量冒烟入口：先测 API，再测页面。
#
# 为什么先测 API：
# - 如果接口已经挂了，页面测试通常也会失败
# - 先做后端快检，可以更快定位是后端问题还是前端问题

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_URL="${APP_URL:-http://127.0.0.1:9010}"
PY="${ROOT_DIR}/.venv/bin/python"

if [[ ! -x "${PY}" ]]; then
  PY="python3"
fi

# 冒烟前先确认服务已经起来，避免后面一串误报。
if ! curl -fsS "${APP_URL}/health" >/dev/null; then
  echo "应用不可用：${APP_URL}" >&2
  echo "请先执行: bash scripts/run_dev.sh" >&2
  exit 1
fi

APP_URL="${APP_URL}" "${PY}" "${ROOT_DIR}/scripts/api_smoke.py"
APP_URL="${APP_URL}" bash "${ROOT_DIR}/scripts/run_ui_smoke.sh"
