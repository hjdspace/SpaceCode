/**
 * TelegramAdapter — Main Telegram adapter that assembles all common modules
 *
 * Architecture:
 * - TelegramBot: HTTP client for Telegram Bot API
 * - WsBridge: WebSocket connection to IM Server
 * - ChatQueue: Serialize inbound events per chatId
 * - SessionStore: Persistent chatId ↔ sessionId mapping
 * - SessionRecovery: 6-step recovery algorithm
 * - MessageDedup: Dedup Telegram message updates
 * - PermissionCard: InlineKeyboard permission buttons
 * - StreamingMessage: Placeholder + editMessageText loop
 * - MediaHandler: Photo/document download/upload
 *
 * Golden path:
 * 1. User sends /pair → pairing code validation → user is paired
 * 2. User sends text → ChatQueue → SessionRecovery → WsBridge.sendUserMessage
 * 3. Engine streams → WsBridge → StreamingMessage.append → editMessageText
 * 4. Permission request → PermissionCard.send → user taps button → callback
 * 5. User sends /projects → list projects → /projects <n> → switch
 */

import type { TelegramBot, TelegramUpdate, TelegramUser } from './telegramBot'
import { StreamingMessage } from './streamingMessage'
import { PermissionCard } from './permissionCard'
import { MediaHandler } from './mediaHandler'
import { TELEGRAM_COMMANDS, parseCommand, isKnownCommand } from './commands'

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

const log = createLogger('TelegramAdapter')

const TELEGRAM_MSG_MAX_LEN = 4096
const POLLING_TIMEOUT_SEC = 30

export interface TelegramAdapterOptions {
  bot: TelegramBot
  config?: AdapterConfig
  serverUrl?: string
  authToken?: string
  attachmentDir?: string
  sessionStorePath?: string
}

export class TelegramAdapter {
  private bot: TelegramBot
  private bridge: WsBridge
  private chatQueue: ChatQueue
  private sessionStore: SessionStore
  private sessionRecovery: SessionRecovery
  private messageDedup: MessageDedup
  private pairing: Pairing
  private httpClient: HttpClient
  private permissionCard: PermissionCard
  private mediaHandler: MediaHandler
  private config: AdapterConfig
  private readonly serverUrl: string
  private streamingMessages: Map<number, StreamingMessage> = new Map()
  private running: boolean = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private recoveryChatId: string = ''

  constructor(opts: TelegramAdapterOptions) {
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
    this.permissionCard = new PermissionCard(this.bot)
    this.mediaHandler = new MediaHandler(this.bot, opts.attachmentDir ?? resolveUserDefaultWorkDir())
  }

  // ────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────────

