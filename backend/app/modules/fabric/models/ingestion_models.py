"""Database models for Azure SQL to Fabric ingestion and watermark management."""

from datetime import datetime
import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Integer, Text
from app.db.base import Base


class TableSyncJob(Base):
    __tablename__ = "table_sync_jobs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_schema = Column(String(128), nullable=False, default="dbo")
    source_table = Column(String(128), nullable=False)
    target_schema = Column(String(128), nullable=False, default="dbo")
    target_table = Column(String(128), nullable=False)

    # Load strategy: "INCREMENTAL" or "FULL"
    load_type = Column(String(32), nullable=False, default="FULL")

    # Incremental Type: "BOTH", "UPDATED_ONLY", "CREATED_ONLY", "FULL"
    incremental_type = Column(String(32), nullable=False, default="FULL")

    # Detected and chosen watermark columns
    watermark_column = Column(String(128), nullable=True)
    created_column = Column(String(128), nullable=True)
    updated_column = Column(String(128), nullable=True)

    # Current high-water mark timestamp / value (string representation)
    last_watermark_value = Column(String(128), nullable=True)

    # Execution state
    is_enabled = Column(Boolean, default=True, nullable=False)
    last_run_status = Column(String(32), nullable=True)  # "SUCCESS", "FAILED", "RUNNING", "IDLE"
    last_run_at = Column(DateTime, nullable=True)
    last_run_rows = Column(Integer, default=0, nullable=False)
    last_error = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class SyncJobRun(Base):
    __tablename__ = "sync_job_runs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    job_id = Column(String(36), nullable=False, index=True)
    source_table = Column(String(256), nullable=False)
    target_table = Column(String(256), nullable=False)
    load_type = Column(String(32), nullable=False)
    incremental_type = Column(String(32), nullable=True)

    watermark_column = Column(String(128), nullable=True)
    watermark_start = Column(String(128), nullable=True)
    watermark_end = Column(String(128), nullable=True)

    rows_transferred = Column(Integer, default=0, nullable=False)
    status = Column(String(32), nullable=False, default="RUNNING")  # "RUNNING", "SUCCESS", "FAILED"
    error_message = Column(Text, nullable=True)

    start_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    end_time = Column(DateTime, nullable=True)
