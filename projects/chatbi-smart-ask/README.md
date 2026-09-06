# 智能问数（FastAPI + HTML 原型）

这是一个面向演示/投标场景的 ChatBI 原型项目，使用 `FastAPI + Jinja2 + Vue CDN + Ant Design Vue + ECharts` 搭建。

部署和环境变量说明见：[`DEPLOYMENT.md`](DEPLOYMENT.md)。

它的目标不是做成复杂的前后端分离工程，而是用尽量少的工程成本，把“自然语言问数 → SQL 生成/执行 → 表格图表展示 → 图表上屏 → 数据开发联动”这条主链路跑通并方便演示。

## 核心能力

- 自然语言问数，支持闲聊与查询意图识别
- SQL 生成可见、可编辑、可再次执行
- 多专题演示数据源：警情 / 人员 / 装备 / 监督检查
- 查询结果自动选择表格或图表展示
- 一键上屏到 Dashboard 大屏
- 数据开发模块可模拟“实时接入”并回流到问数结果
- 支持离线演示，前端依赖已内置到 `static/vendor/`

## 技术结构

- `app/main.py`：应用入口，注册中间件、静态资源、页面路由、接口路由
- `app/routers/pages.py`：纯页面路由
- `app/routers/api.py`：智能问数、登录、图表上屏、运行态等主接口
- `app/routers/data_dev.py`：数据开发模块接口
- `app/services/`：数据源、演示库、问数引擎、运行结果存储等服务层
- `templates/`：页面模板
- `static/`：前端静态资源
- `storage/`：运行时生成的数据文件
- `scripts/`：启动和测试脚本
- `tests/e2e/`：浏览器端到端冒烟测试

更详细的模块说明可看：`docs/项目说明.md`，页面结构说明可看：`docs/页面逻辑说明.md`

## 页面入口

默认本地地址为 `http://127.0.0.1:9010`。

- 首页：`/`
- 图表大屏：`/dashboard`
- 数据开发：`/data-dev`
- 数据源管理：`/datasources`
- 健康检查：`/health`

## 接口分组

- `GET /health`：服务健康检查
- `POST /api/auth/login`：登录
- `GET /api/runtime`：当前 LLM 运行态
- `GET /api/metrics`：首页实时概览指标
- `POST /api/chat`：普通问答
- `POST /api/chat/stream`：流式问答
- `POST /api/sql/run`：执行用户编辑后的 SQL
- `POST /api/charts/pin`：图表上屏
- `GET /api/charts`：获取已上屏图表
- `GET /api/dev/tasks`：数据开发任务列表
- `POST /api/dev/tasks/{task_id}/runs`：启动任务运行

## 本地启动

### 方式 1：手动启动

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 9010
```

### 方式 2：脚本启动

```bash
bash scripts/run_dev.sh
```

这个脚本会优先使用项目内的 `.venv/bin/python`，如果不存在则回退到系统 `python3`。

## 默认演示账号

- 用户名：`admin`
- 密码：`admin123`

如果你修改了账号体系，也可以通过环境变量覆盖测试脚本使用的账号：`APP_USERNAME`、`APP_PASSWORD`。

## 冒烟测试

项目已经内置一套可复用的回归检查，适合在你改页面、改接口或演示前快速自测。

### 全量冒烟

```bash
bash scripts/run_smoke.sh
```

它会顺序执行：

1. 后端 API 冒烟
2. 前端 Playwright 页面冒烟

### 只跑接口冒烟

```bash
python3 scripts/api_smoke.py
```

覆盖的关键能力包括：

- 健康检查
- 登录与鉴权
- 运行态、指标、数据源、示例接口
- 普通问答与流式问答
- SQL 执行
- 图表上屏 / 取消上屏
- 数据开发任务与运行详情

### 只跑页面冒烟

```bash
bash scripts/run_ui_smoke.sh
```

覆盖的页面链路包括：

- 登录
- 首页自动问数结果展示
- 上屏到 Dashboard
- 数据开发任务运行
- 数据源页面搜索筛选

### 可覆盖的环境变量

- `APP_URL`：应用地址，默认 `http://127.0.0.1:9010`
- `APP_USERNAME`：测试用户名，默认 `admin`
- `APP_PASSWORD`：测试密码，默认 `admin123`
- `PLAYWRIGHT_WORKDIR`：Playwright 临时工作目录
- `SMOKE_TIMEOUT`：接口冒烟超时秒数

