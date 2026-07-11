/**
 * DingtalkAdapter — Main DingTalk adapter
 *
 * Architecture:
 * - DingtalkBot: HTTP client for DingTalk API
 * - DingtalkStreamState: AI card streaming (PUT /card/streaming)
 * - DingtalkPermissionCard: AI card template permission
 * - DingtalkMediaHandler: File download only (no upload)
 * - sessionWebhook management with 72h expiry detection
 *
 * DingTalk uses dingtalk-stream DWClient for receiving events
 * (simulated here — events come via handleEvent).
 *
 * Golden path:
 * 1. User sends /pair → pairing code validation → user is paired
 * 2. User sends text → ChatQueue → SessionRecovery → WsBridge.sendUserMessage
 * 3. Engine streams → WsBridge → StreamState.append → AI card update
 * 4. Permission request → PermissionCard.send → callback
 * 5. sessionWebhook expiry → notify user to send a new message
 */

import type { DingtalkBot, DingtalkMessage } from './dingtalkBot'
import { DingtalkStreamState } from './streamState'
import { DingtalkPermissionCard } from './permissionCard'
import { DingtalkMediaHandler } from './mediaHandler'
import { parseCommand, isKnownCommand } from './commands'

import { WsBridge } from '../common/ws-bridge'
import { ChatQueue } from '../common/chat-queue'
import { SessionStore } from '../common/session-store'
import { SessionRecovery } from '../common/session-recovery'
import { MessageDedup } from '../common/message-dedup'
import { Pairing } from '../common/pairing'
import { HttpClient } from '../common/http-client'
import {
  loadConfig,
  saveConfig,
  resolveUserDefaultWorkDir,
} from '../common/config'
import type { AdapterConfig } from '../common/config'
import {
  formatImHelp,
  formatImStatus,
  formatToolUse,
  splitMessage,
} from '../common/format'
import { parsePermissionCommand } from '../common/permission'
import type { ServerMessage, SessionBinding } from '../common/types'
import { createLogger } from '../common/logger'

const log = createLogger('DingtalkAdapter')

const DINGTALK_MSG_MAX_LEN = 20000
const DEFAULT_AI_CARD_TEMPLATE_ID = '02fcf2f4-2e3a-4de0-9b41-1c4de6a8b53e'

export interface DingtalkAdapterOptions {
  bot: DingtalkBot
  config?: AdapterConfig
  serverUrl?: string
  authToken?: string
  attachmentDir?: string
  sessionStorePath?: string
}

export class DingtalkAdapter {
  private bot: DingtalkBot
  private bridge: WsBridge
  private chatQueue: ChatQueue
  private sessionStore: SessionStore
  private sessionRecovery: SessionRecovery
  private messageDedup: MessageDedup
  private pairing: Pairing
  private httpClient: HttpClient
  private permissionCard: DingtalkPermissionCard
  private mediaHandler: DingtalkMediaHandler
  private config: AdapterConfig
  private streamStates: Map<string, DingtalkStreamState> = new Map()
  private sessionWebhooks: Map<string, { webhook: string; expiresAt: number }> = new Map()
  private running: boolean = false

  constructor(opts: DingtalkAdapterOptions) {
    this.bot = opts.bot
    this.config = opts.config ?? loadConfig()

    const serverUrl = opts.serverUrl ?? this.config.serverUrl
    const authToken = opts.authToken

    this.bridge = new WsBridge({ serverUrl, authToken })
    this.bridge.startHeartbeat()

    this.chatQueue = new ChatQueue()
    this.sessionStore = new SessionStore({ filePath: opts.sessionStorePath })
    this.httpClient = new HttpClient({
      baseUrl: serverUrl.replace(/^ws/, 'http'),
      allowedProjectRoots: [this.config.defaultProjectDir],
    })

    this.sessionRecovery = new SessionRecovery({
      store: this.createRecoveryStore(),
      bridge: this.createRecoveryBridge(),
      httpClient: this.httpClient,
    })

    this.messageDedup = new MessageDedup({ ttlMs: 10 * 60 * 1000, maxEntries: 5000 })
    this.messageDedup.startSweep()

    this.pairing = new Pairing()

    const templateId = this.config.dingtalk.permissionCardTemplateId || DEFAULT_AI_CARD_TEMPLATE_ID
    this.permissionCard = new DingtalkPermissionCard(this.bot, templateId)
    this.mediaHandler = new DingtalkMediaHandler(this.bot, opts.attachmentDir ?? resolveUserDefaultWorkDir())
  }

