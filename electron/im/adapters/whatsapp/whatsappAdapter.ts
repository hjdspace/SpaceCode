/**
 * WhatsappAdapter — Main WhatsApp adapter
 *
 * WhatsApp characteristics:
 * - Baileys WhatsApp Web protocol (or Business API)
 * - Accumulated + one-shot send (no streaming)
 * - Presence (composing) indicator
 * - Plain text permission
 * - Media upload via sendMediaMessage
 *
 * Golden path:
 * 1. User sends /pair → pairing code validation
 * 2. User sends text → ChatQueue → SessionRecovery → WsBridge.sendUserMessage
 * 3. Engine streams → WsBridge → accumulate → one-shot send on complete
 * 4. Permission request → plain text → quick reply
 * 5. User sends /projects → list/switch
 */

import type { WhatsappBot, WhatsappMessage } from './whatsappBot'
import { WhatsappMediaHandler } from './mediaHandler'
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
  formatPermissionRequest,
  splitMessage,
} from '../common/format'
import { parsePermissionCommand } from '../common/permission'
import type { ServerMessage, SessionBinding } from '../common/types'
import { createLogger } from '../common/logger'

const log = createLogger('WhatsappAdapter')

const WHATSAPP_MSG_MAX_LEN = 65536

export interface WhatsappAdapterOptions {
  bot: WhatsappBot
  config?: AdapterConfig
  serverUrl?: string
  authToken?: string
  attachmentDir?: string
  sessionStorePath?: string
}

export class WhatsappAdapter {
  private bot: WhatsappBot
  private bridge: WsBridge
  private chatQueue: ChatQueue
  private sessionStore: SessionStore
  private sessionRecovery: SessionRecovery
  private messageDedup: MessageDedup
  private pairing: Pairing
  private httpClient: HttpClient
  private mediaHandler: WhatsappMediaHandler
  private config: AdapterConfig
  private readonly serverUrl: string
  private fullTexts: Map<string, string> = new Map()
  private pendingPermissions: Map<string, Array<{ requestId: string; toolName: string }>> = new Map()
  private running: boolean = false
  private recoveryChatId: string = ''

  constructor(opts: WhatsappAdapterOptions) {
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
    this.mediaHandler = new WhatsappMediaHandler(this.bot, opts.attachmentDir ?? resolveUserDefaultWorkDir())

    // Register message handler
    this.bot.onMessage((msg) => this.handleIncomingMessage(msg))
  }

  // ────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return

    await this.bot.start()

    if (!this.bot.isConnected()) {
      log.info('start', 'WhatsApp needs QR scan')
    }

