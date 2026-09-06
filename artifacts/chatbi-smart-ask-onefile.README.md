# ChatBI 单文件执行包启动说明

本文档和下面这个单文件执行包放在同一层级：

```text
/Users/chenhao/Desktop/code/chatbi-smart-ask-onefile
```

## 1. 先确认这个包能在哪里运行

这个文件是从 910B 机器上用 Nuitka 编译出来的 Linux ARM64 包：

```text
类型：Linux ARM64 / aarch64 ELF
大小：约 47M
SHA256：ab06136eb0321c2fc97a978c5a993afe4da276c39ba63f7ae8d2a4e4871cc065
```

它不能在当前 macOS 本机直接运行。macOS 直接执行通常会报：

```text
exec format error
```

正确用法是把它拷贝到 Linux ARM64 / aarch64 环境运行，例如 910B 机器或同架构 Ubuntu 服务器。

## 2. Linux ARM64 上最小启动

假设文件放在服务器：

```text
/opt/chatbi/chatbi-smart-ask-onefile
```

先加执行权限：

```bash
chmod +x /opt/chatbi/chatbi-smart-ask-onefile
```

离线演示启动，不连接真实模型：

```bash
cd /opt/chatbi

SMARTASK_HOST=0.0.0.0 \
SMARTASK_PORT=8000 \
SMARTASK_SESSION_SECRET="change-me-to-a-long-random-secret" \
SMARTASK_LLM_PROVIDER=mock \
./chatbi-smart-ask-onefile
```

浏览器访问：

```text
http://服务器IP:8000/
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8000/health
```

离线演示模式返回里会看到：

```json
{
  "ok": true,
  "llm_provider": "mock",
  "llm_mode": "mock_rule",
  "llm_ready": false
}
```

这是正常的，表示当前没有接真实模型。

## 3. Linux ARM64 上连接 910B 模型启动

如果 ChatBI 和模型服务在同一台机器，且模型 OpenAI-compatible 服务监听 `9012`：

```bash
cd /opt/chatbi

SMARTASK_HOST=0.0.0.0 \
SMARTASK_PORT=8000 \
SMARTASK_SESSION_SECRET="change-me-to-a-long-random-secret" \
SMARTASK_LLM_PROVIDER=openai_compatible \
SMARTASK_OPENAI_BASE_URL="http://127.0.0.1:9012/v1" \
SMARTASK_OPENAI_API_KEY="replace-with-api-key-or-placeholder" \
SMARTASK_OPENAI_MODEL="Qwen3.6-35B-A3B" \
SMARTASK_OPENAI_WIRE_API="chat_completions" \
./chatbi-smart-ask-onefile
```

如果模型服务在另一台机器，把：

```bash
SMARTASK_OPENAI_BASE_URL="http://127.0.0.1:9012/v1"
```

改成当前服务器能访问到的真实地址，例如：

```bash
SMARTASK_OPENAI_BASE_URL="http://192.168.10.241:9012/v1"
```

真实模型模式下，健康检查应重点确认：

```text
ok=true
llm_provider=openai_compatible
llm_mode=real_llm
llm_ready=true
```

## 4. 推荐生产 env

生产运行建议显式写完整 env，尤其是 `storage` 相关路径，避免 onefile 解包目录变化导致运行数据不稳定。

先准备目录：

```bash
mkdir -p /data/chatbi/storage /var/log/chatbi
```

可以写一个环境文件：

```bash
cat >/opt/chatbi/chatbi.env <<'EOF'
SMARTASK_HOST=0.0.0.0
SMARTASK_PORT=8000
SMARTASK_LOG_LEVEL=info
SMARTASK_SESSION_SECRET=change-me-to-a-long-random-secret

SMARTASK_LLM_PROVIDER=openai_compatible
SMARTASK_OPENAI_BASE_URL=http://127.0.0.1:9012/v1
SMARTASK_OPENAI_API_KEY=replace-with-api-key-or-placeholder
SMARTASK_OPENAI_MODEL=Qwen3.6-35B-A3B
SMARTASK_OPENAI_WIRE_API=chat_completions

SMARTASK_DEBUG=false
SMARTASK_CORS_ORIGINS=*

SMARTASK_SQL_MAX_ROWS=800
SMARTASK_SQL_TIMEOUT_MS=6000
SMARTASK_FEDERATED_MAX_ROWS=20000
SMARTASK_FEDERATED_BATCH_SIZE=2000

SMARTASK_DEMO_DB_PATH=/data/chatbi/storage/demo.db
SMARTASK_DATASOURCE_STORE_PATH=/data/chatbi/storage/datasources.json
SMARTASK_USER_STORE_PATH=/data/chatbi/storage/users.json
SMARTASK_DEV_STORE_PATH=/data/chatbi/storage/data_dev_store.json
EOF
```

