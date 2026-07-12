/**
 * FeishuAdapter — Main Feishu adapter that assembles all common modules
 *
 * Architecture mirrors TelegramAdapter but uses Feishu-specific:
 * - FeishuBot: HTTP client for Feishu Open Platform API
 * - StreamingCard: CardKit 5-step streaming card protocol
 * - FeishuPermissionCard: Schema 2.0 card with 3 buttons + path safety
 * - FeishuMediaHandler: im.messageResource.get download, im.image.create upload
 *
 * Feishu uses Lark WSClient for receiving events (simulated via polling here).
 *
 * Golden path:
 * 1. User sends /pair → pairing code validation → user is paired
 * 2. User sends text → ChatQueue → SessionRecovery → WsBridge.sendUserMessage
 * 3. Engine streams → WsBridge → StreamingCard.append → CardKit update
 * 4. Permission request → PermissionCard.send → user taps button → callback
 * 5. User sends /projects → list projects → /projects <n> → switch
 */

import type { FeishuBot, FeishuMessage } from './feishuBot'
import { StreamingCard } from './streamingCard'
import { FeishuPermissionCard } from './permissionCard'
import { FeishuMediaHandler } from './mediaHandler'
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

const log = createLogger('FeishuAdapter')

const FEISHU_MSG_MAX_LEN = 30000
const POLLING_INTERVAL_MS = 2000

export interface FeishuAdapterOptions {
  bot: FeishuBot
  config?: AdapterConfig
  serverUrl?: string
  authToken?: string
  attachmentDir?: string
  sessionStorePath?: string
}

