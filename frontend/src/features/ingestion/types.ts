export interface ProvisionWorkspaceRequest {
  tenant_id: string;
  client_id: string;
  client_secret: string;
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
  client_id?: string;
  client_secret?: string;
  tenant_id?: string;
  username?: string;
  password?: string;
  auth_mode: 'service_principal' | 'sql_auth';
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
