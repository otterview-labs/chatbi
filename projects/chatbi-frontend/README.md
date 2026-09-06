# ChatBI 前端资源

这是从 ChatBI 项目中单独拷出的前端资源目录。

来源项目：

```text
/Users/chenhao/code/chatbi-smart-ask
```

当前目录：

```text
/Users/chenhao/Desktop/code/chatbi-frontend
```

## 文件说明

```text
templates/index.html        智能问数首页
templates/dashboard.html    图表大屏
templates/data_dev.html     数据开发页面
templates/datasources.html  数据源管理页面
static/app_shell.css        页面公共样式
app/routers/pages.py        FastAPI 页面路由映射
docs/页面逻辑说明.md          页面结构说明
```

## 注意

这不是独立前端工程，也不是纯静态站点。页面模板依赖 ChatBI 后端提供的路由和接口：

```text
GET  /
GET  /dashboard
GET  /data-dev
GET  /datasources
POST /api/auth/login
POST /api/chat
POST /api/chat/stream
POST /api/sql/run
GET  /api/runtime
GET  /api/metrics
```

如果要完整运行，请启动 ChatBI 后端项目：

```bash
cd /Users/chenhao/code/chatbi-smart-ask
source .venv/bin/activate
source .env.local
python -m uvicorn app.main:app --host "$SMARTASK_HOST" --port "$SMARTASK_PORT"
```

然后访问：

```text
http://127.0.0.1:9010/
```
