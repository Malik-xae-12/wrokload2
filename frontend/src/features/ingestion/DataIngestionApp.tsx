import React, { useState, useEffect } from 'react';
import {
  Database,
  Play,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Server,
  ShieldCheck,
  Check,
  ChevronRight,
  Trash2,
  FileText,
  X,
  Search,
  Cpu,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { ingestionApi } from './services/ingestionApi';
import {
  ProvisionWorkspaceRequest,
  SourceCredentials,
  FabricTargetCredentials,
  DiscoveredTable,
  TableJobConfig,
  TableSyncJobRead,
  SyncJobRunRead,
  IncrementalType,
} from './types';

interface MigrationProject {
  id: string;
  name: string;
  sourceServer: string;
  sourceDatabase: string;
  targetWorkspace: string;
  targetWarehouse: string;
  tableCount: number;
  completedJobs: number;
  totalJobs: number;
  totalRows: number;
  status: 'SUCCESS' | 'RUNNING' | 'FAILED' | 'IDLE';
  lastRunAt: string | null;
  createdAt: string;
}

export const DataIngestionApp: React.FC = () => {
  // Navigation: Projects List vs Wizard
  const [viewMode, setViewMode] = useState<'projects' | 'wizard'>('wizard');
  const [activeTab, setActiveTab] = useState<'provision' | 'source' | 'tables' | 'review' | 'jobs'>('provision');
  const [selectedSourceType, setSelectedSourceType] = useState<'azure_sql' | 'synapse' | 'sql_server'>('azure_sql');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Projects State
  const [projects, setProjects] = useState<MigrationProject[]>([
    {
      id: 'proj-1',
      name: 'Azure SQL to Fabric Migration',
      sourceServer: import.meta.env.VITE_DEFAULT_SOURCE_SERVER || 'uiapsqlserver.database.windows.net',
      sourceDatabase: import.meta.env.VITE_DEFAULT_SOURCE_DATABASE || 'fabricaccelerator',
      targetWorkspace: import.meta.env.VITE_DEFAULT_WORKSPACE_NAME || 'Data_Migration_Workspace',
      targetWarehouse: import.meta.env.VITE_DEFAULT_WAREHOUSE_NAME || 'WH_METADATA',
      tableCount: 3,
      completedJobs: 3,
      totalJobs: 3,
      totalRows: 1420,
      status: 'SUCCESS',
      lastRunAt: '2026-08-26 21:55:00',
      createdAt: '2026-08-26',
    },
  ]);
  const [projectFilter, setProjectFilter] = useState('');

  // Service Principal & Auto-Provisioning State (Dynamically loaded from .env)
  const [provisionReq, setProvisionReq] = useState<ProvisionWorkspaceRequest>({
    tenant_id: import.meta.env.VITE_DEFAULT_TENANT_ID || '',
    client_id: import.meta.env.VITE_DEFAULT_CLIENT_ID || '',
    client_secret: import.meta.env.VITE_DEFAULT_CLIENT_SECRET || '',
    workspace_name: import.meta.env.VITE_DEFAULT_WORKSPACE_NAME || 'Data_Migration_Workspace',
    capacity_id: import.meta.env.VITE_DEFAULT_CAPACITY_ID || '',
    lakehouse_name: import.meta.env.VITE_DEFAULT_LAKEHOUSE_NAME || 'LH_BRONZE',
    warehouse_name: import.meta.env.VITE_DEFAULT_WAREHOUSE_NAME || 'WH_METADATA',
  });
  const [provisioning, setProvisioning] = useState(false);
  const [provisionResult, setProvisionResult] = useState<any>(null);

  // Source Credentials state (Dynamically loaded from .env)
  const [sourceCreds, setSourceCreds] = useState<SourceCredentials>({
    server: import.meta.env.VITE_DEFAULT_SOURCE_SERVER || 'uiapsqlserver.database.windows.net',
    database: import.meta.env.VITE_DEFAULT_SOURCE_DATABASE || 'fabricaccelerator',
    username: import.meta.env.VITE_DEFAULT_SOURCE_USERNAME || 'fauser',
    password: '',
    port: parseInt(import.meta.env.VITE_DEFAULT_SOURCE_PORT || '1433', 10),
  });

  // Target Fabric Credentials state (WH_METADATA default, dynamically loaded from .env)
  const [targetCreds, setTargetCreds] = useState<FabricTargetCredentials>({
    server: import.meta.env.VITE_DEFAULT_TARGET_SERVER || '',
    database: import.meta.env.VITE_DEFAULT_WAREHOUSE_NAME || 'WH_METADATA',
    client_id: import.meta.env.VITE_DEFAULT_CLIENT_ID || '',
    client_secret: import.meta.env.VITE_DEFAULT_CLIENT_SECRET || '',
    tenant_id: import.meta.env.VITE_DEFAULT_TENANT_ID || '',
    auth_mode: 'service_principal',
  });

  // Connection testing states
  const [testingSource, setTestingSource] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [sourceMessage, setSourceMessage] = useState('');

  const [testingTarget, setTestingTarget] = useState(false);
  const [targetStatus, setTargetStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [targetMessage, setTargetMessage] = useState('');

  // Table Discovery state
  const [discovering, setDiscovering] = useState(false);
  const [discoveredTables, setDiscoveredTables] = useState<DiscoveredTable[]>([]);
  const [selectedTables, setSelectedTables] = useState<Record<string, boolean>>({});
  const [tableConfigs, setTableConfigs] = useState<
    Record<
      string,
      {
        loadType: 'INCREMENTAL' | 'FULL';
        incrementalType: IncrementalType;
        watermarkColumn: string;
        createdColumn: string;
        updatedColumn: string;
        targetTable: string;
      }
    >
  >({});
  const [tableFilter, setTableFilter] = useState('');

  // Jobs state
  const [jobs, setJobs] = useState<TableSyncJobRead[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [runningAll, setRunningAll] = useState(false);

  // History modal state
  const [selectedHistoryJob, setSelectedHistoryJob] = useState<TableSyncJobRead | null>(null);
  const [historyLogs, setHistoryLogs] = useState<SyncJobRunRead[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    fetchConfiguredJobs();
  }, []);

  const fetchConfiguredJobs = async () => {
    try {
      setLoadingJobs(true);
      const data = await ingestionApi.listJobs();
      setJobs(data);
      if (data && data.length > 0) {
        const completed = data.filter((j) => j.last_run_status === 'SUCCESS').length;
        const totalRows = data.reduce((sum, j) => sum + (j.last_run_rows || 0), 0);
        setProjects((prev) => [
          {
            ...prev[0],
            tableCount: data.length,
            completedJobs: completed,
            totalJobs: data.length,
            totalRows: totalRows,
            status: data.some((j) => j.last_run_status === 'RUNNING')
              ? 'RUNNING'
              : data.some((j) => j.last_run_status === 'FAILED')
              ? 'FAILED'
              : completed === data.length
              ? 'SUCCESS'
              : 'IDLE',
            lastRunAt: data[0]?.last_run_at || prev[0].lastRunAt,
          },
        ]);
      }
    } catch (err: any) {
      console.error('Failed to fetch jobs', err);
    } finally {
      setLoadingJobs(false);
    }
  };

  // Auto-Provision Workspace & Lakehouse
  const handleAutoProvision = async () => {
    if (!provisionReq.client_secret || !provisionReq.client_id || !provisionReq.tenant_id) {
      showToast('Please provide Client ID, Client Secret, and Tenant ID', 'error');
      return;
    }
    try {
      setProvisioning(true);
      const res = await ingestionApi.provisionWorkspace(provisionReq);
      if (res.success) {
        setProvisionResult(res);
        setTargetCreds((prev) => ({
          ...prev,
          server: res.sql_endpoint || prev.server,
          database: res.warehouse_name || provisionReq.warehouse_name || prev.database,
          client_id: provisionReq.client_id || prev.client_id,
          client_secret: provisionReq.client_secret || prev.client_secret,
          tenant_id: provisionReq.tenant_id || prev.tenant_id,
        }));
        showToast(res.message, 'success');
        setActiveTab('source');
      } else {
        showToast(res.message || 'Provisioning failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Provisioning failed', 'error');
    } finally {
      setProvisioning(false);
    }
  };

  // Test Azure SQL Source
  const handleTestSource = async () => {
    try {
      setTestingSource(true);
      setSourceStatus('idle');
      const res = await ingestionApi.testSource(sourceCreds);
      if (res.success) {
        setSourceStatus('success');
        setSourceMessage(res.message);
        showToast(res.message, 'success');
      } else {
        setSourceStatus('error');
        setSourceMessage(res.message);
        showToast(res.message, 'error');
      }
    } catch (err: any) {
      setSourceStatus('error');
      setSourceMessage(err.message || 'Connection failed');
      showToast(err.message || 'Connection failed', 'error');
    } finally {
      setTestingSource(false);
    }
  };

  // Test Fabric Target
  const handleTestTarget = async () => {
    try {
      setTestingTarget(true);
      setTargetStatus('idle');
      const res = await ingestionApi.testTarget(targetCreds);
      if (res.success) {
        setTargetStatus('success');
        setTargetMessage(res.message);
        showToast(res.message, 'success');
      } else {
        setTargetStatus('error');
        setTargetMessage(res.message);
        showToast(res.message, 'error');
      }
    } catch (err: any) {
      setTargetStatus('error');
      setTargetMessage(err.message || 'Target connection failed');
      showToast(err.message || 'Target connection failed', 'error');
    } finally {
      setTestingTarget(false);
    }
  };

  // Discover tables and auto-configure load type
  const handleDiscoverTables = async () => {
    if (!sourceCreds.password) {
      showToast('Please enter the Azure SQL password first', 'error');
      return;
    }
    try {
      setDiscovering(true);
      const res = await ingestionApi.discoverTables(sourceCreds);
      if (res.success && res.tables.length > 0) {
        setDiscoveredTables(res.tables);

        const initialSelected: Record<string, boolean> = {};
        const initialConfigs: Record<
          string,
          {
            loadType: 'INCREMENTAL' | 'FULL';
            incrementalType: IncrementalType;
            watermarkColumn: string;
            createdColumn: string;
            updatedColumn: string;
            targetTable: string;
          }
        > = {};

        res.tables.forEach((t) => {
          initialSelected[t.full_name] = true;
          const incType: IncrementalType =
            t.incremental_type ||
            (t.suggested_load_type === 'INCREMENTAL'
              ? t.created_column && t.updated_column
                ? 'BOTH'
                : t.updated_column
                ? 'UPDATED_ONLY'
                : 'CREATED_ONLY'
              : 'FULL');

          initialConfigs[t.full_name] = {
            loadType: incType === 'FULL' ? 'FULL' : 'INCREMENTAL',
            incrementalType: incType,
            watermarkColumn: t.suggested_watermark_column || t.updated_column || t.created_column || (t.datetime_columns[0] || ''),
            createdColumn: t.created_column || '',
            updatedColumn: t.updated_column || '',
            targetTable: t.table_name,
          };
        });

        setSelectedTables(initialSelected);
        setTableConfigs(initialConfigs);
        showToast(`Discovered ${res.tables.length} tables from Azure SQL`, 'success');
        setActiveTab('tables');
      } else {
        showToast(res.message || 'No tables found in this database', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to inspect tables', 'error');
    } finally {
      setDiscovering(false);
    }
  };

  // Toggle selection for all tables
  const handleToggleSelectAll = (select: boolean) => {
    const next: Record<string, boolean> = {};
    discoveredTables.forEach((t) => {
      next[t.full_name] = select;
    });
    setSelectedTables(next);
  };

  // Save selected tables as jobs
  const handleSaveAndConfigureJobs = async () => {
    const selectedList = discoveredTables.filter((t) => selectedTables[t.full_name]);
    if (selectedList.length === 0) {
      showToast('Please select at least one table to configure', 'error');
      return;
    }

    const payloadJobs: TableJobConfig[] = selectedList.map((t) => {
      const cfg = tableConfigs[t.full_name] || {
        loadType: t.suggested_load_type,
        incrementalType: t.incremental_type || 'FULL',
        watermarkColumn: t.suggested_watermark_column,
        createdColumn: t.created_column,
        updatedColumn: t.updated_column,
        targetTable: t.table_name,
      };
      return {
        source_schema: t.schema_name,
        source_table: t.table_name,
        target_schema: 'dbo',
        target_table: cfg.targetTable || t.table_name,
        load_type: cfg.incrementalType === 'FULL' ? 'FULL' : 'INCREMENTAL',
        incremental_type: cfg.incrementalType,
        watermark_column: cfg.incrementalType === 'FULL' ? null : (cfg.watermarkColumn || cfg.updatedColumn || cfg.createdColumn || null),
        created_column: cfg.createdColumn || t.created_column,
        updated_column: cfg.updatedColumn || t.updated_column,
        is_enabled: true,
      };
    });

    try {
      setLoadingJobs(true);
      await ingestionApi.configureJobs(sourceCreds, targetCreds, payloadJobs);
      showToast(`Configured ${payloadJobs.length} tables successfully`, 'success');
      await fetchConfiguredJobs();
      setActiveTab('review');
    } catch (err: any) {
      showToast(err.message || 'Failed to save configurations', 'error');
    } finally {
      setLoadingJobs(false);
    }
  };

  // Run all enabled jobs
  const handleRunAllJobs = async () => {
    const sSecret = sourceCreds.password;
    const tSecret = targetCreds.client_secret || provisionReq.client_secret;

    if (!sSecret || !tSecret) {
      showToast('Source Password and Fabric Client Secret are required to run jobs', 'error');
      setActiveTab('source');
      return;
    }

    try {
      setRunningAll(true);
      showToast('Executing synchronization for all tables into Fabric Warehouse...', 'info');
      const activeTargetCreds: FabricTargetCredentials = {
        ...targetCreds,
        client_secret: tSecret,
        client_id: targetCreds.client_id || provisionReq.client_id,
        tenant_id: targetCreds.tenant_id || provisionReq.tenant_id,
        server: targetCreds.server || provisionResult?.sql_endpoint || 'ptrf35b4be5udprnukus7ggpeq-fd5dtvvoglfe7bzgpupk4nn5cm.datawarehouse.fabric.microsoft.com',
        database: targetCreds.database || provisionReq.warehouse_name || 'WH_METADATA',
      };
      const res = await ingestionApi.runAllJobs(sourceCreds, activeTargetCreds);
      
      const failed = res.results.filter((r) => r.status === 'FAILED');
      const totalTransferred = res.results.reduce((sum, r) => sum + (r.rows_transferred || 0), 0);
      
      if (failed.length > 0) {
        showToast(`Sync finished with issues: ${failed[0].error_message || 'Table sync failed'}`, 'error');
      } else {
        showToast(`Sync completed successfully! Transferred ${totalTransferred} rows into ${activeTargetCreds.database}.`, 'success');
      }
      await fetchConfiguredJobs();
    } catch (err: any) {
      showToast(err.message || 'Execution failed', 'error');
      await fetchConfiguredJobs();
    } finally {
      setRunningAll(false);
    }
  };

  // Run a single job
  const handleRunSingleJob = async (job: TableSyncJobRead) => {
    const sSecret = sourceCreds.password;
    const tSecret = targetCreds.client_secret || provisionReq.client_secret;

    if (!sSecret || !tSecret) {
      showToast('Source Password and Fabric Client Secret are required to run job', 'error');
      setActiveTab('source');
      return;
    }

    try {
      showToast(`Executing sync for ${job.source_table}...`, 'info');
      const activeTargetCreds: FabricTargetCredentials = {
        ...targetCreds,
        client_secret: tSecret,
        client_id: targetCreds.client_id || provisionReq.client_id,
        tenant_id: targetCreds.tenant_id || provisionReq.tenant_id,
        server: targetCreds.server || provisionResult?.sql_endpoint || 'ptrf35b4be5udprnukus7ggpeq-fd5dtvvoglfe7bzgpupk4nn5cm.datawarehouse.fabric.microsoft.com',
        database: targetCreds.database || provisionReq.warehouse_name || 'WH_METADATA',
      };
      const res = await ingestionApi.runJob(job.id, sourceCreds, activeTargetCreds);
      if (res.status === 'SUCCESS') {
        showToast(`Synced ${res.table_name}: ${res.rows_transferred} rows transferred.`, 'success');
      } else {
        showToast(`Failed to sync ${res.table_name}: ${res.error_message}`, 'error');
      }
      await fetchConfiguredJobs();
    } catch (err: any) {
      showToast(err.message || `Execution failed for ${job.source_table}`, 'error');
      await fetchConfiguredJobs();
    }
  };

  // Reset all high watermarks to force fresh full reload
  const handleResetAllWatermarks = async () => {
    try {
      await ingestionApi.resetAllWatermarks();
      showToast('Reset all high watermarks. Next execution will perform a full reload of all rows.', 'success');
      await fetchConfiguredJobs();
    } catch (err: any) {
      showToast(err.message || 'Failed to reset watermarks', 'error');
    }
  };

  // Reset watermark for a single job
  const handleResetSingleWatermark = async (jobId: string) => {
    try {
      await ingestionApi.resetJobWatermark(jobId);
      showToast('High watermark reset for table. Next execution will perform a full reload.', 'success');
      await fetchConfiguredJobs();
    } catch (err: any) {
      showToast(err.message || 'Failed to reset watermark', 'error');
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      await ingestionApi.deleteJob(jobId);
      showToast('Job removed', 'success');
      await fetchConfiguredJobs();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete job', 'error');
    }
  };

  const handleOpenHistory = async (job: TableSyncJobRead) => {
    setSelectedHistoryJob(job);
    setLoadingHistory(true);
    try {
      const logs = await ingestionApi.getJobHistory(job.id);
      setHistoryLogs(logs);
    } catch (err: any) {
      showToast('Failed to load job history', 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  const filteredDiscovered = discoveredTables.filter((t) =>
    t.full_name.toLowerCase().includes(tableFilter.toLowerCase())
  );

  const selectedCount = Object.values(selectedTables).filter(Boolean).length;
  const incrementalCount = jobs.filter((j) => j.load_type === 'INCREMENTAL').length;
  const fullCount = jobs.filter((j) => j.load_type === 'FULL').length;
  const totalRowsLoaded = jobs.reduce((sum, j) => sum + (j.last_run_rows || 0), 0);

  // Stepper Items config
  const steps = [
    { id: 'provision', label: 'Select source' },
    { id: 'source', label: 'Upload source' },
    { id: 'tables', label: 'Select and configure tables' },
    { id: 'review', label: 'Review & Sync' },
    { id: 'jobs', label: 'Jobs' },
  ];

  const currentStepIdx = steps.findIndex((s) => s.id === activeTab);

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#242424] font-sans flex flex-col antialiased selection:bg-[#008272]/20">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          className={`fixed top-3 right-5 z-50 px-3.5 py-2 rounded shadow-md border text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
              : toastMessage.type === 'error'
              ? 'bg-red-50 text-red-900 border-red-300'
              : 'bg-teal-50 text-teal-900 border-teal-300'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : toastMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          ) : (
            <Check className="w-4 h-4 text-teal-600 flex-shrink-0" />
          )}
          {toastMessage.text}
        </div>
      )}

      {/* Breadcrumb Sub-Header */}
      <div className="bg-white border-b border-[#e1dfdd] px-6 py-2 flex items-center justify-between text-xs select-none sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (viewMode === 'wizard' && currentStepIdx > 0) {
                setActiveTab(steps[currentStepIdx - 1].id as any);
              } else {
                setViewMode('projects');
              }
            }}
            className="flex items-center gap-1 font-semibold text-[#201f1e] hover:text-[#008272] cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <div className="h-3.5 w-px bg-[#e1dfdd]" />
          <div className="flex items-center gap-1.5 text-[#605e5c]">
            <span
              onClick={() => setViewMode('projects')}
              className={`cursor-pointer hover:text-[#008272] ${viewMode === 'projects' ? 'font-bold text-[#201f1e]' : ''}`}
            >
              Code projects
            </span>
            {viewMode === 'wizard' && (
              <>
                <ChevronRight className="w-3 h-3 text-[#a19f9d]" />
                <span className="font-semibold text-[#201f1e]">New code project</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {viewMode === 'wizard' ? (
            <button
              onClick={() => setViewMode('projects')}
              className="px-3 py-1 text-xs font-semibold text-[#323130] bg-[#f3f2f1] hover:bg-[#edebe9] rounded border border-[#8a8886] transition cursor-pointer"
            >
              View All Projects
            </button>
          ) : (
            <button
              onClick={() => {
                setViewMode('wizard');
                setActiveTab('provision');
              }}
              className="px-3 py-1 text-xs font-bold text-white bg-[#008272] hover:bg-[#006e60] rounded shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New Code Project
            </button>
          )}
        </div>
      </div>

      {/* ================= VIEW 1: PROJECTS LIST & PROGRESS ================= */}
      {viewMode === 'projects' && (
        <div className="flex-1 p-5 sm:p-6 max-w-7xl w-full mx-auto space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-[11px] text-[#605e5c] font-medium">Workspace Overview</p>
              <h2 className="text-lg font-bold text-[#201f1e]">Projects &amp; Migration Progress</h2>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative w-60">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#605e5c]" />
                <input
                  type="text"
                  placeholder="Filter projects..."
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="w-full text-xs h-8 pl-8 pr-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                />
              </div>

              <button
                onClick={() => {
                  setViewMode('wizard');
                  setActiveTab('provision');
                }}
                className="px-3.5 py-1.5 text-xs font-bold text-white bg-[#008272] hover:bg-[#006e60] rounded shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Create Project
              </button>
            </div>
          </div>

          {/* Projects Table */}
          <div className="bg-white border border-[#e1dfdd] rounded-lg shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#f3f2f1] border-b border-[#e1dfdd] text-[11px] font-bold text-[#323130] uppercase tracking-wider">
                    <th className="py-2.5 px-4">Project Name</th>
                    <th className="py-2.5 px-4">Source Database</th>
                    <th className="py-2.5 px-4">Target Fabric Warehouse</th>
                    <th className="py-2.5 px-4">Tables</th>
                    <th className="py-2.5 px-4">Sync Progress</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Last Run</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e1dfdd] text-xs">
                  {projects
                    .filter((p) => p.name.toLowerCase().includes(projectFilter.toLowerCase()))
                    .map((proj) => {
                      const pct = proj.totalJobs > 0 ? Math.round((proj.completedJobs / proj.totalJobs) * 100) : 0;
                      return (
                        <tr key={proj.id} className="hover:bg-[#f8f9fa] transition">
                          <td className="py-2.5 px-4 font-semibold text-[#201f1e]">
                            <button
                              onClick={() => {
                                setViewMode('wizard');
                                setActiveTab('jobs');
                              }}
                              className="text-left hover:text-[#008272] hover:underline font-bold text-xs cursor-pointer"
                            >
                              {proj.name}
                            </button>
                            <p className="text-[10px] text-[#605e5c] font-normal">Created: {proj.createdAt}</p>
                          </td>
                          <td className="py-2.5 px-4 text-[#323130]">
                            <p className="font-mono text-xs">{proj.sourceDatabase}</p>
                            <p className="text-[10px] text-[#605e5c] truncate max-w-xs">{proj.sourceServer}</p>
                          </td>
                          <td className="py-2.5 px-4 text-[#008272]">
                            <p className="font-mono text-xs">{proj.targetWarehouse}</p>
                            <p className="text-[10px] text-[#605e5c]">{proj.targetWorkspace}</p>
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-[#323130]">
                            {proj.tableCount} tables
                          </td>
                          <td className="py-2.5 px-4 w-44">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[10px] font-semibold text-[#605e5c]">
                                <span>{proj.completedJobs}/{proj.totalJobs} synced</span>
                                <span>{pct}%</span>
                              </div>
                              <div className="w-full h-1.5 bg-[#edebe9] rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#008272] rounded-full transition-all duration-300"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              {proj.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-[#605e5c] text-[11px]">
                            {proj.lastRunAt || 'Never'}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              onClick={() => {
                                setViewMode('wizard');
                                setActiveTab('jobs');
                              }}
                              className="px-2.5 py-1 bg-[#f3f2f1] hover:bg-[#edebe9] text-[#201f1e] font-semibold text-xs rounded border border-[#8a8886] transition cursor-pointer"
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= VIEW 2: WIZARD STEPPER ================= */}
      {viewMode === 'wizard' && (
        <div className="flex-1 flex flex-col lg:flex-row p-4 sm:p-6 gap-6 w-full mx-auto">
          {/* LEFT VERTICAL STEPPER */}
          <nav className="w-full lg:w-52 flex-shrink-0 select-none">
            <div className="relative flex flex-col space-y-4">
              {/* Connecting vertical line */}
              <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-[#e1dfdd] -z-0" />

              {steps.map((step, idx) => {
                const isActive = activeTab === step.id;
                const isPast = currentStepIdx > idx;

                return (
                  <div
                    key={step.id}
                    onClick={() => setActiveTab(step.id as any)}
                    className="relative z-10 flex items-center gap-2.5 cursor-pointer group"
                  >
                    {/* Step Circle Indicator */}
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center transition-all ${
                        isActive
                          ? 'bg-[#008272] text-white ring-3 ring-[#008272]/20'
                          : isPast
                          ? 'bg-[#008272] text-white'
                          : 'bg-white border border-[#8a8886] group-hover:border-[#008272]'
                      }`}
                    >
                      {isPast ? (
                        <Check className="w-3 h-3 stroke-[3]" />
                      ) : (
                        <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-transparent'}`} />
                      )}
                    </div>

                    {/* Step Label */}
                    <div>
                      <p
                        className={`text-xs leading-tight ${
                          isActive
                            ? 'text-[#201f1e] font-bold'
                            : isPast
                            ? 'text-[#323130] font-semibold'
                            : 'text-[#605e5c] group-hover:text-[#201f1e]'
                        }`}
                      >
                        {step.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </nav>

          {/* MAIN WIZARD CONTENT AREA */}
          <main className="flex-1 min-w-0">
            {/* Header Title */}
            <div className="mb-3">
              <p className="text-[11px] text-[#605e5c] font-medium">Create new code project</p>
              <h2 className="text-lg font-bold text-[#201f1e]">
                {activeTab === 'provision' && 'Fabric Auto-Provisioning'}
                {activeTab === 'source' && 'Select source database'}
                {activeTab === 'tables' && 'Select and configure tables'}
                {activeTab === 'review' && 'Review & Sync'}
                {activeTab === 'jobs' && 'Execution Jobs & Dashboard'}
              </h2>
            </div>

            {/* TAB 1: SELECT SOURCE / FABRIC AUTO-PROVISION (INCREASED WIDTH & HEIGHT, NOT FULL WIDTH) */}
            {activeTab === 'provision' && (
              <div className="space-y-3 animate-in fade-in-50 duration-200 max-w-5xl w-full">
                <p className="text-xs text-[#605e5c]">
                  Automatically provision Microsoft Fabric Workspace, Lakehouse (<code className="text-[#008272] font-semibold">LH_BRONZE</code>), and Warehouse (<code className="text-[#008272] font-semibold">WH_METADATA</code>).
                </p>

                <div className="bg-white border border-[#e1dfdd] rounded-lg p-6 sm:p-7 shadow-2xs space-y-5 min-h-[340px]">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-3.5">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#323130] mb-1">
                          Tenant ID (Azure AD GUID)
                        </label>
                        <input
                          type="text"
                          value={provisionReq.tenant_id}
                          onChange={(e) => setProvisionReq({ ...provisionReq, tenant_id: e.target.value })}
                          className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                          placeholder="f45de27c-093c-413b-be2d-a2a92f98cf24"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#323130] mb-1">
                          Application (Client) ID
                        </label>
                        <input
                          type="text"
                          value={provisionReq.client_id}
                          onChange={(e) => setProvisionReq({ ...provisionReq, client_id: e.target.value })}
                          className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                          placeholder="fbdd0ef6-296b-48a0-b07b-b23d6a2ad44b"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#323130] mb-1">
                          Client Secret
                        </label>
                        <input
                          type="password"
                          value={provisionReq.client_secret}
                          onChange={(e) => setProvisionReq({ ...provisionReq, client_secret: e.target.value })}
                          className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                          placeholder="Enter Service Principal secret"
                        />
                      </div>
                    </div>

                    <div className="space-y-3.5">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#323130] mb-1">
                          Target Workspace Name
                        </label>
                        <input
                          type="text"
                          value={provisionReq.workspace_name}
                          onChange={(e) => setProvisionReq({ ...provisionReq, workspace_name: e.target.value })}
                          className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#323130] mb-1">
                          Fabric Capacity ID (GUID)
                        </label>
                        <input
                          type="text"
                          value={provisionReq.capacity_id}
                          onChange={(e) => setProvisionReq({ ...provisionReq, capacity_id: e.target.value })}
                          className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-[#323130] mb-1">
                            Lakehouse Name
                          </label>
                          <input
                            type="text"
                            value={provisionReq.lakehouse_name}
                            onChange={(e) => setProvisionReq({ ...provisionReq, lakehouse_name: e.target.value })}
                            className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-[#323130] mb-1">
                            Warehouse Name
                          </label>
                          <input
                            type="text"
                            value={provisionReq.warehouse_name}
                            onChange={(e) => setProvisionReq({ ...provisionReq, warehouse_name: e.target.value })}
                            className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {provisionResult && (
                    <div className="mt-3 p-3.5 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="font-bold flex items-center gap-1.5 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" /> {provisionResult.message}
                        </p>
                        <button
                          onClick={handleTestTarget}
                          disabled={testingTarget}
                          className="px-2.5 py-1 bg-white hover:bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded border border-emerald-300 transition flex items-center gap-1 cursor-pointer"
                        >
                          {testingTarget ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3 text-[#008272]" />}
                          Test Warehouse Endpoint
                        </button>
                      </div>
                      <p className="text-[11px] text-[#605e5c]">
                        Workspace ID: <span className="font-mono text-[#201f1e]">{provisionResult.workspace_id}</span> | Warehouse:{' '}
                        <span className="font-mono text-[#201f1e]">{provisionResult.warehouse_name}</span>
                      </p>
                      {targetStatus === 'success' && (
                        <p className="text-[11px] text-emerald-700 font-semibold">{targetMessage}</p>
                      )}
                      {targetStatus === 'error' && (
                        <p className="text-[11px] text-red-600 font-semibold">{targetMessage}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: UPLOAD SOURCE (DECREASED WIDTH & INCREASED HEIGHT) */}
            {activeTab === 'source' && (
              <div className="space-y-4 animate-in fade-in-50 duration-200 max-w-3xl w-full">
                {/* Source Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div
                    onClick={() => setSelectedSourceType('azure_sql')}
                    className={`bg-white border rounded-md p-3.5 flex items-center gap-3 cursor-pointer transition-all ${
                      selectedSourceType === 'azure_sql'
                        ? 'border-[#008272] ring-2 ring-[#008272]/20 shadow-xs'
                        : 'border-[#e1dfdd] hover:border-[#8a8886]'
                    }`}
                  >
                    <div className="w-8 h-8 rounded bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                      <Database className="w-4 h-4 text-[#0078d4]" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-[#201f1e] block">Azure SQL Database</span>
                      <span className="text-[10px] text-[#605e5c]">Single / Managed</span>
                    </div>
                  </div>

                  <div
                    onClick={() => setSelectedSourceType('synapse')}
                    className={`bg-white border rounded-md p-3.5 flex items-center gap-3 cursor-pointer transition-all ${
                      selectedSourceType === 'synapse'
                        ? 'border-[#008272] ring-2 ring-[#008272]/20 shadow-xs'
                        : 'border-[#e1dfdd] hover:border-[#8a8886]'
                    }`}
                  >
                    <div className="w-8 h-8 rounded bg-cyan-50 border border-cyan-100 flex items-center justify-center text-cyan-600 flex-shrink-0">
                      <Cpu className="w-4 h-4 text-[#00a4ef]" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-[#201f1e] block">Azure Synapse</span>
                      <span className="text-[10px] text-[#605e5c]">Dedicated SQL Pool</span>
                    </div>
                  </div>

                  <div
                    onClick={() => setSelectedSourceType('sql_server')}
                    className={`bg-white border rounded-md p-3.5 flex items-center gap-3 cursor-pointer transition-all ${
                      selectedSourceType === 'sql_server'
                        ? 'border-[#008272] ring-2 ring-[#008272]/20 shadow-xs'
                        : 'border-[#e1dfdd] hover:border-[#8a8886]'
                    }`}
                  >
                    <div className="w-8 h-8 rounded bg-red-50 border border-red-100 flex items-center justify-center text-red-600 flex-shrink-0">
                      <Server className="w-4 h-4 text-[#d83b01]" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-[#201f1e] block">SQL Server</span>
                      <span className="text-[10px] text-[#605e5c]">On-Premises / VM</span>
                    </div>
                  </div>
                </div>

                {/* Connection Details Form with Increased Height */}
                <div className="bg-white border border-[#e1dfdd] rounded-lg p-6 shadow-2xs space-y-4 min-h-[320px]">
                  <div className="flex items-center justify-between pb-2 border-b border-[#e1dfdd]">
                    <h4 className="text-xs font-bold text-[#201f1e] uppercase tracking-wider">
                      Source Connection Parameters
                    </h4>
                    {sourceStatus === 'success' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Connected
                      </span>
                    )}
                  </div>

                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-[#323130] mb-1">Server Host</label>
                      <input
                        type="text"
                        value={sourceCreds.server}
                        onChange={(e) => setSourceCreds({ ...sourceCreds, server: e.target.value })}
                        className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                        placeholder="uiapsqlserver.database.windows.net"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <label className="block text-[11px] font-semibold text-[#323130] mb-1">Database Name</label>
                        <input
                          type="text"
                          value={sourceCreds.database}
                          onChange={(e) => setSourceCreds({ ...sourceCreds, database: e.target.value })}
                          className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-[#323130] mb-1">Port</label>
                        <input
                          type="number"
                          value={sourceCreds.port}
                          onChange={(e) => setSourceCreds({ ...sourceCreds, port: parseInt(e.target.value) || 1433 })}
                          className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#323130] mb-1">Username</label>
                        <input
                          type="text"
                          value={sourceCreds.username}
                          onChange={(e) => setSourceCreds({ ...sourceCreds, username: e.target.value })}
                          className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#323130] mb-1">Password</label>
                        <input
                          type="password"
                          value={sourceCreds.password}
                          onChange={(e) => setSourceCreds({ ...sourceCreds, password: e.target.value })}
                          className="w-full text-xs h-9 px-3 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                          placeholder="Enter password"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      onClick={handleTestSource}
                      disabled={testingSource || !sourceCreds.password}
                      className="px-3.5 py-1.5 text-xs font-semibold text-[#323130] bg-[#f3f2f1] hover:bg-[#edebe9] rounded border border-[#8a8886] transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      {testingSource ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" /> Testing...
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-[#0078d4]" /> Test Connection
                        </>
                      )}
                    </button>
                  </div>

                  {sourceStatus === 'error' && (
                    <p className="text-xs text-red-600 flex items-center gap-1 pt-1">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {sourceMessage}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: SELECT & CONFIGURE TABLES (FULL WIDTH GRID) */}
            {activeTab === 'tables' && (
              <div className="space-y-3 animate-in fade-in-50 duration-200 w-full">
                <div className="bg-white border border-[#e1dfdd] rounded-lg p-4 shadow-2xs space-y-3 w-full">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#e1dfdd]">
                    <div>
                      <h3 className="text-xs font-bold text-[#201f1e] uppercase tracking-wider">Discovered Source Tables</h3>
                      <p className="text-[11px] text-[#605e5c]">
                        Configure the <strong>Incremental Strategy</strong> (dual date column filter) and target table names.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleSelectAll(true)}
                        className="px-2.5 py-1 text-xs font-semibold text-[#323130] bg-[#f3f2f1] hover:bg-[#edebe9] rounded border border-[#8a8886] transition cursor-pointer"
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => handleToggleSelectAll(false)}
                        className="px-2.5 py-1 text-xs font-semibold text-[#323130] bg-[#f3f2f1] hover:bg-[#edebe9] rounded border border-[#8a8886] transition cursor-pointer"
                      >
                        Deselect All
                      </button>
                      <button
                        onClick={handleDiscoverTables}
                        disabled={discovering}
                        className="px-2.5 py-1 text-xs font-semibold text-[#008272] bg-teal-50 hover:bg-teal-100 rounded border border-teal-200 transition flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${discovering ? 'animate-spin' : ''}`} />
                        Re-scan
                      </button>
                    </div>
                  </div>

                  {/* Search filter & summary badges */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="relative max-w-xs w-full">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#605e5c]" />
                      <input
                        type="text"
                        placeholder="Filter tables..."
                        value={tableFilter}
                        onChange={(e) => setTableFilter(e.target.value)}
                        className="w-full text-xs h-7 pl-7 pr-2.5 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-3 text-xs font-semibold text-[#605e5c]">
                      <span>
                        Selected: <strong className="text-[#008272]">{selectedCount} / {discoveredTables.length}</strong>
                      </span>
                      <span>
                        Incremental:{' '}
                        <strong className="text-teal-800">
                          {
                            discoveredTables.filter(
                              (t) =>
                                selectedTables[t.full_name] &&
                                (tableConfigs[t.full_name]?.loadType || t.suggested_load_type) === 'INCREMENTAL'
                            ).length
                          }
                        </strong>
                      </span>
                      <span>
                        Full Load:{' '}
                        <strong className="text-blue-800">
                          {
                            discoveredTables.filter(
                              (t) =>
                                selectedTables[t.full_name] &&
                                (tableConfigs[t.full_name]?.loadType || t.suggested_load_type) === 'FULL'
                            ).length
                          }
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Clean Enterprise Data Table */}
                  {discoveredTables.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-xs font-semibold text-[#605e5c]">No tables discovered yet</p>
                      <button
                        onClick={() => setActiveTab('source')}
                        className="mt-2 px-3 py-1 bg-[#008272] text-white rounded text-xs font-semibold cursor-pointer"
                      >
                        Go to Source
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-[#e1dfdd] rounded w-full">
                      <table className="w-full text-left border-collapse min-w-full">
                        <thead>
                          <tr className="bg-[#f3f2f1] border-b border-[#e1dfdd] text-[11px] font-bold text-[#323130] uppercase tracking-wider">
                            <th className="py-2.5 px-3 w-10 text-center">
                              <input
                                type="checkbox"
                                checked={selectedCount === discoveredTables.length && discoveredTables.length > 0}
                                onChange={(e) => handleToggleSelectAll(e.target.checked)}
                                className="accent-[#008272]"
                              />
                            </th>
                            <th className="py-2.5 px-3">Source Table</th>
                            <th className="py-2.5 px-3">Detected Date Columns</th>
                            <th className="py-2.5 px-3">Incremental Type</th>
                            <th className="py-2.5 px-3">Watermark Tracking Filter</th>
                            <th className="py-2.5 px-3">Target Table (Fabric)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e1dfdd] text-xs">
                          {filteredDiscovered.map((t) => {
                            const isSelected = !!selectedTables[t.full_name];
                            const cfg = tableConfigs[t.full_name] || {
                              loadType: t.suggested_load_type,
                              incrementalType: t.incremental_type || 'FULL',
                              watermarkColumn: t.suggested_watermark_column || '',
                              createdColumn: t.created_column || '',
                              updatedColumn: t.updated_column || '',
                              targetTable: t.table_name,
                            };

                            return (
                              <tr
                                key={t.full_name}
                                className={`hover:bg-[#f8f9fa] transition ${
                                  isSelected ? 'bg-teal-50/15' : 'opacity-60 bg-white'
                                }`}
                              >
                                <td className="py-2.5 px-3 text-center">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(e) =>
                                      setSelectedTables({
                                        ...selectedTables,
                                        [t.full_name]: e.target.checked,
                                      })
                                    }
                                    className="accent-[#008272]"
                                  />
                                </td>

                                <td className="py-2.5 px-3 font-semibold text-[#201f1e]">
                                  <div className="font-mono text-xs">{t.full_name}</div>
                                  <span className="text-[10px] text-[#605e5c] font-normal">{t.columns.length} columns</span>
                                </td>

                                <td className="py-2.5 px-3">
                                  <div className="flex flex-wrap gap-1">
                                    {t.updated_column && (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 text-[10px] font-mono">
                                        updated: {t.updated_column}
                                      </span>
                                    )}
                                    {t.created_column && (
                                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-900 border border-blue-200 text-[10px] font-mono">
                                        created: {t.created_column}
                                      </span>
                                    )}
                                    {!t.created_column && !t.updated_column && (
                                      <span className="text-[#a19f9d] italic text-[10px]">None (Full Load)</span>
                                    )}
                                  </div>
                                </td>

                                <td className="py-2.5 px-3">
                                  <select
                                    value={cfg.incrementalType}
                                    disabled={!isSelected}
                                    onChange={(e) => {
                                      const nextInc = e.target.value as IncrementalType;
                                      let nextWm = cfg.watermarkColumn;
                                      if (nextInc === 'BOTH') {
                                        nextWm = cfg.updatedColumn || cfg.createdColumn || t.suggested_watermark_column || '';
                                      } else if (nextInc === 'UPDATED_ONLY') {
                                        nextWm = cfg.updatedColumn || t.updated_column || (t.datetime_columns[0] || '');
                                      } else if (nextInc === 'CREATED_ONLY') {
                                        nextWm = cfg.createdColumn || t.created_column || (t.datetime_columns[0] || '');
                                      } else {
                                        nextWm = '';
                                      }

                                      setTableConfigs({
                                        ...tableConfigs,
                                        [t.full_name]: {
                                          ...cfg,
                                          incrementalType: nextInc,
                                          loadType: nextInc === 'FULL' ? 'FULL' : 'INCREMENTAL',
                                          watermarkColumn: nextWm,
                                        },
                                      });
                                    }}
                                    className={`text-xs px-2 py-0.5 rounded border focus:outline-none font-medium ${
                                      cfg.incrementalType === 'BOTH'
                                        ? 'bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold'
                                        : cfg.incrementalType === 'UPDATED_ONLY'
                                        ? 'bg-amber-50 text-amber-900 border-amber-300'
                                        : cfg.incrementalType === 'CREATED_ONLY'
                                        ? 'bg-teal-50 text-teal-900 border-teal-300'
                                        : 'bg-blue-50 text-blue-900 border-blue-300'
                                    }`}
                                  >
                                    <option value="BOTH">Both (Created &amp; Updated)</option>
                                    <option value="UPDATED_ONLY">Updated Only</option>
                                    <option value="CREATED_ONLY">Created Only</option>
                                    <option value="FULL">Full Load</option>
                                  </select>
                                </td>

                                <td className="py-2.5 px-3">
                                  {cfg.incrementalType === 'BOTH' ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 font-mono text-[10px]">
                                      COALESCE({cfg.updatedColumn || 'updated_at'}, {cfg.createdColumn || 'created_at'})
                                    </span>
                                  ) : cfg.incrementalType === 'UPDATED_ONLY' || cfg.incrementalType === 'CREATED_ONLY' ? (
                                    <select
                                      value={cfg.watermarkColumn}
                                      disabled={!isSelected}
                                      onChange={(e) =>
                                        setTableConfigs({
                                          ...tableConfigs,
                                          [t.full_name]: {
                                            ...cfg,
                                            watermarkColumn: e.target.value,
                                          },
                                        })
                                      }
                                      className="text-xs px-2 py-0.5 bg-white border border-[#8a8886] rounded focus:outline-none font-mono"
                                    >
                                      {t.datetime_columns.map((c) => (
                                        <option key={c} value={c}>
                                          {c}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="text-[#a19f9d] text-[10px] italic">Full Refresh (No filter)</span>
                                  )}
                                </td>

                                <td className="py-2.5 px-3">
                                  <input
                                    type="text"
                                    value={cfg.targetTable}
                                    disabled={!isSelected}
                                    onChange={(e) =>
                                      setTableConfigs({
                                        ...tableConfigs,
                                        [t.full_name]: {
                                          ...cfg,
                                          targetTable: e.target.value,
                                        },
                                      })
                                    }
                                    className="text-xs h-7 px-2 bg-white border border-[#8a8886] focus:border-[#008272] rounded focus:outline-none w-36 font-mono"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: REVIEW & SYNC (EXTENDED WIDTH) */}
            {activeTab === 'review' && (
              <div className="space-y-3 animate-in fade-in-50 duration-200 max-w-6xl w-full">
                <div className="bg-white border border-[#e1dfdd] rounded-lg p-6 shadow-2xs space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#201f1e]">Review Configuration</h3>
                    <p className="text-[11px] text-[#605e5c]">
                      Verify migration parameters before synchronizing to Microsoft Fabric.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    <div className="p-3.5 rounded border border-[#e1dfdd] bg-[#f8f9fa] space-y-1.5">
                      <p className="font-bold text-[#201f1e] uppercase tracking-wider text-[10px]">Source Environment</p>
                      <p className="text-[#605e5c]">Database Type: <strong className="text-[#201f1e]">Azure SQL Database</strong></p>
                      <p className="text-[#605e5c]">Server: <span className="font-mono text-[#201f1e]">{sourceCreds.server}</span></p>
                      <p className="text-[#605e5c]">Database: <span className="font-mono text-[#201f1e]">{sourceCreds.database}</span></p>
                    </div>

                    <div className="p-3.5 rounded border border-[#e1dfdd] bg-[#f8f9fa] space-y-1.5">
                      <p className="font-bold text-[#201f1e] uppercase tracking-wider text-[10px]">Target Environment (Fabric)</p>
                      <p className="text-[#605e5c]">Warehouse: <strong className="text-[#008272]">{targetCreds.database}</strong></p>
                      <p className="text-[#605e5c]">Endpoint: <span className="font-mono text-[#201f1e] text-[11px] truncate block">{targetCreds.server}</span></p>
                      <p className="text-[#605e5c]">Authentication: <strong className="text-[#201f1e]">Service Principal (OAuth2)</strong></p>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <h4 className="text-[11px] font-bold text-[#201f1e] uppercase tracking-wider">
                      Tables to be Synchronized ({selectedCount})
                    </h4>

                    <div className="border border-[#e1dfdd] rounded overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-[#f3f2f1] border-b border-[#e1dfdd] text-[11px] font-bold text-[#323130]">
                            <th className="py-2.5 px-3">Source Table</th>
                            <th className="py-2.5 px-3">Fabric Target</th>
                            <th className="py-2.5 px-3">Load Strategy</th>
                            <th className="py-2.5 px-3">Watermark Filter</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e1dfdd]">
                          {discoveredTables
                            .filter((t) => selectedTables[t.full_name])
                            .map((t) => {
                              const cfg = tableConfigs[t.full_name];
                              return (
                                <tr key={t.full_name} className="hover:bg-[#f8f9fa]">
                                  <td className="py-2.5 px-3 font-mono font-medium text-[#201f1e]">{t.full_name}</td>
                                  <td className="py-2.5 px-3 font-mono text-[#008272]">{cfg?.targetTable || t.table_name}</td>
                                  <td className="py-2.5 px-3">
                                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200">
                                      {cfg?.incrementalType || 'FULL'}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-[11px] text-[#605e5c]">
                                    {cfg?.incrementalType === 'BOTH'
                                      ? `COALESCE(${cfg.updatedColumn || 'updated_at'}, ${cfg.createdColumn || 'created_at'})`
                                      : cfg?.watermarkColumn || 'Full Refresh'}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-start">
                    <button
                      onClick={() => setActiveTab('tables')}
                      className="px-3.5 py-1.5 text-xs font-semibold text-[#323130] bg-[#f3f2f1] hover:bg-[#edebe9] rounded border border-[#8a8886] transition cursor-pointer"
                    >
                      &larr; Modify Tables
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: JOBS (EXECUTION & DASHBOARD) */}
            {activeTab === 'jobs' && (
              <div className="space-y-4 animate-in fade-in-50 duration-200 w-full">
                {/* Metric Tiles */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 w-full">
                  <div className="bg-white border border-[#e1dfdd] rounded p-3 shadow-2xs">
                    <p className="text-[10px] font-bold text-[#605e5c] uppercase">Total Configured Jobs</p>
                    <p className="text-lg font-bold text-[#201f1e] mt-0.5">{jobs.length}</p>
                  </div>
                  <div className="bg-white border border-[#e1dfdd] rounded p-3 shadow-2xs">
                    <p className="text-[10px] font-bold text-[#605e5c] uppercase">Incremental Syncs</p>
                    <p className="text-lg font-bold text-[#008272] mt-0.5">{incrementalCount}</p>
                  </div>
                  <div className="bg-white border border-[#e1dfdd] rounded p-3 shadow-2xs">
                    <p className="text-[10px] font-bold text-[#605e5c] uppercase">Full Load Syncs</p>
                    <p className="text-lg font-bold text-[#0078d4] mt-0.5">{fullCount}</p>
                  </div>
                  <div className="bg-white border border-[#e1dfdd] rounded p-3 shadow-2xs">
                    <p className="text-[10px] font-bold text-[#605e5c] uppercase">Total Transferred Rows</p>
                    <p className="text-lg font-bold text-purple-700 mt-0.5">{totalRowsLoaded.toLocaleString()}</p>
                  </div>
                </div>

                {/* Jobs Table */}
                <div className="bg-white border border-[#e1dfdd] rounded-lg p-4 shadow-2xs space-y-3 w-full">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#e1dfdd]">
                    <div>
                      <h3 className="text-xs font-bold text-[#201f1e] uppercase tracking-wider">Execution Jobs</h3>
                      <p className="text-[11px] text-[#605e5c]">
                        Incremental watermark and MD5 hash key merge synchronization jobs.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleResetAllWatermarks}
                        className="px-2.5 py-1 bg-[#f3f2f1] hover:bg-[#edebe9] rounded border border-[#8a8886] text-[#323130] text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        title="Reset all high watermarks to force full re-sync"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Reset Watermarks
                      </button>

                      <button
                        onClick={fetchConfiguredJobs}
                        disabled={loadingJobs}
                        className="p-1 bg-[#f3f2f1] hover:bg-[#edebe9] rounded border border-[#8a8886] text-[#323130] cursor-pointer"
                        title="Refresh"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingJobs ? 'animate-spin' : ''}`} />
                      </button>

                      <button
                        onClick={handleRunAllJobs}
                        disabled={runningAll || jobs.length === 0}
                        className="px-3.5 py-1 text-xs font-bold text-white bg-[#008272] hover:bg-[#006e60] rounded shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        {runningAll ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running All...
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-white" /> Execute All Jobs
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {jobs.length === 0 ? (
                    <div className="py-8 text-center">
                      <p className="text-xs font-semibold text-[#605e5c]">No jobs configured yet</p>
                      <button
                        onClick={() => setActiveTab('tables')}
                        className="mt-2 px-3 py-1 bg-[#008272] text-white rounded text-xs font-semibold cursor-pointer"
                      >
                        Configure Tables
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-[#e1dfdd] rounded w-full">
                      <table className="w-full text-left border-collapse min-w-full">
                        <thead>
                          <tr className="bg-[#f3f2f1] border-b border-[#e1dfdd] text-[11px] font-bold text-[#323130] uppercase tracking-wider">
                            <th className="py-2 px-3">Source Table</th>
                            <th className="py-2 px-3">Fabric Target</th>
                            <th className="py-2 px-3">Strategy</th>
                            <th className="py-2 px-3">Watermark Filter</th>
                            <th className="py-2 px-3">High Watermark</th>
                            <th className="py-2 px-3">Status</th>
                            <th className="py-2 px-3">Rows Transferred</th>
                            <th className="py-2 px-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#e1dfdd] text-xs">
                          {jobs.map((job) => {
                            return (
                              <tr key={job.id} className="hover:bg-[#f8f9fa] transition">
                                <td className="py-2 px-3 font-semibold text-[#201f1e] font-mono">
                                  {job.source_schema}.{job.source_table}
                                </td>
                                <td className="py-2 px-3 text-[#008272] font-mono font-medium">{job.target_table}</td>
                                <td className="py-2 px-3">
                                  <span
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                      job.incremental_type === 'BOTH' || (job.created_column && job.updated_column)
                                        ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                                        : job.incremental_type === 'UPDATED_ONLY'
                                        ? 'bg-amber-50 text-amber-900 border border-amber-200'
                                        : job.incremental_type === 'CREATED_ONLY'
                                        ? 'bg-teal-50 text-teal-900 border border-teal-200'
                                        : 'bg-blue-50 text-blue-900 border border-blue-200'
                                    }`}
                                  >
                                    {job.incremental_type === 'BOTH' || (job.created_column && job.updated_column)
                                      ? 'Both (Dual Incremental)'
                                      : job.incremental_type === 'UPDATED_ONLY'
                                      ? 'Updated Only'
                                      : job.incremental_type === 'CREATED_ONLY'
                                      ? 'Created Only'
                                      : 'Full Load'}
                                  </span>
                                </td>
                                <td className="py-2 px-3">
                                  {job.incremental_type === 'BOTH' || (job.created_column && job.updated_column) ? (
                                    <span className="font-mono text-[10px] text-emerald-900 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                      COALESCE({job.updated_column || 'updated_at'}, {job.created_column || 'created_at'})
                                    </span>
                                  ) : job.watermark_column ? (
                                    <span className="font-mono text-[10px] text-[#323130] bg-[#f3f2f1] px-1.5 py-0.5 rounded">
                                      {job.watermark_column}
                                    </span>
                                  ) : (
                                    <span className="text-[#a19f9d] text-[10px] italic">Full Refresh</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-mono text-[10px]">
                                  {job.last_watermark_value ? (
                                    <span className="text-[#008272] bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200 font-semibold">
                                      {job.last_watermark_value}
                                    </span>
                                  ) : (
                                    <span className="text-[#a19f9d] italic">Initial</span>
                                  )}
                                </td>
                                <td className="py-2 px-3">
                                  {job.last_run_status === 'SUCCESS' && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Success
                                    </span>
                                  )}
                                  {job.last_run_status === 'FAILED' && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
                                      <AlertCircle className="w-3 h-3 text-red-600" /> Failed
                                    </span>
                                  )}
                                  {job.last_run_status === 'RUNNING' && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                                      <RefreshCw className="w-3 h-3 animate-spin text-[#008272]" /> Running
                                    </span>
                                  )}
                                  {(!job.last_run_status || job.last_run_status === 'IDLE') && (
                                    <span className="text-[10px] text-[#a19f9d]">Idle</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-semibold text-[#201f1e]">
                                  {job.last_run_rows > 0 ? `${job.last_run_rows} rows` : '-'}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      onClick={() => handleRunSingleJob(job)}
                                      className="p-1 hover:bg-emerald-50 text-emerald-700 rounded cursor-pointer"
                                      title="Run this Job"
                                    >
                                      <Play className="w-3.5 h-3.5 fill-emerald-700" />
                                    </button>
                                    <button
                                      onClick={() => handleResetSingleWatermark(job.id)}
                                      className="p-1 hover:bg-[#f3f2f1] text-[#605e5c] rounded cursor-pointer"
                                      title="Reset Watermark (Force Full Reload)"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleOpenHistory(job)}
                                      className="p-1 hover:bg-[#f3f2f1] text-[#605e5c] rounded cursor-pointer"
                                      title="View History"
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteJob(job.id)}
                                      className="p-1 hover:bg-red-50 text-red-600 rounded cursor-pointer"
                                      title="Delete Job"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {/* ================= BOTTOM STICKY ACTION FOOTER ================= */}
      <footer className="bg-white border-t border-[#e1dfdd] py-2.5 px-6 sticky bottom-0 z-30 flex items-center justify-between select-none">
        <p className="text-xs text-[#605e5c]">
          &copy; 2026 Unlimited Innovations. All rights reserved.
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setActiveTab('provision');
              setSelectedTables({});
              setTableConfigs({});
            }}
            className="px-3.5 py-1 text-xs font-semibold text-[#323130] bg-[#f3f2f1] hover:bg-[#edebe9] rounded border border-[#8a8886] transition cursor-pointer"
          >
            Reset Wizard
          </button>

          {activeTab === 'provision' && (
            <button
              onClick={handleAutoProvision}
              disabled={provisioning}
              className="px-4 py-1 text-xs font-bold text-white bg-[#008272] hover:bg-[#006e60] rounded shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {provisioning ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
              Complete Step &rarr;
            </button>
          )}

          {activeTab === 'source' && (
            <button
              onClick={handleDiscoverTables}
              disabled={discovering || !sourceCreds.password}
              className="px-4 py-1 text-xs font-bold text-white bg-[#008272] hover:bg-[#006e60] rounded shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {discovering ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
              Complete Step &rarr;
            </button>
          )}

          {activeTab === 'tables' && (
            <button
              onClick={handleSaveAndConfigureJobs}
              disabled={loadingJobs || selectedCount === 0}
              className="px-4 py-1 text-xs font-bold text-white bg-[#008272] hover:bg-[#006e60] rounded shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {loadingJobs ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
              Complete Step &rarr;
            </button>
          )}

          {activeTab === 'review' && (
            <button
              onClick={() => setActiveTab('jobs')}
              className="px-4 py-1 text-xs font-bold text-white bg-[#008272] hover:bg-[#006e60] rounded shadow-xs transition flex items-center gap-1.5 cursor-pointer"
            >
              Complete Step &rarr;
            </button>
          )}

          {activeTab === 'jobs' && (
            <button
              onClick={handleRunAllJobs}
              disabled={runningAll || jobs.length === 0}
              className="px-4 py-1 text-xs font-bold text-white bg-[#008272] hover:bg-[#006e60] rounded shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {runningAll ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
              Execute All Jobs
            </button>
          )}
        </div>
      </footer>

      {/* History Logs Modal */}
      {selectedHistoryJob && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-[#e1dfdd] shadow-xl max-w-xl w-full p-5 space-y-3 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-2 border-b border-[#e1dfdd]">
              <div>
                <h3 className="text-xs font-bold text-[#201f1e] uppercase tracking-wider">Execution Run History</h3>
                <p className="text-[11px] text-[#605e5c]">
                  Table: <code className="font-mono text-[#008272]">{selectedHistoryJob.source_table}</code>
                </p>
              </div>
              <button
                onClick={() => setSelectedHistoryJob(null)}
                className="p-1 text-[#605e5c] hover:text-[#201f1e] rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {loadingHistory ? (
                <div className="py-6 text-center text-xs text-[#605e5c]">Loading run history...</div>
              ) : historyLogs.length === 0 ? (
                <div className="py-6 text-center text-xs text-[#a19f9d]">No previous execution logs found.</div>
              ) : (
                historyLogs.map((log) => (
                  <div key={log.id} className="p-2.5 rounded border border-[#e1dfdd] bg-[#f8f9fa] text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#201f1e]">{log.start_time}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          log.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#605e5c]">
                      Transferred: <strong className="text-[#201f1e]">{log.rows_transferred} rows</strong> | High Watermark:{' '}
                      <span className="font-mono text-[#008272]">{log.watermark_end || 'N/A'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-[#e1dfdd] text-right">
              <button
                onClick={() => setSelectedHistoryJob(null)}
                className="px-3 py-1 bg-[#f3f2f1] hover:bg-[#edebe9] text-xs font-semibold rounded border border-[#8a8886] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
