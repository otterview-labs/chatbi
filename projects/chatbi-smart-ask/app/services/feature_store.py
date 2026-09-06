from __future__ import annotations

import copy
import json
import smtplib
import ssl
import threading
import time
from dataclasses import dataclass
from email.message import EmailMessage
from html import escape
from pathlib import Path
from typing import Any
from uuid import uuid4


_ROOT = Path(__file__).resolve().parents[2]
_STORAGE = _ROOT / "storage" / "feature_store.json"


def _default_mail() -> dict[str, Any]:
    return {
        "enabled": False,
        "smtp_host": "",
        "smtp_port": 587,
        "smtp_user": "",
        "smtp_password": "",
        "from_addr": "",
        "use_tls": True,
        "use_ssl": False,
        "default_recipients": [],
        "subject_template": "智能问数结果：{question}",
    }


def _default_chart() -> dict[str, Any]:
    return {
        "id": "custom_bar_line",
        "name": "自定义柱状模板",
        "description": "基于查询结果第一列/第一个数值列生成，可用 option_json 覆盖 ECharts 配置。",
        "spec": {
            "seriesType": "bar",
            "xField": "",
            "yField": "",
            "option": {
                "color": ["#2563eb", "#10b981", "#f59e0b"],
                "legend": {"top": 28},
            },
        },
        "created_at": time.time(),
        "updated_at": time.time(),
    }


class FeatureStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or _STORAGE
        self._lock = threading.RLock()
        self._data: dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8") or "{}")
                if isinstance(data, dict):
                    self._data = data
            except Exception:
                self._data = {}
        self._data.setdefault("custom_charts", [_default_chart()])
        mail = self._data.setdefault("mail", _default_mail())
        for key, value in _default_mail().items():
            mail.setdefault(key, value)
        self._save()

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self._path)

    def list_custom_charts(self) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(list(self._data.get("custom_charts") or []))

    def upsert_custom_chart(self, payload: dict[str, Any]) -> dict[str, Any]:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValueError("自定义图表名称不能为空")
        chart_id = str(payload.get("id") or "").strip() or ("chart_" + uuid4().hex[:12])
        description = str(payload.get("description") or "").strip()
        spec = payload.get("spec") if isinstance(payload.get("spec"), dict) else {}
        option = spec.get("option")
        if option is None:
            option = {}
        if not isinstance(option, dict):
            raise ValueError("option 必须是 JSON 对象")
        series_type = str(spec.get("seriesType") or "bar").strip() or "bar"
        if series_type not in {"bar", "line", "scatter", "pie"}:
            raise ValueError("seriesType 仅支持 bar/line/scatter/pie")
        now = time.time()
        record = {
            "id": chart_id,
            "name": name,
            "description": description,
            "spec": {
                "seriesType": series_type,
                "xField": str(spec.get("xField") or "").strip(),
                "yField": str(spec.get("yField") or "").strip(),
                "option": option,
            },
            "created_at": float(payload.get("created_at") or now),
            "updated_at": now,
        }
        with self._lock:
            items = self._data.setdefault("custom_charts", [])
            for idx, item in enumerate(items):
                if item.get("id") == chart_id:
                    record["created_at"] = float(item.get("created_at") or record["created_at"])
                    items[idx] = record
                    self._save()
                    return copy.deepcopy(record)
            items.append(record)
            self._save()
            return copy.deepcopy(record)

    def delete_custom_chart(self, chart_id: str) -> bool:
        key = (chart_id or "").strip()
        if not key:
            return False
        with self._lock:
            items = self._data.setdefault("custom_charts", [])
            before = len(items)
            items[:] = [item for item in items if item.get("id") != key]
            changed = len(items) != before
            if changed:
                self._save()
            return changed

    def get_mail(self, *, sanitized: bool = False) -> dict[str, Any]:
        with self._lock:
            data = copy.deepcopy(self._data.setdefault("mail", _default_mail()))
        if sanitized:
            password = str(data.get("smtp_password") or "")
            data["smtp_password"] = ""
            data["password_set"] = bool(password)
        return data

    def update_mail(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            current = self._data.setdefault("mail", _default_mail())
            merged = {**current}
            for key in _default_mail().keys():
                if key not in payload:
                    continue
                if key == "smtp_password" and payload.get(key) == "":
                    continue
                merged[key] = payload.get(key)
            merged["enabled"] = bool(merged.get("enabled"))
            merged["use_tls"] = bool(merged.get("use_tls"))
            merged["use_ssl"] = bool(merged.get("use_ssl"))
            try:
                merged["smtp_port"] = int(merged.get("smtp_port") or 587)
            except Exception:
                merged["smtp_port"] = 587
            recipients = merged.get("default_recipients")
            if isinstance(recipients, str):
                recipients = [x.strip() for x in recipients.replace(";", ",").split(",") if x.strip()]
            merged["default_recipients"] = list(recipients or [])
            merged["updated_at"] = time.time()
            self._data["mail"] = merged
            self._save()
        return self.get_mail(sanitized=True)

    def send_mail(
        self,
        *,
        recipients: list[str],
        subject: str,
        html: str,
        text: str,
    ) -> dict[str, Any]:
        cfg = self.get_mail(sanitized=False)
        if not cfg.get("enabled"):
            raise ValueError("邮件通知未启用")
        host = str(cfg.get("smtp_host") or "").strip()
        if not host:
            raise ValueError("SMTP 主机未配置")
        from_addr = str(cfg.get("from_addr") or cfg.get("smtp_user") or "").strip()
        if not from_addr:
            raise ValueError("发件人未配置")
        targets = [x.strip() for x in recipients if x and x.strip()]
        if not targets:
            targets = [x.strip() for x in cfg.get("default_recipients") or [] if str(x).strip()]
        if not targets:
            raise ValueError("收件人不能为空")

        msg = EmailMessage()
        msg["Subject"] = subject or "智能问数结果"
        msg["From"] = from_addr
        msg["To"] = ", ".join(targets)
        msg.set_content(text or "")
        msg.add_alternative(html or escape(text or ""), subtype="html")

        port = int(cfg.get("smtp_port") or (465 if cfg.get("use_ssl") else 587))
        username = str(cfg.get("smtp_user") or "").strip()
        password = str(cfg.get("smtp_password") or "")
        if cfg.get("use_ssl"):
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context, timeout=20) as smtp:
                if username:
                    smtp.login(username, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as smtp:
                smtp.ehlo()
                if cfg.get("use_tls"):
                    smtp.starttls(context=ssl.create_default_context())
                    smtp.ehlo()
                if username:
                    smtp.login(username, password)
                smtp.send_message(msg)
        return {"sent": len(targets), "recipients": targets}


def result_to_mail(result: dict[str, Any], *, message: str = "", max_rows: int = 50) -> tuple[str, str]:
    question = str(result.get("question") or "智能问数结果")
    sql = str(result.get("sql") or "")
    analysis = str(result.get("analysis") or "")
    rows = result.get("data") or []
    if not isinstance(rows, list):
        rows = []
    rows = rows[:max_rows]

    text_lines = [f"问题：{question}", "", "SQL：", sql, "", "说明：", analysis]
    if message:
        text_lines.insert(0, message)
        text_lines.insert(1, "")

    table_html = "<div>无数据</div>"
    if rows:
        cols = list(rows[0].keys())
        head = "".join(f"<th>{escape(str(c))}</th>" for c in cols)
        body = "".join(
            "<tr>" + "".join(f"<td>{escape(str(row.get(c, '')))}</td>" for c in cols) + "</tr>"
            for row in rows
        )
        table_html = (
            "<table border='1' cellspacing='0' cellpadding='6' "
            "style='border-collapse:collapse;font-size:12px;'>"
            f"<thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"
        )

    html = f"""
    <div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#111827;">
      <h2>智能问数结果</h2>
      {'<p>' + escape(message) + '</p>' if message else ''}
      <p><b>问题：</b>{escape(question)}</p>
      <p><b>SQL：</b></p>
      <pre style="background:#f3f4f6;padding:10px;border-radius:6px;white-space:pre-wrap;">{escape(sql)}</pre>
      <p><b>分析：</b></p>
      <pre style="white-space:pre-wrap;">{escape(analysis)}</pre>
      <p><b>数据（前 {max_rows} 行）：</b></p>
      {table_html}
    </div>
    """
    return "\n".join(text_lines), html


feature_store = FeatureStore()
