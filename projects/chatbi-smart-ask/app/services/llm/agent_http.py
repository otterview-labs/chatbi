from __future__ import annotations

import json
import re
from typing import Any

import httpx

from app.services.llm.base import LLMClient


def _extract_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)

    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            text = _extract_text(item)
            if text:
                parts.append(text)
        return "\n".join(parts).strip()

    if isinstance(value, dict):
        for key in ("sql", "reply", "content", "text", "output", "result", "message", "answer"):
            text = _extract_text(value.get(key))
            if text:
                return text

        data = value.get("data")
        text = _extract_text(data)
        if text:
            return text

        choices = value.get("choices")
        if isinstance(choices, list) and choices:
            text = _extract_text(choices[0])
            if text:
                return text

        for v in value.values():
            text = _extract_text(v)
            if text:
                return text
    return ""


def _parse_intent(text: str) -> str:
    raw = (text or "").strip().lower()
    if not raw:
        return "unknown"
    m = re.search(r"\b(chat|data)\b", raw)
    if m:
        return m.group(1)
    if any(k in raw for k in ["闲聊", "聊天", "问候", "寒暄", "感谢", "告别"]):
        return "chat"
    if any(k in raw for k in ["查询", "数据", "图表", "统计", "sql", "字段"]):
        return "data"
    return "unknown"


class AgentHTTPLLM(LLMClient):
    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str = "",
        auth_scheme: str = "Bearer",
        timeout_s: int = 40,
    ) -> None:
        self._endpoint = (endpoint or "").strip()
        self._api_key = (api_key or "").strip()
        self._auth_scheme = (auth_scheme or "Bearer").strip()
        self._timeout_s = max(1, int(timeout_s))

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if not self._api_key:
            return headers

        scheme = self._auth_scheme.strip()
        low = scheme.lower()
        if low in {"none", "noauth"}:
            return headers
        if low in {"x-api-key", "x_api_key", "xapikey"}:
            headers["X-API-Key"] = self._api_key
            return headers
        if low == "token":
            headers["Authorization"] = f"Token {self._api_key}"
            return headers
        if low == "raw":
            headers["Authorization"] = self._api_key
            return headers
        headers["Authorization"] = f"{scheme} {self._api_key}"
        return headers

    async def _call(self, task: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not self._endpoint:
            raise RuntimeError("智能体端点未配置：SMARTASK_AGENT_ENDPOINT")

        body = {"task": task, **payload}
        async with httpx.AsyncClient(timeout=float(self._timeout_s)) as client:
            resp = await client.post(self._endpoint, headers=self._headers(), json=body)
            resp.raise_for_status()

            content_type = (resp.headers.get("content-type") or "").lower()
            if "application/json" in content_type:
                data = resp.json()
                return data if isinstance(data, dict) else {"data": data}

            raw = (resp.text or "").strip()
            if not raw:
                return {}
            try:
                data = json.loads(raw)
                return data if isinstance(data, dict) else {"data": data}
            except Exception:
                return {"content": raw}

    async def chat(self, question: str, history: list[dict]) -> str:
        data = await self._call("chat", {"question": question, "history": history})
        return _extract_text(data)

    async def explain_sql(self, question: str, sql: str) -> str:
        data = await self._call("explain_sql", {"question": question, "sql": sql})
        return _extract_text(data)

    async def generate_sql(self, prompt: str) -> str:
        data = await self._call("generate_sql", {"prompt": prompt})
        sql = _extract_text(data.get("sql"))
        if sql:
            return sql
        return _extract_text(data)

    async def classify_intent(self, question: str, history: list[dict]) -> str:
        data = await self._call("classify_intent", {"question": question, "history": history})
        intent = (data.get("intent") if isinstance(data, dict) else "") or ""
        if isinstance(intent, str) and intent.strip():
            return _parse_intent(intent)
        return _parse_intent(_extract_text(data))
