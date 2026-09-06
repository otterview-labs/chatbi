from __future__ import annotations

import copy
import difflib
import hashlib
import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Sequence


_ROOT = Path(__file__).resolve().parents[2]
_STORAGE = _ROOT / "storage" / "query_cache.json"
_LOCK = threading.RLock()
_DEFAULT_TTL_SECONDS = 1800
_MAX_ITEMS = 200
_SIMILAR_THRESHOLD = 0.9

# 问句里的礼貌语/语气词不影响查询语义，归一化时剔除，让"请帮我查一下各单位火警数"
# 与"各单位火警数"命中同一条缓存。
_FILLER_RE = re.compile(
    r"^(请问|请|麻烦|帮我|帮忙|给我|我想|我要)+|(查询|查一下|查查|看看|看一下|统计一下|统计)|(呢|吗|呀|啊|吧)+$"
)
_PUNCT_RE = re.compile(r"[\s，。！？、；：,.!?;:\"'“”‘’（）()]+")


def normalize_question(question: str) -> str:
    text = (question or "").strip().lower()
    text = _PUNCT_RE.sub("", text)
    text = _FILLER_RE.sub("", text)
    return text or (question or "").strip().lower()


def make_key(question: str, datasource_ids: Sequence[str], history: Sequence[dict] | None = None) -> str:
    payload = {
        "question": normalize_question(question),
        "datasource_ids": sorted(str(x) for x in datasource_ids),
        "history": list(history or [])[-6:],
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _load() -> dict[str, Any]:
    if not _STORAGE.exists():
        return {"items": {}}
    try:
        with _STORAGE.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("items"), dict):
            return data
    except Exception:
        pass
    return {"items": {}}


def _save(data: dict[str, Any]) -> None:
    _STORAGE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STORAGE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, default=str)
    tmp.replace(_STORAGE)


def get(key: str, ttl_seconds: int = _DEFAULT_TTL_SECONDS) -> dict[str, Any] | None:
    now = time.time()
    with _LOCK:
        data = _load()
        item = data.get("items", {}).get(key)
        if not item:
            return None
        created_at = float(item.get("created_at") or 0)
        if ttl_seconds > 0 and now - created_at > ttl_seconds:
            data["items"].pop(key, None)
            _save(data)
            return None
        result = copy.deepcopy(item.get("result") or {})
        meta = result.setdefault("meta", {})
        meta["cache_hit"] = True
        meta["cache_key"] = key
        meta["cache_created_at"] = created_at
        return result


def set(
    key: str,
    result: dict[str, Any],
    ttl_seconds: int = _DEFAULT_TTL_SECONDS,
    datasource_ids: Sequence[str] | None = None,
) -> None:
    if not key or not result.get("success"):
        return
    with _LOCK:
        data = _load()
        items = data.setdefault("items", {})
        stored = copy.deepcopy(result)
        stored.pop("result_id", None)
        stored.setdefault("meta", {})["cache_hit"] = False
        items[key] = {
            "created_at": time.time(),
            "ttl_seconds": ttl_seconds,
            "question": stored.get("question"),
            "question_norm": normalize_question(str(stored.get("question") or "")),
            "datasource_ids": sorted(str(x) for x in datasource_ids or []),
            "sql": stored.get("sql"),
            "row_count": len(stored.get("data") or []),
            "result": stored,
        }
        if len(items) > _MAX_ITEMS:
            ordered = sorted(items.items(), key=lambda kv: float(kv[1].get("created_at") or 0))
            for old_key, _ in ordered[: len(items) - _MAX_ITEMS]:
                items.pop(old_key, None)
        _save(data)


def get_similar(
    question: str,
    datasource_ids: Sequence[str],
    ttl_seconds: int = _DEFAULT_TTL_SECONDS,
) -> dict[str, Any] | None:
    """精确 key 未命中时的兜底：按归一化问题的相似度复用缓存（阈值 0.9，数据源须一致）。"""
    qn = normalize_question(question)
    if not qn:
        return None
    ds = sorted(str(x) for x in datasource_ids)
    now = time.time()
    with _LOCK:
        data = _load()
        best_key = None
        best_ratio = 0.0
        for key, item in data.get("items", {}).items():
            created_at = float(item.get("created_at") or 0)
            if ttl_seconds > 0 and now - created_at > ttl_seconds:
                continue
            item_ds = item.get("datasource_ids")
            if item_ds and item_ds != ds:
                continue
            cand = item.get("question_norm") or normalize_question(str(item.get("question") or ""))
            if not cand:
                continue
            ratio = difflib.SequenceMatcher(None, qn, cand).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_key = key
        if not best_key or best_ratio < _SIMILAR_THRESHOLD:
            return None
        matched = data["items"][best_key]
        result = copy.deepcopy(matched.get("result") or {})
        meta = result.setdefault("meta", {})
        meta["cache_hit"] = True
        meta["cache_key"] = best_key
        meta["cache_created_at"] = float(matched.get("created_at") or 0)
        meta["cache_similarity"] = round(best_ratio, 3)
        meta["cache_matched_question"] = matched.get("question")
        return result


def stats(ttl_seconds: int = _DEFAULT_TTL_SECONDS) -> dict[str, Any]:
    now = time.time()
    with _LOCK:
        data = _load()
        items = data.get("items", {})
        active = 0
        expired = 0
        for item in items.values():
            created_at = float(item.get("created_at") or 0)
            if ttl_seconds > 0 and now - created_at > ttl_seconds:
                expired += 1
            else:
                active += 1
        size_bytes = _STORAGE.stat().st_size if _STORAGE.exists() else 0
        return {
            "active": active,
            "expired": expired,
            "total": len(items),
            "ttl_seconds": ttl_seconds,
            "max_items": _MAX_ITEMS,
            "size_bytes": size_bytes,
        }


def clear() -> int:
    with _LOCK:
        data = _load()
        count = len(data.get("items", {}))
        _save({"items": {}})
        return count
