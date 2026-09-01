import { Routes, Route } from 'react-router-dom';
import { DataIngestionApp } from '../features/ingestion/DataIngestionApp';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DataIngestionApp />} />
      <Route path="/chat" element={<DataIngestionApp />} />
      <Route path="/ingestion" element={<DataIngestionApp />} />
      <Route path="*" element={<DataIngestionApp />} />
    </Routes>
  );
}
