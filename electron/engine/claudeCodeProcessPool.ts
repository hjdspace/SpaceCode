import { BrowserWindow } from 'electron'
import { SessionProcess, ProcessStatus, SessionConfig } from '../session/sessionProcess'
import { info, warn, error, debug } from '../infra/logger'
import { claudeCodeNamespace, type ThinkingUpdateTiming } from '@/shared/channels/claudeCode'
import { eventChannelsBySuffix } from '@/shared/channelMap'
import { engineBlockedError, type EngineBlockedPayload } from '@/shared/engineErrors'
import type { EffortLevel } from '@/shared/effort'

// 引擎事件按类型动态派发：后缀 → 完整 channel 名，与 renderer 端订阅共享同一真相源
const CLAUDE_CODE_EVENT_BY_SUFFIX = eventChannelsBySuffix(claudeCodeNamespace.events, 'claude-code:')

export const MAX_PROCESSES = 20

export interface SessionStatusInfo {
  sessionId: string
  engineSessionId: string | null
  status: ProcessStatus
  isRunning: boolean
  permissionMode?: string
  /**
   * 引擎侧是否已确认运行在 permissionMode（用户意图）上。
   * null = 该 CLI 版本没在 system/init 回报模式，按"spawn 参数即意图"采信。
   */
  permissionModeVerified?: boolean | null
}

export class ClaudeCodeProcessPool {
  private processes: Map<string, SessionProcess> = new Map()
  private pendingPermissionModes: Map<string, string> = new Map()
  /** 已用"重启到该模式"补救过的 sessionId → mode，防止对确定性拒绝无限重启。 */
  private modeRepairTried: Map<string, string> = new Map()
  private mainWindow: BrowserWindow | null = null
  private routeEventListeners: Array<(sessionId: string, eventType: string, data: any) => void> = []
  private poolHandlers: Map<
    string,
    {
      message: (msg: any) => void
      log: (data: string) => void
      exit: (code: number | null) => void
      error: (err: Error) => void
      permissionRequest?: (data: any) => void
      permissionRequestCancelled?: (data: any) => void
      elicitationRequest?: (data: any) => void
    }
  > = new Map()

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  /** 注册事件路由监听器，返回取消订阅函数 */
  onRouteEvent(listener: (sessionId: string, eventType: string, data: any) => void): () => void {
    this.routeEventListeners.push(listener)
    return () => {
      const idx = this.routeEventListeners.indexOf(listener)
      if (idx >= 0) this.routeEventListeners.splice(idx, 1)
    }
  }

