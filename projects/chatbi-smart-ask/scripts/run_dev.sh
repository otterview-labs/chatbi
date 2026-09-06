#!/usr/bin/env bash
set -euo pipefail

# 启动本地开发服务。
#
# 设计目标：
# 1. 尽量零心智负担，进入项目后直接执行即可
# 2. 优先复用项目自己的 .venv，避免污染全局 Python
# 3. 若存在 .env，则自动注入配置，方便切换模型/数据库参数

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${ROOT_DIR}/.env"
if [[ -f "$ENV_FILE" ]]; then
  # 自动导出 .env 中的变量，便于 uvicorn 和 app 配置直接读取。
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# 优先使用项目虚拟环境；没有则回退到系统 python3。
PY="${ROOT_DIR}/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  PY="python3"
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-9010}"

# 直接 exec，保证当前 shell 进程被 uvicorn 替换，便于 Ctrl+C 正常退出。
exec "$PY" -m uvicorn app.main:app --reload --host "$HOST" --port "$PORT"