## 典型演示链路

如果你要现场演示，推荐按下面顺序操作：

1. 打开首页，登录后观察“实时概览”和默认演示结果
2. 输入“按月统计火警趋势”等问题，查看结果表格、SQL、分析说明
3. 点击“上屏”，切到 Dashboard 展示图表
4. 打开“数据开发”，触发一次“警情实时接入”运行
5. 回到首页再次提问，演示数据开发与问数的联动效果

## LLM 接入方式

默认 `SMARTASK_LLM_PROVIDER=mock`，离线即可运行。

### OpenAI 兼容接口

```bash
export SMARTASK_LLM_PROVIDER=openai_compatible
export SMARTASK_OPENAI_BASE_URL="https://your-base-url"
export SMARTASK_OPENAI_API_KEY="sk-xxx"
export SMARTASK_OPENAI_MODEL="gpt-4o-mini"
```

### 智能体 HTTP 服务

```bash
export SMARTASK_LLM_PROVIDER=agent_http
export SMARTASK_AGENT_ENDPOINT="https://your-agent-endpoint"
export SMARTASK_AGENT_API_KEY="agent-key-xxx"
export SMARTASK_AGENT_AUTH_SCHEME="Bearer"
export SMARTASK_AGENT_TIMEOUT_S=40
```

智能体服务约定：

- 请求方式：`POST JSON`
- 通过 `task` 字段区分任务类型
- 支持：`classify_intent`、`chat`、`generate_sql`、`explain_sql`
- 返回可复用字段：`intent/sql/reply/content/text/output/result/data`

## 查询保护与远程数据源

### SQL 执行保护

```bash
export SMARTASK_SQL_MAX_ROWS=800
export SMARTASK_SQL_TIMEOUT_MS=6000
```

### MySQL / PostgreSQL 数据源

- MySQL：`mysql+pymysql://user:pass@host:3306/dbname`
- PostgreSQL：`postgresql+psycopg://user:pass@host:5432/dbname`

跨数据源联表时，会把远程表拉到本地 SQLite 临时执行，适合演示和小数据量验证。

```bash
export SMARTASK_FEDERATED_MAX_ROWS=20000
export SMARTASK_FEDERATED_BATCH_SIZE=2000
```

## 生产部署与 Nuitka 编译

生产环境推荐先按普通 Python 方式验证配置，再用 Nuitka 构建独立运行目录。Nuitka 产物仍依赖 `templates/`、`static/`、`storage/` 这些运行资源，构建脚本会把它们一起放进 `run_compiled.dist/`。

### 910B 当前部署信息

- 服务器配置名：`ascend-910b-241-frp`
- 远端目录：`/data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask`
- 当前 Docker 容器：`chatbi-smart-ask-public`
- 当前容器端口：宿主机 `19181` -> 容器 `8000`
- 外部访问端口按 FRP 配置映射，当前文档记录为 `http://110.40.237.78:62181/`

### 必填环境变量

生产环境至少需要配置下面这些变量：

```bash
export SMARTASK_SESSION_SECRET="replace-with-a-long-random-secret"
export SMARTASK_LLM_PROVIDER=openai_compatible
export SMARTASK_OPENAI_BASE_URL="http://host.docker.internal:9012/v1"
export SMARTASK_OPENAI_API_KEY="replace-with-api-key-or-placeholder"
export SMARTASK_OPENAI_MODEL="Qwen3.6-35B-A3B"
export SMARTASK_OPENAI_WIRE_API="chat_completions"
```

