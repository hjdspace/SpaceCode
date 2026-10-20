import type { BrowserWindow } from 'electron'
import { ClaudeCodeProcessPool } from '../claudeCodeProcessPool'
import { SessionConfig } from '../../session/sessionProcess'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo, ImageAttachment, PermissionDecision, PermissionMode, PermissionUpdate, ThinkingUpdateTiming, EffortLevel } from './types'
import { discoverAgentDefinitions, toAgentInfos } from './agentDefinitions'
import { info } from '../../infra/logger'

const BUILTIN_AGENTS: AgentInfo[] = [
  {
    agentType: 'general-purpose',
    description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
    source: 'built-in',
  },
  {
    agentType: 'Explore',
    description: 'Fast read-only agent specialized for exploring codebases — finding files, searching code, answering questions about the codebase.',
    source: 'built-in',
    model: 'haiku',
    color: 'blue',
  },
  {
    agentType: 'Plan',
    description: 'Software architect agent for designing implementation plans. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
    source: 'built-in',
    model: 'inherit',
    color: 'purple',
  },
  {
    agentType: 'verification',
    description: 'Verification specialist that tries to break implementations. Runs builds, tests, linters, and adversarial probes to produce a PASS/FAIL verdict.',
    source: 'built-in',
    model: 'inherit',
    color: 'red',
  },
]

export class ClaudeCodeEngine implements IEngine {
  readonly type: EngineType = 'claude-code'
  private pool: ClaudeCodeProcessPool
  private _mainWindow: BrowserWindow | null = null

  constructor() {
    this.pool = new ClaudeCodeProcessPool()
  }

  setMainWindow(window: BrowserWindow): void {
    this._mainWindow = window
    this.pool.setMainWindow(window)
  }

  /** 注册事件路由监听器，供 H5 Server 订阅引擎事件 */
  onRouteEvent(listener: (sessionId: string, eventType: string, data: any) => void): () => void {
    return this.pool.onRouteEvent(listener)
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    const sessionConfig: SessionConfig = {
      cwd: config.cwd,
      provider: config.provider as SessionConfig['provider'],
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      effortLevel: config.effortLevel,
      // 无人值守的调用方（定时任务）靠这个字段决定是否跳过权限确认，此前被丢弃
      permissionMode: config.permissionMode,
      systemPrompt: config.systemPrompt,
      agent: config.agent,
      thinkingEnabled: config.thinkingEnabled,
      resumeSessionId: config.resumeSessionId,
      engineSource: config.engineSource as SessionConfig['engineSource'],
      installedCliPath: config.installedCliPath,
      modelContextWindows: config.modelContextWindows,
      rtkEnabled: config.rtkEnabled,
    }
    await this.pool.startSession(sessionId, sessionConfig)
  }

  sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    // 池会在转发前做权限模式核验与 --thinking 重启，这两步是异步的，
    // 且可能判定"不该发送"—— 必须把这条 Promise 原样交给调用方。
    return this.pool.sendMessage(sessionId, content, images)
  }

  submitToolAnswer(sessionId: string, toolCallId: string, answers: Record<string, string>): Promise<void> {
    this.pool.submitToolAnswer(sessionId, toolCallId, answers)
    return Promise.resolve()
  }

  skipToolAnswer(sessionId: string, toolCallId: string): Promise<void> {
    this.pool.skipToolAnswer(sessionId, toolCallId)
    return Promise.resolve()
  }

  // ── can_use_tool / control_request 协议 ──

  respondPermission(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void> {
    this.pool.respondPermission(sessionId, requestId, decision)
    return Promise.resolve()
  }

  allowPermission(
    sessionId: string,
    requestId: string,
    updatedInput?: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
    updatedPermissions?: PermissionUpdate[],
  ): Promise<void> {
    this.pool.allowPermission(sessionId, requestId, updatedInput, decisionClassification, updatedPermissions)
    return Promise.resolve()
  }

  denyPermission(
    sessionId: string,
    requestId: string,
    message?: string,
    options?: { interrupt?: boolean },
  ): Promise<void> {
    this.pool.denyPermission(sessionId, requestId, message, options)
    return Promise.resolve()
  }

  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    return this.pool.setPermissionMode(sessionId, mode)
  }

  setModel(sessionId: string, model: string | undefined): Promise<void> {
    return this.pool.setModel(sessionId, model)
  }

  // async 而非 Promise.resolve(...)：进程池这一层是同步的，抛出来时要变成 reject，
  // 别让"返回 Promise 却同步抛错"漏到只写 .catch() 的调用方身上。
  async updateThinkingLevel(sessionId: string, enabled: boolean): Promise<ThinkingUpdateTiming> {
    return this.pool.updateThinkingLevel(sessionId, enabled)
  }

  async updateEffortLevel(sessionId: string, level: EffortLevel): Promise<ThinkingUpdateTiming> {
    return this.pool.updateEffortLevel(sessionId, level)
  }

  getMcpStatus(sessionId: string) {
    return this.pool.getMcpStatus(sessionId)
  }

  getContextUsage(sessionId: string) {
    return this.pool.getContextUsage(sessionId)
  }

  getSettings(sessionId: string) {
    return this.pool.getSettings(sessionId)
  }

  stopEngineTask(sessionId: string, taskId: string): Promise<void> {
    return this.pool.stopTask(sessionId, taskId)
  }

  getPendingPermissionRequestIds(sessionId: string): string[] {
    return this.pool.getPendingPermissionRequestIds(sessionId)
  }

  abort(sessionId: string): Promise<void> {
    this.pool.abortSession(sessionId)
    return Promise.resolve()
  }

  stop(sessionId: string): Promise<void> {
    this.pool.killSession(sessionId)
    return Promise.resolve()
  }

  suspendSession(sessionId: string): void {
    this.pool.suspendSession(sessionId)
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.pool.resumeSession(sessionId)
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    const status = this.pool.getSessionStatus(sessionId)
    if (!status) return null
    return {
      sessionId: status.sessionId,
      engineSessionId: status.engineSessionId,
      status: status.status,
      isRunning: status.isRunning,
      permissionMode: status.permissionMode as PermissionMode | undefined,
      permissionModeVerified: status.permissionModeVerified,
    }
  }

  getActiveSessions(): EngineSessionStatus[] {
    return this.pool.getActiveSessions().map(s => ({
      sessionId: s.sessionId,
      engineSessionId: s.engineSessionId,
      status: s.status,
      isRunning: s.isRunning,
      permissionMode: s.permissionMode as PermissionMode | undefined,
      permissionModeVerified: s.permissionModeVerified,
    }))
  }

  async listAgents(cwd?: string): Promise<AgentInfo[]> {
    return [...BUILTIN_AGENTS, ...toAgentInfos(discoverAgentDefinitions({ kinds: ['claude'], cwd }))]
  }
}
