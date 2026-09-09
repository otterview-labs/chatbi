# ChatBI 智能问数部署文档

本文档说明 ChatBI 在 Linux ARM64 / 910B 环境下的部署方式，包括单文件执行包、Nuitka standalone 目录产物、Docker、systemd、环境变量、验证和故障排查。

> **⚠️ 现有 Nuitka 产物已过期（2026-07-26 构建）**：下面列出的单文件包 / standalone 目录是较早版本编译的，不包含此后新增的功能——ClickHouse 数据源、SQL 生成/闲聊分离的双模型配置、定时报告（PDF/PPT 生成 + 邮件发送）、防幻觉与失败重试、相似查询缓存、以及整套前端视觉重做。如果要部署当前代码的完整能力，**必须在 910B（或同架构机器）上用第 12 节的步骤重新编译**，不能直接分发现有产物。

## 1. 部署包说明（较早版本，见上方提示）

当前已经准备了两类 Nuitka 产物。

### 1.1 单文件执行包

适合拷贝一个文件到 Linux ARM64 机器上快速启动。

本地位置：

```text
/Users/chenhao/code/chatbi-smart-ask-onefile
/Users/chenhao/code/chatbi-smart-ask/build/nuitka-onefile-chatbi-smart-ask-onefile
```

910B 远端位置：

```text
/data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask/build/nuitka-onefile/chatbi-smart-ask-onefile
```

文件信息：

```text
大小：约 47M
类型：Linux ARM64 / aarch64 ELF
SHA256：ab06136eb0321c2fc97a978c5a993afe4da276c39ba63f7ae8d2a4e4871cc065
```

限制：

- 该包是在 910B 的 Ubuntu 22.04 / Linux aarch64 环境编译的，只能在兼容 Linux ARM64 环境运行。
- 不能在 macOS 本地直接运行。macOS 上要用源码方式启动，或重新编译 macOS 版本。
- onefile 首次启动会解包到临时目录，启动会比 standalone 目录模式慢几秒。
- onefile 内置的 `storage/` 不适合长期保存运行状态，生产部署建议把数据路径显式指向外部可写目录。

### 1.2 Nuitka standalone 目录产物

适合长期部署，运行时文件结构更清楚。

本地位置：

```text
/Users/chenhao/code/chatbi-smart-ask/build/nuitka/run_compiled.dist/chatbi-smart-ask
```

910B 远端位置：

```text
/data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask/build/nuitka/run_compiled.dist/chatbi-smart-ask
```

注意：

- `run_compiled.dist/` 是完整运行目录，部署时要整体复制，不要只复制里面的二进制。
- 该目录内包含 Python 运行时、依赖库、模板、静态资源和初始 `storage/` 数据。

## 2. 环境要求

### 2.1 运行单文件或 standalone 产物

目标机器需要满足：

- Linux ARM64 / aarch64
- glibc 兼容 Ubuntu 22.04 环境
- 可用监听端口，例如 `8000`
- 如果走真实模型，机器需要能访问 OpenAI-compatible 模型服务

### 2.2 源码方式运行

源码方式需要：

- Python 3.10+
- 可创建虚拟环境
- 能安装 `requirements.txt`

### 2.3 Docker 方式运行

Docker 方式需要：

- Docker Engine
- 镜像内能访问模型服务地址
- 建议把 `storage/` 挂载为宿主机可写目录

## 3. 环境变量

### 3.1 必填变量

生产环境至少配置：

```bash
export SMARTASK_SESSION_SECRET="replace-with-a-long-random-secret"
export SMARTASK_LLM_PROVIDER=openai_compatible
export SMARTASK_OPENAI_BASE_URL="http://127.0.0.1:9012/v1"
export SMARTASK_OPENAI_API_KEY="replace-with-api-key-or-placeholder"
export SMARTASK_OPENAI_MODEL="Qwen3.6-35B-A3B"
export SMARTASK_OPENAI_WIRE_API="chat_completions"

# 可选：SQL 生成单独指定代码模型（留空则复用 SMARTASK_OPENAI_MODEL）。
# 2026-09 评测结论：qwen3-coder-plus 复杂 SQL 生成更快更稳，推荐用于此项；
# qwen3-coder-flash 更快但不遵循防笛卡尔积等规则，不推荐。
export SMARTASK_OPENAI_SQL_MODEL="qwen3-coder-plus"
```

