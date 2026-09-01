"""Enhanced Ingestion Engine implementing the exact Notebook logic:
1. Extract from Azure SQL Server (supports BOTH created & updated columns via COALESCE, UPDATED_ONLY, CREATED_ONLY, or FULL)
2. Schema & data type casting
3. HashKey computation (MD5 of concatenated columns)
4. Adding ETL audit columns (ETLLoadedDate, ETLLoadedBy, ETLModifiedDate, ETLModifiedBy)
5. Incremental Merge (Left-anti for Inserts, HashKey diff for Updates, skipped if unchanged)
6. Automatic dual-watermark progression and execution logging
"""

import struct
import httpx
from datetime import datetime, timezone
import hashlib
import logging
import time
from typing import Any
import pyodbc
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.fabric.models.ingestion_models import TableSyncJob, SyncJobRun
from app.modules.fabric.schema_ingestion import (
    SourceCredentials,
    FabricTargetCredentials,
    DiscoveredTable,
    ColumnInfo,
    JobRunResult,
    TableJobConfig,
)

logger = logging.getLogger(__name__)

DATETIME_DATA_TYPES = {
    "datetime",
    "datetime2",
    "date",
    "smalldatetime",
    "datetimeoffset",
    "timestamp",
    "time",
}

CREATED_KEYWORDS = {
    "created",
    "create",
    "created_at",
    "created_date",
    "createdat",
    "createddate",
    "creation",
    "creation_time",
    "creation_date",
    "inserted",
    "inserted_at",
    "insert_date",
    "add_date",
    "date_added",
    "sys_start",
    "record_created",
}

UPDATED_KEYWORDS = {
    "updated",
    "update",
    "updated_at",
    "updated_date",
    "updatedat",
    "updateddate",
    "modified",
    "modified_at",
    "modified_date",
    "modifieddate",
    "modify",
    "modify_date",
    "last_modified",
    "last_updated",
    "last_update",
    "change_date",
    "changed_at",
    "sys_end",
    "timestamp",
    "record_updated",
}

PK_KEYWORDS = {"id", "key", "code", "num", "number", "pk"}


def _resolve_odbc_driver() -> str:
    """Find the best available SQL Server ODBC driver installed on the host."""
    drivers = pyodbc.drivers()
    preferred = [
        "ODBC Driver 18 for SQL Server",
        "ODBC Driver 17 for SQL Server",
        "ODBC Driver 13 for SQL Server",
        "SQL Server Native Client 11.0",
        "SQL Server",
    ]
    for p in preferred:
        if p in drivers:
            return p
    if drivers:
        return drivers[0]
    return "ODBC Driver 17 for SQL Server"


def _escape_odbc_val(val: str | None) -> str:
    if val is None:
        return ""
    val_str = str(val)
    if ";" in val_str or "{" in val_str or "}" in val_str:
        return "{" + val_str.replace("}", "}}") + "}"
    return val_str


def _handle_datetimeoffset(dto_value: Any) -> str | None:
    """
    Convert SQL Server datetimeoffset (ODBC SQL type -155 / SQL_SS_TIMESTAMPOFFSET) 
    binary struct to an ISO timestamp string: YYYY-MM-DD HH:MM:SS.ffffff
    Struct format: 20 bytes = SQLSMALLINT (year), SQLUSMALLINT * 5 (month, day, hour, min, sec),
    SQLUINTEGER (nanoseconds), SQLSMALLINT * 2 (tz_hour, tz_min) -> '=h5HI2h'
    """
    if dto_value is None:
        return None
    if isinstance(dto_value, str):
        return dto_value
    try:
        if isinstance(dto_value, bytes) or isinstance(dto_value, bytearray):
            tup = struct.unpack("=h5HI2h", dto_value)
            year, month, day, hour, minute, second, fraction, tz_hour, tz_min = tup
            microsecond = fraction // 1000 if fraction else 0
            return f"{year:04d}-{month:02d}-{day:02d} {hour:02d}:{minute:02d}:{second:02d}.{microsecond:06d}"
        return str(dto_value)
    except Exception as e:
        logger.warning(f"Error converting datetimeoffset struct: {e}")
        return str(dto_value)


