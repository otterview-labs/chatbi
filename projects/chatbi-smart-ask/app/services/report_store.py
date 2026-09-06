"""定时报告：保存问题清单，批量跑问数生成 PDF/PPT 报告，支持定时邮件发送。

设计与项目其他 store 一致：JSON 文件持久化 + 线程锁，够演示用即可。
PDF 用 reportlab（内置 STSong-Light CID 字体，无需字体文件即可渲染中文），
PPT 用 python-pptx。两者均为可选依赖，未安装时报友好错误。
"""
from __future__ import annotations

import io
import json
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Sequence


_ROOT = Path(__file__).resolve().parents[2]
_STORAGE = _ROOT / "storage" / "reports.json"
_LOCK = threading.RLock()

_MAX_TABLE_ROWS = 20
_MAX_TABLE_COLS = 8
_CELL_MAX_CHARS = 24

_VALID_FORMATS = ("pdf", "pptx")


class ReportError(RuntimeError):
    pass


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _load() -> dict[str, Any]:
    if not _STORAGE.exists():
        return {"reports": []}
    try:
        data = json.loads(_STORAGE.read_text(encoding="utf-8") or "{}")
        if isinstance(data, dict) and isinstance(data.get("reports"), list):
            return data
    except Exception:
        pass
    return {"reports": []}


def _save(data: dict[str, Any]) -> None:
    _STORAGE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _STORAGE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    tmp.replace(_STORAGE)


