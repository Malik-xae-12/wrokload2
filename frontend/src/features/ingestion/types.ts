export interface ProvisionWorkspaceRequest {
  tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  workspace_name: string;
  capacity_id?: string;
  lakehouse_name: string;
  warehouse_name: string;
  user_object_id?: string;
}

export interface ProvisionWorkspaceResponse {
  success: boolean;
  message: string;
  workspace_id?: string;
  workspace_name?: string;
  lakehouse_id?: string;
  lakehouse_name?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  sql_endpoint?: string;
  capacity_assigned: boolean;
  admin_assigned?: boolean;
}

export interface UserWorkspaceInfo {
  id: string;
  displayName: string;
  description?: string;
  capacityId?: string;
  userRole: string;
}

export interface ListUserWorkspacesRequest {
  tenant_id: string;
  client_id: string;
  client_secret: string;
  user_object_id: string;
  allowed_roles?: string[];
}

export interface SourceCredentials {
  server: string;
  database: string;
  username: string;
  password: string;
  port: number;
}

export interface FabricTargetCredentials {
  server: string;
  database: string;
  access_token?: string;
  client_id?: string;
  client_secret?: string;
  tenant_id?: string;
  username?: string;
  password?: string;
  auth_mode: 'fabric_token' | 'service_principal' | 'sql_auth';
}

export interface MigrationProjectCreate {
  name: string;
  description?: string;
  source_type: 'azure_sql' | 'synapse' | 'sql_server';
  source_server: string;
  source_database: string;
  source_username: string;
  source_port: number;
  target_workspace_id?: string;
  target_workspace_name: string;
  target_lakehouse_name: string;
  target_warehouse_name: string;
  target_server?: string;
  target_database: string;
  auth_mode: string;
}

export interface MigrationProjectUpdate {
  name?: string;
  description?: string;
  source_type?: 'azure_sql' | 'synapse' | 'sql_server';
  source_server?: string;
  source_database?: string;
  source_username?: string;
  source_port?: number;
  target_workspace_id?: string;
  target_workspace_name?: string;
  target_lakehouse_name?: string;
  target_warehouse_name?: string;
  target_server?: string;
  target_database?: string;
  auth_mode?: string;
}

export interface MigrationProjectRead {
  id: string;
  name: string;
  description?: string | null;
  source_type: 'azure_sql' | 'synapse' | 'sql_server';
  source_server: string;
  source_database: string;
  source_username: string;
  source_port: number;
  target_workspace_id?: string | null;
  target_workspace_name: string;
  target_lakehouse_name: string;
  target_warehouse_name: string;
  target_server?: string | null;
  target_database: string;
  auth_mode: string;
  created_at: string;
  updated_at: string;

  // Live aggregated stats
  table_count: number;
  completed_jobs: number;
  total_jobs: number;
  total_rows: number;
  status: 'SUCCESS' | 'RUNNING' | 'FAILED' | 'IDLE';
  last_run_at: string | null;
  jobs?: TableSyncJobRead[];
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_datetime: boolean;
}

export type IncrementalType = 'BOTH' | 'UPDATED_ONLY' | 'CREATED_ONLY' | 'FULL';

export interface DiscoveredTable {
  schema_name: string;
  table_name: string;
  full_name: string;
  columns: ColumnInfo[];
  datetime_columns: string[];
  created_column: string | null;
  updated_column: string | null;
  suggested_load_type: 'INCREMENTAL' | 'FULL';
  incremental_type: IncrementalType;
  suggested_watermark_column: string | null;
}

export interface DiscoveredTablesResponse {
  success: boolean;
  message: string;
  tables: DiscoveredTable[];
}

export interface ConnectionTestResponse {
  success: boolean;
  message: string;
  details?: Record<string, any> | null;
}

export interface TableJobConfig {
  id?: string;
  project_id?: string;
  source_schema: string;
  source_table: string;
  target_schema: string;
  target_table: string;
  load_type: 'INCREMENTAL' | 'FULL';
  incremental_type: IncrementalType;
  watermark_column: string | null;
  created_column: string | null;
  updated_column: string | null;
  is_enabled: boolean;
}

export interface TableSyncJobRead {
  id: string;
  project_id?: string | null;
  source_schema: string;
  source_table: string;
  target_schema: string;
  target_table: string;
  load_type: 'INCREMENTAL' | 'FULL';
  incremental_type?: IncrementalType;
  watermark_column: string | null;
  created_column: string | null;
  updated_column: string | null;
  last_watermark_value: string | null;
  is_enabled: boolean;
  last_run_status: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'IDLE' | null;
  last_run_at: string | null;
  last_run_rows: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRunResult {
  job_id: string;
  table_name: string;
  status: 'SUCCESS' | 'FAILED';
  load_type: string;
  incremental_type?: string | null;
  rows_transferred: number;
  watermark_start: string | null;
  watermark_end: string | null;
  error_message: string | null;
  duration_seconds: number;
}

export interface RunAllJobsResponse {
  total_jobs: number;
  successful_jobs: number;
  failed_jobs: number;
  results: JobRunResult[];
}

export interface SyncJobRunRead {
  id: string;
  job_id: string;
  source_table: string;
  target_table: string;
  load_type: string;
  incremental_type?: string | null;
  watermark_column: string | null;
  watermark_start: string | null;
  watermark_end: string | null;
  rows_transferred: number;
  status: string;
  error_message: string | null;
  start_time: string;
  end_time: string | null;
}
