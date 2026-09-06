#!/usr/bin/env bash
set -euo pipefail

# 页面端到端冒烟脚本。
#
# 这里采用“临时 Playwright 工作目录”的方式，而不是把 Node 依赖直接装进当前仓库：
# - 不污染 Python 项目目录
# - 不强制项目引入 package.json
# - 更适合原型项目按需验证

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_URL="${APP_URL:-http://127.0.0.1:9010}"
APP_USERNAME="${APP_USERNAME:-admin}"
APP_PASSWORD="${APP_PASSWORD:-admin123}"
PW_DIR="${PLAYWRIGHT_WORKDIR:-${TMPDIR:-/tmp}/chatbi-smart-ask-playwright}"
SPEC_PATH="${ROOT_DIR}/tests/e2e/chatbi-smoke.spec.mjs"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm 未安装，无法执行浏览器冒烟测试" >&2
  exit 1
fi

# 页面测试前先检查应用是否可访问。
if ! curl -fsS "${APP_URL}/health" >/dev/null; then
  echo "应用不可用：${APP_URL}" >&2
  echo "请先执行: bash scripts/run_dev.sh" >&2
  exit 1
fi

mkdir -p "${PW_DIR}"

# 把测试文件复制到 Playwright 工作目录，避免跨目录执行时出现识别问题。
cp "${SPEC_PATH}" "${PW_DIR}/chatbi-smoke.spec.mjs"

# 只有首次运行才创建最小 package.json。
if [[ ! -f "${PW_DIR}/package.json" ]]; then
  cat > "${PW_DIR}/package.json" <<'JSON'
{
  "name": "chatbi-smart-ask-playwright-smoke",
  "private": true,
  "devDependencies": {
    "@playwright/test": "^1.54.2"
  }
}
JSON
fi

# 只有缺依赖时才安装，避免重复下载影响速度。
if [[ ! -d "${PW_DIR}/node_modules/@playwright/test" ]]; then
  (cd "${PW_DIR}" && npm install --silent)
fi

# 浏览器二进制允许复用本地缓存，即便重复执行也比较快。
(cd "${PW_DIR}" && npx playwright install chromium >/dev/null)
(cd "${PW_DIR}" && APP_URL="${APP_URL}" APP_USERNAME="${APP_USERNAME}" APP_PASSWORD="${APP_PASSWORD}" npx playwright test ./chatbi-smoke.spec.mjs --reporter=line --workers=1)
