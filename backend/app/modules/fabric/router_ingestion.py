"""API router for Azure SQL to Microsoft Fabric direct ingestion and sync jobs."""

import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_session
from app.modules.fabric.schema_ingestion import (
    SourceCredentials,
    FabricTargetCredentials,
    DiscoveredTablesResponse,
    ConnectionTestResponse,
    ConfigureJobsRequest,
    TableSyncJobRead,
    JobRunResult,
    RunJobRequest,
    RunAllJobsResponse,
    SyncJobRunRead,
)
from app.modules.fabric.services import ingestion_service as svc
from app.modules.fabric.services.fabric_provisioner import (
    ProvisionWorkspaceRequest,
    ProvisionWorkspaceResponse,
    auto_provision_fabric_environment,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fabric/ingestion", tags=["ingestion"])


@router.post("/provision-workspace", response_model=ProvisionWorkspaceResponse)
def provision_workspace_endpoint(req: ProvisionWorkspaceRequest):
    """Automatically provision Microsoft Fabric Workspace, Lakehouse, and Metadata Warehouse
    using Azure AD Service Principal credentials.
    """
    res = auto_provision_fabric_environment(req)
    if not res.success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=res.message,
        )
    return res


@router.post("/source/test", response_model=ConnectionTestResponse)
def test_source_connection(creds: SourceCredentials):
    """Test connection to Azure SQL Server."""
    res = svc.test_azure_sql_connection(creds)
    return ConnectionTestResponse(
        success=res["success"],
        message=res["message"],
        details=res.get("details"),
    )


@router.post("/target/test", response_model=ConnectionTestResponse)
def test_target_connection(creds: FabricTargetCredentials):
    """Test connection to Microsoft Fabric SQL Analytics / Warehouse Endpoint."""
    res = svc.test_fabric_connection(creds)
    return ConnectionTestResponse(
        success=res["success"],
        message=res["message"],
        details=res.get("details"),
    )


@router.post("/source/discover", response_model=DiscoveredTablesResponse)
def discover_tables(creds: SourceCredentials):
    """Inspect Azure SQL database, list all user tables, and auto-detect
    Incremental vs Full load capabilities based on Created and Updated date columns.
    """
    try:
        tables = svc.discover_source_tables(creds)
        return DiscoveredTablesResponse(
            success=True,
            message=f"Successfully discovered {len(tables)} tables.",
            tables=tables,
        )
    except Exception as e:
        logger.exception("Error discovering tables")
        return DiscoveredTablesResponse(
            success=False,
            message=f"Failed to inspect tables: {str(e)}",
            tables=[],
        )


@router.post("/jobs/configure", response_model=list[TableSyncJobRead])
async def configure_jobs(
    payload: ConfigureJobsRequest,
    db: AsyncSession = Depends(get_async_session),
):
    """Save or update selected table sync job configurations."""
    try:
        jobs = await svc.save_or_update_jobs(db, payload.jobs)
        return jobs
    except Exception as e:
        logger.exception("Error configuring jobs")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to save job configurations: {str(e)}",
        )


@router.get("/jobs", response_model=list[TableSyncJobRead])
async def list_jobs(db: AsyncSession = Depends(get_async_session)):
    """List all configured table ingestion jobs and their current watermark states."""
    jobs = await svc.get_all_jobs(db)
    return jobs


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(
    job_id: str,
    db: AsyncSession = Depends(get_async_session),
):
    """Delete a table ingestion job."""
    deleted = await svc.delete_job_by_id(job_id, db)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job not found.")
    return None




@router.post("/jobs/run-all", response_model=RunAllJobsResponse)
async def run_all_jobs(
    payload: RunJobRequest,
    db: AsyncSession = Depends(get_async_session),
):
    """Trigger execution of all enabled table ingestion jobs sequentially."""
    if not payload.source or not payload.target:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Source and Target credentials must be supplied to execute jobs.",
        )

    all_jobs = await svc.get_all_jobs(db)
    enabled_jobs = [j for j in all_jobs if j.is_enabled]

    results: list[JobRunResult] = []
    success_count = 0
    fail_count = 0

    for job in enabled_jobs:
        try:
            res = await svc.execute_job_and_record(job.id, payload.source, payload.target, db)
            results.append(res)
            if res.status == "SUCCESS":
                success_count += 1
            else:
                fail_count += 1
        except Exception as e:
            fail_count += 1
            results.append(
                JobRunResult(
                    job_id=job.id,
                    table_name=f"{job.source_schema}.{job.source_table}",
                    status="FAILED",
                    load_type=job.load_type,
                    error_message=str(e),
                )
            )

    return RunAllJobsResponse(
        total_jobs=len(enabled_jobs),
        successful_jobs=success_count,
        failed_jobs=fail_count,
        results=results,
    )


@router.get("/jobs/{job_id}/history", response_model=list[SyncJobRunRead])
async def get_job_run_history(
    job_id: str,
    db: AsyncSession = Depends(get_async_session),
):
    """Retrieve execution log history for a specific job."""
    history = await svc.get_job_history(job_id, db)
    return history


@router.post("/jobs/{job_id}/reset-watermark", response_model=TableSyncJobRead)
async def reset_job_watermark(
    job_id: str,
    db: AsyncSession = Depends(get_async_session),
):
    """Reset high watermark for a specific job to force full re-sync."""
    from sqlalchemy import select
    from app.modules.fabric.models.ingestion_models import TableSyncJob
    stmt = select(TableSyncJob).where(TableSyncJob.id == job_id)
    res = await db.execute(stmt)
    job = res.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    job.last_watermark_value = None
    job.last_run_status = "IDLE"
    job.last_run_rows = 0
    await db.commit()
    await db.refresh(job)
    return job


@router.post("/jobs/reset-all-watermarks", response_model=list[TableSyncJobRead])
async def reset_all_watermarks(
    db: AsyncSession = Depends(get_async_session),
):
    """Reset high watermarks for all configured jobs to force full initial re-sync."""
    from sqlalchemy import select
    from app.modules.fabric.models.ingestion_models import TableSyncJob
    stmt = select(TableSyncJob)
    res = await db.execute(stmt)
    jobs = list(res.scalars().all())
    for job in jobs:
        job.last_watermark_value = None
        job.last_run_status = "IDLE"
        job.last_run_rows = 0
    await db.commit()
    for job in jobs:
        await db.refresh(job)
    return jobs

