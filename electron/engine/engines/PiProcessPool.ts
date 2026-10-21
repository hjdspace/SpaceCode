import { BrowserWindow } from 'electron'
import { PiSessionProcess } from './PiSessionProcess'
import { findPiSessionFile, rememberPiSessionFile } from './piSessionRegistry'
import { resolvePlanModeExtensionPath } from './piPlanModeExtension'
import type { EngineSessionConfig, EngineSessionStatus, ExtensionDialogAnswer, ImageAttachment, PermissionMode } from './types'
import type { ProcessStatus } from '../../session/sessionProcess'
import { mapPiEvent } from './PiEventMapper'
import { info, warn, error, debug } from '../../infra/logger'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import { eventChannelsBySuffix } from '@/shared/channelMap'
import { engineBlockedError, type EngineBlockedPayload } from '@/shared/engineErrors'

// 引擎事件按类型动态派发：后缀 → 完整 channel 名，与 renderer 端订阅共享同一真相源
const CLAUDE_CODE_EVENT_BY_SUFFIX = eventChannelsBySuffix(claudeCodeNamespace.events, 'claude-code:')

export const MAX_PROCESSES = 20

/** 刚 spawn 的探测可以等多久：pi 装载扩展与模型表就要十几秒，问早了只会白问 */
const SESSION_FILE_PROBE_TIMEOUT_MS = 30_000

export class PiProcessPool {
  private processes: Map<string, PiSessionProcess> = new Map()
  private mainWindow: BrowserWindow | null = null
  private routeEventListeners: Array<(sessionId: string, eventType: string, data: any) => void> = []

  /**
   * 为装上 plan 扩展而重启过哪条会话：扩展在子进程里装不起来时，每条消息都换一个进程
   * 会把会话打成筛子，所以一条会话只补一次 (#45)。
   */
  private planModeRespawnTried = new Set<string>()

  private poolHandlers: Map<string, {
    message: (msg: any) => void
    exit: (code: number | null, signal?: NodeJS.Signals | null, stderrTail?: string) => void
    error: (err: Error) => void
    extensionDialogClosed: (data: any) => void
  }> = new Map()

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /** 注册事件路由监听器，供 H5 Server 订阅引擎事件 */
  onRouteEvent(listener: (sessionId: string, eventType: string, data: any) => void): () => void {
    this.routeEventListeners.push(listener)
    return () => {
      const idx = this.routeEventListeners.indexOf(listener)
      if (idx >= 0) this.routeEventListeners.splice(idx, 1)
    }
  }

  getActiveCount(): number {
    return Array.from(this.processes.values()).filter(p => p.isRunning()).length
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    const proc = this.processes.get(sessionId)
    return proc ? this.toStatus(proc) : null
  }

  getActiveSessions(): EngineSessionStatus[] {
    return Array.from(this.processes.values()).map(proc => this.toStatus(proc))
  }

  /**
   * plan 之外的三档 Pi 都没有闸可关，所以 verified 只能报 null：说 true 是谎报
   * 「default 也逐次确认」，说 false 会让渲染层无限重发同一个模式 (#45)。
   */
  private toStatus(proc: PiSessionProcess): EngineSessionStatus {
    const intent = proc.config.permissionMode
    return {
      sessionId: proc.sessionId,
      engineSessionId: null,
      status: proc.status,
      isRunning: proc.isRunning(),
      engineVersion: proc.engineVersion,
      engineVersionCompatible: proc.engineVersionCompatible,
      permissionMode: intent,
      permissionModeVerified: intent === 'plan' ? proc.planModeActive : null,
      // agent 的「生效」只由命令行有没有带上那段人设说话：pi 不会回执「我按这个 agent 在跑」，
      // 而没带上就一定没生效 —— 界面对 false 不得声称已按所选 agent 运行 (#46)。
      agentApplied: proc.agentApplied,
      // 选了 agent 才谈得上扩展没装上；其余会话报 undefined，不替不存在的需求说话。
      agentExtensionLoaded: proc.config.agent ? proc.subagentsExtensionLoaded : undefined,
    }
  }