    this.running = true
    log.info('start', 'Adapter started')
  }

  async stop(): Promise<void> {
    this.running = false
    this.messageDedup.stopSweep()
    this.bridge.destroy()
    log.info('stop', 'Adapter stopped')
  }

  // ────────────────────────────────────────────────────────────────────────
  // Incoming message handling
  // ────────────────────────────────────────────────────────────────────────

  private async handleIncomingMessage(msg: WhatsappMessage): Promise<void> {
    // Ignore own messages
    if (msg.key.fromMe) return

    const chatId = msg.key.remoteJid
    const msgId = msg.key.id

    // Dedup
    if (!this.messageDedup.tryRecord(msgId)) return

    await this.chatQueue.enqueue(chatId, async () => {
      await this.handleMessage(chatId, msg)
    })
  }

  private async handleMessage(chatId: string, msg: WhatsappMessage): Promise<void> {
    const userId = chatId
    const displayName = msg.pushName ?? ''

    // Extract text and media
    let text = ''
    let imageUrl: string | null = null
    let imageMime: string | null = null
    let docUrl: string | null = null
    let docName: string | null = null
    let docMime: string | null = null

    const m = msg.message
    if (m) {
      if (m.conversation) {
        text = m.conversation
      } else if (m.extendedTextMessage) {
        text = m.extendedTextMessage.text
      } else if (m.imageMessage) {
        imageUrl = m.imageMessage.url
        imageMime = m.imageMessage.mimetype
        text = m.imageMessage.caption ?? ''
      } else if (m.documentMessage) {
        docUrl = m.documentMessage.url
        docName = m.documentMessage.fileName
        docMime = m.documentMessage.mimetype
      }
    }

    // Check if text is a command
    const command = parseCommand(text)
    if (command && isKnownCommand(command.command)) {
      await this.handleCommand(chatId, command.command, command.args, userId)
      return
    }

    // Check pairing
    if (!this.isUserPaired(userId)) {
      await this.handlePairing(chatId, text, userId, displayName)
      return
    }

    // Handle media
    const attachments: Array<{ type: 'image' | 'file'; name?: string; path?: string; mimeType?: string }> = []
    if (imageUrl && imageMime) {
      const media = await this.mediaHandler.downloadImage(imageUrl, imageMime)
      if (media) {
        attachments.push(this.mediaHandler.toAttachmentRef(media))
      }
    }
    if (docUrl && docName && docMime) {
      const media = await this.mediaHandler.downloadDocument(docUrl, docName, docMime)
      if (media) {
        attachments.push(this.mediaHandler.toAttachmentRef(media))
      }
    }

// Recover or create session
this.recoveryChatId = chatId
const binding = await this.sessionRecovery.recover(chatId)
if (!binding) {
const workDir = this.config.whatsapp.defaultWorkDir || this.config.defaultProjectDir
await this.createSession(chatId, workDir)
// Send the user's message after session creation
this.bridge.sendUserMessage(chatId, text)
return
}

    // Send the message
    this.bridge.sendUserMessage(chatId, text)
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
        const chunks = splitMessage(formatImHelp(), WHATSAPP_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(chatId, chunk)
        }
        break
      }

      case 'pair': {
        if (!args) {
          await this.bot.sendTextMessage(chatId, 'Usage: /pair <code>')
          return
        }
        await this.handlePairing(chatId, args, userId, '')
        break
      }

      case 'unpair': {
        this.pairing.removePairedUser(
          { pairing: this.config.pairing, pairedUsers: this.config.whatsapp.pairedUsers },
          userId
        )
        saveConfig(this.config)
        await this.bot.sendTextMessage(chatId, 'Unpaired')
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
        await this.bot.sendTextMessage(chatId, '⏹️ Stopped')
        break
      }

      case 'clear': {
        this.sessionStore.delete(chatId)
        this.bridge.resetSession(chatId)
        this.fullTexts.delete(chatId)
        this.pendingPermissions.delete(chatId)
        await this.bot.sendTextMessage(chatId, '🧹 Cleared')
        break
      }

      case 'resume': {
        await this.bot.sendTextMessage(chatId, '📋 Use /new to create a session')
        break
      }

      case 'provider': {
        await this.bot.sendTextMessage(chatId, '🔧 Configure in desktop')
        break
      }

      case 'model': {
        await this.bot.sendTextMessage(chatId, '🔧 Configure in desktop')
        break
      }

      case 'skills': {
        await this.bot.sendTextMessage(chatId, '📋 Configure in desktop')
        break
      }

      case 'cancel': {
        this.pendingPermissions.delete(chatId)
        await this.bot.sendTextMessage(chatId, '✅ Cancelled')
        break
      }

      case 'health': {
        await this.bot.sendTextMessage(chatId, '✅ Healthy')
        break
      }

      case 'projects': {
        await this.handleProjectsCommand(chatId, args)
        break
      }

      default: {
        await this.bot.sendTextMessage(chatId, `Unknown: /${command}`)
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
    if (this.isUserPaired(userId)) {
      await this.bot.sendTextMessage(chatId, '✅ Already paired')
      return
    }

    const result = this.pairing.tryPair(code, userId, {
      pairing: this.config.pairing,
      pairedUsers: this.config.whatsapp.pairedUsers,
    })

    if (result.success) {
      this.pairing.addPairedUser(
        { pairing: this.config.pairing, pairedUsers: this.config.whatsapp.pairedUsers },
        userId,
        displayName
      )
      this.pairing.clearCode({ pairing: this.config.pairing, pairedUsers: this.config.whatsapp.pairedUsers })
      this.pairing.clearAttempts(userId)
      saveConfig(this.config)
      await this.bot.sendTextMessage(chatId, '✅ Paired! Use /help for commands')
    } else {
      const messages: Record<string, string> = {
        expired: '❌ Code expired',
        rate_limited: '❌ Too many attempts',
        mismatch: '❌ Wrong code',
        no_code: '❌ No active code',
      }
      await this.bot.sendTextMessage(chatId, messages[result.reason ?? 'mismatch'])
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Session management
  // ────────────────────────────────────────────────────────────────────────

  private async startNewSession(chatId: string): Promise<void> {
    this.bridge.resetSession(chatId)
    this.fullTexts.delete(chatId)
    this.pendingPermissions.delete(chatId)

    const workDir = this.config.whatsapp.defaultWorkDir || this.config.defaultProjectDir
    await this.createSession(chatId, workDir)
  }

  private async createSession(chatId: string, workDir: string): Promise<void> {
    try {
      const { sessionId, token } = await this.httpClient.createSession(workDir)

      this.sessionStore.set(chatId, { sessionId, workDir })

    this.bridge = new WsBridge({
      serverUrl: this.serverUrl,
      authToken: token,
    })
      this.bridge.startHeartbeat()

      this.bridge.onServerMessage(chatId, (msg) => this.handleServerMessage(chatId, msg))
      await this.bridge.connectSession(chatId, sessionId, workDir)

      await this.bot.sendTextMessage(chatId, `✅ New session\n📁 ${workDir}\n🆔 ${sessionId.slice(0, 8)}...`)
    } catch (err) {
      log.error('createSession', `Failed: ${String(err)}`)
      await this.bot.sendTextMessage(chatId, `❌ Failed: ${String(err)}`)
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
          // Send composing presence
          await this.bot.sendPresence(chatId, 'composing')
        } else if (msg.state === 'idle') {
          // Flush accumulated text
          await this.flushText(chatId)
        }
        break
      }

      case 'content_start': {
        if (msg.blockType === 'text') {
          this.fullTexts.delete(chatId)
        }
        break
      }

      case 'content_delta': {
        if (msg.text) {
          const current = this.fullTexts.get(chatId) ?? ''
          this.fullTexts.set(chatId, current + msg.text)
        }
        break
      }

      case 'tool_use_complete': {
        await this.flushText(chatId)
        const toolText = formatToolUse(msg.toolName, msg.input)
        await this.bot.sendTextMessage(chatId, toolText)
        break
      }

      case 'tool_result': {
        if (msg.isError) {
          await this.bot.sendTextMessage(chatId, `❌ Error: ${msg.content.slice(0, 500)}`)
        }
        break
      }

      case 'permission_request': {
        await this.flushText(chatId)
        const text = formatPermissionRequest(msg.toolName, msg.input, msg.description)
        await this.bot.sendTextMessage(chatId, text)

        const list = this.pendingPermissions.get(chatId) ?? []
        list.push({ requestId: msg.requestId, toolName: msg.toolName })
        this.pendingPermissions.set(chatId, list)
        break
      }

      case 'message_complete': {
        await this.flushText(chatId)
        const usage = msg.usage
        await this.bot.sendTextMessage(chatId, `📊 Token: ↓${usage.inputTokens} ↑${usage.outputTokens}`)
        break
      }

      case 'error': {
        const errorText = `❌ Error: ${msg.message}`
        const chunks = splitMessage(errorText, WHATSAPP_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(chatId, chunk)
        }
        break
      }

      case 'api_retry': {
        await this.bot.sendTextMessage(chatId, `🔄 API retry (${msg.attempt}/${msg.maxRetries})`)
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
    const chunks = splitMessage(status, WHATSAPP_MSG_MAX_LEN)

    for (const chunk of chunks) {
      await this.bot.sendTextMessage(chatId, chunk)
    }
  }

  private async handleProjectsCommand(chatId: string, args: string): Promise<void> {
    try {
      const projects = await this.httpClient.listRecentProjects()

      if (!args) {
        if (projects.length === 0) {
          await this.bot.sendTextMessage(chatId, '📭 No projects')
          return
        }

        let text = '📋 Recent projects:\n'
        projects.forEach((p, i) => {
          text += `${i + 1}. ${p.name}\n`
        })
        text += '\n/projects <number> to switch'

        const chunks = splitMessage(text, WHATSAPP_MSG_MAX_LEN)
        for (const chunk of chunks) {
          await this.bot.sendTextMessage(chatId, chunk)
        }
      } else {
        const matched = this.httpClient.matchProject(args, projects)
        if (matched === null) {
          await this.bot.sendTextMessage(chatId, '❌ Not found')
        } else if (matched === 'ambiguous') {
          await this.bot.sendTextMessage(chatId, '❌ Ambiguous')
        } else {
          this.bridge.resetSession(chatId)
          this.fullTexts.delete(chatId)
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
      pairedUsers: this.config.whatsapp.pairedUsers,
    }, this.config.whatsapp.allowedUsers)
  }

  /** Flush accumulated text to the user. */
  private async flushText(chatId: string): Promise<void> {
    const text = this.fullTexts.get(chatId)
    if (text && text.trim()) {
      const chunks = splitMessage(text, WHATSAPP_MSG_MAX_LEN)
      for (const chunk of chunks) {
        await this.bot.sendTextMessage(chatId, chunk)
      }
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
