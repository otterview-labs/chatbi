# 首次体验：完成一次问数

本文验证本地原型流程，使用显式生成的模拟数据与规则模拟模式，不调用真实模型，不代表实际业务数据或模型效果。

## 1. 安装并准备数据

从仓库根目录进入主应用，创建环境：

```bash
cd projects/chatbi-smart-ask
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

如果已经按首页安装，直接继续。新启动只建表；演示数据需要手动生成。下面使用单独的 `.local-demo/` 数据库：

```bash
export SMARTASK_DEMO_DB_PATH="$PWD/.local-demo/demo.db"
.venv/bin/python - <<'PYDEMO'
import os
from app.services.demo_db import ensure_demo_db

ensure_demo_db(os.environ['SMARTASK_DEMO_DB_PATH'], seed=True)
print('已生成本地模拟数据，不代表真实业务记录。')
PYDEMO
SMARTASK_LLM_PROVIDER=mock .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 9010
```

`.local-demo/` 是运行时数据目录，不应提交到 Git。初始化函数对已有非空表不会重复填充。

## 2. 输入第一个问题

打开[本地页面](http://127.0.0.1:9010/)，使用新环境的演示账号 `admin` / `admin123` 登录。

选择“警情/火警库”，输入：

> 按月统计火警趋势

查看生成的 SQL、月份和火警数量。该问题走规则模拟逻辑；表格与图表来自本地模拟记录。也可以直接运行下面的 SQL 核对记录数：

```sql
SELECT COUNT(*) AS 记录数 FROM fire_alarm_record;
```

在新的模拟数据库中，该表应有 240 条记录。按月统计的月份与数值会随生成时间变化。

## 3. 查看图表与上屏

检查问数结果的图表，点击“上屏”，再打开 `/dashboard` 查看对应图表。修改 SQL 后重新执行，可以比较查询结果。

首次体验不需要配置模型 API Key、外部数据库或邮件服务。

## 4. 常见情况

| 情况 | 检查方式 |
| --- | --- |
| 页面无法访问 | 确认终端进程仍在运行，再请求 `http://127.0.0.1:9010/health`。 |
| 登录失败 | `admin` / `admin123` 是新环境默认演示账号；已有环境可能已修改账号。 |
| 查询为空 | 确认生成数据与启动服务使用同一个 `SMARTASK_DEMO_DB_PATH`，且页面选择“警情/火警库”。 |
| 自由提问未生成合适 SQL | `mock` 是有限规则模拟；真实模型接入见[应用配置](../README.md)。 |

完成后按 Ctrl+C 停止本地进程。规则模拟与真实模型的结果应分别记录。

[返回项目首页](../../../README.md) · [应用文档](../README.md)
