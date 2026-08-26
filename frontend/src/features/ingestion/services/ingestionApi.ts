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
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const ingestionApi = {
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

  async configureJobs(
    source: SourceCredentials,
    target: FabricTargetCredentials,
    jobs: TableJobConfig[]
  ): Promise<TableSyncJobRead[]> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target, jobs }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Failed to save job configurations');
    }
    return res.json();
  },

  async listJobs(): Promise<TableSyncJobRead[]> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs`);
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
    target: FabricTargetCredentials
  ): Promise<RunAllJobsResponse> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs/run-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, target }),
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

  async resetAllWatermarks(): Promise<TableSyncJobRead[]> {
    const res = await fetch(`${API_BASE}/fabric/ingestion/jobs/reset-all-watermarks`, {
      method: 'POST',
    });
    if (!res.ok) {
      throw new Error('Failed to reset all job watermarks');
    }
    return res.json();
  },
};
