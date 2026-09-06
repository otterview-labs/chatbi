"""定时报告接口：报告配置 CRUD、手动生成下载、立即发送。

调度执行逻辑在 app/main.py 的后台任务里，这里只做同步的配置管理和手动触发。
"""
from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.settings import get_settings
from app.services.feature_store import feature_store
from app.services.query_engine import QueryEngine
from app.services import report_store as report_service
from app.services.report_store import ReportError, report_store

router = APIRouter()


class ReportPayload(BaseModel):
    id: Optional[str] = None
    name: str = ""
    description: str = ""
    questions: list[str] = Field(default_factory=list)
    datasource_ids: list[str] = Field(default_factory=list)
    formats: list[str] = Field(default_factory=lambda: ["pdf"])
    recipients: list[str] = Field(default_factory=list)
    schedule: dict[str, Any] = Field(default_factory=dict)


class ReportSendPayload(BaseModel):
    recipients: list[str] = Field(default_factory=list)


def _require_admin(request: Request) -> None:
    # 复用 api.py 的管理员校验逻辑，避免循环导入放在函数内。
    from app.routers.api import _require_admin as check

    check(request)


def _get_report_or_404(report_id: str) -> dict[str, Any]:
    report = report_store.get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="报告不存在")
    return report


@router.get("")
def list_reports(request: Request):
    _require_admin(request)
    return {"success": True, "data": report_store.list_reports()}


@router.post("")
def save_report(request: Request, payload: ReportPayload):
    _require_admin(request)
    try:
        record = report_store.upsert(payload.model_dump())
    except ReportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "data": record}


@router.delete("/{report_id}")
def delete_report(request: Request, report_id: str):
    _require_admin(request)
    if not report_store.delete(report_id):
        raise HTTPException(status_code=404, detail="报告不存在")
    return {"success": True}


@router.post("/{report_id}/generate")
async def generate_report(request: Request, report_id: str, fmt: str = "pdf"):
    _require_admin(request)
    report = _get_report_or_404(report_id)
    if fmt not in ("pdf", "pptx"):
        raise HTTPException(status_code=400, detail="格式仅支持 pdf 或 pptx")
    engine = QueryEngine(settings=get_settings())
    try:
        files = await report_service.generate_report_files(report, engine, formats=[fmt])
    except ReportError as e:
        raise HTTPException(status_code=500, detail=str(e))
    filename, content, mime = files[0]
    report_store.mark_run(report_id, status="manual_ok")
    return Response(
        content=content,
        media_type=mime,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.post("/{report_id}/send")
async def send_report(request: Request, report_id: str, payload: ReportSendPayload):
    _require_admin(request)
    report = _get_report_or_404(report_id)
    engine = QueryEngine(settings=get_settings())
    try:
        result = await report_service.send_report(
            report, engine, feature_store, recipients=payload.recipients or None
        )
    except ReportError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    report_store.mark_run(report_id, status="manual_sent")
    return {"success": True, "data": result}