try:
    pyodbc.add_output_converter(-155, _handle_datetimeoffset)
except Exception:
    pass


def get_source_connection(creds: SourceCredentials) -> pyodbc.Connection:
    """Connect to Azure SQL Server."""
    driver = _resolve_odbc_driver()
    server = creds.server.strip()
    if "," not in server and ":" not in server and creds.port and creds.port != 1433:
        server_str = f"{server},{creds.port}"
    else:
        server_str = server

    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={server_str};"
        f"DATABASE={creds.database.strip()};"
        f"UID={_escape_odbc_val(creds.username)};"
        f"PWD={_escape_odbc_val(creds.password)};"
        "Encrypt=yes;"
        "TrustServerCertificate=yes;"
        "Connection Timeout=15;"
    )
    conn = pyodbc.connect(conn_str, timeout=15)
    try:
        conn.add_output_converter(-155, _handle_datetimeoffset)
    except Exception:
        pass
    return conn


def _get_azure_sql_access_token(tenant_id: str, client_id: str, client_secret: str) -> bytes:
    """Acquire OAuth2 access token for Azure SQL / Fabric SQL Endpoint using Service Principal."""
    url = f"https://login.microsoftonline.com/{tenant_id.strip()}/oauth2/v2.0/token"
    payload = {
        "grant_type": "client_credentials",
        "client_id": client_id.strip(),
        "client_secret": client_secret.strip(),
        "scope": "https://database.windows.net/.default",
    }
    resp = httpx.post(url, data=payload, timeout=httpx.Timeout(20.0, connect=10.0))
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to acquire database access token: {resp.status_code} - {resp.text}")
    token = resp.json()["access_token"]
    token_bytes = token.encode("utf-16-le")
    return struct.pack(f"=i{len(token_bytes)}s", len(token_bytes), token_bytes)


def get_target_connection(creds: FabricTargetCredentials) -> pyodbc.Connection:
    """Connect to Microsoft Fabric Lakehouse or Warehouse SQL Endpoint."""
    driver = _resolve_odbc_driver()
    server = (creds.server or "").strip()
    database = (creds.database or "WH_METADATA").strip()

    conn = None

    # 1. Try Token-based connection (OAuth / User token)
    if creds.access_token and server:
        try:
            db_token_struct = _format_token_for_pyodbc(creds.access_token)
            conn_str = f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};Encrypt=yes;TrustServerCertificate=no;"
            SQL_COPT_SS_ACCESS_TOKEN = 1256
            conn = pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: db_token_struct}, timeout=30)
            try:
                conn.add_output_converter(-155, _handle_datetimeoffset)
            except Exception:
                pass
            return conn
        except Exception as e:
            logger.warning(f"Database token connection to {server} failed: {e}")

    # 2. Service Principal with Client ID and Client Secret
    if (creds.auth_mode == "service_principal" or creds.client_id) and creds.client_id and creds.client_secret and server:
        tenant_id = creds.tenant_id or os.getenv("FABRIC_TENANT_ID", "")
        try:
            token_struct = _get_azure_sql_access_token(tenant_id, creds.client_id, creds.client_secret)
            conn_str = f"DRIVER={{{driver}}};SERVER={server};DATABASE={database};Encrypt=yes;TrustServerCertificate=no;"
            SQL_COPT_SS_ACCESS_TOKEN = 1256
            conn = pyodbc.connect(conn_str, attrs_before={SQL_COPT_SS_ACCESS_TOKEN: token_struct}, timeout=30)
            logger.info("Successfully connected to Fabric SQL Endpoint via Service Principal: %s / %s", server, database)
            try:
                conn.add_output_converter(-155, _handle_datetimeoffset)
            except Exception:
                pass
            return conn
        except Exception as e:
            logger.warning(f"Service principal connection failed: {e}")

    # 3. Fallback SQL Authentication (Username / Password)
    if creds.username and creds.password and server:
        try:
            conn_str = (
                f"DRIVER={{{driver}}};"
                f"SERVER={server};"
                f"DATABASE={database};"
                f"UID={_escape_odbc_val(creds.username)};"
                f"PWD={_escape_odbc_val(creds.password)};"
                "Encrypt=yes;"
                "TrustServerCertificate=yes;"
                "Connection Timeout=25;"
            )
            conn = pyodbc.connect(conn_str, timeout=25)
            try:
                conn.add_output_converter(-155, _handle_datetimeoffset)
            except Exception:
                pass
            logger.info("Successfully connected to Fabric SQL Endpoint via SQL credentials: %s / %s", server, database)
            return conn
        except Exception as e:
            logger.warning(f"SQL credentials connection failed: {e}")

    raise RuntimeError(f"Could not establish connection to Fabric target '{server}' (database='{database}').")


