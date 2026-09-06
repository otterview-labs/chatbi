from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import MetaData, Table, create_engine, inspect, select
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import NoSuchModuleError


class RemoteDBError(RuntimeError):
    pass


@dataclass(frozen=True)
class RemoteTable:
    table: Table
    columns: list[tuple[str, str]]


def create_engine_from_url(db_url: str) -> Engine:
    if not db_url:
        raise RemoteDBError("数据库连接地址为空")
    try:
        url = make_url(db_url)
    except Exception as e:
        raise RemoteDBError(f"数据库连接地址格式错误：{e}") from e

    connect_args = {}
    timeout_s = int(os.getenv("SMARTASK_DB_CONNECT_TIMEOUT_S", "5") or "5")
    if timeout_s > 0 and "connect_timeout" not in url.query:
        if url.drivername.startswith(("postgresql", "mysql", "clickhouse")):
            connect_args["connect_timeout"] = timeout_s

    try:
        return create_engine(db_url, pool_pre_ping=True, future=True, connect_args=connect_args)
    except (ModuleNotFoundError, NoSuchModuleError) as e:
        if url.drivername.startswith("clickhouse"):
            raise RemoteDBError(
                "缺少 ClickHouse 驱动，请安装：pip install clickhouse-sqlalchemy"
            ) from e
        raise RemoteDBError(f"缺少数据库驱动（{url.drivername}）：{e}") from e


def split_table_name(table_name: str) -> tuple[str | None, str]:
    parts = [p.strip() for p in (table_name or "").split(".") if p.strip()]
    if len(parts) == 1:
        return None, parts[0]
    if len(parts) == 2:
        return parts[0], parts[1]
    raise RemoteDBError(f"表名格式不支持：{table_name}")


def validate_tables(engine: Engine, tables: Iterable[str]) -> list[str]:
    inspector = inspect(engine)
    missing: list[str] = []
    for table in tables:
        schema, name = split_table_name(table)
        if not inspector.has_table(name, schema=schema):
            missing.append(table)
    return missing


def load_table(engine: Engine, table_name: str) -> RemoteTable:
    metadata = MetaData()
    schema, name = split_table_name(table_name)
    table = Table(name, metadata, schema=schema, autoload_with=engine)
    columns = [(col.name, str(col.type)) for col in table.columns]
    if not columns:
        raise RemoteDBError(f"无法读取表字段：{table_name}")
    return RemoteTable(table=table, columns=columns)


def iter_table_rows(engine: Engine, table: Table, batch_size: int, max_rows: int | None = None):
    fetched = 0
    with engine.connect() as conn:
        result = conn.execute(select(table))
        while True:
            if max_rows is not None:
                remaining = max_rows - fetched
                if remaining <= 0:
                    break
                batch = result.fetchmany(min(batch_size, remaining))
            else:
                batch = result.fetchmany(batch_size)
            if not batch:
                break
            fetched += len(batch)
            yield batch
