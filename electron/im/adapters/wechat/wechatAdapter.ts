/**
 * WechatAdapter — Main WeChat adapter
 *
 * WeChat is the simplest platform:
 * - HTTP long-polling for incoming messages
 * - 3s accumulated buffer + one-shot send (no streaming)
 * - Typing indicator (5s re-send)
 * - Plain text permission (no cards)
 * - AES-128-ECB media decryption
 *
 * Golden path:
 * 1. User sends /pair → pairing code validation
 * 2. User sends text → ChatQueue → SessionRecovery → WsBridge.sendUserMessage
 * 3. Engine streams → WsBridge → MessageBuffer 3s accumulate → one-shot send
 * 4. Permission request → plain text → quick reply
 * 5. User sends /projects → list/switch
 */

import type { WechatBot, WechatMessage } from './wechatBot'
import { TypingIndicator } from './typing'
import { WechatMediaHandler } from './mediaHandler'
import { parseCommand, isKnownCommand } from './commands'

import { WsBridge } from '../common/ws-bridge'
import { ChatQueue } from '../common/chat-queue'
import { SessionStore } from '../common/session-store'
import { SessionRecovery } from '../common/session-recovery'
import { MessageDedup } from '../common/message-dedup'
import { MessageBuffer } from '../common/message-buffer'
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
  formatPermissionRequest,
  splitMessage,
} from '../common/format'
import { parsePermissionCommand } from '../common/permission'
import type { ServerMessage, SessionBinding } from '../common/types'
import { createLogger } from '../common/logger'

const log = createLogger('WechatAdapter')

const WECHAT_MSG_MAX_LEN = 2000
const WECHAT_FLUSH_MS = 3000
const WECHAT_CHAR_THRESHOLD = 200

export interface WechatAdapterOptions {
  bot: WechatBot
  config?: AdapterConfig
  serverUrl?: string
  authToken?: string
  attachmentDir?: string
  sessionStorePath?: string
}

