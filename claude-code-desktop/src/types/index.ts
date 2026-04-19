export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
  status: 'pending' | 'running' | 'completed' | 'error'
}

export interface ToolResult {
  id: string
  output: string
  isError?: boolean
}

export interface Session {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  workingDirectory?: string  // 会话所属的项目路径
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  isExpanded?: boolean
}

export interface DiffInfo {
  oldPath: string
  newPath: string
  oldContent: string
  newContent: string
  hunks: DiffHunk[]
}

export interface DiffHunk {
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldNumber?: number
  newNumber?: number
}