启动：

```bash
cd /opt/chatbi
set -a
. /opt/chatbi/chatbi.env
set +a
./chatbi-smart-ask-onefile
```

后台启动：

```bash
cd /opt/chatbi

nohup sh -c '
  set -a
  . /opt/chatbi/chatbi.env
  set +a
  exec /opt/chatbi/chatbi-smart-ask-onefile
' > /var/log/chatbi/chatbi.log 2>&1 &
```

查看日志：

```bash
tail -f /var/log/chatbi/chatbi.log
```

停止：

```bash
pkill -f chatbi-smart-ask-onefile
```

## 5. systemd 启动

创建服务文件：

```bash
cat >/etc/systemd/system/chatbi-smart-ask.service <<'EOF'
[Unit]
Description=ChatBI Smart Ask
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/chatbi
EnvironmentFile=/opt/chatbi/chatbi.env
ExecStart=/opt/chatbi/chatbi-smart-ask-onefile
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

启动：

```bash
systemctl daemon-reload
systemctl enable --now chatbi-smart-ask
```

查看状态：

```bash
systemctl status chatbi-smart-ask --no-pager -l
journalctl -u chatbi-smart-ask -f
```

重启：

```bash
systemctl restart chatbi-smart-ask
```

## 6. 如果要在当前 macOS 本地启动

不要运行这个 onefile。请用源码方式启动：

```bash
cd /Users/chenhao/code/chatbi-smart-ask

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

写本地 env：

```bash
cat >.env.local <<'EOF'
export SMARTASK_HOST=127.0.0.1
export SMARTASK_PORT=9010
export SMARTASK_LOG_LEVEL=info
export SMARTASK_SESSION_SECRET=local-dev-chatbi-secret-change-me
export SMARTASK_LLM_PROVIDER=mock

export SMARTASK_DEMO_DB_PATH=/Users/chenhao/code/chatbi-smart-ask/storage/demo.db
export SMARTASK_DATASOURCE_STORE_PATH=/Users/chenhao/code/chatbi-smart-ask/storage/datasources.json
export SMARTASK_USER_STORE_PATH=/Users/chenhao/code/chatbi-smart-ask/storage/users.json
export SMARTASK_DEV_STORE_PATH=/Users/chenhao/code/chatbi-smart-ask/storage/data_dev_store.json

export SMARTASK_DEBUG=true
export SMARTASK_CORS_ORIGINS=*
export SMARTASK_SQL_MAX_ROWS=800
export SMARTASK_SQL_TIMEOUT_MS=6000
export SMARTASK_FEDERATED_MAX_ROWS=20000
export SMARTASK_FEDERATED_BATCH_SIZE=2000
EOF
```

启动：

```bash
source .env.local

python -m uvicorn app.main:app \
  --host "$SMARTASK_HOST" \
  --port "$SMARTASK_PORT"
```

打开：

```text
http://127.0.0.1:9010/
```

## 7. 常见问题

### macOS 上执行失败

原因：`chatbi-smart-ask-onefile` 是 Linux ARM64 ELF，不是 macOS 可执行文件。

处理：拷贝到 Linux ARM64 服务器运行，或在 Mac 上使用源码方式启动。

### 端口被占用

检查：

```bash
ss -lntp | grep ':8000'
```

换端口：

```bash
SMARTASK_PORT=18080 ./chatbi-smart-ask-onefile
```

### `llm_ready=false`

检查：

```bash
echo "$SMARTASK_LLM_PROVIDER"
echo "$SMARTASK_OPENAI_BASE_URL"
echo "$SMARTASK_OPENAI_API_KEY"
echo "$SMARTASK_OPENAI_MODEL"
```

确认模型服务可访问：

```bash
curl -fsS "${SMARTASK_OPENAI_BASE_URL}/models"
```

### 重启后数据丢失

不要依赖 onefile 内部的 `storage`。设置这些外部路径：

```bash
SMARTASK_DEMO_DB_PATH=/data/chatbi/storage/demo.db
SMARTASK_DATASOURCE_STORE_PATH=/data/chatbi/storage/datasources.json
SMARTASK_USER_STORE_PATH=/data/chatbi/storage/users.json
SMARTASK_DEV_STORE_PATH=/data/chatbi/storage/data_dev_store.json
```
