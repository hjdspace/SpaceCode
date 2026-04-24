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
  output?: string
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

// ─── Slash Command Types ─────────────────────────────────────────

// Re-export CommandKind from constants to avoid duplication
export type { CommandKind } from '@/lib/constants/commands'

export interface SlashCommand {
  name: string
  description: string
  icon: string
  kind?: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command'
  immediate?: boolean
  aliases?: string[]
}

export interface CommandBadge {
  command: string
  label: string
  description: string
  kind: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command'
}