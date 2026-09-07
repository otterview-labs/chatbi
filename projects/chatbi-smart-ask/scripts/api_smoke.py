#!/usr/bin/env python3
from __future__ import annotations

"""后端接口冒烟测试。

特点：
1. 只依赖 Python 标准库，避免再额外引入 requests 等依赖
2. 自动维护 Cookie，模拟真实登录态
3. 覆盖首页、上屏、数据开发等关键接口链路
4. 对用户、数据源 CRUD、下钻等关键分支也做回归验证
"""

import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from uuid import uuid4

BASE_URL = os.environ.get('APP_URL', 'http://127.0.0.1:9010').rstrip('/')
USERNAME = os.environ.get('APP_USERNAME', 'admin')
PASSWORD = os.environ.get('APP_PASSWORD', 'admin123')
TIMEOUT = float(os.environ.get('SMOKE_TIMEOUT', '180'))


class SmokeError(RuntimeError):
    """冒烟失败时抛出的统一异常。"""


class Client:
    """一个最小可用的 HTTP 客户端。

    这里自己维护 CookieJar，这样登录一次之后，后续请求就能带上同一会话。
    """

    def __init__(self, base_url: str):
        self.base_url = base_url
        self.cookies = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def _build_request(self, path: str, *, method: str = 'GET', payload: dict | None = None, headers: dict | None = None):
        data = None
        req_headers = {'Accept': 'application/json'}
        if headers:
            req_headers.update(headers)
        if payload is not None:
            data = json.dumps(payload).encode('utf-8')
            req_headers['Content-Type'] = 'application/json'
        return urllib.request.Request(f'{self.base_url}{path}', data=data, headers=req_headers, method=method)

    def request(self, path: str, *, method: str = 'GET', payload: dict | None = None, headers: dict | None = None):
        req = self._build_request(path, method=method, payload=payload, headers=headers)
        try:
            return self.opener.open(req, timeout=TIMEOUT)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode('utf-8', errors='replace')
            raise SmokeError(f'{method} {path} -> HTTP {exc.code}: {body}') from exc
        except urllib.error.URLError as exc:
            raise SmokeError(f'{method} {path} -> {exc.reason}') from exc

    def request_json(self, path: str, *, method: str = 'GET', payload: dict | None = None):
        with self.request(path, method=method, payload=payload) as response:
            body = response.read().decode('utf-8', errors='replace')
            return response.status, json.loads(body or '{}')

    def request_text(self, path: str, *, method: str = 'GET', payload: dict | None = None, headers: dict | None = None):
        with self.request(path, method=method, payload=payload, headers=headers) as response:
            return response.status, response.read().decode('utf-8', errors='replace')

    def request_json_allow_error(self, path: str, *, method: str = 'GET', payload: dict | None = None):
        req = self._build_request(path, method=method, payload=payload)
        try:
            with self.opener.open(req, timeout=TIMEOUT) as response:
                body = response.read().decode('utf-8', errors='replace')
                return response.status, json.loads(body or '{}')
        except urllib.error.HTTPError as exc:
            body = exc.read().decode('utf-8', errors='replace')
            try:
                parsed = json.loads(body or '{}')
            except Exception:
                parsed = {'detail': body}
            return exc.code, parsed
        except urllib.error.URLError as exc:
            raise SmokeError(f'{method} {path} -> {exc.reason}') from exc


def check(condition: bool, message: str):
    """统一输出 PASS 信息，失败则立即中断。"""
    if not condition:
        raise SmokeError(message)
    print(f'[PASS] {message}')


def parse_sse_events(text: str):
    """把 SSE 文本拆成结构化事件。"""
    events: list[tuple[str, dict]] = []
    event_name = 'message'
    data_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip('\r')
        if not line:
            if data_lines:
                payload = json.loads('\n'.join(data_lines))
                events.append((event_name, payload))
            event_name = 'message'
            data_lines = []
            continue
        if line.startswith('event:'):
            event_name = line.split(':', 1)[1].strip()
        elif line.startswith('data:'):
            data_lines.append(line.split(':', 1)[1].strip())
    if data_lines:
        payload = json.loads('\n'.join(data_lines))
        events.append((event_name, payload))
    return events


def login(client: Client, username: str, password: str):
    status, payload = client.request_json(
        '/api/auth/login',
        method='POST',
        payload={'username': username, 'password': password},
    )
    check(status == 200 and payload.get('success') is True, f'登录成功：{username}')
    return payload