说明：

- `SMARTASK_SESSION_SECRET` 必须替换成足够长的随机字符串，不要用示例值。
- 如果模型服务不在本机，把 `SMARTASK_OPENAI_BASE_URL` 改成当前运行环境可访问的地址。
- Docker 容器里如果要访问宿主机模型服务，Linux Docker 可使用 `--add-host=host.docker.internal:host-gateway`，然后写 `http://host.docker.internal:9012/v1`。
- 如果只做离线演示，可以设置 `SMARTASK_LLM_PROVIDER=mock`，但这不是真实模型链路。
- `SMARTASK_OPENAI_SQL_MODEL` 只影响 SQL 生成这一步，闲聊、SQL 说明、数据洞察仍使用 `SMARTASK_OPENAI_MODEL`。

### 3.2 监听和日志变量

```bash
export SMARTASK_HOST=0.0.0.0
export SMARTASK_PORT=8000
export SMARTASK_LOG_LEVEL=info
export SMARTASK_FORWARDED_ALLOW_IPS="*"
```

兼容旧脚本时也可以写：

```bash
export APP_HOST=0.0.0.0
export APP_PORT=8000
```

当 `SMARTASK_HOST` / `SMARTASK_PORT` 未设置时，编译启动入口会回退读取 `APP_HOST` / `APP_PORT`。

### 3.3 持久化数据变量

生产部署建议把这些路径指向外部可写目录：

```bash
export SMARTASK_DEMO_DB_PATH="/data/chatbi/storage/demo.db"
export SMARTASK_DATASOURCE_STORE_PATH="/data/chatbi/storage/datasources.json"
export SMARTASK_USER_STORE_PATH="/data/chatbi/storage/users.json"
export SMARTASK_DEV_STORE_PATH="/data/chatbi/storage/data_dev_store.json"
```

如果使用 onefile 单文件包，尤其建议设置这些变量，避免运行状态落在临时解包目录里。

**2026-09 起的行为变更**：应用不再默认往 `SMARTASK_DEMO_DB_PATH` 指向的 SQLite 库自动灌入虚构的火警/人员/装备/检查演示数据——启动时只建表结构，表内容默认是空的。这意味着全新部署出来的默认数据源（警情/人员/装备/检查）打开后是空的，需要用户自己接入真实数据源，或在需要投标/演示场合时手动调用 `app.services.demo_db.seed_demo_data(db_path)` 生成演示数据（未在任何 HTTP 接口中暴露，需要写一段脚本调用）。

### 3.4 可选变量

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

### 3.5 定时报告 / 邮件发送依赖

"定时报告"（PDF/PPT 自动生成 + 定点或按间隔发送）功能依赖：

- `reportlab`、`python-pptx` 两个 Python 包（已在 `requirements.txt` 中，源码方式安装即可；**Nuitka 编译产物需要确认打包时已包含这两个包**，否则报告生成会报错）。
- 邮件发送依赖应用内"邮件通知"页配置的 SMTP 信息（主机/端口/账号/密码，界面里配置，不是环境变量），需要目标机器能访问该 SMTP 服务器。
- PDF 生成会在系统里探测常见中文字体路径（macOS 的 PingFang/STHeiti，Linux 的 Noto Sans CJK / 文泉驿），探测不到会退回内置字体，中文显示依赖阅读器自带字库。生产 Linux 环境建议确认已安装 `fonts-noto-cjk` 或文泉驿字体包，否则生成的 PDF 在部分阅读器上可能中文显示异常。

## 4. 单文件执行包部署

### 4.1 上传文件

把单文件上传到目标 Linux ARM64 机器，例如：

```text
/opt/chatbi/chatbi-smart-ask-onefile
```

赋予执行权限：

```bash
chmod +x /opt/chatbi/chatbi-smart-ask-onefile
```

准备可写目录：

```bash
mkdir -p /data/chatbi/storage /var/log/chatbi
```

如果是首次部署，可以从项目里的 `storage/` 拷贝初始配置到 `/data/chatbi/storage/`。

### 4.2 离线演示启动

