# ChatBI

[简体中文](README.md) · [English](README.en.md) · [First query guide (Chinese)](projects/chatbi-smart-ask/docs/first-query.md) · [Issues](https://github.com/otterview-labs/chatbi/issues)

Ask a database question, inspect the generated SQL, and view the result as a table or chart. Pin charts to a Dashboard to keep several results together.

ChatBI is a FastAPI + Vue prototype for local evaluation and demonstrations. It starts in a rule-based `mock` mode. Connect a model service separately to evaluate actual natural-language-to-SQL generation.

## Features

- Questions, visible SQL, editable queries, tables and charts.
- SQLite, MySQL, PostgreSQL and ClickHouse data sources.
- A Dashboard for pinned charts.
- PDF / PPT reports from a list of questions; scheduled email requires SMTP configuration.
- A data-development page for testing task and query workflows.

Cross-source queries copy data into local SQLite for execution. This approach is intended for small evaluation datasets. Production access control, auditing and SQL governance still need further work.

## Run locally

Use Python 3.11 or later. The main application includes its page templates and frontend assets; no separate Node.js build is needed for this path.

```bash
git clone https://github.com/otterview-labs/chatbi.git
cd chatbi/projects/chatbi-smart-ask
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
SMARTASK_LLM_PROVIDER=mock .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 9010
```

Open [the local app](http://127.0.0.1:9010/). A new local installation creates the demonstration account `admin` / `admin123`.

Startup creates the example table schema without seeding records. Empty query results are expected until you add data. The [first query guide](projects/chatbi-smart-ask/docs/first-query.md) explains how to explicitly seed synthetic records, try a question, inspect SQL and pin a chart. The interface and sample questions are in Chinese.

Synthetic records are demonstration data. Rule-based `mock` results do not measure model quality.

## Connect a model

OpenAI-compatible APIs and a custom HTTP agent interface are supported. After trying the local workflow, configure your own service:

```bash
export SMARTASK_LLM_PROVIDER=openai_compatible
export SMARTASK_OPENAI_BASE_URL='https://your-model-service.example/v1'
export SMARTASK_OPENAI_API_KEY='replace-with-your-key'
export SMARTASK_OPENAI_MODEL='your-model-name'
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 9010
```

The URL and model name above are placeholders. See the [application documentation](projects/chatbi-smart-ask/README.md) for configuration. Review generated SQL and results before using them with business data.

## Repository and documentation

| Path | Contents |
| --- | --- |
| `projects/chatbi-smart-ask/` | Runnable application, templates, APIs and tests |
| `projects/chatbi-frontend/` | A page-resource copy; not a standalone frontend |
| `artifacts/` | Historical build artifacts; use the source for initial evaluation |

The local app serves `/`, `/dashboard`, `/datasources`, `/data-dev` and `/health`. Development mode also exposes `/docs`.

- [First query guide (Chinese)](projects/chatbi-smart-ask/docs/first-query.md)
- [Application development and configuration](projects/chatbi-smart-ask/README.md)
- [Module notes (Chinese)](projects/chatbi-smart-ask/docs/项目说明.md)

## Feedback and license status

Report problems through [Issues](https://github.com/otterview-labs/chatbi/issues). Include reproduction steps and whether you used `mock` or an actual model. Remove credentials and business data from examples.

This repository currently has no top-level LICENSE covering the project. Project-wide license terms remain to be specified by the maintainer. Third-party dependencies retain their own licenses.

[Otterview Labs](https://github.com/otterview-labs)