def _normalize_schedule(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    stype = str(raw.get("type") or "daily").strip().lower()
    if stype not in ("daily", "interval"):
        stype = "daily"
    time_str = str(raw.get("time") or "08:30").strip()
    try:
        datetime.strptime(time_str, "%H:%M")
    except ValueError:
        time_str = "08:30"
    try:
        interval = max(5, int(raw.get("interval_minutes") or 60))
    except (TypeError, ValueError):
        interval = 60
    return {
        "enabled": bool(raw.get("enabled")),
        "type": stype,
        "time": time_str,
        "interval_minutes": interval,
    }


def normalize_report(raw: dict[str, Any]) -> dict[str, Any]:
    rid = str(raw.get("id") or "").strip() or uuid.uuid4().hex[:12]
    name = str(raw.get("name") or "").strip() or "未命名报告"
    questions = [str(q).strip() for q in (raw.get("questions") or []) if str(q).strip()]
    if not questions:
        raise ReportError("报告至少需要一个问题")
    datasource_ids = [str(x).strip() for x in (raw.get("datasource_ids") or []) if str(x).strip()]
    formats = [f for f in (raw.get("formats") or ["pdf"]) if f in _VALID_FORMATS] or ["pdf"]
    recipients = [str(x).strip() for x in (raw.get("recipients") or []) if str(x).strip()]
    return {
        "id": rid,
        "name": name,
        "description": str(raw.get("description") or "").strip(),
        "questions": questions,
        "datasource_ids": datasource_ids,
        "formats": formats,
        "recipients": recipients,
        "schedule": _normalize_schedule(raw.get("schedule")),
    }


class ReportStore:
    def list_reports(self) -> list[dict[str, Any]]:
        with _LOCK:
            return json.loads(json.dumps(_load().get("reports", [])))

    def get(self, report_id: str) -> dict[str, Any] | None:
        for item in self.list_reports():
            if item.get("id") == report_id:
                return item
        return None

    def upsert(self, raw: dict[str, Any]) -> dict[str, Any]:
        record = normalize_report(raw)
        with _LOCK:
            data = _load()
            reports = data.setdefault("reports", [])
            for i, item in enumerate(reports):
                if item.get("id") == record["id"]:
                    record["created_at"] = item.get("created_at") or _now_iso()
                    record["last_run_at"] = item.get("last_run_at")
                    record["last_status"] = item.get("last_status")
                    record["last_error"] = item.get("last_error")
                    record["updated_at"] = _now_iso()
                    reports[i] = record
                    break
            else:
                record["created_at"] = _now_iso()
                record["updated_at"] = _now_iso()
                record["last_run_at"] = None
                record["last_status"] = None
                record["last_error"] = None
                reports.append(record)
            _save(data)
        return record

    def delete(self, report_id: str) -> bool:
        with _LOCK:
            data = _load()
            reports = data.setdefault("reports", [])
            before = len(reports)
            reports[:] = [r for r in reports if r.get("id") != report_id]
            changed = len(reports) != before
            if changed:
                _save(data)
            return changed

    def mark_run(self, report_id: str, *, status: str, error: str = "") -> None:
        with _LOCK:
            data = _load()
            for item in data.setdefault("reports", []):
                if item.get("id") == report_id:
                    item["last_run_at"] = _now_iso()
                    item["last_status"] = status
                    item["last_error"] = error
                    break
            _save(data)


report_store = ReportStore()


def is_due(report: dict[str, Any], now: float | None = None) -> bool:
    """调度器用：判断报告是否到达执行时间。"""
    schedule = _normalize_schedule(report.get("schedule"))
    if not schedule["enabled"]:
        return False
    now_ts = now if now is not None else time.time()
    last_run_at = report.get("last_run_at")
    last_ts = 0.0
    if last_run_at:
        try:
            last_ts = datetime.strptime(str(last_run_at), "%Y-%m-%d %H:%M:%S").timestamp()
        except ValueError:
            last_ts = 0.0
    if schedule["type"] == "interval":
        return now_ts - last_ts >= schedule["interval_minutes"] * 60
    # daily：今天的触发时刻已过，且上次执行早于该时刻。
    hh, mm = schedule["time"].split(":")
    today_fire = datetime.fromtimestamp(now_ts).replace(
        hour=int(hh), minute=int(mm), second=0, microsecond=0
    ).timestamp()
    return now_ts >= today_fire and last_ts < today_fire


# ---------------------------------------------------------------------------
# 报告内容生成
# ---------------------------------------------------------------------------

async def run_report_questions(report: dict[str, Any], engine: Any) -> list[dict[str, Any]]:
    """逐个问题跑问数引擎，收集报告分节数据；单题失败不中断整份报告。"""
    sections: list[dict[str, Any]] = []
    datasource_ids: Sequence[str] = report.get("datasource_ids") or []
    for question in report.get("questions") or []:
        try:
            result = await engine.ask(question, datasource_ids, [])
        except Exception as e:  # noqa: BLE001 - 报告要尽量生成，异常降级为错误分节
            result = {"success": False, "error": str(e)}
        rows = result.get("data") or []
        columns = list(rows[0].keys()) if rows and isinstance(rows[0], dict) else []
        sections.append(
            {
                "question": question,
                "success": bool(result.get("success")),
                "error": str(result.get("error") or ""),
                "sql": str(result.get("sql") or ""),
                "analysis": str(result.get("analysis") or ""),
                "columns": columns,
                "rows": rows,
                "row_count": len(rows),
                "chart_type": ((result.get("chart") or {}).get("type") or "table"),
            }
        )
    return sections


def _cell_text(value: Any) -> str:
    text = "" if value is None else str(value)
    if len(text) > _CELL_MAX_CHARS:
        text = text[: _CELL_MAX_CHARS - 1] + "…"
    return text


def _table_matrix(section: dict[str, Any]) -> tuple[list[str], list[list[str]]]:
    columns = [str(c) for c in (section.get("columns") or [])][:_MAX_TABLE_COLS]
    rows = []
    for row in (section.get("rows") or [])[:_MAX_TABLE_ROWS]:
        rows.append([_cell_text(row.get(c)) for c in columns])
    return columns, rows


# 常见中文字体路径：优先嵌入 TTF/TTC，保证任何阅读器都能正常显示；
# 全部缺失时回退 reportlab 内置 STSong-Light CID 字体（依赖阅读器字库）。
_CJK_FONT_CANDIDATES = [
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    "/usr/share/fonts/truetype/arphic/uming.ttc",
]


def _resolve_pdf_font(pdfmetrics: Any, unicode_cid_font: Any) -> str:
    try:
        pdfmetrics.getFont("SmartAskCJK")
        return "SmartAskCJK"
    except KeyError:
        pass
    from reportlab.pdfbase.ttfonts import TTFont

    for path in _CJK_FONT_CANDIDATES:
        if not Path(path).exists():
            continue
        try:
            pdfmetrics.registerFont(TTFont("SmartAskCJK", path, subfontIndex=0))
            return "SmartAskCJK"
        except Exception:  # noqa: BLE001 - 某些 ttc 不被支持时继续尝试下一个
            continue
    try:
        pdfmetrics.getFont("STSong-Light")
    except KeyError:
        pdfmetrics.registerFont(unicode_cid_font("STSong-Light"))
    return "STSong-Light"


def build_pdf(report: dict[str, Any], sections: list[dict[str, Any]]) -> bytes:
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.platypus import (
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except ImportError as e:
        raise ReportError("缺少 PDF 依赖，请安装：pip install reportlab") from e

    font = _resolve_pdf_font(pdfmetrics, UnicodeCIDFont)
    title_style = ParagraphStyle("title", fontName=font, fontSize=20, leading=26, spaceAfter=6)
    meta_style = ParagraphStyle("meta", fontName=font, fontSize=10, leading=14, textColor=colors.grey)
    h2_style = ParagraphStyle("h2", fontName=font, fontSize=14, leading=20, spaceBefore=10, spaceAfter=4)
    body_style = ParagraphStyle("body", fontName=font, fontSize=10, leading=15)
    sql_style = ParagraphStyle(
        "sql", fontName=font, fontSize=8.5, leading=12,
        backColor=colors.whitesmoke, borderPadding=4, textColor=colors.HexColor("#333333"),
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
        title=report.get("name") or "智能问数报告",
    )
    story: list[Any] = [
        Paragraph(str(report.get("name") or "智能问数报告"), title_style),
        Paragraph(
            f"生成时间：{_now_iso()}　|　问题数：{len(sections)}　|　智能问数自动生成",
            meta_style,
        ),
        Spacer(1, 8),
    ]
    if report.get("description"):
        story.append(Paragraph(str(report["description"]), body_style))
        story.append(Spacer(1, 8))

    for i, section in enumerate(sections, start=1):
        story.append(Paragraph(f"{i}. {section['question']}", h2_style))
        if not section["success"]:
            story.append(Paragraph(f"查询失败：{section['error'] or '未知错误'}", body_style))
            continue
        if section["sql"]:
            story.append(Paragraph(section["sql"].replace("\n", "<br/>"), sql_style))
            story.append(Spacer(1, 4))
        columns, rows = _table_matrix(section)
        if columns and rows:
            table = Table([columns] + rows, repeatRows=1)
            table.setStyle(
                TableStyle(
                    [
                        ("FONTNAME", (0, 0), (-1, -1), font),
                        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8f0fe")),
                        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c8c8c8")),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f9fc")]),
                        ("TOPPADDING", (0, 0), (-1, -1), 3),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ]
                )
            )
            story.append(table)
            if section["row_count"] > _MAX_TABLE_ROWS:
                story.append(
                    Paragraph(f"（共 {section['row_count']} 行，报告仅展示前 {_MAX_TABLE_ROWS} 行）", meta_style)
                )
        if section["analysis"]:
            story.append(Spacer(1, 4))
            story.append(Paragraph(section["analysis"].replace("\n", "<br/>"), body_style))

    doc.build(story)
    return buf.getvalue()