  getProcess(sessionId: string): PiSessionProcess | undefined {
    return this.processes.get(sessionId)
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    info('PiProcessPool', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd}`)

    // 死条目被驱逐重建时，旧实例问到的会话文件比磁盘记录更新鲜
    let carryOver: string | null = null

    if (this.processes.has(sessionId)) {
      const existing = this.processes.get(sessionId)!
      if (existing.isRunning()) {
        info('PiProcessPool', `[${sessionId.slice(0, 8)}] Session already running, reusing`)
        return
      }
      if (existing.status === 'suspended') {
        info('PiProcessPool', `[${sessionId.slice(0, 8)}] Session is suspended, resuming`)
        await this.resumeSession(sessionId)
        return
      }
      // Dead/exited session entry — drop it so a fresh process can be spawned.
      info('PiProcessPool', `[${sessionId.slice(0, 8)}] Evicting stale session entry | status=${existing.status}`)
      carryOver = existing.getPiSessionFile()
      this.detachPoolHandlers(sessionId, existing)
      this.processes.delete(sessionId)
    }

    this.evictIfNeeded()

    const resumeFile = carryOver ?? findPiSessionFile(sessionId, config.cwd)
    if (resumeFile) info('PiProcessPool', `[${sessionId.slice(0, 8)}] Resuming Pi history | ${resumeFile}`)

    const proc = new PiSessionProcess(sessionId, config, resumeFile ?? undefined)
    this.processes.set(sessionId, proc)
    this.planModeRespawnTried.delete(sessionId)

    this.attachPoolHandlers(sessionId, proc)

    try {
      await proc.start()
      info('PiProcessPool', `[${sessionId.slice(0, 8)}] Session started | totalActive=${this.getActiveCount()}`)
      await this.reconcilePlanMode(sessionId, proc, 'start')
      void this.recordSessionFile(sessionId, proc)
    } catch (err) {
      error('PiProcessPool', `[${sessionId.slice(0, 8)}] Failed to start session`, err)
      this.detachPoolHandlers(sessionId, proc)
      this.processes.delete(sessionId)
      throw err
    }
  }

  /**
   * 问一次 pi 它自己的会话文件并记到磁盘。没有这份映射，下次重建进程时
   * `--session` 就无从拼起，历史会话打开后发一条消息等于重开一个空白会话。
   *
   * 已经知道文件（构造时注入的、或挂起前问到的）也要落盘：那份认知此前只活在
   * 这个实例的内存里，不写出去就还是会在下一次重启时丢掉。
   */
  private async recordSessionFile(sessionId: string, proc: PiSessionProcess): Promise<void> {
    if (!proc.getPiSessionFile()) {
      await proc.captureSessionFile(SESSION_FILE_PROBE_TIMEOUT_MS)
    }
    const sessionFile = proc.getPiSessionFile()
    if (sessionFile) {
      // 普通会话保持原来的调用形态；只有侧边任务需要额外的 ephemeral 标记。
      if (proc.config.sideTaskSourceSessionId) {
        rememberPiSessionFile(sessionId, sessionFile, proc.config.cwd, { ephemeral: true })
      } else {
        rememberPiSessionFile(sessionId, sessionFile, proc.config.cwd)
      }
    }
  }

  async sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      error('PiProcessPool', `[${sessionId.slice(0, 8)}] sendMessage failed: no active process`)
      throw engineBlockedError(sessionId, {
        reason: 'session-not-active',
        detail: `Session ${sessionId} has no active process`,
        context: { engine: 'pi', operation: 'sendMessage' },
      })
    }

    await this.guardPermissionMode(sessionId, proc)

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Forwarding user message | contentLen=${content.length} | images=${images?.length || 0}`)
    await proc.sendMessage(content, images)
    // 起进程那趟探测可能赶在 pi 装载完之前就超时了；prompt 被 ack 说明引擎已经
    // 活过来，这会儿补问一次必定有答。
    void this.recordSessionFile(sessionId, proc)
  }

  async abortSession(sessionId: string): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc) return

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Aborting session`)
    await proc.abort()
  }

  /**
   * 把用户的应答送回那条会话。会话不在了也照样抛出去：界面正靠这次调用的成败
   * 决定卡片是收起还是退回可重试态，抹平成成功等于谎报「已经答上了」 (#54)。
   */
  respondExtensionDialog(sessionId: string, dialogId: string, answer: ExtensionDialogAnswer): void {
    const proc = this.processes.get(sessionId)
    if (!proc) {
      throw new Error(`No pi session process for ${sessionId.slice(0, 8)}; extension dialog ${dialogId.slice(0, 8)} has nowhere to go`)
    }
    proc.respondExtensionDialog(dialogId, answer)
  }

  suspendSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Suspending session | canSafelySuspend=${proc.canSafelySuspend()}`)
    proc.suspend()
    this.routeEvent(sessionId, 'suspended', { reason: 'user_request' })
  }

  async resumeSession(sessionId: string): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc) throw new Error(`Session ${sessionId} not found`)
    if (proc.status !== 'suspended') throw new Error(`Session ${sessionId} is not suspended`)

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Resuming session`)

    this.evictIfNeeded()

    this.detachPoolHandlers(sessionId, proc)
    this.attachPoolHandlers(sessionId, proc)

    try {
      await proc.resume()
      info('PiProcessPool', `[${sessionId.slice(0, 8)}] Session resumed successfully`)
      // 恢复起来的进程带不带扩展、扩展恢复出来的又是什么模式，都要重新对一次账：
      // 挂起前收到的那次回执不能替这一次说话。
      await this.reconcilePlanMode(sessionId, proc, 'resume')
      // 挂起那趟 get_state 没答上的话，这条会话此刻其实没带 --session —— 补记一次，
      // 别让下一次重建同样接不上历史。
      void this.recordSessionFile(sessionId, proc)
    } catch (err) {
      error('PiProcessPool', `[${sessionId.slice(0, 8)}] Failed to resume session`, err)
      throw err
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // plan 模式（权限闸扩展）。扩展的来路与口径见 piPlanModeExtension (issue #45)。
  // ──────────────────────────────────────────────────────────────────────

  /**
   * 切换会话的权限模式。
   *
   * default / acceptEdits / bypassPermissions 在 Pi 侧没有对应物（引擎本来就不问），
   * 所以这里只对 plan 负责：进去要拿到扩展回执才算成功，拿不到就抛 —— 渲染层据此把
   * 选择器退回点击前的状态，界面不会停在一个从没生效的模式上。退出尽力而为：退不动
   * 只是让引擎比界面更保守，不构成风险。
   */
  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc) throw new Error(`Session ${sessionId} not found`)

    if (mode !== 'plan') {
      proc.config.permissionMode = mode
      if (proc.planModeExtensionLoaded && proc.isRunning()) {
        try {
          await proc.setPlanMode(false)
        } catch (err) {
          warn('PiProcessPool', `[${sessionId.slice(0, 8)}] Failed to leave plan mode`, { error: String(err) })
        }
      }
      return
    }

    const previous = proc.config.permissionMode
    // 先落意图：没带扩展的那次重启要按它重拼 spawn 参数
    proc.config.permissionMode = mode
    if (!(await this.reconcilePlanMode(sessionId, proc, 'switch'))) {
      proc.config.permissionMode = previous
      throw engineBlockedError(sessionId, {
        reason: 'plan-mode-not-enforced',
        detail: `Pi did not confirm plan mode (extension loaded=${proc.planModeExtensionLoaded}, engine=${proc.planModeActive ?? '(no receipt)'})`,
        context: {
          engine: 'pi',
          intent: 'plan',
          extensionLoaded: proc.planModeExtensionLoaded,
          reported: proc.planModeActive === null ? 'no-receipt' : 'not-in-plan',
        },
      })
    }
  }

  /**
   * 让进程真的跑在 plan 上。三条偏差都收在这里，start / resume / switch / send 四条路
   * 不再各自排一遍重试：
   *  - 进程没带扩展（起的时候意图不是 plan）：换一次进程，历史靠 --session 接上；
   *  - 带了扩展但不在 plan（新会话，或上次没进去）：发 `/plan start`，等回执；
   *  - 回执始终等不到（扩展加载失败 / 引擎正跑着不让切）：返回 false，调用方 fail closed。
   *
   * @returns 意图不是 plan 时恒为 true（没有要对账的东西）。
   */
  private async reconcilePlanMode(
    sessionId: string,
    proc: PiSessionProcess,
    context: 'start' | 'resume' | 'switch' | 'send',
  ): Promise<boolean> {
    const shortSid = sessionId.slice(0, 8)
    if (proc.config.permissionMode !== 'plan') return true
    if (!proc.isRunning()) return false

    if (!proc.planModeExtensionLoaded) {
      if (resolvePlanModeExtensionPath() === null) {
        warn('PiProcessPool', `[${shortSid}] Plan mode extension not loadable | context=${context}`)
        return false
      }
      if (this.planModeRespawnTried.has(sessionId)) {
        warn('PiProcessPool', `[${shortSid}] Extension still missing after a respawn, not retrying | context=${context}`)
        return false
      }
      // 轮次跑到一半不换进程：那等于把用户正在等的答案掐了。等下一轮再对账。
      if (!proc.canSafelySuspend()) {
        warn('PiProcessPool', `[${shortSid}] Won't swap process mid-turn to load the extension | pendingTools=${proc.getPendingToolCount()} | context=${context}`)
        return false
      }
      this.planModeRespawnTried.add(sessionId)
      await this.respawnWithPlanModeExtension(sessionId, proc)
      if (!proc.planModeExtensionLoaded) return false
    }

    if (proc.planModeActive === true) return true

    try {
      const applied = await proc.setPlanMode(true)
      if (!applied) warn('PiProcessPool', `[${shortSid}] Plan mode not confirmed by the extension | context=${context}`)
      return applied
    } catch (err) {
      warn('PiProcessPool', `[${shortSid}] Failed to switch plan mode | context=${context}`, { error: String(err) })
      return false
    }
  }

  /**
   * 扩展只在 spawn 时装得进来，运行中加不了 —— 想追上意图就得换一个进程。
   * 问到过 pi 的会话文件就走挂起→恢复（历史接得上），否则直接重起。
   */
  private async respawnWithPlanModeExtension(sessionId: string, proc: PiSessionProcess): Promise<void> {
    const sessionFile = proc.getPiSessionFile()
    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Swapping process to load the plan mode extension | sessionFile=${sessionFile ?? '(none)'}`)
    if (sessionFile) {
      await proc.suspend()
      await proc.resume()
      return
    }
    await proc.kill()
    await proc.start()
  }

  /**
   * 意图是 plan 而引擎没有闸：这条消息一旦转发，工具就直接改文件，而用户以为在计划模式。
   * 先救一次，救不回来就拦下并说明原因 —— 宁可不发 (#45)。
   */
  private async guardPermissionMode(sessionId: string, proc: PiSessionProcess): Promise<void> {
    if (proc.config.permissionMode !== 'plan') return
    // 已经在 plan 时 reconcile 直接返回 true，不会多发一帧命令
    if (await this.reconcilePlanMode(sessionId, proc, 'send')) return

    const payload: EngineBlockedPayload = {
      reason: 'plan-mode-not-enforced',
      detail: `plan mode is not enforced (extension loaded=${proc.planModeExtensionLoaded}, engine=${proc.planModeActive === null ? 'no receipt' : 'not in plan'})`,
      context: {
        engine: 'pi',
        intent: 'plan',
        extensionLoaded: proc.planModeExtensionLoaded,
        reported: proc.planModeActive === null ? 'no-receipt' : 'not-in-plan',
      },
    }
    error('PiProcessPool', `[${sessionId.slice(0, 8)}] Blocked message send: ${payload.detail}`)
    this.routeEvent(sessionId, 'error', payload)
    throw engineBlockedError(sessionId, payload)
  }

  killSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Killing session`)
    // 对话框账要在摘处理器之前结：摘了之后 emit 的 extension_dialog_closed 没人接，
    // 界面会留一张谁也答不了的卡，而它对应的进程早没了 (#54)。
    proc.cancelPendingExtensionDialogs('process_exit')
    this.detachPoolHandlers(sessionId, proc)
    proc.kill()
    this.processes.delete(sessionId)
  }

  killAll(): void {
    this.processes.forEach((proc, sessionId) => {
      proc.cancelPendingExtensionDialogs('process_exit')
      this.detachPoolHandlers(sessionId, proc)
      proc.kill()
    })
    this.processes.clear()
    this.poolHandlers.clear()
  }

  private evictIfNeeded(): void {
    const runningCount = this.getActiveCount()
    if (runningCount < MAX_PROCESSES) return

    info('PiProcessPool', `Eviction needed | running=${runningCount} | max=${MAX_PROCESSES}`)

    const safeIdleCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'idle' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeIdleCandidates.length > 0) {
      const victim = safeIdleCandidates[0]
      info('PiProcessPool', `[${victim.sessionId.slice(0, 8)}] Evicting idle session`)
      victim.suspend()
      this.routeEvent(victim.sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    const safeActiveCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'active' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeActiveCandidates.length > 0) {
      const victim = safeActiveCandidates[0]
      info('PiProcessPool', `[${victim.sessionId.slice(0, 8)}] Evicting active session`)
      victim.suspend()
      this.routeEvent(victim.sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    warn('PiProcessPool', `Cannot evict: sessions have pending operations`)
  }

  private attachPoolHandlers(sessionId: string, proc: PiSessionProcess): void {
    const handlers = {
      message: (msg: any) => this.routeEvent(sessionId, msg.type, msg),
      exit: (code: number | null, signal?: NodeJS.Signals | null, stderrTail?: string) => {
        this.routeEvent(sessionId, 'exit', { code, signal, stderr: stderrTail })
      },
      error: (err: Error) => this.routeEvent(sessionId, 'error', { message: err.message }),
      // 对话框退场是宿主自己记账的结果（超时、看门狗、abort、进程没了），不是 pi 的帧，
      // 所以它不走 message 那条路，得单独接 (#54)。
      extensionDialogClosed: (data: any) => this.routeEvent(sessionId, 'extension_dialog_closed', data),
    }

    this.poolHandlers.set(sessionId, handlers)
    proc.on('message', handlers.message)
    proc.on('exit', handlers.exit)
    proc.on('error', handlers.error)
    proc.on('extension_dialog_closed', handlers.extensionDialogClosed)

    debug('PiProcessPool', `[${sessionId.slice(0, 8)}] Pool handlers attached`)
  }

  private detachPoolHandlers(sessionId: string, proc: PiSessionProcess): void {
    const handlers = this.poolHandlers.get(sessionId)
    if (!handlers) return

    proc.removeListener('message', handlers.message)
    proc.removeListener('exit', handlers.exit)
    proc.removeListener('error', handlers.error)
    proc.removeListener('extension_dialog_closed', handlers.extensionDialogClosed)
    this.poolHandlers.delete(sessionId)

    debug('PiProcessPool', `[${sessionId.slice(0, 8)}] Pool handlers detached`)
  }

  private routeEvent(sessionId: string, eventType: string, data: any): void {
    const shortSid = sessionId.slice(0, 8)
    const windowAvailable = this.mainWindow && !this.mainWindow.isDestroyed()

    const unifiedEvent = mapPiEvent(sessionId, { type: eventType, ...data })

    if (!unifiedEvent) {
      info('PiProcessPool', `[${shortSid}] route → DROPPED | rawType=${eventType} | hasAssistantMsgEvent=${!!data?.assistantMessageEvent} | msgRole=${data?.message?.role || '(none)'}`)
      return
    }

    if (windowAvailable) {
      const channel = CLAUDE_CODE_EVENT_BY_SUFFIX[unifiedEvent.type]
      if (!channel) {
        warn('PiProcessPool', `[${shortSid}] Event type not in channel table, dropped: ${unifiedEvent.type}`)
      } else {
        this.mainWindow!.webContents.send(channel, { sessionId, data: unifiedEvent.data })
      }
    } else {
      warn('PiProcessPool', `[${shortSid}] Cannot route event to renderer | windowAvailable=${windowAvailable} | type=${unifiedEvent.type}`)
    }

    for (const listener of this.routeEventListeners) {
      try {
        listener(sessionId, unifiedEvent.type, unifiedEvent.data)
      } catch {
        // ignore listener errors
      }
    }
    // 逐事件高频日志降为 debug：正常模式不写文件，--debug 下仍可排查
    debug('PiProcessPool', `[${shortSid}] route → renderer | type=${unifiedEvent.type}`)
  }
}