def test_azure_sql_connection(creds: SourceCredentials) -> dict:
    """Test Azure SQL connection and return basic server version metadata."""
    try:
        conn = get_source_connection(creds)
        cursor = conn.cursor()
        cursor.execute("SELECT @@VERSION, DB_NAME()")
        row = cursor.fetchone()
        version = row[0] if row else "Unknown"
        db_name = row[1] if row else creds.database
        conn.close()
        return {
            "success": True,
            "message": f"Successfully connected to Azure SQL Database '{db_name}'.",
            "details": {"version": version, "database": db_name},
        }
    except Exception as e:
        logger.exception("Azure SQL connection failed")
        return {
            "success": False,
            "message": f"Connection failed: {str(e)}",
            "details": None,
        }


def test_fabric_connection(creds: FabricTargetCredentials) -> dict:
    """Test Microsoft Fabric Lakehouse / Warehouse SQL Endpoint connection."""
    try:
        conn = get_target_connection(creds)
        cursor = conn.cursor()
        cursor.execute("SELECT 1, DB_NAME()")
        row = cursor.fetchone()
        db_name = row[1] if row else creds.database
        conn.close()
        return {
            "success": True,
            "message": f"Successfully connected to Microsoft Fabric Target '{db_name}'.",
            "details": {"database": db_name},
        }
    except Exception as e:
        logger.exception("Fabric Target connection failed")
        return {
            "success": False,
            "message": f"Target connection failed: {str(e)}",
            "details": None,
        }