def build_pptx(report: dict[str, Any], sections: list[dict[str, Any]]) -> bytes:
    try:
        from pptx import Presentation
        from pptx.dml.color import RGBColor
        from pptx.util import Emu, Pt
    except ImportError as e:
        raise ReportError("缺少 PPT 依赖，请安装：pip install python-pptx") from e

    prs = Presentation()
    slide_w, slide_h = prs.slide_width, prs.slide_height

    cover = prs.slides.add_slide(prs.slide_layouts[0])
    cover.shapes.title.text = str(report.get("name") or "智能问数报告")
    if len(cover.placeholders) > 1:
        cover.placeholders[1].text = f"生成时间：{_now_iso()}\n智能问数自动生成"

    for i, section in enumerate(sections, start=1):
        slide = prs.slides.add_slide(prs.slide_layouts[5])  # 仅标题版式
        slide.shapes.title.text = f"{i}. {section['question']}"

        margin = Emu(int(slide_w * 0.05))
        content_top = Emu(int(slide_h * 0.22))
        content_w = Emu(int(slide_w * 0.9))

        if not section["success"]:
            box = slide.shapes.add_textbox(margin, content_top, content_w, Emu(int(slide_h * 0.2)))
            box.text_frame.text = f"查询失败：{section['error'] or '未知错误'}"
            continue

        columns, rows = _table_matrix(section)
        # PPT 表格控制在 10 行内，保证版面可读。
        rows = rows[:10]
        if columns and rows:
            table_h = Emu(int(slide_h * 0.5))
            shape = slide.shapes.add_table(len(rows) + 1, len(columns), margin, content_top, content_w, table_h)
            table = shape.table
            for c, name in enumerate(columns):
                cell = table.cell(0, c)
                cell.text = name
                for p in cell.text_frame.paragraphs:
                    for run in p.runs:
                        run.font.size = Pt(12)
                        run.font.bold = True
            for r, row in enumerate(rows, start=1):
                for c, value in enumerate(row):
                    cell = table.cell(r, c)
                    cell.text = value
                    for p in cell.text_frame.paragraphs:
                        for run in p.runs:
                            run.font.size = Pt(10.5)

        if section["analysis"]:
            note_top = Emu(int(slide_h * 0.78))
            box = slide.shapes.add_textbox(margin, note_top, content_w, Emu(int(slide_h * 0.16)))
            tf = box.text_frame
            tf.word_wrap = True
            tf.text = section["analysis"][:300]
            for p in tf.paragraphs:
                for run in p.runs:
                    run.font.size = Pt(11)
                    run.font.color.rgb = RGBColor(0x55, 0x55, 0x55)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