如果只做离线演示，可以临时使用 `SMARTASK_LLM_PROVIDER=mock`，但智能问数 SQL 生成会走规则或模拟逻辑，不代表真实模型链路。

### 服务监听变量

这些变量由 `scripts/run_compiled.py` 读取，普通 `uvicorn app.main:app` 启动时也可用同样端口约定：

```bash
export SMARTASK_HOST=0.0.0.0
export SMARTASK_PORT=8000
export SMARTASK_LOG_LEVEL=info
export SMARTASK_FORWARDED_ALLOW_IPS="*"
```

兼容旧脚本时也可以写 `APP_HOST`、`APP_PORT`；当 `SMARTASK_HOST` / `SMARTASK_PORT` 未设置时会回退读取它们。

### 可选运行变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SMARTASK_DEBUG` | `true` | 是否开启 `/docs` 和 `/redoc`。生产建议设为 `false`。 |
| `SMARTASK_SESSION_HTTPS_ONLY` | `false` | Cookie 是否仅 HTTPS 发送。HTTPS 入口建议设为 `true`。 |
| `SMARTASK_SESSION_SAMESITE` | `lax` | Session Cookie SameSite 策略。 |
| `SMARTASK_CORS_ORIGINS` | `*` | 逗号分隔的 CORS 来源。生产建议写明确域名。 |
| `SMARTASK_SQL_MAX_ROWS` | `800` | 单次 SQL 查询最大返回行数。 |
| `SMARTASK_SQL_TIMEOUT_MS` | `6000` | SQL 执行超时时间，毫秒。 |
| `SMARTASK_STREAM_CHAR_DELAY_MS` | `8` | 流式输出字符间隔，毫秒。 |
| `SMARTASK_STREAM_STAGE_DELAY_MS` | `250` | 流式阶段间隔，毫秒。 |
| `SMARTASK_FEDERATED_MAX_ROWS` | `20000` | 跨数据源联表时单表最大拉取行数。 |
| `SMARTASK_FEDERATED_BATCH_SIZE` | `2000` | 跨数据源拉取批大小。 |
| `SMARTASK_DEMO_DB_PATH` | `storage/demo.db` | 演示 SQLite 数据库路径。容器部署建议挂到可写卷。 |
| `SMARTASK_DATASOURCE_STORE_PATH` | `storage/datasources.json` | 数据源配置文件路径。 |
| `SMARTASK_USER_STORE_PATH` | `storage/users.json` | 用户配置文件路径。 |
| `SMARTASK_DEV_STORE_PATH` | `storage/data_dev_store.json` | 数据开发运行状态文件路径。 |

测试脚本还会读取：`APP_URL`、`APP_USERNAME`、`APP_PASSWORD`、`PLAYWRIGHT_WORKDIR`、`SMOKE_TIMEOUT`。这些只影响冒烟测试，不影响服务本身。

### 普通 Python 部署

```bash
cd /data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask
python3 -m venv .venv
. .venv/bin/activate
pip install -U pip
pip install -r requirements.txt

export SMARTASK_HOST=0.0.0.0
export SMARTASK_PORT=8000
export SMARTASK_SESSION_SECRET="replace-with-a-long-random-secret"
export SMARTASK_LLM_PROVIDER=openai_compatible
export SMARTASK_OPENAI_BASE_URL="http://host.docker.internal:9012/v1"
export SMARTASK_OPENAI_API_KEY="replace-with-api-key-or-placeholder"
export SMARTASK_OPENAI_MODEL="Qwen3.6-35B-A3B"
export SMARTASK_OPENAI_WIRE_API="chat_completions"

python -m uvicorn app.main:app --host "${SMARTASK_HOST}" --port "${SMARTASK_PORT}"
```

### Nuitka 编译

Nuitka 需要在目标同架构、同系统族环境里构建。910B 是 Linux 环境，所以不要在 macOS 上编译后拿到 910B 上运行。

```bash
cd /data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask
bash scripts/build_nuitka.sh
```

默认产物位置：

