import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// Handle Microsoft Fabric Workload iframe messages
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    try {
      const data = event.data;
      if (!data) return;
      if (data.action === 'initialize' || data.type === 'initialize' || data.action === 'workload.initialize') {
        window.parent.postMessage({ succeeded: true, action: 'item.onCreationSuccess' }, '*');
      }
    } catch (_) {}
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