export class WechatAdapter {
  private bot: WechatBot
  private bridge: WsBridge
  private chatQueue: ChatQueue
  private sessionStore: SessionStore
  private sessionRecovery: SessionRecovery
  private messageDedup: MessageDedup
  private pairing: Pairing
  private httpClient: HttpClient
  private mediaHandler: WechatMediaHandler
  private typingIndicator: TypingIndicator
  private config: AdapterConfig
  private messageBuffers: Map<string, MessageBuffer> = new Map()
  private fullTexts: Map<string, string> = new Map()
  private pendingPermissions: Map<string, Array<{ requestId: string; toolName: string }>> = new Map()
  private running: boolean = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: WechatAdapterOptions) {
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

    const encryptKey = this.config.wechat.botToken
    this.mediaHandler = new WechatMediaHandler(
      this.bot,
      opts.attachmentDir ?? resolveUserDefaultWorkDir(),
      encryptKey
    )
    this.typingIndicator = new TypingIndicator(this.bot)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return

    try {
      const info = await this.bot.getBotInfo()
      log.info('start', `Bot started: ${info.account_id}`)
    } catch (err) {
      throw new Error(`Failed to validate WeChat credentials: ${String(err)}`)
    }

    this.running = true
    this.pollLoop()
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    this.typingIndicator.stopAll()
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
        const messages = await this.bot.getMessages()
        for (const msg of messages) {
          await this.handlePolledMessage(msg)
        }
      } catch (err) {
        log.error('pollLoop', `Polling error: ${String(err)}`)
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
  }

  private async handlePolledMessage(msg: WechatMessage): Promise<void> {
    const chatId = msg.fromUserId

    // Dedup
    if (!this.messageDedup.tryRecord(msg.msgId)) return

    // Update context token
    if (msg.contextToken) {
      this.bot.setContextToken(msg.contextToken)
    }

    await this.chatQueue.enqueue(chatId, async () => {
      await this.handleMessage(chatId, msg)
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Message handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleMessage(chatId: string, msg: WechatMessage): Promise<void> {
    const userId = msg.fromUserId
    const text = msg.content?.trim() ?? ''

    // Check if text is a command
    const command = parseCommand(text)
    if (command && isKnownCommand(command.command)) {
      await this.handleCommand(chatId, command.command, command.args, userId)
      return
    }

    // Check pairing
    if (!this.isUserPaired(userId)) {
      await this.handlePairing(chatId, text, userId)
      return
    }

    // User is paired — handle as chat message
    await this.handleUserMessage(chatId, text, userId)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Command handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleCommand(
    chatId: string,
    command: string,
    args: string,
    userId: string
  ): Promise<void> {
    switch (command) {
      case 'help': {
        const chunks = splitMessage(formatImHelp(), WECHAT_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(chatId, chunk)
        }
        break
      }

      case 'pair': {
        if (!args) {
          await this.bot.sendTextMessage(chatId, '用法: /pair <配对码>')
          return
        }
        await this.handlePairing(chatId, args, userId)
        break
      }

      case 'unpair': {
        this.pairing.removePairedUser(
          { pairing: this.config.pairing, pairedUsers: this.config.wechat.pairedUsers },
          userId
        )
        saveConfig(this.config)
        await this.bot.sendTextMessage(chatId, '已取消配对')
        break
      }

      case 'new': {
        await this.startNewSession(chatId)
        break
      }

      case 'status': {
        await this.handleStatusCommand(chatId)
        break
      }

      case 'stop': {
        this.bridge.sendStopGeneration(chatId)
        this.typingIndicator.stop(chatId)
        await this.bot.sendTextMessage(chatId, '⏹️ 已请求停止生成')
        break
      }

      case 'clear': {
        this.sessionStore.delete(chatId)
        this.bridge.resetSession(chatId)
        this.clearBuffer(chatId)
        this.pendingPermissions.delete(chatId)
        this.typingIndicator.stop(chatId)
        await this.bot.sendTextMessage(chatId, '🧹 已清空会话')
        break
      }

      case 'resume': {
        await this.bot.sendTextMessage(chatId, '📋 使用 /new 创建新会话')
        break
      }

      case 'provider': {
        await this.bot.sendTextMessage(chatId, '🔧 Provider 切换需要桌面端配置')
        break
      }

      case 'model': {
        await this.bot.sendTextMessage(chatId, '🔧 模型切换需要桌面端配置')
        break
      }

      case 'skills': {
        await this.bot.sendTextMessage(chatId, '📋 技能列表需要桌面端配置')
        break
      }

      case 'cancel': {
        this.pendingPermissions.delete(chatId)
        this.typingIndicator.stop(chatId)
        await this.bot.sendTextMessage(chatId, '✅ 已取消')
        break
      }

      case 'health': {
        await this.bot.sendTextMessage(chatId, '✅ 正常运行')
        break
      }

      case 'projects': {
        await this.handleProjectsCommand(chatId, args)
        break
      }

      default: {
        await this.bot.sendTextMessage(chatId, `未知命令: /${command}`)
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Pairing
  // ────────────────────────────────────────────────────────────────────────

  private async handlePairing(chatId: string, code: string, userId: string): Promise<void> {
    if (this.isUserPaired(userId)) {
      await this.bot.sendTextMessage(chatId, '✅ 已配对')
      return
    }

    const result = this.pairing.tryPair(code, userId, {
      pairing: this.config.pairing,
      pairedUsers: this.config.wechat.pairedUsers,
    })

    if (result.success) {
      this.pairing.addPairedUser(
        { pairing: this.config.pairing, pairedUsers: this.config.wechat.pairedUsers },
        userId
      )
      this.pairing.clearCode({ pairing: this.config.pairing, pairedUsers: this.config.wechat.pairedUsers })
      this.pairing.clearAttempts(userId)
      saveConfig(this.config)
      await this.bot.sendTextMessage(chatId, '✅ 配对成功！使用 /help 查看命令')
    } else {
      const messages: Record<string, string> = {
        expired: '❌ 配对码已过期',
        rate_limited: '❌ 尝试过多',
        mismatch: '❌ 配对码不正确',
        no_code: '❌ 无配对码',
      }
      await this.bot.sendTextMessage(chatId, messages[result.reason ?? 'mismatch'])
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // User message handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleUserMessage(chatId: string, text: string, userId: string): Promise<void> {
    // Check for permission quick-reply
    const pending = this.pendingPermissions.get(chatId)
    if (pending && pending.length > 0) {
      const parsed = parsePermissionCommand(text, pending.length, pending.length === 1 ? pending[0].requestId : undefined)
      if (parsed) {
        const rule = parsed.action === 'always' ? 'always' : undefined
        this.bridge.sendPermissionResponse(chatId, parsed.requestId!, parsed.action !== 'deny', rule)
        await this.bot.sendTextMessage(chatId, `✅ 已${parsed.action === 'deny' ? '拒绝' : '允许'}`)
        return
      }
    }

    // Recover or create session
    const binding = await this.sessionRecovery.recover(chatId)
    if (!binding) {
      const workDir = this.config.wechat.defaultWorkDir || this.config.defaultProjectDir
      await this.createSession(chatId, workDir)
      return
    }

    // Send the message
    this.bridge.sendUserMessage(chatId, text)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Session management
  // ────────────────────────────────────────────────────────────────────────

  private async startNewSession(chatId: string): Promise<void> {
    this.bridge.resetSession(chatId)
    this.clearBuffer(chatId)
    this.pendingPermissions.delete(chatId)
    this.typingIndicator.stop(chatId)

    const workDir = this.config.wechat.defaultWorkDir || this.config.defaultProjectDir
    await this.createSession(chatId, workDir)
  }

  private async createSession(chatId: string, workDir: string): Promise<void> {
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

      await this.bot.sendTextMessage(chatId, `✅ 新会话已创建\n📁 ${workDir}\n🆔 ${sessionId.slice(0, 8)}...`)
    } catch (err) {
      log.error('createSession', `Failed: ${String(err)}`)
      await this.bot.sendTextMessage(chatId, `❌ 创建会话失败: ${String(err)}`)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // ServerMessage handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleServerMessage(chatId: string, msg: ServerMessage): Promise<void> {
    switch (msg.type) {
      case 'connected': {
        log.info('handleServerMessage', `WS connected for ${chatId}`)
        break
      }

      case 'status': {
        if (msg.state === 'streaming' || msg.state === 'thinking') {
          this.typingIndicator.start(chatId)
        } else if (msg.state === 'idle') {
          this.typingIndicator.stop(chatId)
          await this.flushBuffer(chatId)
        }
        break
      }

      case 'content_start': {
        if (msg.blockType === 'text') {
          this.clearBuffer(chatId)
          this.ensureBuffer(chatId)
        }
        break
      }

      case 'content_delta': {
        if (msg.text) {
          this.ensureBuffer(chatId)
          const fullText = this.fullTexts.get(chatId) ?? ''
          this.fullTexts.set(chatId, fullText + msg.text)
          this.messageBuffers.get(chatId)!.append(msg.text)
        }
        break
      }

      case 'tool_use_complete': {
        await this.flushBuffer(chatId)
        const toolText = formatToolUse(msg.toolName, msg.input)
        await this.bot.sendTextMessage(chatId, toolText)
        break
      }

      case 'tool_result': {
        if (msg.isError) {
          await this.bot.sendTextMessage(chatId, `❌ 工具错误: ${msg.content.slice(0, 500)}`)
        }
        break
      }

      case 'permission_request': {
        await this.flushBuffer(chatId)
        const text = formatPermissionRequest(msg.toolName, msg.input, msg.description)
        const chunks = splitMessage(text, WECHAT_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(chatId, chunk)
        }

        const list = this.pendingPermissions.get(chatId) ?? []
        list.push({ requestId: msg.requestId, toolName: msg.toolName })
        this.pendingPermissions.set(chatId, list)
        break
      }

      case 'message_complete': {
        await this.flushBuffer(chatId)
        this.typingIndicator.stop(chatId)

        const usage = msg.usage
        await this.bot.sendTextMessage(chatId, `📊 Token: ↓${usage.inputTokens} ↑${usage.outputTokens}`)
        break
      }

      case 'error': {
        this.typingIndicator.stop(chatId)
        const errorText = `❌ 错误: ${msg.message}`
        const chunks = splitMessage(errorText, WECHAT_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(chatId, chunk)
        }
        break
      }

      case 'api_retry': {
        await this.bot.sendTextMessage(chatId, `🔄 API 重试 (${msg.attempt}/${msg.maxRetries})`)
        break
      }

      default: {
        // Ignore unknown
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Status & projects
  // ────────────────────────────────────────────────────────────────────────

  private async handleStatusCommand(chatId: string): Promise<void> {
    const binding = this.sessionStore.get(chatId)
    const sessionId = this.bridge.getSessionId(chatId)
    const isConnected = this.bridge.isConnected(chatId)

    const state = isConnected ? (sessionId ? 'streaming' : 'idle') : 'idle'
    const status = formatImStatus(state, sessionId ?? 'N/A', binding?.workDir)
    const chunks = splitMessage(status, WECHAT_MSG_MAX_LEN)

    for (const chunk of chunks) {
      await this.bot.sendTextMessage(chatId, chunk)
    }
  }

  private async handleProjectsCommand(chatId: string, args: string): Promise<void> {
    try {
      const projects = await this.httpClient.listRecentProjects()

      if (!args) {
        if (projects.length === 0) {
          await this.bot.sendTextMessage(chatId, '📭 无项目')
          return
        }

        let text = '📋 最近项目:\n'
        projects.forEach((p, i) => {
          text += `${i + 1}. ${p.name}\n`
        })
        text += '\n/projects <编号> 切换'

        const chunks = splitMessage(text, WECHAT_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(chatId, chunk)
        }
      } else {
        const matched = this.httpClient.matchProject(args, projects)
        if (matched === null) {
          await this.bot.sendTextMessage(chatId, '❌ 未找到')
        } else if (matched === 'ambiguous') {
          await this.bot.sendTextMessage(chatId, '❌ 多个匹配')
        } else {
          this.bridge.resetSession(chatId)
          this.clearBuffer(chatId)
          this.pendingPermissions.delete(chatId)
          await this.createSession(chatId, matched.path)
        }
      }
    } catch (err) {
      log.error('handleProjectsCommand', `Failed: ${String(err)}`)
      await this.bot.sendTextMessage(chatId, `❌ ${String(err)}`)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────

  private isUserPaired(userId: string): boolean {
    if (!userId) return false
    return this.pairing.isPaired(userId, {
      pairing: this.config.pairing,
      pairedUsers: this.config.wechat.pairedUsers,
    }, this.config.wechat.allowedUsers)
  }

  private ensureBuffer(chatId: string): void {
    if (!this.messageBuffers.has(chatId)) {
      const buffer = new MessageBuffer(
        {
          onFlush: async (text, isComplete) => {
            if (text.trim()) {
              const chunks = splitMessage(text, WECHAT_MSG_MAX_LEN)
              for (const chunk of chunks) {
                await this.bot.sendTextMessage(chatId, chunk)
              }
            }
            if (isComplete) {
              this.fullTexts.delete(chatId)
            }
          },
        },
        { intervalMs: WECHAT_FLUSH_MS, charThreshold: WECHAT_CHAR_THRESHOLD }
      )
      this.messageBuffers.set(chatId, buffer)
    }
  }

  private async flushBuffer(chatId: string): Promise<void> {
    const buffer = this.messageBuffers.get(chatId)
    if (buffer) {
      await buffer.complete()
      this.messageBuffers.delete(chatId)
      this.fullTexts.delete(chatId)
    }
  }

  private clearBuffer(chatId: string): void {
    const buffer = this.messageBuffers.get(chatId)
    if (buffer) {
      buffer.reset()
      this.messageBuffers.delete(chatId)
    }
    this.fullTexts.delete(chatId)
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