export class FeishuAdapter {
  private bot: FeishuBot
  private bridge: WsBridge
  private chatQueue: ChatQueue
  private sessionStore: SessionStore
  private sessionRecovery: SessionRecovery
  private messageDedup: MessageDedup
  private pairing: Pairing
  private httpClient: HttpClient
  private permissionCard: FeishuPermissionCard
  private mediaHandler: FeishuMediaHandler
  private config: AdapterConfig
  private readonly serverUrl: string
  private streamingCards: Map<string, StreamingCard> = new Map()
  private running: boolean = false
  private recoveryChatId: string = ''
  private pollTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: FeishuAdapterOptions) {
    this.bot = opts.bot
    this.config = opts.config ?? loadConfig()

    this.serverUrl = opts.serverUrl ?? this.config.serverUrl
    const authToken = opts.authToken

    this.bridge = new WsBridge({ serverUrl: this.serverUrl, authToken })
    this.bridge.startHeartbeat()

    this.chatQueue = new ChatQueue()
    this.sessionStore = new SessionStore({ filePath: opts.sessionStorePath })
    this.httpClient = new HttpClient({
      baseUrl: this.serverUrl.replace(/^ws/, 'http'),
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
    this.permissionCard = new FeishuPermissionCard(this.bot)
    this.mediaHandler = new FeishuMediaHandler(this.bot, opts.attachmentDir ?? resolveUserDefaultWorkDir())
  }

  // ────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────────

  /** Start the adapter. */
  async start(): Promise<void> {
    if (this.running) return

    try {
      const botInfo = await this.bot.getBotInfo()
      log.info('start', `Bot started: ${botInfo.app_name} (${botInfo.open_id})`)
    } catch (err) {
      throw new Error(`Failed to validate Feishu app credentials: ${String(err)}`)
    }

    this.running = true
    this.pollLoop()
  }

  /** Stop the adapter. */
  async stop(): Promise<void> {
    this.running = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    this.messageDedup.stopSweep()
    this.bridge.destroy()
    log.info('stop', 'Adapter stopped')
  }

  // ────────────────────────────────────────────────────────────────────────
  // Event polling (simulates Lark WSClient)
  // ────────────────────────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        // In production, this would be a WSClient connection.
        // For now, we just sleep and let events come via handleEvent.
        await new Promise((r) => setTimeout(r, POLLING_INTERVAL_MS))
      } catch (err) {
        log.error('pollLoop', `Polling error: ${String(err)}`)
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }

  /** Handle an incoming Feishu event (from WSClient or webhook). */
  async handleEvent(event: { event?: { message?: FeishuMessage } }): Promise<void> {
    const message = event.event?.message
    if (!message) return

    const receiveId = message.sender?.sender_id?.open_id ?? ''
    const messageId = message.message_id

    // Dedup by message_id
    if (!this.messageDedup.tryRecord(messageId)) {
      return
    }

    // Enqueue for serial processing
    await this.chatQueue.enqueue(receiveId, async () => {
      await this.handleMessage(receiveId, message)
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Message handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleMessage(receiveId: string, msg: FeishuMessage): Promise<void> {
    const userId = msg.sender?.sender_id?.open_id ?? ''
    const displayName = '' // Feishu doesn't provide display name in message event

    // Parse message content based on type
    let text = ''
    let imageKey: string | null = null
    let fileKey: string | null = null
    let fileName: string | null = null

    try {
      const content = JSON.parse(msg.content)
      if (msg.message_type === 'text') {
        text = content.text ?? ''
      } else if (msg.message_type === 'image') {
        imageKey = content.image_key ?? null
      } else if (msg.message_type === 'file') {
        fileKey = content.file_key ?? null
        fileName = content.file_name ?? `feishu_file_${Date.now()}`
      } else if (msg.message_type === 'post') {
        // Extract text from rich text post
        text = this.extractPostText(content)
      }
    } catch {
      text = msg.content
    }

    // Check if text is a command
    const command = parseCommand(text)
    if (command && isKnownCommand(command.command)) {
      await this.handleCommand(receiveId, command.command, command.args, userId, displayName)
      return
    }

    // Check if this is a pairing attempt
    if (!this.isUserPaired(userId)) {
      await this.handlePairing(receiveId, text, userId, displayName)
      return
    }

    // User is paired — handle as chat message
    await this.handleUserMessage(receiveId, text, msg, imageKey, fileKey, fileName, userId, displayName)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Command handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleCommand(
    receiveId: string,
    command: string,
    args: string,
    userId: string,
    displayName: string
  ): Promise<void> {
    switch (command) {
      case 'help': {
        const chunks = splitMessage(formatImHelp(), FEISHU_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage('open_id', receiveId, chunk)
        }
        break
      }

      case 'pair': {
        if (!args) {
          await this.bot.sendTextMessage('open_id', receiveId, '用法: /pair <配对码>')
          return
        }
        await this.handlePairing(receiveId, args, userId, displayName)
        break
      }

      case 'unpair': {
        this.pairing.removePairedUser(
          { pairing: this.config.pairing, pairedUsers: this.config.feishu.pairedUsers },
          userId
        )
        saveConfig(this.config)
        await this.bot.sendTextMessage('open_id', receiveId, '已取消配对')
        break
      }

      case 'new': {
        await this.startNewSession(receiveId, userId)
        break
      }

      case 'status': {
        await this.handleStatusCommand(receiveId)
        break
      }

      case 'stop': {
        this.bridge.sendStopGeneration(receiveId)
        await this.bot.sendTextMessage('open_id', receiveId, '⏹️ 已请求停止生成')
        break
      }

      case 'clear': {
        this.sessionStore.delete(receiveId)
        this.bridge.resetSession(receiveId)
        this.permissionCard.clear(receiveId)
        this.clearStreamingCard(receiveId)
        await this.bot.sendTextMessage('open_id', receiveId, '🧹 已清空会话')
        break
      }

      case 'resume': {
        await this.bot.sendTextMessage('open_id', receiveId, '📋 恢复会话功能: 使用 /new 创建新会话，或直接发送消息自动恢复上一个会话')
        break
      }

      case 'provider': {
        await this.bot.sendTextMessage('open_id', receiveId, '🔧 Provider 切换功能需要桌面端配置')
        break
      }

      case 'model': {
        await this.bot.sendTextMessage('open_id', receiveId, '🔧 模型切换功能需要桌面端配置')
        break
      }

      case 'skills': {
        await this.bot.sendTextMessage('open_id', receiveId, '📋 技能列表功能需要桌面端配置')
        break
      }

      case 'cancel': {
        this.permissionCard.clear(receiveId)
        await this.bot.sendTextMessage('open_id', receiveId, '✅ 已取消当前操作')
        break
      }

      case 'health': {
        await this.bot.sendTextMessage('open_id', receiveId, '✅ 适配器运行正常')
        break
      }

      case 'projects': {
        await this.handleProjectsCommand(receiveId, args)
        break
      }

      default: {
        await this.bot.sendTextMessage('open_id', receiveId, `未知命令: /${command}\n使用 /help 查看可用命令`)
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pairing
  // ────────────────────────────────────────────────────────────────────────

  private async handlePairing(
    receiveId: string,
    code: string,
    userId: string,
    displayName: string
  ): Promise<void> {
    if (this.isUserPaired(userId)) {
      await this.bot.sendTextMessage('open_id', receiveId, '✅ 您已配对，可以直接发送消息')
      return
    }

    const result = this.pairing.tryPair(code, userId, {
      pairing: this.config.pairing,
      pairedUsers: this.config.feishu.pairedUsers,
    })

    if (result.success) {
      this.pairing.addPairedUser(
        { pairing: this.config.pairing, pairedUsers: this.config.feishu.pairedUsers },
        userId,
        displayName
      )
      this.pairing.clearCode({ pairing: this.config.pairing, pairedUsers: this.config.feishu.pairedUsers })
      this.pairing.clearAttempts(userId)
      saveConfig(this.config)

      await this.bot.sendTextMessage('open_id', receiveId, `✅ 配对成功！\n\n使用 /help 查看可用命令`)
    } else {
      const messages: Record<string, string> = {
        expired: '❌ 配对码已过期，请重新生成',
        rate_limited: '❌ 尝试次数过多，请稍后再试',
        mismatch: '❌ 配对码不正确',
        no_code: '❌ 当前没有生效的配对码，请先在桌面端生成',
      }
      await this.bot.sendTextMessage('open_id', receiveId, messages[result.reason ?? 'mismatch'])
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // User message handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleUserMessage(
    receiveId: string,
    text: string,
    msg: FeishuMessage,
    imageKey: string | null,
    fileKey: string | null,
    fileName: string | null,
    userId: string,
    displayName: string
  ): Promise<void> {
    // Check for permission quick-reply
    if (this.permissionCard.getPendingCount(receiveId) > 0) {
      const parsed = parsePermissionCommand(
        text,
        this.permissionCard.getPendingCount(receiveId),
        this.permissionCard.getSinglePendingRequestId(receiveId)
      )
      if (parsed) {
        const rule = parsed.action === 'always' ? 'always' : undefined
        this.bridge.sendPermissionResponse(
          receiveId,
          parsed.requestId!,
          parsed.action !== 'deny',
          rule
        )
        await this.bot.sendTextMessage('open_id', receiveId, `✅ 已${parsed.action === 'deny' ? '拒绝' : '允许'}`)
        return
      }
    }

    // Handle media (images/files)
    const attachments: Array<{ type: 'image' | 'file'; name?: string; path?: string; mimeType?: string }> = []
    if (imageKey) {
      const media = await this.mediaHandler.downloadImage(msg.message_id, imageKey)
      if (media) {
        attachments.push(this.mediaHandler.toAttachmentRef(media))
      }
    }
    if (fileKey && fileName) {
      const media = await this.mediaHandler.downloadFile(msg.message_id, fileKey, fileName)
      if (media) {
        attachments.push(this.mediaHandler.toAttachmentRef(media))
      }
    }

    // Recover or create session
    this.recoveryChatId = receiveId
    const binding = await this.sessionRecovery.recover(receiveId)
    if (!binding) {
      const workDir = this.config.feishu.defaultWorkDir || this.config.defaultProjectDir
      await this.createSession(receiveId, workDir)
      // Send the user's message after session creation
      this.bridge.sendUserMessage(receiveId, text)
      return
    }

    // Send the message
    this.bridge.sendUserMessage(receiveId, text)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Session management
  // ────────────────────────────────────────────────────────────────────────

  private async startNewSession(receiveId: string, userId: string): Promise<void> {
    this.bridge.resetSession(receiveId)
    this.clearStreamingCard(receiveId)
    this.permissionCard.clear(receiveId)

    const workDir = this.config.feishu.defaultWorkDir || this.config.defaultProjectDir
    await this.createSession(receiveId, workDir)
  }

  private async createSession(receiveId: string, workDir: string): Promise<void> {
    try {
      const { sessionId, token } = await this.httpClient.createSession(workDir)

      this.sessionStore.set(receiveId, { sessionId, workDir })

    this.bridge = new WsBridge({
      serverUrl: this.serverUrl,
      authToken: token,
    })
      this.bridge.startHeartbeat()

      this.bridge.onServerMessage(receiveId, (msg) => this.handleServerMessage(receiveId, msg))

      await this.bridge.connectSession(receiveId, sessionId, workDir)

      await this.bot.sendTextMessage('open_id', receiveId, `✅ 新会话已创建\n📁 目录: ${workDir}\n🆔 ${sessionId.slice(0, 8)}...`)
    } catch (err) {
      log.error('createSession', `Failed to create session: ${String(err)}`)
      await this.bot.sendTextMessage('open_id', receiveId, `❌ 创建会话失败: ${String(err)}`)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // ServerMessage handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleServerMessage(receiveId: string, msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case 'connected': {
        log.info('handleServerMessage', `WS connected for ${receiveId}`)
        break
      }

      case 'status': {
        if (msg.state === 'idle') {
          const sc = this.streamingCards.get(receiveId)
          if (sc) {
            await sc.complete()
            this.streamingCards.delete(receiveId)
          }
        }
        break
      }

      case 'content_start': {
        if (msg.blockType === 'text') {
          this.clearStreamingCard(receiveId)
          const sc = new StreamingCard(this.bot, receiveId, 'open_id')
          this.streamingCards.set(receiveId, sc)
        }
        break
      }

      case 'content_delta': {
        if (msg.text) {
          const sc = this.streamingCards.get(receiveId)
          if (sc) {
            sc.append(msg.text)
          } else {
            const newSc = new StreamingCard(this.bot, receiveId, 'open_id')
            newSc.append(msg.text)
            this.streamingCards.set(receiveId, newSc)
          }
        }
        break
      }

      case 'tool_use_complete': {
        const sc = this.streamingCards.get(receiveId)
        if (sc) {
          await sc.complete()
          this.streamingCards.delete(receiveId)
        }
        const toolText = formatToolUse(msg.toolName, msg.input)
        await this.bot.sendTextMessage('open_id', receiveId, toolText)
        break
      }

      case 'tool_result': {
        if (msg.isError) {
          await this.bot.sendTextMessage('open_id', receiveId, `❌ 工具错误: ${msg.content.slice(0, 500)}`)
        }
        break
      }

      case 'permission_request': {
        const workDir = this.sessionStore.get(receiveId)?.workDir
        await this.permissionCard.send(
          receiveId,
          'open_id',
          msg.requestId,
          msg.toolName,
          msg.input,
          msg.description,
          workDir
        )
        break
      }

      case 'message_complete': {
        const sc = this.streamingCards.get(receiveId)
        if (sc) {
          await sc.complete()
          this.streamingCards.delete(receiveId)
        }

        const usage = msg.usage
        const usageText = `📊 Token: ↓${usage.inputTokens} ↑${usage.outputTokens}`
        await this.bot.sendTextMessage('open_id', receiveId, usageText)
        break
      }

      case 'error': {
        const errorText = `❌ 错误: ${msg.message}`
        const chunks = splitMessage(errorText, FEISHU_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage('open_id', receiveId, chunk)
        }
        break
      }

      case 'api_retry': {
        await this.bot.sendTextMessage(
          'open_id',
          receiveId,
          `🔄 API 重试 (${msg.attempt}/${msg.maxRetries})，${msg.retryDelayMs}ms 后重试...`
        )
        break
      }

      default: {
        // Ignore unknown message types
      }
    }
  }

  /** Handle a card action callback (button press). */
  async handleCardAction(receiveId: string, actionValue: string): Promise<void> {
    const result = this.permissionCard.handleCallback(receiveId, actionValue)

    if (result) {
      const rule = result.action === 'always' ? 'always' : undefined
      this.bridge.sendPermissionResponse(
        receiveId,
        result.requestId,
        result.action !== 'deny',
        rule
      )
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Status & projects commands
  // ────────────────────────────────────────────────────────────────────────

  private async handleStatusCommand(receiveId: string): Promise<void> {
    const binding = this.sessionStore.get(receiveId)
    const sessionId = this.bridge.getSessionId(receiveId)
    const isConnected = this.bridge.isConnected(receiveId)

    const state = isConnected ? (sessionId ? 'streaming' : 'idle') : 'idle'
    const status = formatImStatus(state, sessionId ?? 'N/A', binding?.workDir)
    const chunks = splitMessage(status, FEISHU_MSG_MAX_LEN)

    for (const chunk of chunks) {
      await this.bot.sendTextMessage('open_id', receiveId, chunk)
    }
  }

  private async handleProjectsCommand(receiveId: string, args: string): Promise<void> {
    try {
      const projects = await this.httpClient.listRecentProjects()

      if (!args) {
        if (projects.length === 0) {
          await this.bot.sendTextMessage('open_id', receiveId, '📭 没有最近的项目\n使用 /new 创建新会话')
          return
        }

        let text = '📋 最近项目:\n\n'
        projects.forEach((p, i) => {
          text += `${i + 1}. ${p.name}\n   ${p.path}\n`
        })
        text += '\n使用 /projects <编号或名称> 切换项目'

        const chunks = splitMessage(text, FEISHU_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage('open_id', receiveId, chunk)
        }
      } else {
        const matched = this.httpClient.matchProject(args, projects)
        if (matched === null) {
          await this.bot.sendTextMessage('open_id', receiveId, '❌ 未找到匹配的项目')
        } else if (matched === 'ambiguous') {
          await this.bot.sendTextMessage('open_id', receiveId, '❌ 匹配到多个项目，请更精确地指定')
        } else {
          this.bridge.resetSession(receiveId)
          this.clearStreamingCard(receiveId)
          this.permissionCard.clear(receiveId)
          await this.createSession(receiveId, matched.path)
        }
      }
    } catch (err) {
      log.error('handleProjectsCommand', `Projects command failed: ${String(err)}`)
      await this.bot.sendTextMessage('open_id', receiveId, `❌ 获取项目列表失败: ${String(err)}`)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────

  private isUserPaired(userId: string): boolean {
    if (!userId) return false
    return this.pairing.isPaired(userId, {
      pairing: this.config.pairing,
      pairedUsers: this.config.feishu.pairedUsers,
    }, this.config.feishu.allowedUsers)
  }

  private clearStreamingCard(receiveId: string): void {
    const sc = this.streamingCards.get(receiveId)
    if (sc) {
      sc.reset()
      this.streamingCards.delete(receiveId)
    }
  }

  /** Extract text from Feishu rich text post format. */
  private extractPostText(content: { content?: Array<Array<{ tag: string; text?: string }>> }): string {
    if (!content.content) return ''
    const lines: string[] = []
    for (const paragraph of content.content) {
      const parts = paragraph
        .filter((node) => node.tag === 'text' && node.text)
        .map((node) => node.text!)
      if (parts.length > 0) {
        lines.push(parts.join(''))
      }
    }
    return lines.join('\n')
  }

  // ────────────────────────────────────────────────────────────────────────
  // Dependency injection adapters for SessionRecovery
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
const self = this
return {
get sessionId(): string | null {
return self.bridge.getSessionId(self.recoveryChatId)
},
get isConnected(): boolean {
return self.bridge.isConnected(self.recoveryChatId)
},
async connectSession(sessionId: string, workDir: string): Promise<void> {
await self.bridge.connectSession(self.recoveryChatId, sessionId, workDir)
},
resetSession(): void {
self.bridge.resetSession(self.recoveryChatId)
},
}
}
}
