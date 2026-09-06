from __future__ import annotations

"""应用入口。

负责三件事：
1. 创建 FastAPI 应用实例
2. 注册中间件、静态资源和路由
3. 在启动时初始化演示数据库并暴露健康检查
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.core.settings import get_settings, llm_runtime_status
from app.routers.api import router as api_router
from app.routers.data_dev import router as data_dev_router
from app.routers.pages import router as pages_router
from app.services.demo_db import ensure_demo_db


def _schema_ref(name: str) -> dict:
    return {"$ref": f"#/components/schemas/{name}"}


def _json_response(schema: dict, description: str = "成功响应", example: dict | None = None) -> dict:
    content: dict = {"schema": schema}
    if example is not None:
        content["example"] = example
    return {"description": description, "content": {"application/json": content}}


def _json_request(schema: dict, example: dict | None = None, *, required: bool = True) -> dict:
    content: dict = {"schema": schema}
    if example is not None:
        content["example"] = example
    return {"required": required, "content": {"application/json": content}}


def _error_responses(*, admin: bool = False, not_found: str | None = None) -> dict:
    responses = {
        "400": _json_response(_schema_ref("ErrorResponse"), "请求参数错误或业务校验失败", {"detail": "错误说明"}),
        "401": _json_response(_schema_ref("ErrorResponse"), "未登录或会话已失效", {"detail": "未登录"}),
    }
    if admin:
        responses["403"] = _json_response(_schema_ref("ErrorResponse"), "当前接口仅管理员可操作", {"detail": "仅管理员可操作"})
    if not_found:
        responses["404"] = _json_response(_schema_ref("ErrorResponse"), not_found, {"detail": not_found})
    return responses


def _install_custom_openapi(app: FastAPI) -> None:
    """增强 Swagger UI 文档：补齐中文说明、请求体、响应体和示例。"""

    def custom_openapi() -> dict:
        if app.openapi_schema:
            return app.openapi_schema

        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=(
                "ChatBI 智能问数 API。认证使用 Cookie Session；先调用 `/api/auth/login` 登录，"
                "后续请求自动携带 Cookie。本文档重点描述问数、SQL执行、图表上屏、自定义图表、"
                "邮件通知、缓存和数据源管理接口的入参与出参。"
            ),
            routes=app.routes,
        )

        components = schema.setdefault("components", {}).setdefault("schemas", {})
        components.update(
            {
                "ErrorResponse": {
                    "type": "object",
                    "title": "错误响应",
                    "properties": {"detail": {"type": "string", "description": "错误说明"}},
                    "required": ["detail"],
                },
                "SuccessResponse": {
                    "type": "object",
                    "title": "通用成功响应",
                    "properties": {"success": {"type": "boolean", "description": "是否成功", "example": True}},
                    "required": ["success"],
                },
                "RuntimeInfo": {
                    "type": "object",
                    "title": "LLM运行态",
                    "properties": {
                        "provider": {"type": "string", "description": "LLM Provider", "example": "openai_compatible"},
                        "wire_api": {"type": "string", "description": "调用协议", "example": "chat_completions"},
                        "configured": {"type": "boolean", "description": "当前 Provider 是否已配置"},
                        "ready": {"type": "boolean", "description": "模型是否可用"},
                        "mode": {"type": "string", "description": "运行模式", "example": "real_llm"},
                        "openai_configured": {"type": "boolean", "description": "OpenAI-compatible 配置是否完整"},
                        "agent_configured": {"type": "boolean", "description": "Agent HTTP 配置是否完整"},
                    },
                },
                "DatasourceItem": {
                    "type": "object",
                    "title": "数据源",
                    "properties": {
                        "id": {"type": "string", "description": "数据源ID", "example": "alarm"},
                        "name": {"type": "string", "description": "数据源名称", "example": "警情/火警库"},
                        "description": {"type": "string", "description": "描述"},
                        "db_type": {"type": "string", "description": "数据库类型", "example": "sqlite"},
                        "tables": {"type": "array", "items": {"type": "string"}, "description": "表名列表"},
                        "is_default": {"type": "boolean", "description": "是否内置数据源"},
                        "row_count": {"anyOf": [{"type": "integer"}, {"type": "null"}], "description": "数据行数，外部库可能为空"},
                    },
                },
                "ChatRequestDoc": {
                    "type": "object",
                    "title": "智能问数请求",
                    "properties": {
                        "question": {"type": "string", "description": "用户自然语言问题", "example": "统计各单位火警数量排名前5"},
                        "query": {"type": "string", "description": "兼容字段，等同 question"},
                        "datasource_ids": {"type": "array", "items": {"type": "string"}, "description": "数据源ID列表；为空时使用有权限的全部数据源", "example": ["alarm"]},
                        "history": {"type": "array", "items": {"type": "object"}, "description": "最近对话历史，元素通常包含 role/content"},
                    },
                },
                "OptimizationInfo": {
                    "type": "object",
                    "title": "SQL优化建议",
                    "properties": {
                        "execution_ms": {"type": "integer", "description": "SQL执行耗时，毫秒", "example": 1},
                        "suggestions": {"type": "array", "items": {"type": "string"}, "description": "优化建议"},
                        "notes": {"type": "array", "items": {"type": "string"}, "description": "执行备注"},
                    },
                },
                "ChartConfig": {
                    "type": "object",
                    "title": "图表配置",
                    "properties": {
                        "type": {"type": "string", "description": "图表类型", "example": "bar"},
                        "title": {"type": "string", "description": "图表标题"},
                        "xField": {"type": "string", "description": "X轴字段"},
                        "yField": {"type": "string", "description": "Y轴字段"},
                        "yFields": {"type": "array", "items": {"type": "string"}, "description": "多指标字段"},
                        "seriesField": {"type": "string", "description": "分组/堆叠系列字段"},
                        "valueField": {"type": "string", "description": "数值字段"},
                        "nameField": {"type": "string", "description": "饼图名称字段"},
                    },
                    "additionalProperties": True,
                },
                "ChatResult": {
                    "type": "object",
                    "title": "智能问数结果",
                    "properties": {
                        "success": {"type": "boolean", "example": True},
                        "question": {"type": "string", "description": "原始问题"},
                        "sql": {"type": "string", "description": "生成或执行的SQL"},
                        "sql_explain": {"type": "string", "description": "SQL说明"},
                        "data": {"type": "array", "items": {"type": "object", "additionalProperties": True}, "description": "查询结果行"},
                        "count": {"type": "integer", "description": "返回行数"},
                        "truncated": {"type": "boolean", "description": "是否截断"},
                        "max_rows": {"type": "integer", "description": "最大返回行数"},
                        "analysis": {"type": "string", "description": "分析说明"},
                        "chart": {"anyOf": [_schema_ref("ChartConfig"), {"type": "null"}], "description": "推荐图表配置"},
                        "optimization": _schema_ref("OptimizationInfo"),
                        "meta": {"type": "object", "additionalProperties": True, "description": "运行元数据，如 sql_source/cache_hit/cache_key"},
                        "result_id": {"type": "string", "description": "结果ID，用于上屏、下钻、邮件发送"},
                    },
                    "required": ["success"],
                },
                "CacheStats": {
                    "type": "object",
                    "title": "缓存统计",
                    "properties": {
                        "active": {"type": "integer", "description": "有效缓存数"},
                        "expired": {"type": "integer", "description": "已过期缓存数"},
                        "total": {"type": "integer", "description": "总缓存数"},
                        "ttl_seconds": {"type": "integer", "description": "TTL秒数", "example": 1800},
                        "max_items": {"type": "integer", "description": "最大缓存条数", "example": 200},
                        "size_bytes": {"type": "integer", "description": "缓存文件大小"},
                    },
                },
                "CustomChartSpec": {
                    "type": "object",
                    "title": "自定义图表协议",
                    "properties": {
                        "seriesType": {"type": "string", "enum": ["bar", "line", "scatter", "pie"], "description": "基础系列类型"},
                        "xField": {"type": "string", "description": "X/名称字段；为空时自动选择"},
                        "yField": {"type": "string", "description": "Y/数值字段；为空时自动选择"},
                        "option": {"type": "object", "description": "ECharts option 覆盖项，必须是 JSON 对象", "additionalProperties": True},
                    },
                },
                "CustomChartItem": {
                    "type": "object",
                    "title": "自定义图表模板",
                    "properties": {
                        "id": {"type": "string", "description": "模板ID"},
                        "name": {"type": "string", "description": "模板名称"},
                        "description": {"type": "string", "description": "模板说明"},
                        "spec": _schema_ref("CustomChartSpec"),
                        "created_at": {"type": "number", "description": "创建时间戳"},
                        "updated_at": {"type": "number", "description": "更新时间戳"},
                    },
                },
                "CustomChartRequestDoc": {
                    "type": "object",
                    "title": "保存自定义图表模板请求",
                    "properties": {
                        "id": {"type": "string", "description": "可选；传入则更新，不传则新增"},
                        "name": {"type": "string", "description": "模板名称", "example": "消防自定义折线"},
                        "description": {"type": "string", "description": "模板说明"},
                        "spec": _schema_ref("CustomChartSpec"),
                    },
                    "required": ["name"],
                },
                "MailSettings": {
                    "type": "object",
                    "title": "邮件通知配置",
                    "properties": {
                        "enabled": {"type": "boolean", "description": "是否启用邮件通知"},
                        "smtp_host": {"type": "string", "description": "SMTP主机", "example": "smtp.example.com"},
                        "smtp_port": {"type": "integer", "description": "SMTP端口", "example": 587},
                        "smtp_user": {"type": "string", "description": "SMTP账号"},
                        "smtp_password": {"type": "string", "description": "SMTP密码/授权码；读取接口不回显"},
                        "password_set": {"type": "boolean", "description": "是否已保存密码/授权码"},
                        "from_addr": {"type": "string", "description": "发件人地址"},
                        "use_tls": {"type": "boolean", "description": "是否使用STARTTLS"},
                        "use_ssl": {"type": "boolean", "description": "是否使用SSL"},
                        "default_recipients": {"type": "array", "items": {"type": "string"}, "description": "默认收件人"},
                        "subject_template": {"type": "string", "description": "默认标题模板，支持 {question}"},
                        "updated_at": {"type": "number", "description": "更新时间戳"},
                    },
                },
                "MailSendRequestDoc": {
                    "type": "object",
                    "title": "发送邮件请求",
                    "properties": {
                        "result_id": {"type": "string", "description": "问数结果ID；测试邮件可不传"},
                        "recipients": {"type": "array", "items": {"type": "string"}, "description": "收件人；为空时使用默认收件人"},
                        "subject": {"type": "string", "description": "邮件标题；为空时使用标题模板"},
                        "message": {"type": "string", "description": "附加说明"},
                    },
                },
                "MailSendResult": {
                    "type": "object",
                    "title": "邮件发送结果",
                    "properties": {
                        "sent": {"type": "integer", "description": "发送收件人数"},
                        "recipients": {"type": "array", "items": {"type": "string"}, "description": "实际收件人"},
                    },
                },
            }
        )

        examples = {
            "chat_request": {"question": "统计各单位火警数量排名前5", "datasource_ids": ["alarm"], "history": []},
            "chat_result": {
                "success": True,
                "question": "统计各单位火警数量排名前5",
                "sql": "SELECT unit_name AS 单位名称, COUNT(*) AS 火警数量 FROM fire_alarm_record GROUP BY unit_name ORDER BY 火警数量 DESC LIMIT 5",
                "data": [{"单位名称": "广州市天河区消防救援大队", "火警数量": 47}],
                "count": 5,
                "truncated": False,
                "max_rows": 800,
                "analysis": "思考过程：...",
                "chart": {"type": "bar", "title": "统计各单位火警数量排名前5", "xField": "单位名称", "yField": "火警数量"},
                "optimization": {"execution_ms": 1, "suggestions": ["聚合查询建议在分组字段上建立索引：unit_name。"], "notes": ["涉及表：fire_alarm_record"]},
                "meta": {"llm_provider": "openai_compatible", "llm_mode": "real_llm", "sql_source": "llm", "cache_hit": False},
                "result_id": "result_id_example",
            },
            "custom_chart": {
                "name": "消防自定义折线",
                "description": "按月份和火警数量绘制折线",
                "spec": {"seriesType": "line", "xField": "月份", "yField": "火警数量", "option": {"color": ["#2563eb"], "legend": {"top": 28}}},
            },
            "mail_settings": {
                "enabled": True,
                "smtp_host": "smtp.example.com",
                "smtp_port": 587,
                "smtp_user": "bi@example.com",
                "smtp_password": "smtp-auth-code",
                "from_addr": "bi@example.com",
                "use_tls": True,
                "use_ssl": False,
                "default_recipients": ["ops@example.com"],
                "subject_template": "智能问数结果：{question}",
            },
            "mail_send": {"result_id": "result_id_example", "recipients": ["ops@example.com"], "subject": "今日火警统计", "message": "请查看本次智能问数结果。"},
        }

        def patch(method: str, path: str, *, tag: str, summary: str, description: str, request_schema: dict | None = None, request_example: dict | None = None, response_schema: dict | None = None, response_example: dict | None = None, admin: bool = False, not_found: str | None = None) -> None:
            op = schema.get("paths", {}).get(path, {}).get(method)
            if not op:
                return
            op["tags"] = [tag]
            op["summary"] = summary
            op["description"] = description
            if request_schema is not None:
                op["requestBody"] = _json_request(request_schema, request_example)
            responses = {"200": _json_response(response_schema or _schema_ref("SuccessResponse"), "成功响应", response_example)}
            responses.update(_error_responses(admin=admin, not_found=not_found))
            op["responses"] = responses

        patch("post", "/api/auth/login", tag="认证", summary="登录", description="使用用户名和密码登录。成功后服务端写入 Session Cookie，后续接口使用该 Cookie 鉴权。", request_schema={"type": "object", "required": ["username", "password"], "properties": {"username": {"type": "string", "description": "用户名", "example": "admin"}, "password": {"type": "string", "description": "密码", "example": "admin123"}}}, request_example={"username": "admin", "password": "admin123"}, response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "user": {"type": "object", "properties": {"username": {"type": "string"}, "role": {"type": "string"}}}}}, response_example={"success": True, "user": {"username": "admin", "role": "admin"}})
        patch("get", "/api/auth/me", tag="认证", summary="当前用户", description="读取当前 Session 对应的用户信息。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "user": {"type": "object"}}})
        patch("post", "/api/auth/logout", tag="认证", summary="退出登录", description="清空当前 Session。")
        patch("get", "/api/runtime", tag="运行态", summary="LLM运行态", description="查看当前模型 Provider、调用协议、配置完整性和是否处于真实 LLM 模式。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": _schema_ref("RuntimeInfo")}})
        patch("get", "/api/datasources", tag="数据源", summary="数据源列表", description="获取当前用户有权限访问的数据源列表。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": {"type": "array", "items": _schema_ref("DatasourceItem")}}})
        patch("post", "/api/datasources", tag="数据源", summary="新增/更新数据源", description="新增或更新 SQLite/MySQL/PostgreSQL 数据源；SQLite 可同时快速建表。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": _schema_ref("DatasourceItem")}})
        patch("post", "/api/chat", tag="智能问数", summary="自然语言问数", description="根据自然语言问题生成 SQL、执行查询、返回表格数据、图表推荐、分析说明、SQL优化建议和 result_id。若识别为闲聊，则返回 chat 模式回复。", request_schema=_schema_ref("ChatRequestDoc"), request_example=examples["chat_request"], response_schema=_schema_ref("ChatResult"), response_example=examples["chat_result"])
        patch("post", "/api/chat/stream", tag="智能问数", summary="流式自然语言问数", description="SSE 流式返回 SQL、SQL说明、分析和最终结果。事件包括 sql_delta、sql、sql_explain_delta、sql_explain、analysis_delta、analysis、result、error、done。", request_schema=_schema_ref("ChatRequestDoc"), request_example=examples["chat_request"], response_schema={"type": "string", "description": "text/event-stream SSE 数据"})
        patch("post", "/api/sql/run", tag="智能问数", summary="执行SQL", description="执行用户编辑后的 SQL。仅允许安全 SELECT/WITH 查询，并校验表权限。", request_schema={"type": "object", "required": ["sql"], "properties": {"sql": {"type": "string", "description": "待执行SQL"}, "datasource_ids": {"type": "array", "items": {"type": "string"}}, "question": {"type": "string", "description": "用于生成分析和图表标题"}}}, request_example={"sql": "SELECT unit_name AS 单位名称, COUNT(*) AS 火警数量 FROM fire_alarm_record GROUP BY unit_name LIMIT 5", "datasource_ids": ["alarm"], "question": "统计各单位火警数量"}, response_schema=_schema_ref("ChatResult"))
        patch("post", "/api/drilldown", tag="智能问数", summary="图表下钻", description="根据已保存结果 result_id、点击字段和值，生成明细查询。", request_schema={"type": "object", "required": ["result_id", "field", "value"], "properties": {"result_id": {"type": "string"}, "field": {"type": "string"}, "value": {"type": "string"}, "datasource_ids": {"type": "array", "items": {"type": "string"}}}}, request_example={"result_id": "result_id_example", "field": "单位名称", "value": "广州市天河区消防救援大队", "datasource_ids": ["alarm"]}, response_schema=_schema_ref("ChatResult"), not_found="找不到要下钻的结果")
        patch("get", "/api/cache/stats", tag="查询缓存", summary="缓存统计", description="查看轻量查询缓存的有效条数、过期条数、TTL、容量和文件大小。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": _schema_ref("CacheStats")}})
        patch("post", "/api/cache/clear", tag="查询缓存", summary="清空缓存", description="清空查询缓存。仅管理员可操作。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "cleared": {"type": "integer"}}}, admin=True)
        patch("post", "/api/charts/pin", tag="图表上屏", summary="上屏图表", description="将问数结果固定到图表大屏。可传 chart 覆盖图表配置。", request_schema={"type": "object", "required": ["result_id"], "properties": {"result_id": {"type": "string"}, "chart": _schema_ref("ChartConfig")}}, request_example={"result_id": "result_id_example", "chart": {"type": "bar", "xField": "单位名称", "yField": "火警数量"}}, not_found="result_id不存在")
        patch("get", "/api/charts", tag="图表上屏", summary="上屏列表", description="读取当前用户已固定到图表大屏的结果列表。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": {"type": "array", "items": _schema_ref("ChatResult")}}})
        patch("delete", "/api/charts/{result_id}", tag="图表上屏", summary="取消上屏", description="从图表大屏取消指定 result_id。")
        patch("get", "/api/custom-charts", tag="自定义图表", summary="自定义图表模板列表", description="读取自定义图表模板。模板会出现在前端图表类型下拉中。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": {"type": "array", "items": _schema_ref("CustomChartItem")}}})
        patch("post", "/api/custom-charts", tag="自定义图表", summary="新增/更新自定义图表模板", description="保存自定义图表模板。支持 bar、line、scatter、pie，并可通过 ECharts option JSON 扩展。仅管理员可操作。", request_schema=_schema_ref("CustomChartRequestDoc"), request_example=examples["custom_chart"], response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": _schema_ref("CustomChartItem")}}, admin=True)
        patch("delete", "/api/custom-charts/{chart_id}", tag="自定义图表", summary="删除自定义图表模板", description="删除指定自定义图表模板。仅管理员可操作。", admin=True, not_found="自定义图表不存在")
        patch("get", "/api/mail/settings", tag="邮件通知", summary="读取邮件配置", description="读取 SMTP 邮件通知配置。密码不会回显，只返回 password_set。仅管理员可操作。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": _schema_ref("MailSettings")}}, admin=True)
        patch("post", "/api/mail/settings", tag="邮件通知", summary="保存邮件配置", description="保存 SMTP 主机、端口、账号、密码/授权码、发件人、TLS/SSL、默认收件人和标题模板。仅管理员可操作。", request_schema=_schema_ref("MailSettings"), request_example=examples["mail_settings"], response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": _schema_ref("MailSettings")}}, admin=True)
        patch("post", "/api/mail/test", tag="邮件通知", summary="发送测试邮件", description="使用当前 SMTP 配置发送测试邮件。未启用或配置缺失时返回 400 明确错误。仅管理员可操作。", request_schema=_schema_ref("MailSendRequestDoc"), request_example={"recipients": ["ops@example.com"], "subject": "智能问数邮件通知测试", "message": "这是一封 SMTP 配置测试邮件。"}, response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": _schema_ref("MailSendResult")}}, admin=True)
        patch("post", "/api/mail/send", tag="邮件通知", summary="发送问数结果邮件", description="把指定 result_id 对应的问数结果发送到邮件。收件人为空时使用默认收件人。", request_schema=_schema_ref("MailSendRequestDoc"), request_example=examples["mail_send"], response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": _schema_ref("MailSendResult")}}, not_found="找不到要发送的问数结果")
        patch("post", "/api/demo/seed-dashboard", tag="Demo", summary="生成演示大屏", description="为当前用户生成一批演示图表并固定到大屏。", response_schema={"type": "object", "properties": {"success": {"type": "boolean"}, "data": {"type": "array", "items": _schema_ref("ChatResult")}}})
        patch("post", "/api/demo/reset-db", tag="Demo", summary="重置演示数据库", description="删除并重新生成 demo SQLite 数据库。")
        patch("get", "/health", tag="运维", summary="健康检查", description="服务存活和 LLM 运行态检查。", response_schema={"type": "object", "properties": {"ok": {"type": "boolean"}, "app": {"type": "string"}, "version": {"type": "string"}, "llm_provider": {"type": "string"}, "llm_mode": {"type": "string"}, "llm_ready": {"type": "boolean"}}})

        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi


def create_app() -> FastAPI:
    # 统一在这里完成应用装配，便于本地启动和测试脚本复用同一入口。
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
    )

    # 演示项目默认允许配置化跨域，便于本地调试和后续前后端拆分。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 登录态通过 Session 保存，页面接口直接复用浏览器 Cookie。
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        https_only=settings.session_https_only,
        same_site=settings.session_same_site,
    )

    root_dir = Path(__file__).resolve().parents[1]
    static_dir = root_dir / "static"
    templates_dir = root_dir / "templates"
    storage_dir = root_dir / "storage"

    static_dir.mkdir(parents=True, exist_ok=True)
    templates_dir.mkdir(parents=True, exist_ok=True)
    storage_dir.mkdir(parents=True, exist_ok=True)

    # 静态目录下放的是 CSS、前端库和图表依赖。
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    # 页面路由负责返回 HTML，接口路由负责返回 JSON / SSE。
    _install_custom_openapi(app)
    app.include_router(pages_router)
    app.include_router(api_router, prefix="/api")
    app.include_router(data_dev_router, prefix="/api/dev")

    @app.on_event("startup")
    def _startup() -> None:
        # 启动时确保演示库存在，这样首次拉起项目就能直接体验。
        ensure_demo_db(settings.demo_db_path)

    @app.get("/health")
    def health() -> dict:
        # 健康检查除了服务存活，也顺带返回当前 LLM 模式，方便排查。
        runtime = llm_runtime_status(settings)
        return {
            "ok": True,
            "app": settings.app_name,
            "version": settings.app_version,
            "llm_provider": runtime["provider"],
            "llm_mode": runtime["mode"],
            "llm_ready": runtime["ready"],
        }

    return app


app = create_app()