```bash
cd /opt/chatbi

SMARTASK_HOST=0.0.0.0 \
SMARTASK_PORT=8000 \
SMARTASK_SESSION_SECRET="replace-with-a-long-random-secret" \
SMARTASK_LLM_PROVIDER=mock \
SMARTASK_DEMO_DB_PATH="/data/chatbi/storage/demo.db" \
SMARTASK_DATASOURCE_STORE_PATH="/data/chatbi/storage/datasources.json" \
SMARTASK_USER_STORE_PATH="/data/chatbi/storage/users.json" \
SMARTASK_DEV_STORE_PATH="/data/chatbi/storage/data_dev_store.json" \
./chatbi-smart-ask-onefile
```

### 4.3 真实模型启动

```bash
cd /opt/chatbi

SMARTASK_HOST=0.0.0.0 \
SMARTASK_PORT=8000 \
SMARTASK_SESSION_SECRET="replace-with-a-long-random-secret" \
SMARTASK_LLM_PROVIDER=openai_compatible \
SMARTASK_OPENAI_BASE_URL="http://127.0.0.1:9012/v1" \
SMARTASK_OPENAI_API_KEY="replace-with-api-key-or-placeholder" \
SMARTASK_OPENAI_MODEL="Qwen3.6-35B-A3B" \
SMARTASK_OPENAI_WIRE_API="chat_completions" \
SMARTASK_DEMO_DB_PATH="/data/chatbi/storage/demo.db" \
SMARTASK_DATASOURCE_STORE_PATH="/data/chatbi/storage/datasources.json" \
SMARTASK_USER_STORE_PATH="/data/chatbi/storage/users.json" \
SMARTASK_DEV_STORE_PATH="/data/chatbi/storage/data_dev_store.json" \
./chatbi-smart-ask-onefile
```

### 4.4 后台启动

```bash
cd /opt/chatbi

nohup env \
  SMARTASK_HOST=0.0.0.0 \
  SMARTASK_PORT=8000 \
  SMARTASK_SESSION_SECRET="replace-with-a-long-random-secret" \
  SMARTASK_LLM_PROVIDER=openai_compatible \
  SMARTASK_OPENAI_BASE_URL="http://127.0.0.1:9012/v1" \
  SMARTASK_OPENAI_API_KEY="replace-with-api-key-or-placeholder" \
  SMARTASK_OPENAI_MODEL="Qwen3.6-35B-A3B" \
  SMARTASK_OPENAI_WIRE_API="chat_completions" \
  SMARTASK_DEMO_DB_PATH="/data/chatbi/storage/demo.db" \
  SMARTASK_DATASOURCE_STORE_PATH="/data/chatbi/storage/datasources.json" \
  SMARTASK_USER_STORE_PATH="/data/chatbi/storage/users.json" \
  SMARTASK_DEV_STORE_PATH="/data/chatbi/storage/data_dev_store.json" \
  ./chatbi-smart-ask-onefile > /var/log/chatbi/chatbi.log 2>&1 &
```

查看日志：

```bash
tail -f /var/log/chatbi/chatbi.log
```

停止：

```bash
pkill -f chatbi-smart-ask-onefile
```

## 5. standalone 目录产物部署

把整个 `run_compiled.dist/` 目录复制到服务器，例如：

```text
/opt/chatbi/run_compiled.dist
```

启动：

```bash
cd /opt/chatbi/run_compiled.dist

SMARTASK_HOST=0.0.0.0 \
SMARTASK_PORT=8000 \
SMARTASK_SESSION_SECRET="replace-with-a-long-random-secret" \
SMARTASK_LLM_PROVIDER=openai_compatible \
SMARTASK_OPENAI_BASE_URL="http://127.0.0.1:9012/v1" \
SMARTASK_OPENAI_API_KEY="replace-with-api-key-or-placeholder" \
SMARTASK_OPENAI_MODEL="Qwen3.6-35B-A3B" \
SMARTASK_OPENAI_WIRE_API="chat_completions" \
./chatbi-smart-ask
```

## 6. Docker 部署

先基于 Nuitka standalone 产物构建镜像：

```bash
cd /data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask
docker build -f Dockerfile.nuitka -t chatbi-smart-ask:nuitka .
```

启动容器：