def discover_source_tables(creds: SourceCredentials) -> list[DiscoveredTable]:
    """Introspect Azure SQL Server to list all tables and inspect their column metadata.
    Automatically identifies created and updated timestamp columns, assigning
    Incremental Types: BOTH, UPDATED_ONLY, CREATED_ONLY, or FULL.
    """
    conn = get_source_connection(creds)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
              AND TABLE_SCHEMA NOT IN ('sys', 'information_schema', 'guest')
            ORDER BY TABLE_SCHEMA, TABLE_NAME
            """
        )
        table_rows = cursor.fetchall()
        if not table_rows:
            return []

        cursor.execute(
            """
            SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA NOT IN ('sys', 'information_schema', 'guest')
            ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
            """
        )
        col_rows = cursor.fetchall()

        table_columns_map: dict[tuple[str, str], list[ColumnInfo]] = {}
        for r in col_rows:
            schema_name, table_name, col_name, data_type = r[0], r[1], r[2], (r[3] or "").lower()
            key = (schema_name, table_name)
            is_dt = data_type in DATETIME_DATA_TYPES
            if key not in table_columns_map:
                table_columns_map[key] = []
            table_columns_map[key].append(
                ColumnInfo(column_name=col_name, data_type=data_type, is_datetime=is_dt)
            )

        discovered: list[DiscoveredTable] = []
        for row in table_rows:
            schema_name, table_name = row[0], row[1]
            key = (schema_name, table_name)
            cols = table_columns_map.get(key, [])
            dt_cols = [c.column_name for c in cols if c.is_datetime]

            created_col: str | None = None
            updated_col: str | None = None

            for col_name in dt_cols:
                low = col_name.lower().replace(" ", "").replace("_", "")
                if not updated_col and any(h.replace("_", "") in low for h in UPDATED_KEYWORDS):
                    updated_col = col_name
                elif not created_col and any(h.replace("_", "") in low for h in CREATED_KEYWORDS):
                    created_col = col_name

            # Determine load strategy & incremental type recommendation
            if updated_col and created_col:
                suggested_load_type = "INCREMENTAL"
                incremental_type = "BOTH"
                suggested_watermark = updated_col
            elif updated_col:
                suggested_load_type = "INCREMENTAL"
                incremental_type = "UPDATED_ONLY"
                suggested_watermark = updated_col
            elif created_col:
                suggested_load_type = "INCREMENTAL"
                incremental_type = "CREATED_ONLY"
                suggested_watermark = created_col
            elif dt_cols:
                suggested_load_type = "INCREMENTAL"
                incremental_type = "UPDATED_ONLY"
                suggested_watermark = dt_cols[0]
            else:
                suggested_load_type = "FULL"
                incremental_type = "FULL"
                suggested_watermark = None

            discovered.append(
                DiscoveredTable(
                    schema_name=schema_name,
                    table_name=table_name,
                    full_name=f"{schema_name}.{table_name}",
                    columns=cols,
                    datetime_columns=dt_cols,
                    created_column=created_col,
                    updated_column=updated_col,
                    suggested_load_type=suggested_load_type,
                    incremental_type=incremental_type,
                    suggested_watermark_column=suggested_watermark,
                )
            )

        return discovered
    finally:
        conn.close()


async def save_or_update_jobs(
    db: AsyncSession,
    jobs_payload: list[TableJobConfig],
    project_id: str | None = None,
) -> list[TableSyncJob]:
    """Persist selected table ingestion job configurations into metadata store."""
    saved_jobs: list[TableSyncJob] = []

    for item in jobs_payload:
        pid = item.project_id or project_id

        if pid:
            stmt = select(TableSyncJob).where(
                TableSyncJob.project_id == pid,
                TableSyncJob.source_schema == item.source_schema,
                TableSyncJob.source_table == item.source_table,
            )
        else:
            stmt = select(TableSyncJob).where(
                TableSyncJob.source_schema == item.source_schema,
                TableSyncJob.source_table == item.source_table,
            )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

        inc_type = item.incremental_type or ("INCREMENTAL" if item.load_type.upper() == "INCREMENTAL" else "FULL")

        if existing:
            if pid:
                existing.project_id = pid
            existing.target_schema = item.target_schema or "dbo"
            existing.target_table = item.target_table or item.source_table
            existing.load_type = item.load_type.upper()
            existing.incremental_type = inc_type
            existing.watermark_column = item.watermark_column
            existing.created_column = item.created_column
            existing.updated_column = item.updated_column
            existing.is_enabled = item.is_enabled
            existing.updated_at = datetime.utcnow()
            saved_jobs.append(existing)
        else:
            new_job = TableSyncJob(
                project_id=pid,
                source_schema=item.source_schema,
                source_table=item.source_table,
                target_schema=item.target_schema or "dbo",
                target_table=item.target_table or item.source_table,
                load_type=item.load_type.upper(),
                incremental_type=inc_type,
                watermark_column=item.watermark_column,
                created_column=item.created_column,
                updated_column=item.updated_column,
                is_enabled=item.is_enabled,
                last_run_status="IDLE",
            )
            db.add(new_job)
            saved_jobs.append(new_job)

    await db.commit()
    for j in saved_jobs:
        await db.refresh(j)
    return saved_jobs


async def get_all_jobs(db: AsyncSession, project_id: str | None = None) -> list[TableSyncJob]:
    """Retrieve all configured table sync jobs, optionally scoped to a project."""
    if project_id:
        stmt = select(TableSyncJob).where(TableSyncJob.project_id == project_id).order_by(TableSyncJob.created_at.asc())
    else:
        stmt = select(TableSyncJob).order_by(TableSyncJob.created_at.desc())
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def delete_job_by_id(job_id: str, db: AsyncSession) -> bool:
    """Delete a table sync job."""
    stmt = select(TableSyncJob).where(TableSyncJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        return False
    await db.delete(job)
    await db.commit()
    return True


def _compute_hash_key(values: list[Any]) -> str:
    """Exact Notebook Logic: HashKey = MD5(concat_ws('', all_columns_as_string))"""
    raw_str = "".join("" if v is None else str(v) for v in values)
    return hashlib.md5(raw_str.encode("utf-8")).hexdigest()


def _map_sql_type(data_type: str, char_len: Any, num_prec: Any, num_scale: Any) -> str:
    """Map source SQL Server data types to Fabric target compatible data types."""
    dt = (data_type or "").lower()
    if dt in ("varchar", "nvarchar", "char", "nchar", "text", "ntext", "xml"):
        if char_len is None or char_len == -1 or str(char_len) == "-1" or dt in ("text", "ntext", "xml"):
            return "VARCHAR(MAX)"
        try:
            cl = int(char_len)
            if 0 < cl <= 8000:
                return f"VARCHAR({cl})"
            return "VARCHAR(MAX)"
        except (ValueError, TypeError):
            return "VARCHAR(MAX)"
    if dt in ("decimal", "numeric"):
        p = num_prec or 18
        s = num_scale or 2
        return f"DECIMAL({p}, {s})"
    if dt in ("int", "integer"):
        return "INT"
    if dt == "bigint":
        return "BIGINT"
    if dt == "smallint":
        return "SMALLINT"
    if dt == "tinyint":
        return "TINYINT"
    if dt == "bit":
        return "BIT"
    if dt in ("float", "real", "money", "smallmoney"):
        return "FLOAT"
    if dt in ("datetime", "datetime2", "smalldatetime", "datetimeoffset"):
        return "DATETIME2(6)"
    if dt == "date":
        return "DATE"
    if dt == "time":
        return "TIME"
    if dt == "uniqueidentifier":
        return "VARCHAR(36)"
    return "VARCHAR(MAX)"


def _ensure_target_table_with_audit_columns(
    source_cursor: pyodbc.Cursor,
    target_cursor: pyodbc.Cursor,
    source_schema: str,
    source_table: str,
    target_schema: str,
    target_table: str,
    is_full_load: bool = False,
) -> tuple[list[str], str | None]:
    """Ensure target table exists in Fabric with HashKey and ETL audit columns.
    Returns (raw_column_names, primary_key_column_name).
    """
    source_cursor.execute(
        """
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
               NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
        """,
        (source_schema, source_table),
    )
    cols = source_cursor.fetchall()
    if not cols:
        raise ValueError(f"No columns found for source table [{source_schema}].[{source_table}]")

    column_names = [c[0] for c in cols]

    pk_col = None
    try:
        source_cursor.execute(
            """
            SELECT kcu.COLUMN_NAME
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
              ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
             AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
              AND tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
            """,
            (source_schema, source_table),
        )
        pk_row = source_cursor.fetchone()
        if pk_row:
            pk_col = pk_row[0]
    except Exception:
        pass

    if not pk_col:
        for c in column_names:
            low = c.lower()
            if low == "id" or low == f"{source_table.lower()}id" or any(h in low for h in PK_KEYWORDS):
                pk_col = c
                break

    target_cursor.execute(
        """
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        """,
        (target_schema, target_table),
    )
    exists = target_cursor.fetchone() is not None

    if is_full_load and exists:
        try:
            target_cursor.execute(f"DROP TABLE [{target_schema}].[{target_table}]")
            target_cursor.commit()
            exists = False
        except Exception as e:
            logger.warning(f"Could not drop target table [{target_schema}].[{target_table}]: {e}")

    if exists:
        for c in cols:
            c_name, c_type, c_len, c_prec, c_scale = c[0], c[1], c[2], c[3], c[4]
            target_type = _map_sql_type(c_type, c_len, c_prec, c_scale)
            if target_type == "VARCHAR(MAX)":
                try:
                    target_cursor.execute(f"ALTER TABLE [{target_schema}].[{target_table}] ALTER COLUMN [{c_name}] VARCHAR(MAX)")
                    target_cursor.commit()
                except Exception:
                    pass

    if not exists:
        col_defs = []
        for c in cols:
            c_name, c_type, c_len, c_prec, c_scale, is_null = c[0], c[1], c[2], c[3], c[4], c[5]
            target_type = _map_sql_type(c_type, c_len, c_prec, c_scale)
            nullable_sql = "NULL" if is_null == "YES" else "NOT NULL"
            col_defs.append(f"[{c_name}] {target_type} {nullable_sql}")

        col_defs.append("[HashKey] VARCHAR(64) NOT NULL")
        col_defs.append("[ETLLoadedDate] DATETIME2(6) NOT NULL")
        col_defs.append("[ETLLoadedBy] VARCHAR(128) NOT NULL")
        col_defs.append("[ETLModifiedDate] DATETIME2(6) NOT NULL")
        col_defs.append("[ETLModifiedBy] VARCHAR(128) NOT NULL")

        create_sql = f"CREATE TABLE [{target_schema}].[{target_table}] ({', '.join(col_defs)})"
        target_cursor.execute(create_sql)
        target_cursor.commit()

    return column_names, pk_col


def execute_table_sync_sync(
    job_id: str,
    source_creds: SourceCredentials,
    target_creds: FabricTargetCredentials,
    job_config: TableSyncJob,
) -> JobRunResult:
    """Executes pure Python implementation of the Notebook BronzeToSilver incremental load logic:
    Supports dual created & updated timestamp filtering (via COALESCE), HashKey diffing, and audit columns.
    """
    start_time = time.time()
    source_schema = job_config.source_schema
    source_table = job_config.source_table
    target_schema = job_config.target_schema or "dbo"
    target_table = job_config.target_table or source_table
    load_type = (job_config.load_type or "FULL").upper()
    inc_type = (getattr(job_config, "incremental_type", None) or "FULL").upper()
    watermark_col = job_config.watermark_column
    created_col = job_config.created_column
    updated_col = job_config.updated_column
    last_wm_value = job_config.last_watermark_value

    source_conn = None
    target_conn = None

    try:
        source_conn = get_source_connection(source_creds)
        target_conn = get_target_connection(target_creds)
        source_cursor = source_conn.cursor()
        target_cursor = target_conn.cursor()

        is_full = load_type == "FULL" or inc_type == "FULL"
        column_names, pk_col = _ensure_target_table_with_audit_columns(
            source_cursor, target_cursor, source_schema, source_table,
            target_schema, target_table, is_full_load=is_full
        )

        cols_str = ", ".join(f"[{c}]" for c in column_names)
        params: list[Any] = []

        # 1. Query source records based on Incremental Type
        if is_full:
            extract_sql = f"SELECT {cols_str} FROM [{source_schema}].[{source_table}]"
        elif (inc_type == "BOTH" or (created_col and updated_col)) and created_col in column_names and updated_col in column_names:
            # Dual watermark extraction: checks COALESCE(updated, created)
            if not last_wm_value:
                extract_sql = (
                    f"SELECT {cols_str} FROM [{source_schema}].[{source_table}] "
                    f"ORDER BY COALESCE([{updated_col}], [{created_col}]) ASC"
                )
            else:
                extract_sql = (
                    f"SELECT {cols_str} FROM [{source_schema}].[{source_table}] "
                    f"WHERE COALESCE([{updated_col}], [{created_col}]) > ? "
                    f"ORDER BY COALESCE([{updated_col}], [{created_col}]) ASC"
                )
                params.append(last_wm_value)
        elif inc_type == "CREATED_ONLY" and created_col and created_col in column_names:
            if not last_wm_value:
                extract_sql = f"SELECT {cols_str} FROM [{source_schema}].[{source_table}] ORDER BY [{created_col}] ASC"
            else:
                extract_sql = f"SELECT {cols_str} FROM [{source_schema}].[{source_table}] WHERE [{created_col}] > ? ORDER BY [{created_col}] ASC"
                params.append(last_wm_value)
        elif watermark_col and watermark_col in column_names:
            if not last_wm_value:
                extract_sql = f"SELECT {cols_str} FROM [{source_schema}].[{source_table}] ORDER BY [{watermark_col}] ASC"
            else:
                extract_sql = f"SELECT {cols_str} FROM [{source_schema}].[{source_table}] WHERE [{watermark_col}] > ? ORDER BY [{watermark_col}] ASC"
                params.append(last_wm_value)
        else:
            extract_sql = f"SELECT {cols_str} FROM [{source_schema}].[{source_table}]"

        source_cursor.execute(extract_sql, params)
        source_rows = source_cursor.fetchall()
        total_source_count = len(source_rows)

        new_watermark_value = last_wm_value
        inserted_count = 0
        updated_count = 0

        now_utc = datetime.now(timezone.utc)
        now_str = now_utc.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        user_str = "FabricDataEngineer"

        if total_source_count > 0:
            # Determine new high watermark across dual or single date columns
            if (inc_type == "BOTH" or (created_col and updated_col)) and created_col in column_names and updated_col in column_names:
                u_idx = column_names.index(updated_col)
                c_idx = column_names.index(created_col)
                wm_vals = [r[u_idx] or r[c_idx] for r in source_rows if (r[u_idx] is not None or r[c_idx] is not None)]
                if wm_vals:
                    new_watermark_value = str(max(wm_vals))
            elif inc_type == "CREATED_ONLY" and created_col and created_col in column_names:
                c_idx = column_names.index(created_col)
                wm_vals = [r[c_idx] for r in source_rows if r[c_idx] is not None]
                if wm_vals:
                    new_watermark_value = str(max(wm_vals))
            elif watermark_col and watermark_col in column_names:
                wm_idx = column_names.index(watermark_col)
                wm_vals = [r[wm_idx] for r in source_rows if r[wm_idx] is not None]
                if wm_vals:
                    new_watermark_value = str(max(wm_vals))

            transformed_rows: list[dict[str, Any]] = []
            for r in source_rows:
                row_vals = list(r)
                h_key = _compute_hash_key(row_vals)
                row_dict = {col_name: val for col_name, val in zip(column_names, row_vals)}
                row_dict["HashKey"] = h_key
                row_dict["ETLLoadedDate"] = now_str
                row_dict["ETLLoadedBy"] = user_str
                row_dict["ETLModifiedDate"] = now_str
                row_dict["ETLModifiedBy"] = user_str
                transformed_rows.append(row_dict)

            target_map: dict[Any, str] = {}
            if pk_col and not is_full:
                try:
                    target_cursor.execute(
                        f"SELECT [{pk_col}], [HashKey] FROM [{target_schema}].[{target_table}]"
                    )
                    t_rows = target_cursor.fetchall()
                    for tr in t_rows:
                        if tr[0] is not None:
                            target_map[tr[0]] = str(tr[1])
                except Exception as e:
                    logger.warning(f"Could not load target hashkeys: {e}")

            rows_to_insert: list[tuple] = []
            keys_to_update: list[Any] = []

            if not target_map or is_full or not pk_col:
                for tr in transformed_rows:
                    tuple_val = tuple(tr[c] for c in column_names) + (
                        tr["HashKey"], tr["ETLLoadedDate"], tr["ETLLoadedBy"],
                        tr["ETLModifiedDate"], tr["ETLModifiedBy"]
                    )
                    rows_to_insert.append(tuple_val)
                inserted_count = len(rows_to_insert)
            else:
                for tr in transformed_rows:
                    pk_val = tr[pk_col]
                    source_hash = tr["HashKey"]
                    tuple_val = tuple(tr[c] for c in column_names) + (
                        tr["HashKey"], tr["ETLLoadedDate"], tr["ETLLoadedBy"],
                        tr["ETLModifiedDate"], tr["ETLModifiedBy"]
                    )

                    if pk_val not in target_map:
                        rows_to_insert.append(tuple_val)
                        inserted_count += 1
                    elif target_map[pk_val] != source_hash:
                        keys_to_update.append(pk_val)
                        rows_to_insert.append(tuple_val)
                        updated_count += 1

            if keys_to_update and pk_col:
                chunk_size = 500
                for i in range(0, len(keys_to_update), chunk_size):
                    chunk = keys_to_update[i:i + chunk_size]
                    placeholders = ", ".join("?" for _ in chunk)
                    del_sql = f"DELETE FROM [{target_schema}].[{target_table}] WHERE [{pk_col}] IN ({placeholders})"
                    target_cursor.execute(del_sql, chunk)
                target_cursor.commit()

            if rows_to_insert:
                all_target_cols = column_names + ["HashKey", "ETLLoadedDate", "ETLLoadedBy", "ETLModifiedDate", "ETLModifiedBy"]
                all_cols_str = ", ".join(f"[{c}]" for c in all_target_cols)
                placeholders = ", ".join("?" for _ in all_target_cols)
                insert_sql = f"INSERT INTO [{target_schema}].[{target_table}] ({all_cols_str}) VALUES ({placeholders})"

                try:
                    target_cursor.fast_executemany = True
                    target_cursor.executemany(insert_sql, rows_to_insert)
                except Exception as e:
                    logger.warning(f"fast_executemany failed ({e}), falling back to standard executemany...")
                    target_cursor.fast_executemany = False
                    target_cursor.executemany(insert_sql, rows_to_insert)
                target_cursor.commit()

        total_transferred = inserted_count + updated_count
        duration = time.time() - start_time

        return JobRunResult(
            job_id=job_id,
            table_name=f"{source_schema}.{source_table}",
            status="SUCCESS",
            load_type=load_type,
            incremental_type=inc_type,
            rows_transferred=total_transferred,
            watermark_start=last_wm_value,
            watermark_end=new_watermark_value,
            duration_seconds=round(duration, 2),
        )

    except Exception as e:
        duration = time.time() - start_time
        logger.exception(f"Error during ingestion for job {job_id}")
        return JobRunResult(
            job_id=job_id,
            table_name=f"{source_schema}.{source_table}",
            status="FAILED",
            load_type=load_type,
            incremental_type=inc_type,
            rows_transferred=0,
            watermark_start=last_wm_value,
            watermark_end=last_wm_value,
            error_message=str(e),
            duration_seconds=round(duration, 2),
        )
    finally:
        if source_conn:
            try:
                source_conn.close()
            except Exception:
                pass
        if target_conn:
            try:
                target_conn.close()
            except Exception:
                pass


async def execute_job_and_record(
    job_id: str,
    source_creds: SourceCredentials,
    target_creds: FabricTargetCredentials,
    db: AsyncSession,
) -> JobRunResult:
    """Execute sync job, persist execution logs, and update high watermark in the database."""
    stmt = select(TableSyncJob).where(TableSyncJob.id == job_id)
    res = await db.execute(stmt)
    job = res.scalar_one_or_none()
    if not job:
        raise ValueError(f"Job with ID '{job_id}' not found.")

    job.last_run_status = "RUNNING"
    await db.commit()

    result = execute_table_sync_sync(job_id, source_creds, target_creds, job)

    run_log = SyncJobRun(
        job_id=job.id,
        source_table=f"{job.source_schema}.{job.source_table}",
        target_table=f"{job.target_schema}.{job.target_table}",
        load_type=job.load_type,
        incremental_type=job.incremental_type,
        watermark_column=job.watermark_column,
        watermark_start=result.watermark_start,
        watermark_end=result.watermark_end,
        rows_transferred=result.rows_transferred,
        status=result.status,
        error_message=result.error_message,
        start_time=datetime.utcnow(),
        end_time=datetime.utcnow(),
    )
    db.add(run_log)

    job.last_run_status = result.status
    job.last_run_at = datetime.utcnow()
    job.last_run_rows = result.rows_transferred
    job.last_error = result.error_message

    if result.status == "SUCCESS" and result.watermark_end:
        job.last_watermark_value = result.watermark_end

    await db.commit()
    await db.refresh(job)
    return result


async def get_job_history(job_id: str, db: AsyncSession) -> list[SyncJobRun]:
    """Retrieve history of runs for a given job."""
    stmt = select(SyncJobRun).where(SyncJobRun.job_id == job_id).order_by(SyncJobRun.start_time.desc())
    res = await db.execute(stmt)
    return list(res.scalars().all())
