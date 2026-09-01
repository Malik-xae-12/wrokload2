"""Pydantic schemas for Azure SQL to Fabric ingestion, project management, and incremental watermark sync."""

from datetime import datetime
from pydantic import BaseModel, Field


class SourceCredentials(BaseModel):
    server: str = Field(..., description="Azure SQL Server hostname, e.g. myserver.database.windows.net")
    database: str = Field(..., description="Database name")
    username: str = Field(..., description="SQL Server username")
    password: str = Field(..., description="SQL Server password")
    port: int = Field(1433, description="Port number")


class FabricTargetCredentials(BaseModel):
    server: str = Field(..., description="Microsoft Fabric SQL Endpoint / Datawarehouse server host")
    database: str = Field(..., description="Fabric Lakehouse / Warehouse database name")
    access_token: str | None = Field(None, description="Fabric user bearer token from logged-in session")
    client_id: str | None = Field(None, description="Azure AD Service Principal Client ID (legacy)")
    client_secret: str | None = Field(None, description="Azure AD Service Principal Secret (legacy)")
    tenant_id: str | None = Field(None, description="Azure AD Tenant ID (legacy)")
    username: str | None = Field(None, description="Username if using SQL auth")
    password: str | None = Field(None, description="Password if using SQL auth")
    auth_mode: str = Field("fabric_token", description="'fabric_token', 'service_principal', or 'sql_auth'")


# ==============================================================================
# PROJECT SCHEMAS
# ==============================================================================

class MigrationProjectCreate(BaseModel):
    name: str = Field(..., description="Project Name")
    description: str | None = Field(None, description="Optional Project Description")
    source_type: str = Field("azure_sql", description="'azure_sql', 'synapse', or 'sql_server'")
    source_server: str = Field(..., description="Source SQL Host")
    source_database: str = Field(..., description="Source Database")
    source_username: str = Field(..., description="Source Username")
    source_port: int = Field(1433, description="Source Port")
    target_workspace_id: str | None = Field(None, description="Fabric Workspace ID")
    target_workspace_name: str = Field("Data_Migration_Workspace", description="Fabric Workspace Name")
    target_lakehouse_name: str = Field("LH_BRONZE", description="Fabric Lakehouse Name")
    target_warehouse_name: str = Field("WH_METADATA", description="Fabric Warehouse Name")
    target_server: str | None = Field(None, description="Fabric SQL Analytics Endpoint")
    target_database: str = Field("WH_METADATA", description="Target Database")
    auth_mode: str = Field("fabric_token", description="Auth Mode")


class MigrationProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    source_type: str | None = None
    source_server: str | None = None
    source_database: str | None = None
    source_username: str | None = None
    source_port: int | None = None
    target_workspace_id: str | None = None
    target_workspace_name: str | None = None
    target_lakehouse_name: str | None = None
    target_warehouse_name: str | None = None
    target_server: str | None = None
    target_database: str | None = None
    auth_mode: str | None = None


# ==============================================================================
# TABLE & JOB SCHEMAS
# ==============================================================================

class ColumnInfo(BaseModel):
    column_name: str
    data_type: str
    is_datetime: bool = False


class DiscoveredTable(BaseModel):
    schema_name: str
    table_name: str
    full_name: str
    columns: list[ColumnInfo] = []
    datetime_columns: list[str] = []
    created_column: str | None = None
    updated_column: str | None = None
    suggested_load_type: str = "FULL"  # "INCREMENTAL" or "FULL"
    incremental_type: str = "FULL"     # "BOTH", "UPDATED_ONLY", "CREATED_ONLY", "FULL"
    suggested_watermark_column: str | None = None


class DiscoveredTablesResponse(BaseModel):
    success: bool
    message: str
    tables: list[DiscoveredTable] = []


class ConnectionTestResponse(BaseModel):
    success: bool
    message: str
    details: dict | None = None


class TableJobConfig(BaseModel):
    id: str | None = None
    project_id: str | None = None
    source_schema: str = "dbo"
    source_table: str
    target_schema: str = "dbo"
    target_table: str
    load_type: str = "FULL"            # "INCREMENTAL" or "FULL"
    incremental_type: str = "FULL"     # "BOTH", "UPDATED_ONLY", "CREATED_ONLY", "FULL"
    watermark_column: str | None = None
    created_column: str | None = None
    updated_column: str | None = None
    is_enabled: bool = True


class ConfigureJobsRequest(BaseModel):
    project_id: str | None = None
    source: SourceCredentials
    target: FabricTargetCredentials
    jobs: list[TableJobConfig]


class TableSyncJobRead(BaseModel):
    id: str
    project_id: str | None = None
    source_schema: str
    source_table: str
    target_schema: str
    target_table: str
    load_type: str
    incremental_type: str | None = "FULL"
    watermark_column: str | None
    created_column: str | None
    updated_column: str | None
    last_watermark_value: str | None
    is_enabled: bool
    last_run_status: str | None
    last_run_at: datetime | None
    last_run_rows: int
    last_error: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MigrationProjectRead(BaseModel):
    id: str
    name: str
    description: str | None = None
    source_type: str
    source_server: str
    source_database: str
    source_username: str
    source_port: int
    target_workspace_id: str | None = None
    target_workspace_name: str
    target_lakehouse_name: str
    target_warehouse_name: str
    target_server: str | None = None
    target_database: str
    auth_mode: str
    created_at: datetime
    updated_at: datetime

    # Aggregated metrics
    table_count: int = 0
    completed_jobs: int = 0
    total_jobs: int = 0
    total_rows: int = 0
    status: str = "IDLE"  # "SUCCESS", "RUNNING", "FAILED", "IDLE"
    last_run_at: datetime | None = None
    jobs: list[TableSyncJobRead] = []

    class Config:
        from_attributes = True


class JobRunResult(BaseModel):
    job_id: str
    table_name: str
    status: str  # "SUCCESS" or "FAILED"
    load_type: str
    incremental_type: str | None = None
    rows_transferred: int = 0
    watermark_start: str | None = None
    watermark_end: str | None = None
    error_message: str | None = None
    duration_seconds: float = 0.0


class RunJobRequest(BaseModel):
    project_id: str | None = None
    source: SourceCredentials | None = None
    target: FabricTargetCredentials | None = None


class RunAllJobsResponse(BaseModel):
    total_jobs: int
    successful_jobs: int
    failed_jobs: int
    results: list[JobRunResult] = []


class SyncJobRunRead(BaseModel):
    id: str
    job_id: str
    source_table: str
    target_table: str
    load_type: str
    incremental_type: str | None = None
    watermark_column: str | None
    watermark_start: str | None
    watermark_end: str | None
    rows_transferred: int
    status: str
    error_message: str | None
    start_time: datetime
    end_time: datetime | None

    class Config:
        from_attributes = True


class ListUserWorkspacesRequest(BaseModel):
    tenant_id: str = Field(..., description="Azure AD Tenant ID")
    client_id: str = Field(..., description="Service Principal Client ID")
    client_secret: str = Field(..., description="Service Principal Client Secret")
    user_object_id: str = Field(..., description="Target User Object ID (Azure AD GUID)")
    allowed_roles: list[str] = Field(
        default=["Admin", "Member", "Contributor"],
        description="Roles to filter for (e.g. Admin, Member, Contributor)",
    )


class UserWorkspaceInfo(BaseModel):
    id: str
    displayName: str
    description: str | None = None
    capacityId: str | None = None
    userRole: str