```bash
docker run -d --name chatbi-smart-ask-public \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 19181:8000 \
  -v /data/chatbi/storage:/app/storage \
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

查看：

```bash
docker ps --filter name=chatbi-smart-ask-public
docker logs -f chatbi-smart-ask-public
```

停止：

```bash
docker stop chatbi-smart-ask-public
docker rm chatbi-smart-ask-public
```

## 7. systemd 部署

以下示例使用 onefile 单文件包。

创建 `/etc/systemd/system/chatbi-smart-ask.service`：

```ini
[Unit]
Description=ChatBI Smart Ask
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/chatbi
Environment=SMARTASK_HOST=0.0.0.0
Environment=SMARTASK_PORT=8000
Environment=SMARTASK_SESSION_SECRET=replace-with-a-long-random-secret
Environment=SMARTASK_LLM_PROVIDER=openai_compatible
Environment=SMARTASK_OPENAI_BASE_URL=http://127.0.0.1:9012/v1
Environment=SMARTASK_OPENAI_API_KEY=replace-with-api-key-or-placeholder
Environment=SMARTASK_OPENAI_MODEL=Qwen3.6-35B-A3B
Environment=SMARTASK_OPENAI_WIRE_API=chat_completions
Environment=SMARTASK_DEMO_DB_PATH=/data/chatbi/storage/demo.db
Environment=SMARTASK_DATASOURCE_STORE_PATH=/data/chatbi/storage/datasources.json
Environment=SMARTASK_USER_STORE_PATH=/data/chatbi/storage/users.json
Environment=SMARTASK_DEV_STORE_PATH=/data/chatbi/storage/data_dev_store.json
ExecStart=/opt/chatbi/chatbi-smart-ask-onefile
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

加载并启动：

```bash
systemctl daemon-reload
systemctl enable --now chatbi-smart-ask
```

查看状态和日志：

```bash
systemctl status chatbi-smart-ask --no-pager -l
journalctl -u chatbi-smart-ask -f
```

重启：

```bash
systemctl restart chatbi-smart-ask
```

## 8. 验证

### 8.1 健康检查

```bash
curl -fsS http://127.0.0.1:8000/health
```

离线演示模式返回示例：

```json
{"ok":true,"app":"智能问数","version":"0.1.0","llm_provider":"mock","llm_mode":"mock_rule","llm_ready":false}
```

真实模型模式应重点检查：

```text
ok=true
llm_provider=openai_compatible
llm_mode=real_llm
llm_ready=true
```

### 8.2 页面检查

浏览器打开：

```text
http://服务器IP:8000/
```

如果使用 910B 当前 Docker 端口映射：

```text
http://服务器IP:19181/
```

如果经过 FRP 或 Nginx，需要以实际外部映射地址为准。

### 8.3 问数链路检查

登录后发起一个自然语言问数请求。真实模型模式下，结果元信息里应能看到类似：

```text
meta.sql_source=llm
```

如果显示 `rule_fallback`，说明模型调用失败或模型返回的 SQL 不可用，服务走了规则兜底。

## 9. macOS 本地启动

当前 onefile 是 Linux ARM64 包，macOS 不能直接运行。如果要在 Mac 上本地调试，用源码方式：

```bash
cd /Users/chenhao/code/chatbi-smart-ask
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

SMARTASK_HOST=127.0.0.1 \
SMARTASK_PORT=9010 \
SMARTASK_SESSION_SECRET="dev-secret" \
SMARTASK_LLM_PROVIDER=mock \
python -m uvicorn app.main:app --host 127.0.0.1 --port 9010
```

打开：

```text
http://127.0.0.1:9010/
```

## 10. 常见问题

### 10.1 macOS 上执行 onefile 报错

原因：该文件是 Linux ARM64 ELF，不是 macOS Mach-O。

处理：放到 Linux ARM64 环境运行，或在 macOS 上用源码方式启动。

### 10.2 端口被占用

检查：

```bash
ss -lntp | grep ':8000'
```

换端口启动：

```bash
SMARTASK_PORT=18080 ./chatbi-smart-ask-onefile
```

### 10.3 `/health` 返回 `llm_ready=false`

检查：

- `SMARTASK_LLM_PROVIDER` 是否为 `openai_compatible`
- `SMARTASK_OPENAI_BASE_URL` 是否能从当前运行环境访问
- `SMARTASK_OPENAI_API_KEY` 是否为空
- `SMARTASK_OPENAI_MODEL` 是否和模型服务里的名称一致