def main() -> int:
    client = Client(BASE_URL)
    temp_files: list[Path] = []
    temp_user_name = f'smoke_{uuid4().hex[:8]}'
    temp_user_password = 'smoke123'
    temp_user_password2 = 'smoke456'
    temp_ds_id = f'smoke_ds_{uuid4().hex[:8]}'
    temp_table = 'smoke_table'
    temp_table_alias = f'{temp_ds_id}__{temp_table}'

    try:
        status, health = client.request_json('/health')
        check(status == 200 and health.get('ok') is True, '健康检查可用')

        login(client, USERNAME, PASSWORD)

        status, me = client.request_json('/api/auth/me')
        check(status == 200 and me.get('user', {}).get('username') == USERNAME, '当前用户接口正常')

        status, users = client.request_json('/api/auth/users')
        check(status == 200 and users.get('success') is True and len(users.get('data') or []) >= 1, '用户列表接口正常')

        temp_db = Path(tempfile.gettempdir()) / f'{temp_ds_id}.db'
        temp_files.append(temp_db)
        if temp_db.exists():
            temp_db.unlink()

        status, created_ds = client.request_json(
            '/api/datasources',
            method='POST',
            payload={
                'id': temp_ds_id,
                'name': 'Smoke 测试数据源',
                'description': 'API smoke temporary datasource',
                'db_type': 'sqlite',
                'db_path': str(temp_db),
                'tables': [temp_table],
                'create_table': {
                    'name': temp_table,
                    'columns': [
                        {'name': 'region', 'type': 'TEXT'},
                        {'name': 'total', 'type': 'INTEGER'},
                    ],
                    'rows': [
                        {'region': 'A区', 'total': 3},
                        {'region': 'B区', 'total': 7},
                    ],
                },
            },
        )
        check(status == 200 and created_ds.get('success') is True and created_ds.get('data', {}).get('id') == temp_ds_id, '数据源创建接口正常')

        status, datasources = client.request_json('/api/datasources')
        ds_data = datasources.get('data') or []
        check(status == 200 and any(item.get('id') == temp_ds_id for item in ds_data), '数据源列表可见临时数据源')

        status, user_created = client.request_json(
            '/api/auth/users',
            method='POST',
            payload={
                'username': temp_user_name,
                'password': temp_user_password,
                'role': 'user',
                'allowed_datasource_ids': [temp_ds_id],
            },
        )
        check(status == 200 and user_created.get('success') is True and user_created.get('data', {}).get('username') == temp_user_name, '用户创建接口正常')

        limited_client = Client(BASE_URL)
        login(limited_client, temp_user_name, temp_user_password)
        status, limited_ds = limited_client.request_json('/api/datasources')
        limited_ids = [item.get('id') for item in (limited_ds.get('data') or [])]
        check(status == 200 and limited_ids == [temp_ds_id], '普通用户数据源权限过滤正常')

        status, user_updated = client.request_json(
            f'/api/auth/users/{urllib.parse.quote(temp_user_name)}',
            method='PUT',
            payload={
                'password': temp_user_password2,
                'allowed_datasource_ids': ['alarm'],
            },
        )
        check(status == 200 and user_updated.get('success') is True, '用户更新接口正常')

        relogin_client = Client(BASE_URL)
        login(relogin_client, temp_user_name, temp_user_password2)
        status, limited_ds2 = relogin_client.request_json('/api/datasources')
        limited_ids2 = [item.get('id') for item in (limited_ds2.get('data') or [])]
        check(status == 200 and limited_ids2 == ['alarm'], '用户更新后权限生效')

        status, logout_payload = relogin_client.request_json('/api/auth/logout', method='POST', payload={})
        check(status == 200 and logout_payload.get('success') is True, '登出接口正常')
        status, me_after_logout = relogin_client.request_json_allow_error('/api/auth/me')
        check(status == 401, '登出后鉴权状态正确')

        status, runtime = client.request_json('/api/runtime')
        check(status == 200 and runtime.get('success') is True and isinstance(runtime.get('data'), dict), '运行态接口正常')

        status, metrics = client.request_json('/api/metrics')
        check(status == 200 and metrics.get('success') is True and 'alarm_total' in metrics.get('data', {}), '指标接口正常')

        status, examples = client.request_json('/api/examples')
        check(status == 200 and examples.get('success') is True and len(examples.get('examples') or []) > 0, '示例问法接口正常')

        status, chat_smalltalk = client.request_json('/api/chat', method='POST', payload={'question': '你好'})
        check(status == 200 and chat_smalltalk.get('mode') == 'chat' and bool(chat_smalltalk.get('reply')), '闲聊问答正常')

        status, chat_query = client.request_json('/api/chat', method='POST', payload={'question': '按月统计火警趋势'})
        result_id = chat_query.get('result_id')
        sql_text = chat_query.get('sql') or ''
        rows = chat_query.get('data') or []
        # 列别名由 LLM 生成（月份/年月等），不做硬编码：取第一行第一个文本列做下钻。
        month_field = ''
        first_month = ''
        if rows and isinstance(rows[0], dict):
            for key, value in rows[0].items():
                if isinstance(value, str) and value:
                    month_field = key
                    first_month = value
                    break
        check(status == 200 and chat_query.get('success') is True and bool(result_id) and bool(sql_text) and bool(first_month), '查询问答正常并返回结果ID')

        status, drilldown = client.request_json(
            '/api/drilldown',
            method='POST',
            payload={'result_id': result_id, 'field': month_field, 'value': first_month},
        )
        check(status == 200 and drilldown.get('success') is True and bool(drilldown.get('data')), '下钻接口正常')

        status, stream_text = client.request_text(
            '/api/chat/stream',
            method='POST',
            payload={'question': '按月统计火警趋势'},
            headers={'Accept': 'text/event-stream'},
        )
        stream_events = parse_sse_events(stream_text)
        stream_names = [name for name, _ in stream_events]
        done_payload = next((payload for name, payload in reversed(stream_events) if name == 'done'), None)
        check(status == 200 and 'result' in stream_names and done_payload and done_payload.get('success') is True, '流式问答正常结束')

        status, sql_run = client.request_json(
            '/api/sql/run',
            method='POST',
            payload={'sql': 'SELECT COUNT(*) AS total FROM fire_alarm_record', 'question': '统计火警总数'},
        )
        check(status == 200 and sql_run.get('success') is True and bool(sql_run.get('data')), 'SQL 执行接口正常')

        status, sql_run_temp = client.request_json(
            '/api/sql/run',
            method='POST',
            payload={'sql': f'SELECT region, total FROM {temp_table_alias} ORDER BY total DESC', 'question': '测试临时数据源', 'datasource_ids': [temp_ds_id]},
        )
        temp_rows = sql_run_temp.get('data') or []
        check(status == 200 and sql_run_temp.get('success') is True and len(temp_rows) == 2 and temp_rows[0].get('region') == 'B区', '临时数据源 SQL 查询正常')

        status, pin_result = client.request_json('/api/charts/pin', method='POST', payload={'result_id': result_id})
        check(status == 200 and pin_result.get('success') is True, '图表上屏接口正常')

        status, charts = client.request_json('/api/charts')
        chart_list = charts.get('data') or []
        check(status == 200 and charts.get('success') is True and any(item.get('result_id') == result_id for item in chart_list), '上屏列表可见刚刚结果')

        status, seeded = client.request_json('/api/demo/seed-dashboard', method='POST', payload={})
        check(status == 200 and seeded.get('success') is True, '大屏种子数据接口正常')

        status, overview = client.request_json('/api/dev/overview')
        check(status == 200 and overview.get('success') is True and 'task_total' in overview.get('data', {}), '数据开发概览接口正常')

        status, sources = client.request_json('/api/dev/sources')
        check(status == 200 and sources.get('success') is True and len(sources.get('data') or []) > 0, '数据开发来源接口正常')

        status, tasks = client.request_json('/api/dev/tasks')
        task_list = tasks.get('data') or []
        check(status == 200 and tasks.get('success') is True and len(task_list) > 0, '数据开发任务列表正常')

        status, created_task = client.request_json(
            '/api/dev/tasks',
            method='POST',
            payload={
                'name': 'Smoke 自定义任务',
                'type': 'flink_realtime',
                'description': 'smoke test task',
                'runtime': {'parallelism': 2},
                'pipeline': {'nodes': [], 'edges': []},
                'linkage': {'enabled': True, 'rules': []},
            },
        )
        custom_task = created_task.get('data') or {}
        custom_task_id = custom_task.get('id')
        check(status == 200 and created_task.get('success') is True and bool(custom_task_id), '数据开发任务创建接口正常')

        status, task_detail = client.request_json(f'/api/dev/tasks/{urllib.parse.quote(custom_task_id)}')
        check(status == 200 and task_detail.get('success') is True and task_detail.get('data', {}).get('id') == custom_task_id, '任务详情接口正常')

        status, patched_task = client.request_json(
            f'/api/dev/tasks/{urllib.parse.quote(custom_task_id)}',
            method='PATCH',
            payload={'status': 'running', 'description': 'patched by smoke'},
        )
        check(status == 200 and patched_task.get('success') is True and patched_task.get('data', {}).get('status') == 'running', '任务更新接口正常')

        status, versioned_task = client.request_json(
            f'/api/dev/tasks/{urllib.parse.quote(custom_task_id)}/versions',
            method='POST',
            payload={'comment': 'smoke checkpoint'},
        )
        current_version = int((versioned_task.get('data') or {}).get('version') or 0)
        check(status == 200 and versioned_task.get('success') is True and current_version >= 2, '任务版本接口正常')

        status, rollback_task = client.request_json(
            f'/api/dev/tasks/{urllib.parse.quote(custom_task_id)}/rollback',
            method='POST',
            payload={'version': 1},
        )
        check(status == 200 and rollback_task.get('success') is True and int((rollback_task.get('data') or {}).get('version') or 0) >= 1, '任务回滚接口正常')

        task_id = task_list[0]['id']
        status, task_runs = client.request_json(f'/api/dev/tasks/{urllib.parse.quote(task_id)}/runs')
        check(status == 200 and task_runs.get('success') is True, '任务运行列表接口正常')

        status, start_run = client.request_json(f'/api/dev/tasks/{urllib.parse.quote(task_id)}/runs', method='POST', payload={})
        run_id = (start_run.get('data') or {}).get('run_id')
        check(status == 200 and start_run.get('success') is True and bool(run_id), '任务启动接口正常')

        status, run_detail = client.request_json(f'/api/dev/runs/{urllib.parse.quote(run_id)}')
        check(status == 200 and run_detail.get('success') is True and isinstance(run_detail.get('data', {}).get('logs'), list), '任务运行详情接口正常')

        status, linkage = client.request_json('/api/dev/simulate/linkage', method='POST', payload={})
        linkage_data = linkage.get('data') or {}
        check(status == 200 and linkage.get('success') is True and isinstance(linkage_data.get('push_targets'), list), '联动模拟接口正常')

        status, reset_dev = client.request_json('/api/dev/reset', method='POST', payload={})
        check(status == 200 and reset_dev.get('success') is True, '数据开发重置接口正常')

        status, reset_db = client.request_json('/api/demo/reset-db', method='POST', payload={})
        check(status == 200 and reset_db.get('success') is True, '演示库重置接口正常')

        status, metrics_after_reset = client.request_json('/api/metrics')
        check(status == 200 and metrics_after_reset.get('success') is True and 'alarm_total' in metrics_after_reset.get('data', {}), '重置后指标接口仍正常')

        status, delete_chart = client.request_json(f'/api/charts/{urllib.parse.quote(result_id)}', method='DELETE')
        check(status == 200 and delete_chart.get('success') is True, '图表取消上屏接口正常')

        status, delete_user = client.request_json(f'/api/auth/users/{urllib.parse.quote(temp_user_name)}', method='DELETE')
        check(status == 200 and delete_user.get('success') is True, '用户删除接口正常')

        status, delete_ds = client.request_json(f'/api/datasources/{urllib.parse.quote(temp_ds_id)}', method='DELETE')
        check(status == 200 and delete_ds.get('success') is True, '数据源删除接口正常')

        print('\nAPI smoke checks passed.')
        return 0
    finally:
        try:
            client.request_json_allow_error(f'/api/auth/users/{urllib.parse.quote(temp_user_name)}', method='DELETE')
        except Exception:
            pass
        try:
            client.request_json_allow_error(f'/api/datasources/{urllib.parse.quote(temp_ds_id)}', method='DELETE')
        except Exception:
            pass
        for path in temp_files:
            try:
                if path.exists():
                    path.unlink()
            except Exception:
                pass


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except SmokeError as exc:
        print(f'[FAIL] {exc}', file=sys.stderr)
        raise SystemExit(1)