  async startSession(sessionId: string, config: SessionConfig): Promise<void> {
    info('ProcessPool', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model} | existing=${this.processes.has(sessionId)}`)

    if (this.processes.has(sessionId)) {
      const existing = this.processes.get(sessionId)!
      if (existing.isRunning()) {
        info('ProcessPool', `[${sessionId.slice(0, 8)}] Session already running, reusing`)
        return
      }
      if (existing.status === 'suspended' && existing.engineSessionId) {
        info('ProcessPool', `[${sessionId.slice(0, 8)}] Session is suspended, resuming | engineSessionId=${existing.engineSessionId}`)
        await this.resumeSession(sessionId)
        return
      }
      // Dead/exited entry — drop it so a fresh process can take over cleanly.
      info('ProcessPool', `[${sessionId.slice(0, 8)}] Evicting stale session entry | status=${existing.status}`)
      this.detachPoolHandlers(sessionId, existing)
      this.processes.delete(sessionId)
      this.modeRepairTried.delete(sessionId)
    }

    this.evictIfNeeded()

    const proc = new SessionProcess(sessionId, config)
    this.processes.set(sessionId, proc)

    this.attachPoolHandlers(sessionId, proc)

    try {
      await proc.start()
      info('ProcessPool', `[${sessionId.slice(0, 8)}] Session started successfully | pid=${proc.process?.pid} | totalActive=${Array.from(this.processes.values()).filter(p => p.isRunning()).length}`)
      await this.reconcilePermissionMode(sessionId, proc, 'start')
    } catch (err) {
      error('ProcessPool', `[${sessionId.slice(0, 8)}] Failed to start session`, { error: String(err) })
      throw err
    }
  }

  async resumeSession(sessionId: string): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc) throw new Error(`Session ${sessionId} not found`)
    if (proc.status !== 'suspended') throw new Error(`Session ${sessionId} is not suspended`)

    info('ProcessPool', `[${sessionId.slice(0, 8)}] Resuming session | engineSessionId=${proc.engineSessionId}`)

    this.evictIfNeeded()

    this.detachPoolHandlers(sessionId, proc)
    this.attachPoolHandlers(sessionId, proc)

    try {
      await proc.resume()
      info('ProcessPool', `[${sessionId.slice(0, 8)}] Session resumed successfully`)
      await this.reconcilePermissionMode(sessionId, proc, 'resume')
    } catch (err) {
      error('ProcessPool', `[${sessionId.slice(0, 8)}] Failed to resume session`, { error: String(err) })
      throw err
    }
  }

  suspendSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Suspending session | canSafelySuspend=${proc.canSafelySuspend()} | pendingTools=${proc.getPendingToolCount()}`)
    proc.suspend()
  }

  /**
   * 让引擎实际运行的权限模式追上用户意图。
   *
   * spawn 参数现在已经是意图（见 sessionProcess.buildArgs），所以这里只处理两种真偏差：
   *  - 意图在进程起来之后才变（pendingPermissionModes：无进程时用户切了模式）；
   *  - 引擎在 system/init 里回报的模式与意图不符（被 settings 闸门降级等）。
   * 偏差时先发 set_permission_mode（等 system/init 之后再发，避开 CLI 未就绪的 10s 超时），
   * 失败就用意图作为启动参数重启进程 —— 重启不依赖控制请求，等于把"恢复失败还留在
   * bypass"这类失控从根上消掉。同一模式只重启补救一次，避免对确定性拒绝无限循环。
   */
  private async reconcilePermissionMode(
    sessionId: string,
    proc: SessionProcess,
    context: 'start' | 'resume' | 'init' | 'result' | 'send',
  ): Promise<void> {
    const shortSid = sessionId.slice(0, 8)
    const intent = (this.pendingPermissionModes.get(sessionId) ?? proc.currentPermissionMode) as
      | import('../session/controlProtocol').PermissionMode
      | undefined
    if (!intent) {
      this.pendingPermissionModes.delete(sessionId)
      return
    }
    // buildArgs 里 config.permissionMode 缺省按 default 下发，比对要用同一个口径。
    const spawnedAsIntent = (proc.config.permissionMode ?? 'default') === intent
    const engineDisagrees = proc.reportedPermissionMode !== null && proc.reportedPermissionMode !== intent
    if (spawnedAsIntent && !engineDisagrees) {
      this.pendingPermissionModes.delete(sessionId)
      return
    }

    info('ProcessPool', `[${shortSid}] Reconciling permission mode | intent=${intent} | spawnedAs=${proc.config.permissionMode} | engineReports=${proc.reportedPermissionMode ?? '(unknown)'} | context=${context}`)
    if (!proc.isRunning()) return
    // 等 CLI 真正开始消费 stdin 上的控制请求，否则这次下发注定超时。
    await proc.waitForInit()
    if (!proc.isRunning()) return

    if (await this.applyPermissionModeWithRetry(sessionId, proc, intent, context)) {
      this.pendingPermissionModes.delete(sessionId)
      // 同步 spawn 参数：进程之后挂起再恢复时不应退回旧模式。
      proc.config.permissionMode = intent
      return
    }
    await this.restartInPermissionMode(sessionId, proc, intent)
  }

  /**
   * 下发意图模式，有限次重试。CLI 冷启动（Linux AppImage 等）可能超过 setPermissionMode
   * 的 10s 超时窗口才开始消费 stdin 控制请求 —— 调用方已先等过 system/init，这里只剩
   * 偶发失败；进程已退出则立即放弃。
   */
  private async applyPermissionModeWithRetry(
    sessionId: string,
    proc: SessionProcess,
    mode: import('../session/controlProtocol').PermissionMode,
    context: string,
  ): Promise<boolean> {
    const maxAttempts = 3
    const retryDelayMs = 3_000
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await proc.setPermissionMode(mode)
        return true
      } catch (e) {
        if (!proc.isRunning() || attempt >= maxAttempts) {
          warn('ProcessPool', `[${sessionId.slice(0, 8)}] Failed to apply permission mode after ${attempt} attempt(s) | context=${context}`, { error: String(e) })
          return false
        }
        warn('ProcessPool', `[${sessionId.slice(0, 8)}] Permission mode attempt ${attempt}/${maxAttempts} failed, retrying in ${retryDelayMs}ms | context=${context}`, { error: String(e) })
        await new Promise(resolve => setTimeout(resolve, retryDelayMs))
      }
    }
    return false
  }

  /**
   * 控制请求救不回来时的兜底：把意图写进启动参数并重启进程。
   * 带 engineSessionId 时走 suspend+resume，历史与上下文都保住。
   *
   * @returns 是否真的做了一次重启补救；false = 该模式已重启试过，不再无限循环。
   */
  private async restartInPermissionMode(
    sessionId: string,
    proc: SessionProcess,
    mode: import('../session/controlProtocol').PermissionMode,
  ): Promise<boolean> {
    const shortSid = sessionId.slice(0, 8)
    if (this.modeRepairTried.get(sessionId) === mode) {
      error('ProcessPool', `[${shortSid}] Permission mode still not in effect after restart | intent=${mode} | engineReports=${proc.reportedPermissionMode ?? '(unknown)'}`)
      return false
    }
    if (proc.engineSessionId && !proc.canSafelySuspend()) {
      // 有历史要保，不能硬杀进程；等这一轮收尾后由 result 路径再对账。
      warn('ProcessPool', `[${shortSid}] Won't restart mid-turn to apply permission mode | mode=${mode} | pendingTools=${proc.getPendingToolCount()}`)
      return false
    }
    this.modeRepairTried.set(sessionId, mode)
    this.pendingPermissionModes.delete(sessionId)
    warn('ProcessPool', `[${shortSid}] Restarting engine process to apply permission mode | mode=${mode}`)
    proc.config.permissionMode = mode
    proc.currentPermissionMode = mode
    if (proc.engineSessionId) {
      proc.suspend()
      await this.resumeSession(sessionId)
      return true
    }
    // 还没拿到 engineSessionId（刚 spawn 就失败），没有历史可保，直接重起。
    proc.kill()
    await proc.start()
    return true
  }

  /**
   * 危险偏差：引擎跑在 bypassPermissions 上，而用户意图是别的模式 —— 那意味着工具
   * 不会再经宿主确认。其余方向（引擎比意图更保守）不构成风险，不拦。
   */
  private isModeHazard(proc: SessionProcess): boolean {
    return proc.reportedPermissionMode === 'bypassPermissions' && proc.currentPermissionMode !== 'bypassPermissions'
  }

  /** --thinking / --effort 都只在 spawn 时读一次：配置与本次 spawn 不一致即待重启生效。 */
  private isSpawnArgsStale(proc: SessionProcess): boolean {
    return proc.isRunning()
      && (proc.spawnedThinkingEnabled !== proc.config.thinkingEnabled
        || proc.spawnedEffortLevel !== proc.config.effortLevel)
  }

  async sendMessage(sessionId: string, content: string, images?: any[]): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      error('ProcessPool', `[${sessionId.slice(0, 8)}] sendMessage failed: no active process | hasProcess=${!!proc} | isRunning=${proc?.isRunning()}`)
      throw engineBlockedError(sessionId, {
        reason: 'session-not-active',
        detail: `Session ${sessionId} has no active process`,
        context: { engine: 'claude-code', operation: 'sendMessage' },
      })
    }
    await this.guardPermissionMode(sessionId, proc)
    await this.applyStaleSpawnArgs(sessionId, proc)
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Forwarding user message | contentLen=${content.length} | images=${images?.length || 0}`)
    proc.sendMessage(content, images)
  }

  /**
   * 引擎若跑在比意图更宽的模式上（bypass），消息一旦转发，工具就绕不开宿主直接执行。
   * 先救一次（下发 + 重启），救不回来就拦下这条消息 —— 宁可不发，也不要在用户以为的
   * 计划模式下改他的文件。
   */
  private async guardPermissionMode(sessionId: string, proc: SessionProcess): Promise<void> {
    if (!this.isModeHazard(proc)) return
    await this.reconcilePermissionMode(sessionId, proc, 'send')
    if (!this.isModeHazard(proc)) return
    const payload: EngineBlockedPayload = {
      reason: 'permission-mode-not-applied',
      detail: `permission mode not applied (intent=${proc.currentPermissionMode}, engine=${proc.reportedPermissionMode ?? 'unknown'})`,
      context: {
        engine: 'claude-code',
        intent: proc.currentPermissionMode,
        reported: proc.reportedPermissionMode ?? null,
      },
    }
    error('ProcessPool', `[${sessionId.slice(0, 8)}] Blocked message send: ${payload.detail}`)
    this.routeEvent(sessionId, 'error', payload)
    throw engineBlockedError(sessionId, payload)
  }

  /**
   * 思考开关或推理深度在轮次进行中被改过：那一轮不动，但下一条消息必须以新参数起来。
   * result 事件已经挂过一次了，这里是漏掉那次（或期间又改了配置）的兜底。
   */
  private async applyStaleSpawnArgs(sessionId: string, proc: SessionProcess): Promise<void> {
    if (!this.isSpawnArgsStale(proc) || !proc.canSafelySuspend()) return
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Spawn-only config changed mid-turn | respawning with --thinking=${proc.config.thinkingEnabled ? 'enabled' : 'disabled'} --effort=${proc.config.effortLevel ?? '(default)'} before this send`)
    if (proc.engineSessionId) {
      proc.suspend()
      await this.resumeSession(sessionId)
      return
    }
    proc.kill()
    await proc.start()
  }

  submitToolAnswer(sessionId: string, toolCallId: string, answers: Record<string, string>): void {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      error('ProcessPool', `[${sessionId.slice(0, 8)}] submitToolAnswer failed: no active process | hasProcess=${!!proc} | isRunning=${proc?.isRunning()}`)
      throw engineBlockedError(sessionId, {
        reason: 'session-not-active',
        detail: `Session ${sessionId} has no active process`,
        context: { engine: 'claude-code', operation: 'submitToolAnswer' },
      })
    }
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Forwarding tool answer | toolId=${toolCallId.slice(0, 8)} | answers=${JSON.stringify(answers)}`)
    proc.submitToolAnswer(toolCallId, answers)
  }

  skipToolAnswer(sessionId: string, toolCallId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      error('ProcessPool', `[${sessionId.slice(0, 8)}] skipToolAnswer failed: no active process | hasProcess=${!!proc} | isRunning=${proc?.isRunning()}`)
      throw engineBlockedError(sessionId, {
        reason: 'session-not-active',
        detail: `Session ${sessionId} has no active process`,
        context: { engine: 'claude-code', operation: 'skipToolAnswer' },
      })
    }
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Forwarding tool skip | toolId=${toolCallId.slice(0, 8)}`)
    proc.skipToolAnswer(toolCallId)
  }

  // ──────────────────────────────────────────────────────────────────────
  // can_use_tool / control_request 协议（来自 SessionProcess）
  // ──────────────────────────────────────────────────────────────────────

  respondPermission(
    sessionId: string,
    requestId: string,
    decision: import('../session/controlProtocol').PermissionDecision,
  ): void {
    const proc = this.requireRunning(sessionId, 'respondPermission')
    proc.respondPermission(requestId, decision)
  }

  allowPermission(
    sessionId: string,
    requestId: string,
    updatedInput?: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
    updatedPermissions?: import('../session/controlProtocol').PermissionUpdate[],
  ): void {
    const proc = this.requireRunning(sessionId, 'allowPermission')
    proc.allowPermission(requestId, updatedInput, decisionClassification, updatedPermissions)
  }

  denyPermission(
    sessionId: string,
    requestId: string,
    message: string = 'User denied',
    options: { interrupt?: boolean } = {},
  ): void {
    const proc = this.requireRunning(sessionId, 'denyPermission')
    proc.denyPermission(requestId, message, options)
  }

  async setPermissionMode(
    sessionId: string,
    mode: import('../session/controlProtocol').PermissionMode,
  ): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      this.pendingPermissionModes.set(sessionId, mode)
      // 意图当场落地：进程下次起来时 reconcile 会按它对齐，不必再等恢复回调。
      if (proc) proc.currentPermissionMode = mode
      info('ProcessPool', `[${sessionId.slice(0, 8)}] setPermissionMode: no active process, saved as pending | mode=${mode}`)
      return
    }
    this.pendingPermissionModes.delete(sessionId)
    try {
      await proc.setPermissionMode(mode)
    } catch (err) {
      // 引擎只允许"启动时带了 --dangerously-skip-permissions"的进程进入 bypass，
      // 与其把"请新建会话后再试"甩给用户，不如按新模式重启进程（--resume 保历史）。
      info('ProcessPool', `[${sessionId.slice(0, 8)}] setPermissionMode refused, restarting engine in mode ${mode}`, { error: String(err) })
      if (!(await this.restartInPermissionMode(sessionId, proc, mode))) throw err
    }
  }

  /**
   * 切换会话的思考开关。
   *
   * CLI 没有 set_thinking 控制请求，`--thinking` 只在 spawn 时读一次，所以这里改的是
   * 会话配置本身，处置逻辑见 respawnForSpawnOnlyChange。
   */
  updateThinkingLevel(sessionId: string, enabled: boolean): ThinkingUpdateTiming {
    const proc = this.processes.get(sessionId)
    if (!proc) {
      debug('ProcessPool', `[${sessionId.slice(0, 8)}] updateThinkingLevel: no session entry | enabled=${enabled}`)
      return 'now'
    }
    proc.config.thinkingEnabled = enabled
    return this.respawnForSpawnOnlyChange(sessionId, proc, `updateThinkingLevel=${enabled}`)
  }

  /**
   * 切换会话的推理深度。与思考开关走同一条路径 —— CLI 同样没有 set_effort 控制请求，
   * 而且非法档位它只 warn 后退回默认、退出码照旧是 0，所以界面只能靠这里的答复判断生效时机。
   */
  updateEffortLevel(sessionId: string, level: EffortLevel): ThinkingUpdateTiming {
    const proc = this.processes.get(sessionId)
    if (!proc) {
      debug('ProcessPool', `[${sessionId.slice(0, 8)}] updateEffortLevel: no session entry | level=${level}`)
      return 'now'
    }
    proc.config.effortLevel = level
    return this.respawnForSpawnOnlyChange(sessionId, proc, `updateEffortLevel=${level}`)
  }

  /**
   * 正在跑的那一轮不打断（历史靠 --resume 保住）：空闲时立即挂起，轮次进行中则留待
   * result 事件挂起，最迟在下一条消息转发前重启补齐 —— 否则表现就是"点了没反应"。
   *
   * @returns now = 本次切换已经落到进程上；next-turn = 当前这一轮跑完后生效。
   */
  private respawnForSpawnOnlyChange(
    sessionId: string,
    proc: SessionProcess,
    applied: string,
  ): ThinkingUpdateTiming {
    if (!proc.isRunning()) return 'now'
    if (proc.canSafelySuspend()) {
      info('ProcessPool', `[${sessionId.slice(0, 8)}] ${applied} | suspending so the next send respawns with it`)
      this.suspendSession(sessionId)
      return 'now'
    }
    info('ProcessPool', `[${sessionId.slice(0, 8)}] ${applied} | turn in flight, applies at the end of this turn`)
    return 'next-turn'
  }

  setModel(sessionId: string, model: string | undefined): Promise<void> {
    const proc = this.requireRunning(sessionId, 'setModel')
    return proc.setModel(model)
  }

  getMcpStatus(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      debug('ProcessPool', `[${sessionId.slice(0, 8)}] getMcpStatus: no active process, returning undefined`)
      return Promise.resolve(undefined)
    }
    return proc.getMcpStatus()
  }

  getContextUsage(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      debug('ProcessPool', `[${sessionId.slice(0, 8)}] getContextUsage: no active process, returning undefined`)
      return Promise.resolve(undefined)
    }
    return proc.getContextUsage()
  }

  getSettings(sessionId: string): Promise<Record<string, unknown> | undefined> {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      debug('ProcessPool', `[${sessionId.slice(0, 8)}] getSettings: no active process, returning undefined`)
      return Promise.resolve(undefined)
    }
    return proc.getSettings()
  }

  stopTask(sessionId: string, taskId: string): Promise<void> {
    const proc = this.requireRunning(sessionId, 'stopTask')
    return proc.stopTask(taskId)
  }

  getPendingPermissionRequestIds(sessionId: string): string[] {
    const proc = this.processes.get(sessionId)
    if (!proc) return []
    return proc.getPendingPermissionRequestIds()
  }

  private requireRunning(sessionId: string, op: string): SessionProcess {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      error(
        'ProcessPool',
        `[${sessionId.slice(0, 8)}] ${op} failed: no active process | hasProcess=${!!proc} | isRunning=${proc?.isRunning()}`,
      )
      throw engineBlockedError(sessionId, {
        reason: 'session-not-active',
        detail: `Session ${sessionId} has no active process`,
        context: { engine: 'claude-code', operation: op },
      })
    }
    return proc
  }

  abortSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Aborting session`)
    proc.abort()
  }

  killSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Killing session`)
    this.detachPoolHandlers(sessionId, proc)
    proc.kill()
    this.processes.delete(sessionId)
    this.modeRepairTried.delete(sessionId)
  }

  getSessionStatus(sessionId: string): SessionStatusInfo | null {
    const proc = this.processes.get(sessionId)
    if (!proc) return null
    return {
      sessionId: proc.sessionId,
      engineSessionId: proc.engineSessionId,
      status: proc.status,
      isRunning: proc.isRunning(),
      permissionMode: proc.currentPermissionMode,
      permissionModeVerified: proc.permissionModeVerified
    }
  }

  getActiveSessions(): SessionStatusInfo[] {
    return Array.from(this.processes.values()).map(proc => ({
      sessionId: proc.sessionId,
      engineSessionId: proc.engineSessionId,
      status: proc.status,
      isRunning: proc.isRunning(),
      permissionMode: proc.currentPermissionMode,
      permissionModeVerified: proc.permissionModeVerified
    }))
  }

  getEngineSessionId(sessionId: string): string | null {
    return this.processes.get(sessionId)?.engineSessionId ?? null
  }

  killAll(): void {
    info('ProcessPool', `Killing all sessions | count=${this.processes.size}`)
    for (const [sessionId, proc] of this.processes.entries()) {
      this.detachPoolHandlers(sessionId, proc)
      proc.kill()
    }
    this.processes.clear()
    this.poolHandlers.clear()
    this.modeRepairTried.clear()
  }

  private evictIfNeeded(): void {
    const runningCount = Array.from(this.processes.values()).filter(p => p.isRunning()).length
    if (runningCount < MAX_PROCESSES) return

    info('ProcessPool', `Eviction needed | runningCount=${runningCount} | max=${MAX_PROCESSES}`)

    // 首先尝试驱逐可以安全挂起的 idle 会话
    const safeIdleCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'idle' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeIdleCandidates.length > 0) {
      const victim = safeIdleCandidates[0]
      info('ProcessPool', `[${victim.sessionId.slice(0, 8)}] Evicting idle session | lastActivity=${new Date(victim.lastActivityAt).toISOString()}`)
      victim.suspend()
      this.routeEvent(victim.sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    // 其次尝试驱逐可以安全挂起的 active 会话
    const safeActiveCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'active' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeActiveCandidates.length > 0) {
      const victim = safeActiveCandidates[0]
      info('ProcessPool', `[${victim.sessionId.slice(0, 8)}] Evicting active session | lastActivity=${new Date(victim.lastActivityAt).toISOString()}`)
      victim.suspend()
      this.routeEvent(victim.sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    // 如果没有可以安全挂起的会话，记录警告但不强制驱逐
    const unsafeCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && !p.canSafelySuspend())

    if (unsafeCandidates.length > 0) {
      warn('ProcessPool', `Cannot evict any session: ${unsafeCandidates.length} session(s) have pending operations. Waiting for operations to complete.`)
      unsafeCandidates.forEach(p => {
        this.routeEvent(p.sessionId, 'eviction_blocked', {
          reason: 'pending_operations',
          pendingTools: p.getPendingToolCount()
        })
      })
    }
  }

  private attachPoolHandlers(sessionId: string, proc: SessionProcess): void {
    const handlers = {
      message: (msg: any) => {
        this.routeEvent(sessionId, msg.type, msg)
        // 先转发给渲染层，再做池内的收尾动作：挂起会触发 exit 事件，顺序颠倒会让
        // 渲染层在本轮尚未收口时收到进程退出。
        if (msg.type === 'system' && msg.subtype === 'init') {
          void this.reconcilePermissionMode(sessionId, proc, 'init').catch(err =>
            error('ProcessPool', `[${sessionId.slice(0, 8)}] Permission mode reconcile after init failed`, { error: String(err) }),
          )
        } else if (msg.type === 'result') {
          // 本轮结束 = 安全点：把轮次进行中欠下的两件事补上（spawn 参数、权限模式重启）。
          if (this.isSpawnArgsStale(proc) && proc.canSafelySuspend()) {
            info('ProcessPool', `[${sessionId.slice(0, 8)}] Turn ended with stale spawn-only args | suspending so the next send respawns with them`)
            this.suspendSession(sessionId)
          }
          if (this.isModeHazard(proc)) {
            void this.reconcilePermissionMode(sessionId, proc, 'init').catch(err =>
              error('ProcessPool', `[${sessionId.slice(0, 8)}] Permission mode reconcile after turn failed`, { error: String(err) }),
            )
          }
        }
      },
      log: (data: string) => this.routeEvent(sessionId, 'log', data),
      exit: (data: { code: number | null; signal?: string | null; stderr?: string }) => this.routeEvent(sessionId, 'exit', data),
      error: (err: Error) => this.routeEvent(sessionId, 'error', { message: err.message }),
      permissionRequest: (data: any) => this.routeEvent(sessionId, 'permission_request', data),
      permissionRequestCancelled: (data: any) =>
        this.routeEvent(sessionId, 'permission_request_cancelled', data),
      elicitationRequest: (data: any) => this.routeEvent(sessionId, 'elicitation_request', data),
    }
    this.poolHandlers.set(sessionId, handlers as any)
    proc.on('message', handlers.message)
    proc.on('log', handlers.log)
    proc.on('exit', handlers.exit)
    proc.on('error', handlers.error)
    proc.on('permission_request', handlers.permissionRequest)
    proc.on('permission_request_cancelled', handlers.permissionRequestCancelled)
    proc.on('elicitation_request', handlers.elicitationRequest)
    debug('ProcessPool', `[${sessionId.slice(0, 8)}] Pool handlers attached`)
  }

  private detachPoolHandlers(sessionId: string, proc: SessionProcess): void {
    const handlers = this.poolHandlers.get(sessionId) as any
    if (!handlers) return
    proc.removeListener('message', handlers.message)
    proc.removeListener('log', handlers.log)
    proc.removeListener('exit', handlers.exit)
    proc.removeListener('error', handlers.error)
    if (handlers.permissionRequest) proc.removeListener('permission_request', handlers.permissionRequest)
    if (handlers.permissionRequestCancelled) {
      proc.removeListener('permission_request_cancelled', handlers.permissionRequestCancelled)
    }
    if (handlers.elicitationRequest) proc.removeListener('elicitation_request', handlers.elicitationRequest)
    this.poolHandlers.delete(sessionId)
    debug('ProcessPool', `[${sessionId.slice(0, 8)}] Pool handlers detached`)
  }

  private routeEvent(sessionId: string, eventType: string, data: any) {
    const shortSid = sessionId.slice(0, 8)
    const windowAvailable = this.mainWindow && !this.mainWindow.isDestroyed()

    // 路由日志只留低频边界事件。逐消息/逐 delta 的类型（user、assistant、tool_use、
    // tool_result、stream_event、log…）不再逐条输出：sdkMessage / processRaw 已逐条落盘，
    // 路由失败（窗口不可用 / 类型不在 channel 表）也各有 warn 兜底 —— 而 debug() 的
    // console 镜像不受 --debug 门控，逐条输出会把终端刷满重复行。
    if (eventType === 'stream_event') {
      const ev = data?.event || data
      if (ev.type === 'message_stop') {
        info('ProcessPool', `[${shortSid}] route → renderer | type=stream_event | subType=message_stop`)
      }
    } else if (eventType === 'exit') {
      info('ProcessPool', `[${shortSid}] route → renderer | type=${eventType} | code=${data?.code}${data?.stderr ? ` | stderr=${String(data.stderr).slice(0, 100)}` : ''}`)
    } else if (eventType === 'error') {
      error('ProcessPool', `[${shortSid}] route → renderer | type=${eventType}`, data)
    } else if (eventType === 'result') {
      debug('ProcessPool', `[${shortSid}] route → renderer | type=result`)
    }

    if (windowAvailable) {
      const channel = CLAUDE_CODE_EVENT_BY_SUFFIX[eventType]
      if (!channel) {
        warn('ProcessPool', `[${shortSid}] Event type not in channel table, dropped: ${eventType}`)
      } else {
        this.mainWindow!.webContents.send(channel, { sessionId, data })
      }
    } else {
      warn('ProcessPool', `[${shortSid}] Cannot route event to renderer | windowAvailable=${windowAvailable} | type=${eventType}`)
    }

    // 通知 H5 事件监听器
    for (const listener of this.routeEventListeners) {
      try {
        listener(sessionId, eventType, data)
      } catch (e) {
        // ignore listener errors
      }
    }
  }
}
