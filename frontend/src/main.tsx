import { bootstrap, createWorkloadClient, InitParams, ItemLikeV2 } from '@ms-fabric/workload-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';

const WORKLOAD_NAME = 'Org.Accelerator';

function renderApp() {
  const rootElement = document.getElementById('root');
  if (rootElement && !rootElement.hasChildNodes()) {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  }
}

// Fabric Workload Client SDK bootstrap
try {
  bootstrap({
    initializeWorker: async (params: InitParams) => {
      console.log('🚀 Fabric Workload Worker initialized:', params);
      const workloadClient = createWorkloadClient();

      workloadClient.action.onAction(async ({ action, data }) => {
        console.log(`🧭 Worker action ${action} with data:`, data);
        if (action === 'item.onCreationSuccess') {
          const { item } = data as { item: ItemLikeV2 };
          console.log('Item created successfully, opening editor for:', item?.objectId);
          try {
            await workloadClient.page.open({
              workloadName: WORKLOAD_NAME,
              route: { path: `/HelloWorldItem-editor/${item.objectId}` },
            });
          } catch (e) {
            console.warn('Could not call page.open:', e);
          }
          return { succeeded: true };
        }
        return { succeeded: true };
      });
    },
    initializeUI: async (params: InitParams) => {
      console.log('🎨 Fabric Workload UI initialized:', params);
      const workloadClient = createWorkloadClient();

      workloadClient.action.onAction(async ({ action }) => {
        console.log(`🧭 UI action: ${action}`);
        if (action === 'item.tab.onInit') {
          return { title: 'Data Ingestion Pipeline' };
        }
        if (action === 'item.tab.canDeactivate') {
          return { canDeactivate: true };
        }
        return {};
      });

      renderApp();
    },
  });
} catch (err) {
  console.warn('Fabric bootstrap fallback:', err);
}

// Render immediately for direct web access or iframe fallback
renderApp();

