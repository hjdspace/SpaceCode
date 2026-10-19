import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, EngineAvailability, AgentInfo, ImageAttachment, PermissionMode, ThinkingUpdateTiming, EffortLevel } from './types'
import { toPiThinkingLevel } from '@/shared/effort'
import { PiProcessPool } from './PiProcessPool'
import { detectPiCli } from './piCliResolver'
import { info, warn, error } from '../../infra/logger'

export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'

  private pool: PiProcessPool
  private _mainWindow: BrowserWindow | null = null

  constructor() {
    this.pool = new PiProcessPool()
  }

  setMainWindow(window: BrowserWindow): void {
    this._mainWindow = window
    this.pool.setMainWindow(window)
    info('PiEngine', 'Main window set')
  }

  /** 注册事件路由监听器，供 H5 Server 订阅引擎事件 */
  onRouteEvent(listener: (sessionId: string, eventType: string, data: any) => void): () => void {
    return this.pool.onRouteEvent(listener)
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    info('PiEngine', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)

    const existingStatus = this.pool.getSessionStatus(sessionId)
    if (existingStatus?.isRunning) {
      info('PiEngine', `[${sessionId.slice(0, 8)}] Session already active, reusing`)
      return
    }

    try {
      await this.pool.startSession(sessionId, config)
      const status = this.pool.getSessionStatus(sessionId)
      info('PiEngine', `[${sessionId.slice(0, 8)}] Session started | status=${status?.status}`)
    } catch (err) {
      error('PiEngine', `[${sessionId.slice(0, 8)}] Failed to start session`, err)
      throw err
    }
  }

  async sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    info('PiEngine', `sendMessage | sessionId=${sessionId.slice(0, 8)} | contentLen=${content.length} | images=${images?.length || 0}`)

    try {
      await this.pool.sendMessage(sessionId, content, images)
    } catch (err) {
      error('PiEngine', `sendMessage failed | sessionId=${sessionId.slice(0, 8)}`, err)
      throw err
    }
  }

  /**
   * pi 把「开不开思考」和「思考多深」合成同一个 level 参数，所以两个入口都按合成结果下发，
   * 否则会互相覆盖 —— 之前这里写死 medium，用户选的档位整条链路根本没进 pi。
   */
  private piThinkingLevel(enabled: boolean, effort?: EffortLevel): string {
    return toPiThinkingLevel(enabled, effort ?? 'medium')
  }

  async updateThinkingLevel(sessionId: string, enabled: boolean): Promise<ThinkingUpdateTiming> {
    const proc = this.pool.getProcess(sessionId)
    if (!proc) {
      // 会话还没起进程：没有正在跑的轮次会被旧参数卡住，下一条消息起来就带新配置。
      warn('PiEngine', `updateThinkingLevel: session not found | sessionId=${sessionId.slice(0, 8)}`)
      return 'now'
    }

    info('PiEngine', `updateThinkingLevel | sessionId=${sessionId.slice(0, 8)} | enabled=${enabled}`)

    // 先落 config 再下发：进程池之后 suspend/resume 是按 config 重拼 spawn 参数的，
    // 只发 stdin 命令不写 config 的话，一次重启就把设置退回去了。
    proc.config.thinkingEnabled = enabled
    try {
      await proc.setThinkingLevel(this.piThinkingLevel(enabled, proc.config.effortLevel))
    } catch (err) {
      error('PiEngine', `updateThinkingLevel failed | sessionId=${sessionId.slice(0, 8)}`, err)
      throw err
    }
    return 'now'
  }

  async updateEffortLevel(sessionId: string, level: EffortLevel): Promise<ThinkingUpdateTiming> {
    const proc = this.pool.getProcess(sessionId)
    if (!proc) {
      warn('PiEngine', `updateEffortLevel: session not found | sessionId=${sessionId.slice(0, 8)}`)
      return 'now'
    }

    info('PiEngine', `updateEffortLevel | sessionId=${sessionId.slice(0, 8)} | level=${level}`)

    proc.config.effortLevel = level
    try {
      await proc.setThinkingLevel(this.piThinkingLevel(proc.config.thinkingEnabled === true, level))
    } catch (err) {
      error('PiEngine', `updateEffortLevel failed | sessionId=${sessionId.slice(0, 8)}`, err)
      throw err
    }
    return 'now'
  }

  /**
   * 切换权限模式。四档里只有 plan 做得到，靠的是起进程时装进来的扩展（口径见
   * piPlanModeExtension）；进不去时进程池抛错 —— 界面据此把选择器退回点击前的状态 (#45)。
   */
  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    info('PiEngine', `setPermissionMode | sessionId=${sessionId.slice(0, 8)} | mode=${mode}`)
    await this.pool.setPermissionMode(sessionId, mode)
  }

  async abort(sessionId: string): Promise<void> {
    info('PiEngine', `abort | sessionId=${sessionId.slice(0, 8)}`)
    await this.pool.abortSession(sessionId)
  }

  async stop(sessionId: string): Promise<void> {
    info('PiEngine', `stop | sessionId=${sessionId.slice(0, 8)}`)
    this.pool.killSession(sessionId)
  }

  suspendSession(sessionId: string): void {
    info('PiEngine', `suspendSession | sessionId=${sessionId.slice(0, 8)}`)
    this.pool.suspendSession(sessionId)
  }

  async resumeSession(sessionId: string): Promise<void> {
    info('PiEngine', `resumeSession | sessionId=${sessionId.slice(0, 8)}`)
    await this.pool.resumeSession(sessionId)
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    return this.pool.getSessionStatus(sessionId)
  }

  getActiveSessions(): EngineSessionStatus[] {
    return this.pool.getActiveSessions()
  }

  async listAgents(cwd?: string): Promise<AgentInfo[]> {
    return [
      {
        agentType: 'general-purpose',
        description: 'Pi coding agent - full-featured coding assistant with compaction, extensions, and multi-provider support',
        source: 'built-in',
      },
    ]
  }

  /**
   * 界面据此决定 Pi 选项是可选、置灰、还是提示版本过低。版本无从核验时算不可用 ——
   * 声称能力可用之前，得先知道真正要跑的是哪个引擎。
   *
   * 候选序列与版本判定都收在 piCliResolver，和 PiSessionProcess 实际 spawn 的读的是同一个
   * 结果 —— 以前这里另算一套候选（既不看 asar unpack，也不看版本），于是可用性说「有 pi」，
   * 子进程起的却是用户全局装的另一个引擎 (#52)。
   */
  static getAvailability(): EngineAvailability {
    const cli = detectPiCli()
    // 打包版找不到 bundled pi 是产物坏了，装全局 pi 修不了它
    return {
      available: cli.available,
      reason: cli.reason,
      version: cli.version,
      installable: !app.isPackaged && cli.reason === 'not-found',
    }
  }
}