_MIME_BY_FORMAT = {
    "pdf": "application/pdf",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


async def generate_report_files(
    report: dict[str, Any], engine: Any, formats: Sequence[str] | None = None
) -> list[tuple[str, bytes, str]]:
    """生成报告文件，返回 (文件名, 内容, MIME) 列表。"""
    sections = await run_report_questions(report, engine)
    wanted = [f for f in (formats or report.get("formats") or ["pdf"]) if f in _VALID_FORMATS] or ["pdf"]
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    name = str(report.get("name") or "report").replace("/", "_")
    files: list[tuple[str, bytes, str]] = []
    for fmt in wanted:
        content = build_pdf(report, sections) if fmt == "pdf" else build_pptx(report, sections)
        files.append((f"{name}_{stamp}.{fmt}", content, _MIME_BY_FORMAT[fmt]))
    return files


async def send_report(
    report: dict[str, Any],
    engine: Any,
    feature_store: Any,
    recipients: Sequence[str] | None = None,
) -> dict[str, Any]:
    """生成报告并作为附件发送邮件。"""
    files = await generate_report_files(report, engine)
    name = str(report.get("name") or "智能问数报告")
    text = f"{name}\n\n本邮件由智能问数定时报告自动生成，报告文件见附件。"
    html = f"<p><b>{name}</b></p><p>本邮件由智能问数定时报告自动生成，报告文件见附件。</p>"
    sent = feature_store.send_mail(
        recipients=list(recipients or report.get("recipients") or []),
        subject=f"定时报告：{name}",
        html=html,
        text=text,
        attachments=files,
    )
    return {"sent": sent, "files": [f[0] for f in files]}
