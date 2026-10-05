# ChatBI · 智能问数

[简体中文](README.md) · [English](README.en.md) · [首次体验](projects/chatbi-smart-ask/docs/first-query.md) · [反馈问题](https://github.com/otterview-labs/chatbi/issues)

用自然语言查询数据库，查看生成的 SQL、结果表格和图表，再把图表放到 Dashboard。

这是一个 FastAPI + Vue 问数原型，适合本地体验、界面演示和数据查询流程验证。默认使用规则模拟模式；接入模型服务后，可以验证真实的自然语言转 SQL 流程。

## 可以用来做什么

- 在问数页面输入问题，查看 SQL 和查询结果；修改 SQL 后再次执行。
- 管理 SQLite、MySQL、PostgreSQL、ClickHouse 数据源。
- 将查询图表放到 Dashboard，组合展示多个结果。
- 按问题清单生成 PDF / PPT 报告；定时邮件需要另外配置 SMTP。
- 在数据开发页面验证任务运行与查询结果的联动。

跨数据源查询采用将数据拉到本地 SQLite 的原型方案，适合小数据量验证。当前项目仍需完善生产所需的权限、审计和 SQL 治理。

## 本地启动

需要 Python 3.11 或更高版本。主应用的页面与前端依赖在仓库内提供，这条启动路径不需要单独构建 Node.js 前端。

```bash
git clone https://github.com/otterview-labs/chatbi.git
cd chatbi/projects/chatbi-smart-ask
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
SMARTASK_LLM_PROVIDER=mock .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 9010
```

打开[本地问数页面](http://127.0.0.1:9010/)。新建本地环境的演示账号为 `admin` / `admin123`，仅用于本地体验。

首次启动只创建演示表结构，不自动填充示例记录。没有数据时返回空结果是正常情况。按[首次体验指南](projects/chatbi-smart-ask/docs/first-query.md)显式生成模拟数据，即可体验“按月统计火警趋势 → 查看 SQL 与图表 → 上屏”。模拟数据不代表实际业务记录，`mock` 模式也不代表真实模型效果。

## 接入模型服务

项目支持 OpenAI 兼容接口和自定义 HTTP 智能体服务。先完成本地体验，再配置自己的模型服务：

```bash
export SMARTASK_LLM_PROVIDER=openai_compatible
export SMARTASK_OPENAI_BASE_URL='https://your-model-service.example/v1'
export SMARTASK_OPENAI_API_KEY='replace-with-your-key'
export SMARTASK_OPENAI_MODEL='your-model-name'
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 9010
```

上面的地址和模型名是占位符。变量见[应用配置](projects/chatbi-smart-ask/README.md)。真实模型可能生成错误 SQL，需要检查查询与结果。

## 页面与文档

| 入口 | 用途 |
| --- | --- |
| `/` | 问数、SQL 与结果展示 |
| `/dashboard` | 已上屏的图表 |
| `/datasources` | 数据源配置 |
| `/data-dev` | 数据开发任务 |
| `/health` | 进程健康检查 |
| `/docs` | 本地 API 文档，默认开发配置启用 |

- [首次体验：完成一次问数](projects/chatbi-smart-ask/docs/first-query.md)
- [应用开发与配置](projects/chatbi-smart-ask/README.md)
- [模块说明](projects/chatbi-smart-ask/docs/项目说明.md)
- [页面逻辑](projects/chatbi-smart-ask/docs/页面逻辑说明.md)

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `projects/chatbi-smart-ask/` | 可运行的 FastAPI 应用、页面、接口和测试 |
| `projects/chatbi-frontend/` | 页面资源副本，不能独立运行 |
| `artifacts/` | 历史构建产物；首次体验建议从源码启动 |

运行应用时进入 `projects/chatbi-smart-ask/`。两套页面目录不是两项独立产品。

## 反馈与授权

请在 [Issues](https://github.com/otterview-labs/chatbi/issues) 说明复现步骤、运行环境，以及使用的是规则模拟模式还是真实模型；日志和 SQL 示例请先去除凭据与业务数据。

当前仓库没有覆盖整个项目的顶层 LICENSE，项目授权范围待维护者明确。第三方依赖以各自许可证为准。

[Otterview Labs](https://github.com/otterview-labs)
