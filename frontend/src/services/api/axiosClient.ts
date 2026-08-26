import axios from 'axios';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sql?: string | null;
  row_count?: number | null;
  export_id?: string | null;
  export_row_count?: number | null;
  intent?: string | null;
  created_at?: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  intent: 'db_query' | 'off_topic';
  sql?: string | null;
  row_count?: number | null;
  export_id?: string | null;
  export_row_count?: number | null;
}

const API_BASE = import.meta.env.VITE_API_BASE || '';

export function exportUrl(exportId: string): string {
  return `/api/export/${exportId}`;
}

export interface HealthResponse {
  status: string;
  db_configured: boolean;
  schema_loaded: boolean;
}

// Create an Axios instance with credentials enabled so it sends cookies automatically
export const apiClient = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor to handle 401s and auto-refresh the token
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    // If the error is 401 and we haven't already retried
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        // Attempt to refresh the token via cookie
        await axios.post(
          `${API_BASE}/auth/jwt/refresh`,
          {},
          { withCredentials: true }
        );
        // If successful, retry the original request
        return apiClient(originalRequest);
      } catch (refreshError) {
        // If refresh fails, let the error pass through (AuthContext will log out)
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

// --- API Service Methods ---

export async function sendMessage(message: string, sessionId: string): Promise<ChatResponse> {
  const res = await apiClient.post(`/api/chat?t=`, {
    message,
    session_id: sessionId,
  });
  return res.data;
}

export async function getSessions(): Promise<ChatSession[]> {
  const res = await apiClient.get('/api/chat/sessions');
  return res.data;
}

export async function createSession(): Promise<ChatSession> {
  const res = await apiClient.post('/api/chat/sessions');
  return res.data;
}

export async function deleteSession(id: string): Promise<void> {
  await apiClient.delete(`/api/chat/sessions/${id}`);
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await apiClient.get(`/api/health?t=`);
  return res.data;
}

