export interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  sql?: string | null
  rowCount?: number | null
  exportId?: string | null
  exportRowCount?: number | null
  intent?: 'db_query' | 'off_topic'
  status?: 'pending' | 'done' | 'error'
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}