```text
build/nuitka/run_compiled.dist/chatbi-smart-ask
```

启动编译产物：

```bash
cd build/nuitka/run_compiled.dist
export SMARTASK_HOST=0.0.0.0
export SMARTASK_PORT=8000
export SMARTASK_SESSION_SECRET="replace-with-a-long-random-secret"
export SMARTASK_LLM_PROVIDER=openai_compatible
export SMARTASK_OPENAI_BASE_URL="http://host.docker.internal:9012/v1"
export SMARTASK_OPENAI_API_KEY="replace-with-api-key-or-placeholder"
export SMARTASK_OPENAI_MODEL="Qwen3.6-35B-A3B"
export SMARTASK_OPENAI_WIRE_API="chat_completions"
./chatbi-smart-ask
```

验证：

```bash
curl -fsS http://127.0.0.1:8000/health
```

预期返回里至少应包含 `ok=true`。如果要确认真实模型链路，还要看 `llm_provider=openai_compatible`、`llm_ready=true`、`llm_mode=real_llm`，并在问数结果里确认 `meta.sql_source=llm`。

### Nuitka 单文件执行包

如果需要一个单文件交付包，可以使用 Nuitka `--onefile` 构建。这个包会把 Python 运行时、依赖库、模板、静态资源和初始 `storage/` 数据打进一个可执行文件中，适合拷贝到同架构 Linux 机器上直接启动。

注意：当前单文件是在 910B 的 Ubuntu 22.04 / Linux aarch64 环境编译的，只能在兼容的 Linux ARM64 环境运行，不能在 macOS 本地直接运行。

当前已生成的单文件位置：

```text
/data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask/build/nuitka-onefile/chatbi-smart-ask-onefile
```

已拷贝到本地的保存位置：

```text
/Users/chenhao/code/chatbi-smart-ask-onefile
/Users/chenhao/code/chatbi-smart-ask/build/nuitka-onefile-chatbi-smart-ask-onefile
```

文件信息：

```text
大小：约 47M
类型：Linux ARM64 / aarch64 ELF
SHA256：ab06136eb0321c2fc97a978c5a993afe4da276c39ba63f7ae8d2a4e4871cc065
```

构建命令：

```bash
cd /data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask
build/nuitka-venv/bin/python -m nuitka \
  --onefile \
  --standalone \
  --assume-yes-for-downloads \
  --output-dir=build/nuitka-onefile \
  --output-filename=chatbi-smart-ask-onefile \
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
```

运行命令：

```bash
chmod +x chatbi-smart-ask-onefile

SMARTASK_HOST=0.0.0.0 \
SMARTASK_PORT=8000 \
SMARTASK_SESSION_SECRET="replace-with-a-long-random-secret" \
SMARTASK_LLM_PROVIDER=openai_compatible \
SMARTASK_OPENAI_BASE_URL="http://host.docker.internal:9012/v1" \
SMARTASK_OPENAI_API_KEY="replace-with-api-key-or-placeholder" \
SMARTASK_OPENAI_MODEL="Qwen3.6-35B-A3B" \
SMARTASK_OPENAI_WIRE_API="chat_completions" \
./chatbi-smart-ask-onefile
```

验证命令：

```bash
curl -fsS http://127.0.0.1:8000/health
```

单文件部署注意事项：

- onefile 首次启动会先解包到临时目录，因此启动会比 `run_compiled.dist/` 目录模式慢几秒。
- onefile 适合单文件分发；长期生产运行更推荐 `run_compiled.dist/` 目录模式或 Docker 镜像，资源路径和可写目录更直观。
- 如果要持久化数据源、用户和演示数据库，建议显式设置 `SMARTASK_DEMO_DB_PATH`、`SMARTASK_DATASOURCE_STORE_PATH`、`SMARTASK_USER_STORE_PATH`、`SMARTASK_DEV_STORE_PATH` 到外部可写目录。
- `query_cache.json` 和 `feature_store.json` 当前按应用目录下的 `storage/` 使用；onefile 解包目录可能会随进程生命周期变化，生产环境不要依赖 onefile 内置 `storage/` 保存长期状态。
- 如果模型服务在宿主机上，确认 `SMARTASK_OPENAI_BASE_URL` 是运行环境可访问的地址。裸机运行时通常不要写 Docker 专用的 `host.docker.internal`，应改成实际宿主机或内网 IP。

