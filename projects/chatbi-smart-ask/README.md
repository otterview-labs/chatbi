# ChatBI 应用开发与配置

这里是仓库内可运行的主应用，使用 FastAPI、Jinja2、Vue、Ant Design Vue 和 ECharts。页面依赖随源码提供。

[项目首页](../../README.md) · [首次体验](docs/first-query.md) · [模块说明](docs/项目说明.md) · [页面逻辑](docs/页面逻辑说明.md)

## 开发启动

在本目录执行：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
SMARTASK_LLM_PROVIDER=mock .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 9010 --reload
```

服务首页为 `http://127.0.0.1:9010/`，健康检查为 `/health`，开发模式的 API 文档为 `/docs`。新本地环境的默认演示账号为 `admin` / `admin123`。

启动时只初始化演示表结构，不自动生成记录。[首次体验指南](docs/first-query.md)提供单独数据库与显式模拟数据的步骤。

## 模型配置

变量通过进程环境传入。普通 `uvicorn` 命令不会自动加载 `.env.example`。

| 变量 | 用途 |
| --- | --- |
| `SMARTASK_LLM_PROVIDER` | `mock`、`openai_compatible` 或 `agent_http` |
| `SMARTASK_OPENAI_BASE_URL` | OpenAI 兼容服务地址 |
| `SMARTASK_OPENAI_API_KEY` | 模型服务密钥 |
| `SMARTASK_OPENAI_MODEL` | 通用模型名称 |
| `SMARTASK_OPENAI_SQL_MODEL` | 可选的 SQL 专用模型，留空复用通用模型 |
| `SMARTASK_OPENAI_WIRE_API` | OpenAI 请求协议，默认 `chat_completions` |
| `SMARTASK_AGENT_ENDPOINT` | 自定义 HTTP 智能体服务地址 |
| `SMARTASK_AGENT_API_KEY` | 智能体服务密钥 |
| `SMARTASK_AGENT_AUTH_SCHEME` | 默认 `Bearer` |

HTTP 智能体接口以 `task` 区分 `classify_intent`、`chat`、`generate_sql`、`explain_sql`。具体处理见 `app/services/llm/`。

## 数据与运行配置

| 变量 | 用途 |
| --- | --- |
| `SMARTASK_DEMO_DB_PATH` | 演示 SQLite 数据库路径 |
| `SMARTASK_DATASOURCE_STORE_PATH` | 数据源配置路径 |
| `SMARTASK_USER_STORE_PATH` | 用户配置路径 |
| `SMARTASK_DEV_STORE_PATH` | 数据开发状态路径 |
| `SMARTASK_SESSION_SECRET` | Session 签名配置 |
| `SMARTASK_SESSION_HTTPS_ONLY` | HTTPS Cookie 设置 |
| `SMARTASK_CORS_ORIGINS` | 允许的来源 |
| `SMARTASK_DEBUG` | 控制 API 文档，默认启用 |
| `SMARTASK_SQL_MAX_ROWS`、`SMARTASK_SQL_TIMEOUT_MS` | 查询行数上限与超时 |
| `SMARTASK_FEDERATED_MAX_ROWS`、`SMARTASK_FEDERATED_BATCH_SIZE` | 跨数据源拉取上限与批大小 |

报告、查询缓存和功能配置还会写入 `storage/`。部署时需要可写、可持久化的存储，不能只配置演示数据库路径。定时邮件需要 SMTP 配置，首次体验不启用。

## 开发检查

服务启动后，可使用仓库内已有脚本：

```bash
.venv/bin/python scripts/api_smoke.py
bash scripts/run_ui_smoke.sh
```

测试读取 `APP_URL`、`APP_USERNAME`、`APP_PASSWORD`；默认目标为本地 9010 端口。页面测试另外需要 Node.js 与 Playwright。

## 文件位置

| 目录 | 内容 |
| --- | --- |
| `app/routers/` | 页面、问数、SQL、数据源和报告接口 |
| `app/services/` | 模型调用、数据库查询和文件存储 |
| `templates/`、`static/` | 页面、脚本和内置前端依赖 |
| `scripts/`、`tests/e2e/` | 启动、构建与检查脚本 |
| `storage/` | 运行时数据与配置 |

容器和 Nuitka 构建方法见现有[部署文档](DEPLOYMENT.md)。本项目仍为原型；授权状态与使用边界见[项目首页](../../README.md)。
