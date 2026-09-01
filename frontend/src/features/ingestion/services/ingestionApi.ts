import {
  ProvisionWorkspaceRequest,
  ProvisionWorkspaceResponse,
  SourceCredentials,
  FabricTargetCredentials,
  DiscoveredTablesResponse,
  ConnectionTestResponse,
  TableJobConfig,
  TableSyncJobRead,
  JobRunResult,
  RunAllJobsResponse,
  SyncJobRunRead,
  MigrationProjectCreate,
  MigrationProjectUpdate,
  MigrationProjectRead,
  ListUserWorkspacesRequest,
  UserWorkspaceInfo,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const ingestionApi = {
  // ===========================================================================
  // PROJECTS
  // ===========================================================================

  async createProject(payload: MigrationProjectCreate): Promise<MigrationProjectRead> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to create project');
    }
    return res.json();
  },

  async listProjects(): Promise<MigrationProjectRead[]> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/projects`);
    if (!res.ok) {
      throw new Error('Failed to fetch projects');
    }
    return res.json();
  },

  async getProject(projectId: string): Promise<MigrationProjectRead> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/projects/${projectId}`);
    if (!res.ok) {
      throw new Error('Failed to fetch project details');
    }
    return res.json();
  },

  async updateProject(projectId: string, payload: MigrationProjectUpdate): Promise<MigrationProjectRead> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to update project');
    }
    return res.json();
  },

  async deleteProject(projectId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/projects/${projectId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      throw new Error('Failed to delete project');
    }
  },

  // ===========================================================================
  // PROVISIONING & CONNECTION TESTS
  // ===========================================================================

  async listUserWorkspaces(req: ListUserWorkspacesRequest): Promise<UserWorkspaceInfo[]> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/workspaces/user-workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to fetch user workspaces');
    }
    return res.json();
  },

  async provisionWorkspace(req: ProvisionWorkspaceRequest): Promise<ProvisionWorkspaceResponse> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/provision-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to auto-provision Fabric workspace');
    }
    return res.json();
  },

  async testSource(creds: SourceCredentials): Promise<ConnectionTestResponse> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/source/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Source connection test failed');
    }
    return res.json();
  },

  async testTarget(creds: FabricTargetCredentials): Promise<ConnectionTestResponse> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/target/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Target connection test failed');
    }
    return res.json();
  },

  async discoverTables(creds: SourceCredentials): Promise<DiscoveredTablesResponse> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/source/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(creds),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to discover source tables');
    }
    return res.json();
  },

  // ===========================================================================
  // JOBS CONFIGURATION & EXECUTION
  // ===========================================================================

  async configureJobs(
    source: SourceCredentials,
    target: FabricTargetCredentials,
    jobs: TableJobConfig[],
    projectId?: string
  ): Promise<TableSyncJobRead[]> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target, jobs, project_id: projectId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to save job configurations');
    }
    return res.json();
  },

  async listJobs(projectId?: string): Promise<TableSyncJobRead[]> {
    const url = projectId
      ? `${API_BASE}/fabric/ingestion/jobs?project_id=${encodeURIComponent(projectId)}`
      : `${API_BASE}/fabric/ingestion/jobs`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error('Failed to fetch configured jobs');
    }
    return res.json();
  },

  async deleteJob(jobId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs/${jobId}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      throw new Error('Failed to delete job');
    }
  },

  async runJob(
    jobId: string,
    source: SourceCredentials,
    target: FabricTargetCredentials
  ): Promise<JobRunResult> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs/${jobId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to execute job');
    }
    return res.json();
  },

  async runAllJobs(
    source: SourceCredentials,
    target: FabricTargetCredentials,
    projectId?: string
  ): Promise<RunAllJobsResponse> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs/run-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target, project_id: projectId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to execute all jobs');
    }
    return res.json();
  },

  async getJobHistory(jobId: string): Promise<SyncJobRunRead[]> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs/${jobId}/history`);
    if (!res.ok) {
      throw new Error('Failed to fetch job run history');
    }
    return res.json();
  },

  async resetJobWatermark(jobId: string): Promise<TableSyncJobRead> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs/${jobId}/reset-watermark`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error('Failed to reset job watermark');
    }
    return res.json();
  },

  async resetAllWatermarks(projectId?: string): Promise<TableSyncJobRead[]> {
    const url = projectId
      ? `${API_BASE}/fabric/ingestion/jobs/reset-all-watermarks?project_id=${encodeURIComponent(projectId)}`
      : `${API_BASE}/fabric/ingestion/jobs/reset-all-watermarks`;
    const res = await fetch(url, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error('Failed to reset all job watermarks');
    }
    return res.json();
  },
};