### Docker 部署示例

先基于 Nuitka 产物构建镜像：

```bash
docker build -f Dockerfile.nuitka -t chatbi-smart-ask:nuitka .
```

再启动容器：

```bash
docker run -d --name chatbi-smart-ask-public \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 19181:8000 \
  -v /data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask/storage:/app/storage \
  -e SMARTASK_HOST=0.0.0.0 \
  -e SMARTASK_PORT=8000 \
  -e SMARTASK_SESSION_SECRET=replace-with-a-long-random-secret \
  -e SMARTASK_LLM_PROVIDER=openai_compatible \
  -e SMARTASK_OPENAI_BASE_URL=http://host.docker.internal:9012/v1 \
  -e SMARTASK_OPENAI_API_KEY=replace-with-api-key-or-placeholder \
  -e SMARTASK_OPENAI_MODEL=Qwen3.6-35B-A3B \
  -e SMARTASK_OPENAI_WIRE_API=chat_completions \
  chatbi-smart-ask:nuitka
```

如果模型服务在宿主机上，容器里需要能解析 `host.docker.internal`。Linux Docker 可按实际网络补 `--add-host=host.docker.internal:host-gateway`，或把 `SMARTASK_OPENAI_BASE_URL` 改成容器可访问的宿主机/内网地址。

### systemd 示例

```ini
[Unit]
Description=ChatBI Smart Ask
After=network.target

[Service]
Type=simple
WorkingDirectory=/data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask/build/nuitka/run_compiled.dist
Environment=SMARTASK_HOST=0.0.0.0
Environment=SMARTASK_PORT=8000
Environment=SMARTASK_SESSION_SECRET=replace-with-a-long-random-secret
Environment=SMARTASK_LLM_PROVIDER=openai_compatible
Environment=SMARTASK_OPENAI_BASE_URL=http://host.docker.internal:9012/v1
Environment=SMARTASK_OPENAI_API_KEY=replace-with-api-key-or-placeholder
Environment=SMARTASK_OPENAI_MODEL=Qwen3.6-35B-A3B
Environment=SMARTASK_OPENAI_WIRE_API=chat_completions
ExecStart=/data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask/build/nuitka/run_compiled.dist/chatbi-smart-ask
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### Nuitka 注意事项

- 不要对编译产物使用 `uvicorn --reload`。热重载是开发功能，编译部署时应关闭。
- `build/nuitka/run_compiled.dist/` 是完整运行目录，部署时要整体复制，不要只复制单个二进制。
- `storage/` 是运行时可写目录。容器或 systemd 部署时要保证它可写，尤其是 `demo.db`、`query_cache.json`、`datasources.json`、`users.json`。
- `templates/` 和 `static/` 必须随产物一起部署，否则页面和静态资源会 404。
- 如果依赖新增了动态导入包，需要同步更新 `scripts/build_nuitka.sh` 的 `--include-package` 参数。

## 常见问题

### 页面打不开

先检查服务是否启动：

```bash
curl http://127.0.0.1:9010/health
```

如果不通，执行：

```bash
bash scripts/run_dev.sh
```

### `.venv` 失效

如果出现 `bad interpreter: No such file or directory`，通常是项目目录移动后，旧虚拟环境里的 shebang 路径失效。

处理方式：

```bash
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 说明

- 这是一个偏原型/演示用途的项目，重点是链路完整和页面效果。
- 目前没有做生产级别的权限、审计、SQL 安全治理和复杂运维能力。
- 如果后续要扩展为正式产品，建议再拆分前后端、补充测试分层、完善权限模型和配置管理。