  /** Start the adapter: validate bot, sync commands, begin polling. */
  async start(): Promise<void> {
    if (this.running) return

    // Validate bot token
    try {
      const me = await this.bot.getMe()
      log.info('start', `Bot started: @${me.username} (${me.first_name})`)
    } catch (err) {
      throw new Error(`Failed to validate bot token: ${String(err)}`)
    }

    // Sync command menu
    try {
      await this.bot.setMyCommands(TELEGRAM_COMMANDS)
      log.info('start', `Synced ${TELEGRAM_COMMANDS.length} commands`)
    } catch (err) {
      log.warn('start', `Failed to sync commands: ${String(err)}`)
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
  // Polling loop
  // ────────────────────────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.bot.getUpdates(POLLING_TIMEOUT_SEC)
        for (const update of updates) {
          await this.handleUpdate(update)
        }
      } catch (err) {
        log.error('pollLoop', `Polling error: ${String(err)}`)
        // Wait before retrying
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Update handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    // Handle callback query (permission button press)
    if (update.callback_query) {
      const chatId = update.callback_query.message?.chat.id
      if (chatId) {
        await this.chatQueue.enqueue(String(chatId), async () => {
          await this.handleCallbackQuery(chatId, update.callback_query!)
        })
      }
      return
    }

    // Handle message
    if (update.message) {
      const chatId = update.message.chat.id
      const updateId = update.update_id

      // Dedup by update_id
      if (!this.messageDedup.tryRecord(String(updateId))) {
        return
      }

      // Enqueue for serial processing
      await this.chatQueue.enqueue(String(chatId), async () => {
        await this.handleMessage(chatId, update.message!, update.message!.from)
      })
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Message handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleMessage(
    chatId: number,
    msg: NonNullable<TelegramUpdate['message']>,
    from?: TelegramUser
  ): Promise<void> {
    const userId = from?.id ? String(from.id) : ''
    const displayName = from ? `${from.first_name}${from.last_name ? ' ' + from.last_name : ''}` : ''

    // Check if text is a command
    const text = msg.text ?? msg.caption ?? ''
    const command = parseCommand(text)

    if (command && isKnownCommand(command.command)) {
      await this.handleCommand(chatId, command.command, command.args, userId, displayName)
      return
    }

    // Check if this is a pairing attempt (code without /pair command)
    if (!this.isUserPaired(userId)) {
      // Try pairing
      await this.handlePairing(chatId, text, userId, displayName)
      return
    }

    // User is paired — handle as chat message
    await this.handleUserMessage(chatId, text, msg, userId, displayName)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Command handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleCommand(
    chatId: number,
    command: string,
    args: string,
    userId: string,
    displayName: string
  ): Promise<void> {
    switch (command) {
      case 'help': {
        const chunks = splitMessage(formatImHelp(), TELEGRAM_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendMessage(chatId, chunk)
        }
        break
      }

      case 'pair': {
        if (!args) {
          await this.bot.sendMessage(chatId, '用法: /pair <配对码>')
          return
        }
        await this.handlePairing(chatId, args, userId, displayName)
        break
      }

      case 'unpair': {
        this.pairing.removePairedUser(
          { pairing: this.config.pairing, pairedUsers: this.config.telegram.pairedUsers },
          userId
        )
        saveConfig(this.config)
        await this.bot.sendMessage(chatId, '已取消配对')
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
        this.bridge.sendStopGeneration(String(chatId))
        await this.bot.sendMessage(chatId, '⏹️ 已请求停止生成')
        break
      }

      case 'clear': {
        this.sessionStore.delete(String(chatId))
        this.bridge.resetSession(String(chatId))
        this.permissionCard.clear(chatId)
        this.clearStreamingMessage(chatId)
        await this.bot.sendMessage(chatId, '🧹 已清空会话')
        break
      }

      case 'projects': {
        await this.handleProjectsCommand(chatId, args)
        break
      }

      case 'resume': {
        await this.bot.sendMessage(chatId, '📋 恢复会话功能: 使用 /new 创建新会话，或直接发送消息自动恢复上一个会话')
        break
      }

      case 'provider': {
        await this.bot.sendMessage(chatId, '🔧 Provider 切换功能需要桌面端配置')
        break
      }

      case 'model': {
        await this.bot.sendMessage(chatId, '🔧 模型切换功能需要桌面端配置')
        break
      }

      case 'skills': {
        await this.bot.sendMessage(chatId, '📋 技能列表功能需要桌面端配置')
        break
      }

      case 'cancel': {
        this.permissionCard.clear(chatId)
        await this.bot.sendMessage(chatId, '✅ 已取消当前操作')
        break
      }

      case 'health': {
        await this.bot.sendMessage(chatId, '✅ 适配器运行正常')
        break
      }

      default: {
        await this.bot.sendMessage(chatId, `未知命令: /${command}\n使用 /help 查看可用命令`)
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pairing
  // ────────────────────────────────────────────────────────────────────────

  private async handlePairing(
    chatId: number,
    code: string,
    userId: string,
    displayName: string
  ): Promise<void> {
    if (this.isUserPaired(userId)) {
      await this.bot.sendMessage(chatId, '✅ 您已配对，可以直接发送消息')
      return
    }

    const result = this.pairing.tryPair(code, userId, {
      pairing: this.config.pairing,
      pairedUsers: this.config.telegram.pairedUsers,
    })

    if (result.success) {
      this.pairing.addPairedUser(
        { pairing: this.config.pairing, pairedUsers: this.config.telegram.pairedUsers },
        userId,
        displayName
      )
      this.pairing.clearCode({ pairing: this.config.pairing, pairedUsers: this.config.telegram.pairedUsers })
      this.pairing.clearAttempts(userId)
      saveConfig(this.config)

      await this.bot.sendMessage(chatId, `✅ 配对成功！欢迎${displayName ? '，' + displayName : ''}\n\n使用 /help 查看可用命令`)
    } else {
      const messages: Record<string, string> = {
        expired: '❌ 配对码已过期，请重新生成',
        rate_limited: '❌ 尝试次数过多，请稍后再试',
        mismatch: '❌ 配对码不正确',
        no_code: '❌ 当前没有生效的配对码，请先在桌面端生成',
      }
      await this.bot.sendMessage(chatId, messages[result.reason ?? 'mismatch'])
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // User message handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleUserMessage(
    chatId: number,
    text: string,
    msg: NonNullable<TelegramUpdate['message']>,
    userId: string,
    displayName: string
  ): Promise<void> {
    // Check for permission quick-reply
    if (this.permissionCard.getPendingCount(chatId) > 0) {
      const parsed = parsePermissionCommand(
        text,
        this.permissionCard.getPendingCount(chatId),
        this.permissionCard.getSinglePendingRequestId(chatId)
      )
      if (parsed) {
        const rule = parsed.action === 'always' ? 'always' : undefined
        this.bridge.sendPermissionResponse(
          String(chatId),
          parsed.requestId!,
          parsed.action !== 'deny',
          rule
        )
        await this.bot.sendMessage(chatId, `✅ 已${parsed.action === 'deny' ? '拒绝' : '允许'}`)
        return
      }
    }

    // Handle media (photos/documents)
    const attachments: Array<{ type: 'image' | 'file'; name?: string; path?: string; mimeType?: string }> = []
    if (msg.photo && msg.photo.length > 0) {
      const media = await this.mediaHandler.downloadPhoto(msg.photo)
      if (media) {
        attachments.push(this.mediaHandler.toAttachmentRef(media))
      }
    }
    if (msg.document) {
      const media = await this.mediaHandler.downloadDocument(msg.document)
      if (media) {
        attachments.push(this.mediaHandler.toAttachmentRef(media))
      }
    }

    // Recover or create session
    this.recoveryChatId = String(chatId)
    const binding = await this.sessionRecovery.recover(String(chatId))
    if (!binding) {
      // Create new session
      const workDir = this.config.telegram.defaultWorkDir || this.config.defaultProjectDir
      await this.createSession(chatId, workDir)
      // Send the user's message after session creation
      this.bridge.sendUserMessage(String(chatId), text)
      return
    }

    // Send the message
    this.bridge.sendUserMessage(String(chatId), text)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Session management
  // ────────────────────────────────────────────────────────────────────────

  private async startNewSession(chatId: number, userId: string): Promise<void> {
    // Reset existing session
    this.bridge.resetSession(String(chatId))
    this.clearStreamingMessage(chatId)
    this.permissionCard.clear(chatId)

    const workDir = this.config.telegram.defaultWorkDir || this.config.defaultProjectDir
    await this.createSession(chatId, workDir)
  }

  private async createSession(chatId: number, workDir: string): Promise<void> {
    try {
      const { sessionId, token } = await this.httpClient.createSession(workDir)

      // Store binding
      this.sessionStore.set(String(chatId), { sessionId, workDir })

      // Update bridge auth token
    this.bridge = new WsBridge({
      serverUrl: this.serverUrl,
      authToken: token,
    })
      this.bridge.startHeartbeat()

      // Register message handler
      this.bridge.onServerMessage(String(chatId), (msg) => this.handleServerMessage(chatId, msg))

      // Connect
      await this.bridge.connectSession(String(chatId), sessionId, workDir)

      await this.bot.sendMessage(chatId, `✅ 新会话已创建\n📁 目录: ${workDir}\n🆔 ${sessionId.slice(0, 8)}...`)
    } catch (err) {
      log.error('createSession', `Failed to create session: ${String(err)}`)
      await this.bot.sendMessage(chatId, `❌ 创建会话失败: ${String(err)}`)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // ServerMessage handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleServerMessage(chatId: number, msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case 'connected': {
        log.info('handleServerMessage', `WS connected for chat ${chatId}`)
        break
      }

      case 'status': {
        if (msg.state === 'idle') {
          // Complete any streaming message
          const sm = this.streamingMessages.get(chatId)
          if (sm) {
            await sm.complete()
            this.streamingMessages.delete(chatId)
          }
        }
        break
      }

      case 'content_start': {
        if (msg.blockType === 'text') {
          // Start a new streaming message
          this.clearStreamingMessage(chatId)
          const sm = new StreamingMessage(this.bot, chatId)
          this.streamingMessages.set(chatId, sm)
        }
        break
      }

      case 'content_delta': {
        if (msg.text) {
          const sm = this.streamingMessages.get(chatId)
          if (sm) {
            sm.append(msg.text)
          } else {
            // Create streaming message if not exists
            const newSm = new StreamingMessage(this.bot, chatId)
            newSm.append(msg.text)
            this.streamingMessages.set(chatId, newSm)
          }
        }
        break
      }

      case 'tool_use_complete': {
        // Complete current streaming text before showing tool use
        const sm = this.streamingMessages.get(chatId)
        if (sm) {
          await sm.complete()
          this.streamingMessages.delete(chatId)
        }
        const toolText = formatToolUse(msg.toolName, msg.input)
        await this.bot.sendMessage(chatId, toolText)
        break
      }

      case 'tool_result': {
        if (msg.isError) {
          await this.bot.sendMessage(chatId, `❌ 工具错误: ${msg.content.slice(0, 500)}`)
        }
        break
      }

      case 'permission_request': {
        await this.permissionCard.send(
          chatId,
          msg.requestId,
          msg.toolName,
          msg.input,
          msg.description
        )
        break
      }

      case 'message_complete': {
        const sm = this.streamingMessages.get(chatId)
        if (sm) {
          await sm.complete()
          this.streamingMessages.delete(chatId)
        }

        // Show token usage
        const usage = msg.usage
        const usageText = `📊 Token: ↓${usage.inputTokens} ↑${usage.outputTokens}`
        if (usage.cacheReadInputTokens || usage.cacheCreationInputTokens) {
          const cache = `💾 Cache: ${usage.cacheReadInputTokens ?? 0}/${usage.cacheCreationInputTokens ?? 0}`
          await this.bot.sendMessage(chatId, `${usageText}\n${cache}`)
        }
        break
      }

      case 'error': {
        const errorText = `❌ 错误: ${msg.message}`
        const chunks = splitMessage(errorText, TELEGRAM_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendMessage(chatId, chunk)
        }
        break
      }

      case 'api_retry': {
        await this.bot.sendMessage(
          chatId,
          `🔄 API 重试 (${msg.attempt}/${msg.maxRetries})，${msg.retryDelayMs}ms 后重试...`
        )
        break
      }

      default: {
        // Ignore unknown message types
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Callback query handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleCallbackQuery(
    chatId: number,
    callback: NonNullable<TelegramUpdate['callback_query']>
  ): Promise<void> {
    const data = callback.data ?? ''
    const result = await this.permissionCard.handleCallback(chatId, data, callback.id)

    if (result) {
      const rule = result.action === 'always' ? 'always' : undefined
      this.bridge.sendPermissionResponse(
        String(chatId),
        result.requestId,
        result.action !== 'deny',
        rule
      )
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Status & projects commands
  // ────────────────────────────────────────────────────────────────────────

  private async handleStatusCommand(chatId: number): Promise<void> {
    const binding = this.sessionStore.get(String(chatId))
    const sessionId = this.bridge.getSessionId(String(chatId))
    const isConnected = this.bridge.isConnected(String(chatId))

    const state = isConnected ? (sessionId ? 'streaming' : 'idle') : 'idle'
    const status = formatImStatus(state, sessionId ?? 'N/A', binding?.workDir)
    const chunks = splitMessage(status, TELEGRAM_MSG_MAX_LEN)

    for (const chunk of chunks) {
      await this.bot.sendMessage(chatId, chunk)
    }
  }

  private async handleProjectsCommand(chatId: number, args: string): Promise<void> {
    try {
      const projects = await this.httpClient.listRecentProjects()

      if (!args) {
        // List projects
        if (projects.length === 0) {
          await this.bot.sendMessage(chatId, '📭 没有最近的项目\n使用 /new 创建新会话')
          return
        }

        let text = '📋 最近项目:\n\n'
        projects.forEach((p, i) => {
          text += `${i + 1}. ${p.name}\n   ${p.path}\n`
        })
        text += '\n使用 /projects <编号或名称> 切换项目'

        const chunks = splitMessage(text, TELEGRAM_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendMessage(chatId, chunk)
        }
      } else {
        // Switch project
        const matched = this.httpClient.matchProject(args, projects)
        if (matched === null) {
          await this.bot.sendMessage(chatId, '❌ 未找到匹配的项目')
        } else if (matched === 'ambiguous') {
          await this.bot.sendMessage(chatId, '❌ 匹配到多个项目，请更精确地指定')
        } else {
          // Create new session with the matched project
          this.bridge.resetSession(String(chatId))
          this.clearStreamingMessage(chatId)
          this.permissionCard.clear(chatId)
          await this.createSession(chatId, matched.path)
        }
      }
    } catch (err) {
      log.error('handleProjectsCommand', `Projects command failed: ${String(err)}`)
      await this.bot.sendMessage(chatId, `❌ 获取项目列表失败: ${String(err)}`)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────

  private isUserPaired(userId: string): boolean {
    if (!userId) return false
    return this.pairing.isPaired(userId, {
      pairing: this.config.pairing,
      pairedUsers: this.config.telegram.pairedUsers,
    }, this.config.telegram.allowedUsers)
  }

  private clearStreamingMessage(chatId: number): void {
    const sm = this.streamingMessages.get(chatId)
    if (sm) {
      sm.reset()
      this.streamingMessages.delete(chatId)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Dependency injection adapters for SessionRecovery
  // ────────────────────────────────────────────────────────────────────────

  private createRecoveryStore() {
    const store = this.sessionStore
    const chatIdMap: Map<string, string> = new Map() // Not needed — store is global

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
