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

export interface IEngine {
  readonly type: EngineType
  startSession(sessionId: string, config: EngineSessionConfig): Promise&lt;void&gt;
  sendMessage(sessionId: string, content: string): Promise&lt;void&gt;
  abort(sessionId: string): Promise&lt;void&gt;
  stop(sessionId: string): Promise&lt;void&gt;
  suspendSession?(sessionId: string): void
  resumeSession?(sessionId: string): Promise&lt;void&gt;
  getSessionStatus(sessionId: string): EngineSessionStatus | null
  getActiveSessions(): EngineSessionStatus[]
  listAgents?(cwd?: string): Promise&lt;AgentInfo[]&gt;
  setMainWindow(window: BrowserWindow): void
}

export interface AgentInfo {
  agentType: string
  description: string
  source: 'built-in' | 'user' | 'project' | 'plugin'
  model?: string
  color?: string
}
