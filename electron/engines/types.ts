import type { BrowserWindow } from 'electron'

export type EngineType = 'claude-code' | 'pi'

export interface EngineSessionConfig {
  cwd: string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  thinkingEnabled?: boolean
  effortLevel?: string
  systemPrompt?: string
  appendSystemPrompt?: string
  agent?: string
  engineType?: EngineType
}

export interface UnifiedEngineEvent {
  sessionId: string
  type:
    | 'assistant'
    | 'tool_use'
    | 'tool_result'
    | 'stream_event'
    | 'result'
    | 'system'
    | 'error'
    | 'exit'
    | 'log'
    | 'suspended'
    | 'eviction_blocked'
    | 'user'
    | 'compact'
    | 'api_retry'
  data: any
}

export interface EngineSessionStatus {
  sessionId: string
  engineSessionId: string | null
  status: 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
  isRunning: boolean
}

export interface ImageAttachment {
  id: string
  name: string
  type: 'image'
  mimeType: string
  previewUrl: string
  data: string
}

export interface IEngine {
  readonly type: EngineType
  startSession(sessionId: string, config: EngineSessionConfig): Promise<void>
  sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void>
  abort(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  suspendSession?(sessionId: string): void
  resumeSession?(sessionId: string): Promise<void>
  getSessionStatus(sessionId: string): EngineSessionStatus | null
  getActiveSessions(): EngineSessionStatus[]
  listAgents?(cwd?: string): Promise<AgentInfo[]>
  setMainWindow(window: BrowserWindow): void
}

export interface AgentInfo {
  agentType: string
  description: string
  source: 'built-in' | 'user' | 'project' | 'plugin'
  model?: string
  color?: string
}