测试模型服务：

```bash
curl -fsS "${SMARTASK_OPENAI_BASE_URL}/models"
```

### 10.4 页面 404 或静态资源丢失

如果使用 standalone 目录模式，确认部署的是整个 `run_compiled.dist/`，不是只复制单个 `chatbi-smart-ask`。

如果使用 onefile，确认没有手动删除 onefile 解包临时目录；正常情况下 Nuitka 会自动处理。

### 10.5 数据重启后丢失

onefile 默认资源来自内置包或临时解包目录，不适合长期保存状态。生产必须配置外部可写路径：

```bash
SMARTASK_DEMO_DB_PATH=/data/chatbi/storage/demo.db
SMARTASK_DATASOURCE_STORE_PATH=/data/chatbi/storage/datasources.json
SMARTASK_USER_STORE_PATH=/data/chatbi/storage/users.json
SMARTASK_DEV_STORE_PATH=/data/chatbi/storage/data_dev_store.json
```

### 10.6 Docker 里访问不到模型服务

Linux Docker 里 `127.0.0.1` 指容器本身，不是宿主机。可选处理：

```bash
--add-host=host.docker.internal:host-gateway
SMARTASK_OPENAI_BASE_URL=http://host.docker.internal:9012/v1
```

或直接配置为容器可访问的内网 IP。

## 11. 推荐部署选择

| 场景 | 推荐方式 |
| --- | --- |
| 快速拷贝到 910B 同类机器验证 | onefile 单文件包（需先按第 12 节重新编译） |
| 长期裸机运行 | standalone 目录产物 + systemd |
| 标准服务化部署 | Docker |
| macOS 本地调试 | 源码 + uvicorn |
| 接入 ClickHouse 数据源 | 任意方式均可，无需额外配置，`clickhouse-sqlalchemy` 已在依赖里 |

## 12. 重新编译 Nuitka 产物（2026-09 起必须）

现有产物是 2026-07-26 编译的，缺失此后新增的功能。在 910B（或同架构 Linux ARM64 机器）上按以下步骤重新编译：

```bash
cd /data/nvme0n1/jetlinks-ai-center/apps/chatbi-smart-ask   # 或对应源码路径
git pull                                                     # 拉取最新代码
bash scripts/build_nuitka.sh                                 # standalone 目录产物
```

产物输出在 `build/nuitka/run_compiled.dist/chatbi-smart-ask`。

如果需要单文件（onefile）产物，在 `build_nuitka.sh` 的 nuitka 命令里把 `--standalone` 换成 `--onefile`（或参考脚本里已有的 onefile 变体，如果没有则复制一份改造），其余 `--include-package` 参数保持一致。

**编译后务必验证新功能实际可用**，不要只看编译是否成功：

```bash
# 1) 健康检查确认服务起来
curl -fsS http://127.0.0.1:8000/health

# 2) 确认 ClickHouse 方言能加载（不需要真实 ClickHouse 服务也能验证到这一步）
./chatbi-smart-ask -c "from sqlalchemy import create_engine; create_engine('clickhouse+http://u:p@127.0.0.1:8123/d'); print('ok')"
# 如果产物不支持 -c 参数，改成起服务后调用 /api/datasources 接口注册一个
# db_type=clickhouse 的数据源，报错信息里不应出现"缺少 ClickHouse 驱动"

# 3) 确认报告生成依赖打包完整：登录后调用
curl -s -b cookies.txt -X POST "http://127.0.0.1:8000/api/reports/<已建报告ID>/generate?fmt=pdf" -o test.pdf
file test.pdf   # 应显示 "PDF document"，而不是报错或空文件
```

编译脚本里的 `--include-package` 列表如果后续又新增了第三方依赖（例如以后接入新的数据库驱动），必须同步加进 `scripts/build_nuitka.sh`，否则 `pip install -r requirements.txt` 能让代码在源码模式下跑通，但 Nuitka 编译产物会静默缺失这个包（Nuitka 的自动依赖探测对间接导入、插件式加载的包经常检测不到，这正是 `clickhouse-sqlalchemy`/`reportlab`/`python-pptx` 这次遗漏的原因）。