  // ────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return

    try {
      const token = await this.bot.getAccessToken()
      if (!token) throw new Error('Empty access token')
      log.info('start', 'Bot started with valid access token')
    } catch (err) {
      throw new Error(`Failed to validate DingTalk credentials: ${String(err)}`)
    }

    this.running = true
  }

  async stop(): Promise<void> {
    this.running = false
    this.messageDedup.stopSweep()
    this.bridge.destroy()
    log.info('stop', 'Adapter stopped')
  }

  // ────────────────────────────────────────────────────────────────────────
  // Event handling
  // ────────────────────────────────────────────────────────────────────────

  /** Handle an incoming DingTalk message event. */
  async handleEvent(msg: DingtalkMessage): Promise<void> {
    const chatId = msg.senderId
    const msgId = msg.msgId

    // Dedup by msgId
    if (!this.messageDedup.tryRecord(msgId)) return

    // Store sessionWebhook for replies (72h expiry)
    this.sessionWebhooks.set(chatId, {
      webhook: msg.sessionWebhook,
      expiresAt: msg.sessionWebhookExpiredTime * 1000,
    })

    // Enqueue for serial processing
    await this.chatQueue.enqueue(chatId, async () => {
      await this.handleMessage(chatId, msg)
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Message handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleMessage(chatId: string, msg: DingtalkMessage): Promise<void> {
    const userId = msg.senderId
    const displayName = msg.senderNick
    const text = msg.text?.content?.trim() ?? ''

    // Check if text is a command
    const command = parseCommand(text)
    if (command && isKnownCommand(command.command)) {
      await this.handleCommand(chatId, command.command, command.args, userId, displayName)
      return
    }

    // Check pairing
    if (!this.isUserPaired(userId)) {
      await this.handlePairing(chatId, text, userId, displayName)
      return
    }

    // User is paired — handle as chat message
    await this.handleUserMessage(chatId, text, userId, displayName)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Command handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleCommand(
    chatId: string,
    command: string,
    args: string,
    userId: string,
    displayName: string
  ): Promise<void> {
    const webhook = this.getWebhook(chatId)
    if (!webhook) {
      log.warn('handleCommand', `No sessionWebhook for ${chatId}`)
      return
    }

    switch (command) {
      case 'help': {
        const chunks = splitMessage(formatImHelp(), DINGTALK_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(webhook, chunk)
        }
        break
      }

      case 'pair': {
        if (!args) {
          await this.bot.sendTextMessage(webhook, '用法: /pair <配对码>')
          return
        }
        await this.handlePairing(chatId, args, userId, displayName)
        break
      }

      case 'unpair': {
        this.pairing.removePairedUser(
          { pairing: this.config.pairing, pairedUsers: this.config.dingtalk.pairedUsers },
          userId
        )
        saveConfig(this.config)
        await this.bot.sendTextMessage(webhook, '已取消配对')
        break
      }

      case 'new': {
        await this.startNewSession(chatId, userId)
        break
      }

      case 'status': {
        await this.handleStatusCommand(chatId)
        break
      }

      case 'stop': {
        this.bridge.sendStopGeneration(chatId)
        await this.bot.sendTextMessage(webhook, '⏹️ 已请求停止生成')
        break
      }

      case 'clear': {
        this.sessionStore.delete(chatId)
        this.bridge.resetSession(chatId)
        this.permissionCard.clear(this.getWebhook(chatId) ?? '')
        this.clearStreamState(chatId)
        await this.bot.sendTextMessage(webhook, '🧹 已清空会话')
        break
      }

      case 'resume': {
        await this.bot.sendTextMessage(webhook, '📋 恢复会话功能: 使用 /new 创建新会话')
        break
      }

      case 'provider': {
        await this.bot.sendTextMessage(webhook, '🔧 Provider 切换功能需要桌面端配置')
        break
      }

      case 'model': {
        await this.bot.sendTextMessage(webhook, '🔧 模型切换功能需要桌面端配置')
        break
      }

      case 'skills': {
        await this.bot.sendTextMessage(webhook, '📋 技能列表功能需要桌面端配置')
        break
      }

      case 'cancel': {
        this.permissionCard.clear(this.getWebhook(chatId) ?? '')
        await this.bot.sendTextMessage(webhook, '✅ 已取消当前操作')
        break
      }

      case 'health': {
        await this.bot.sendTextMessage(webhook, '✅ 适配器运行正常')
        break
      }

      case 'projects': {
        await this.handleProjectsCommand(chatId, args)
        break
      }

      default: {
        await this.bot.sendTextMessage(webhook, `未知命令: /${command}\n使用 /help 查看可用命令`)
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pairing
  // ────────────────────────────────────────────────────────────────────────

  private async handlePairing(
    chatId: string,
    code: string,
    userId: string,
    displayName: string
  ): Promise<void> {
    const webhook = this.getWebhook(chatId)
    if (!webhook) return

    if (this.isUserPaired(userId)) {
      await this.bot.sendTextMessage(webhook, '✅ 您已配对，可以直接发送消息')
      return
    }

    const result = this.pairing.tryPair(code, userId, {
      pairing: this.config.pairing,
      pairedUsers: this.config.dingtalk.pairedUsers,
    })

    if (result.success) {
      this.pairing.addPairedUser(
        { pairing: this.config.pairing, pairedUsers: this.config.dingtalk.pairedUsers },
        userId,
        displayName
      )
      this.pairing.clearCode({ pairing: this.config.pairing, pairedUsers: this.config.dingtalk.pairedUsers })
      this.pairing.clearAttempts(userId)
      saveConfig(this.config)

      await this.bot.sendTextMessage(webhook, '✅ 配对成功！\n\n使用 /help 查看可用命令')
    } else {
      const messages: Record<string, string> = {
        expired: '❌ 配对码已过期，请重新生成',
        rate_limited: '❌ 尝试次数过多，请稍后再试',
        mismatch: '❌ 配对码不正确',
        no_code: '❌ 当前没有生效的配对码，请先在桌面端生成',
      }
      await this.bot.sendTextMessage(webhook, messages[result.reason ?? 'mismatch'])
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // User message handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleUserMessage(
    chatId: string,
    text: string,
    userId: string,
    displayName: string
  ): Promise<void> {
    const webhook = this.getWebhook(chatId)
    if (!webhook) return

    // Check for permission quick-reply
    if (this.permissionCard.getPendingCount(webhook) > 0) {
      const parsed = parsePermissionCommand(
        text,
        this.permissionCard.getPendingCount(webhook),
        this.permissionCard.getSinglePendingRequestId(webhook)
      )
      if (parsed) {
        const rule = parsed.action === 'always' ? 'always' : undefined
        this.bridge.sendPermissionResponse(
          chatId,
          parsed.requestId!,
          parsed.action !== 'deny',
          rule
        )
        await this.bot.sendTextMessage(webhook, `✅ 已${parsed.action === 'deny' ? '拒绝' : '允许'}`)
        return
      }
    }

    // Recover or create session
    const binding = await this.sessionRecovery.recover(chatId)
    if (!binding) {
      const workDir = this.config.dingtalk.defaultWorkDir || this.config.defaultProjectDir
      await this.createSession(chatId, workDir)
      return
    }

    // Send the message
    this.bridge.sendUserMessage(chatId, text)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Session management
  // ────────────────────────────────────────────────────────────────────────

  private async startNewSession(chatId: string, userId: string): Promise<void> {
    this.bridge.resetSession(chatId)
    this.clearStreamState(chatId)
    this.permissionCard.clear(this.getWebhook(chatId) ?? '')

    const workDir = this.config.dingtalk.defaultWorkDir || this.config.defaultProjectDir
    await this.createSession(chatId, workDir)
  }

  private async createSession(chatId: string, workDir: string): Promise<void> {
    const webhook = this.getWebhook(chatId)
    if (!webhook) return

    try {
      const { sessionId, token } = await this.httpClient.createSession(workDir)

      this.sessionStore.set(chatId, { sessionId, workDir })

      this.bridge = new WsBridge({
        serverUrl: this.config.serverUrl,
        authToken: token,
      })
      this.bridge.startHeartbeat()

      this.bridge.onServerMessage(chatId, (msg) => this.handleServerMessage(chatId, msg))
      await this.bridge.connectSession(chatId, sessionId, workDir)

      await this.bot.sendTextMessage(webhook, `✅ 新会话已创建\n📁 目录: ${workDir}\n🆔 ${sessionId.slice(0, 8)}...`)
    } catch (err) {
      log.error('createSession', `Failed to create session: ${String(err)}`)
      await this.bot.sendTextMessage(webhook, `❌ 创建会话失败: ${String(err)}`)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // ServerMessage handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleServerMessage(chatId: string, msg: ServerMessage): Promise<void> {
    const webhook = this.getWebhook(chatId)
    if (!webhook) return

    switch (msg.type) {
      case 'connected': {
        log.info('handleServerMessage', `WS connected for ${chatId}`)
        break
      }

      case 'status': {
        if (msg.state === 'idle') {
          const ss = this.streamStates.get(chatId)
          if (ss) {
            await ss.complete()
            this.streamStates.delete(chatId)
          }
        }
        break
      }

      case 'content_start': {
        if (msg.blockType === 'text') {
          this.clearStreamState(chatId)
          const templateId = this.config.dingtalk.permissionCardTemplateId || DEFAULT_AI_CARD_TEMPLATE_ID
          const ss = new DingtalkStreamState(this.bot, webhook, templateId)
          this.streamStates.set(chatId, ss)
        }
        break
      }

      case 'content_delta': {
        if (msg.text) {
          const ss = this.streamStates.get(chatId)
          if (ss) {
            ss.append(msg.text)
          } else {
            const templateId = this.config.dingtalk.permissionCardTemplateId || DEFAULT_AI_CARD_TEMPLATE_ID
            const newSs = new DingtalkStreamState(this.bot, webhook, templateId)
            newSs.append(msg.text)
            this.streamStates.set(chatId, newSs)
          }
        }
        break
      }

      case 'tool_use_complete': {
        const ss = this.streamStates.get(chatId)
        if (ss) {
          await ss.complete()
          this.streamStates.delete(chatId)
        }
        const toolText = formatToolUse(msg.toolName, msg.input)
        await this.bot.sendTextMessage(webhook, toolText)
        break
      }

      case 'tool_result': {
        if (msg.isError) {
          await this.bot.sendTextMessage(webhook, `❌ 工具错误: ${msg.content.slice(0, 500)}`)
        }
        break
      }

      case 'permission_request': {
        await this.permissionCard.send(
          webhook,
          msg.requestId,
          msg.toolName,
          msg.input,
          msg.description
        )
        break
      }

      case 'message_complete': {
        const ss = this.streamStates.get(chatId)
        if (ss) {
          // Check if webhook expired
          if (ss.isWebhookExpired()) {
            await this.bot.sendTextMessage(webhook, '⚠️ 会话通道已过期，请重新发一条消息以刷新通道')
          } else {
            await ss.complete()
          }
          this.streamStates.delete(chatId)
        }

        const usage = msg.usage
        await this.bot.sendTextMessage(webhook, `📊 Token: ↓${usage.inputTokens} ↑${usage.outputTokens}`)
        break
      }

      case 'error': {
        const errorText = `❌ 错误: ${msg.message}`
        const chunks = splitMessage(errorText, DINGTALK_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(webhook, chunk)
        }
        break
      }

      case 'api_retry': {
        await this.bot.sendTextMessage(webhook, `🔄 API 重试 (${msg.attempt}/${msg.maxRetries})`)
        break
      }

      default: {
        // Ignore unknown
      }
    }
  }

  /** Handle a card action callback. */
  async handleCardAction(webhookKey: string, actionValue: string): Promise<void> {
    // Find chatId by webhook
    let chatId: string | null = null
    for (const [cid, info] of this.sessionWebhooks) {
      if (info.webhook === webhookKey) {
        chatId = cid
        break
      }
    }

    const result = this.permissionCard.handleCallback(webhookKey, actionValue)

    if (result && chatId) {
      const rule = result.action === 'always' ? 'always' : undefined
      this.bridge.sendPermissionResponse(
        chatId,
        result.requestId,
        result.action !== 'deny',
        rule
      )
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Status & projects
  // ────────────────────────────────────────────────────────────────────────

  private async handleStatusCommand(chatId: string): Promise<void> {
    const webhook = this.getWebhook(chatId)
    if (!webhook) return

    const binding = this.sessionStore.get(chatId)
    const sessionId = this.bridge.getSessionId(chatId)
    const isConnected = this.bridge.isConnected(chatId)

    const state = isConnected ? (sessionId ? 'streaming' : 'idle') : 'idle'
    const status = formatImStatus(state, sessionId ?? 'N/A', binding?.workDir)
    const chunks = splitMessage(status, DINGTALK_MSG_MAX_LEN)

    for (const chunk of chunks) {
      await this.bot.sendTextMessage(webhook, chunk)
    }
  }

  private async handleProjectsCommand(chatId: string, args: string): Promise<void> {
    const webhook = this.getWebhook(chatId)
    if (!webhook) return

    try {
      const projects = await this.httpClient.listRecentProjects()

      if (!args) {
        if (projects.length === 0) {
          await this.bot.sendTextMessage(webhook, '📭 没有最近的项目\n使用 /new 创建新会话')
          return
        }

        let text = '📋 最近项目:\n\n'
        projects.forEach((p, i) => {
          text += `${i + 1}. ${p.name}\n   ${p.path}\n`
        })
        text += '\n使用 /projects <编号或名称> 切换项目'

        const chunks = splitMessage(text, DINGTALK_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(webhook, chunk)
        }
      } else {
        const matched = this.httpClient.matchProject(args, projects)
        if (matched === null) {
          await this.bot.sendTextMessage(webhook, '❌ 未找到匹配的项目')
        } else if (matched === 'ambiguous') {
          await this.bot.sendTextMessage(webhook, '❌ 匹配到多个项目，请更精确地指定')
        } else {
          this.bridge.resetSession(chatId)
          this.clearStreamState(chatId)
          this.permissionCard.clear(webhook)
          await this.createSession(chatId, matched.path)
        }
      }
    } catch (err) {
      log.error('handleProjectsCommand', `Projects failed: ${String(err)}`)
      await this.bot.sendTextMessage(webhook, `❌ 获取项目列表失败: ${String(err)}`)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────

  private isUserPaired(userId: string): boolean {
    if (!userId) return false
    return this.pairing.isPaired(userId, {
      pairing: this.config.pairing,
      pairedUsers: this.config.dingtalk.pairedUsers,
    }, this.config.dingtalk.allowedUsers)
  }

  private getWebhook(chatId: string): string | null {
    const info = this.sessionWebhooks.get(chatId)
    if (!info) return null

    // Check if webhook has expired (72h)
    if (Date.now() > info.expiresAt) {
      log.warn('getWebhook', `sessionWebhook expired for ${chatId}`)
      return null
    }

    return info.webhook
  }

  private clearStreamState(chatId: string): void {
    const ss = this.streamStates.get(chatId)
    if (ss) {
      ss.reset()
      this.streamStates.delete(chatId)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Dependency injection for SessionRecovery
  // ────────────────────────────────────────────────────────────────────────

  private createRecoveryStore() {
    const store = this.sessionStore
    return {
      get(chatId: string): SessionBinding | null {
        return store.get(chatId)
      },
      delete(chatId: string): void {
        store.delete(chatId)
      },
    }
  }

  private createRecoveryBridge() {
    const bridge = this.bridge
    const chatIdRef = { current: '' }
    return {
      get sessionId(): string | null {
        return bridge.getSessionId(chatIdRef.current)
      },
      get isConnected(): boolean {
        return bridge.isConnected(chatIdRef.current)
      },
      async connectSession(sessionId: string, workDir: string): Promise<void> {
        await bridge.connectSession(chatIdRef.current, sessionId, workDir)
      },
      resetSession(): void {
        bridge.resetSession(chatIdRef.current)
      },
    }
  }
}
