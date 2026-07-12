/**
 * ImServer — HTTP+WS server for IM adapter communication
 *
 * Provides:
 * - /ws/:sessionId  — client channel (IM adapters connect here, token auth required)
 * - /sdk/:sessionId — SDK channel (CLI subprocess connects here, token auth required)
 * - /api/*          — REST API for sessions, adapters config, etc.
 *
 * Security:
 * - Default bind: 127.0.0.1 (localhost only)
 * - Client channel: requires token from query param ?token= or Sec-WebSocket-Protocol
 * - Protocol version negotiation: ?proto=v1
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import { info, warn, error as logError } from '../logger'
import { engineGateway } from '../engineGateway'
import { EngineFactory } from '../engines/EngineFactory'
import { translateEngineEvent } from './engineTranslator'
import {
  loadConfig,
  saveConfig,
  desensitizeConfig,
  getClaudeConfigDir,
} from '../im/adapters/common/config'
import type { AdapterConfig } from '../im/adapters/common/config'
import type { ClientMessage, ServerMessage } from '../im/adapters/common/types'
import type { EngineSessionConfig, UnifiedEngineEvent } from '../engines/types'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

interface ClientConnection {
  ws: WebSocket
  sessionId: string
  token: string
}

interface SessionRecord {
  sessionId: string
  token: string
  workDir: string
  clientWs: WebSocket | null
}

interface PersistedProviderConfig {
  baseUrl?: string
  apiKey?: string
  sonnetModel?: string
}

interface PersistedGuiSettings {
  authMethod?: 'anthropic_compatible' | 'openai_compatible' | 'gemini_api' | 'claudeai' | 'console'
  anthropicConfig?: PersistedProviderConfig
  openaiConfig?: PersistedProviderConfig
  geminiConfig?: PersistedProviderConfig
  thinkingEnabled?: boolean
  effortLevel?: string
  engineType?: EngineSessionConfig['engineType']
  engineSource?: EngineSessionConfig['engineSource']
  installedCliPath?: string
  modelContextWindows?: Record<string, number>
  rtkEnabled?: boolean
}

// ──────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────

const SESSION_ID_RE = /^[0-9a-zA-Z_-]{1,64}$/
const SUPPORTED_PROTOCOL_VERSIONS = ['v1']
const DEFAULT_PROTOCOL_VERSION = 'v1'

function loadEngineSessionConfig(cwd: string): EngineSessionConfig {
  const config: EngineSessionConfig = { cwd }

  try {
    const settingsPath = join(getClaudeConfigDir(), 'gui-settings.json')
    if (!existsSync(settingsPath)) return config

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as PersistedGuiSettings
    let providerConfig: PersistedProviderConfig | undefined

    switch (settings.authMethod) {
      case 'anthropic_compatible':
        config.provider = 'anthropic'
        providerConfig = settings.anthropicConfig
        break
      case 'openai_compatible':
        config.provider = 'openai'
        providerConfig = settings.openaiConfig
        break
      case 'gemini_api':
        config.provider = 'gemini'
        providerConfig = settings.geminiConfig
        break
      case 'claudeai':
      case 'console':
        config.provider = 'anthropic'
        break
    }

    if (providerConfig?.sonnetModel) config.model = providerConfig.sonnetModel
    if (providerConfig?.apiKey) config.apiKey = providerConfig.apiKey
    if (providerConfig?.baseUrl) config.baseUrl = providerConfig.baseUrl
    if (typeof settings.thinkingEnabled === 'boolean') config.thinkingEnabled = settings.thinkingEnabled
    if (settings.effortLevel) config.effortLevel = settings.effortLevel
    if (settings.engineType) config.engineType = settings.engineType
    if (settings.engineSource) config.engineSource = settings.engineSource
    if (settings.installedCliPath) config.installedCliPath = settings.installedCliPath
    if (settings.modelContextWindows) config.modelContextWindows = settings.modelContextWindows
    if (typeof settings.rtkEnabled === 'boolean') config.rtkEnabled = settings.rtkEnabled
  } catch (err) {
    warn('ImServer', `Failed to load GUI settings for IM session: ${String(err)}`)
  }

  return config
}

// ──────────────────────────────────────────────────────────────────────────
// ImServer
// ──────────────────────────────────────────────────────────────────────────

export class ImServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private wsServer: WebSocketServer | null = null
  private sessions: Map<string, SessionRecord> = new Map()
  private port: number = 0
  private unsubEngineEvents: (() => void) | null = null

  /**
   * Start the IM server.
   * @param port Port to listen on (0 = random available port)
   * @param host Host to bind to (default: 127.0.0.1)
   */
  async start(port: number = 0, host: string = '127.0.0.1'): Promise<{ port: number; host: string }> {
    if (this.httpServer) {
      throw new Error('IM Server is already running')
    }

    this.httpServer = createServer((req, res) => this.handleHttp(req, res))

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on('error', reject)
      this.httpServer!.listen(port, host, () => {
        const addr = this.httpServer!.address()
        this.port = typeof addr === 'object' && addr ? addr.port : port
        info('ImServer', `HTTP server listening on ${host}:${this.port}`)
        resolve()
      })
    })

    // WebSocket server — handles both /ws/:sessionId and /sdk/:sessionId
    this.wsServer = new WebSocketServer({ server: this.httpServer })
    this.wsServer.on('connection', (ws, req) => this.handleWsConnection(ws, req))

    // Subscribe to engine events
    this.unsubEngineEvents = EngineFactory.onRouteEvent((sessionId, eventType, data) => {
      this.handleEngineEvent(sessionId, eventType, data)
    })

    return { port: this.port, host }
  }

  /** Stop the IM server. */
  stop(): void {
    if (this.unsubEngineEvents) {
      this.unsubEngineEvents()
      this.unsubEngineEvents = null
    }

    // Close all client connections
    for (const [, record] of this.sessions) {
      if (record.clientWs && record.clientWs.readyState === WebSocket.OPEN) {
        record.clientWs.close(1000, 'server shutting down')
      }
    }
    this.sessions.clear()

    if (this.wsServer) {
      this.wsServer.close()
      this.wsServer = null
    }

    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }

    info('ImServer', 'Server stopped')
  }

  /** Get the port the server is listening on. */
  getPort(): number {
    return this.port
  }

  // ────────────────────────────────────────────────────────────────────────
  // HTTP REST API
  // ────────────────────────────────────────────────────────────────────────

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`)
    const path = url.pathname
    const method = req.method ?? 'GET'

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    // Route matching
    if (path === '/api/sessions' && method === 'POST') {
      this.handleCreateSession(req, res)
    } else if (path.startsWith('/api/sessions/') && method === 'GET') {
      this.handleCheckSession(req, res, path)
    } else if (path === '/api/adapters' && method === 'GET') {
      this.handleGetAdapters(res)
    } else if (path === '/api/adapters' && method === 'PUT') {
      this.handleUpdateAdapters(req, res)
    } else if (path === '/api/sessions/recent-projects' && method === 'GET') {
      this.handleListRecentProjects(res)
    } else if (path === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', port: this.port, sessions: this.sessions.size }))
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  }

  /** POST /api/sessions — Create a new Claude session */
  private async handleCreateSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req)
      const { workDir } = JSON.parse(body) as { workDir: string }

      if (!workDir) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'workDir is required' }))
        return
      }

      const sessionId = randomUUID()
      const token = randomUUID()

      // Start the engine session
      const config = loadEngineSessionConfig(workDir)
      await engineGateway.startSession(sessionId, config)

      // Store session record
      this.sessions.set(sessionId, {
        sessionId,
        token,
        workDir,
        clientWs: null,
      })

      info('ImServer', `Session created: ${sessionId} (workDir: ${workDir})`)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessionId, token }))
    } catch (err) {
      logError('ImServer', `Failed to create session: ${err}`)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Failed to create session', message: String(err) }))
    }
  }

  /** GET /api/sessions/:id — Check if session exists */
  private handleCheckSession(req: IncomingMessage, res: ServerResponse, path: string): void {
    const sessionId = path.split('/').pop() ?? ''

    if (!SESSION_ID_RE.test(sessionId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid session ID' }))
      return
    }

    const exists = this.sessions.has(sessionId)
    if (exists) {
      const record = this.sessions.get(sessionId)!
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessionId, workDir: record.workDir }))
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
    }
  }

  /** GET /api/adapters — Get adapter config (desensitized) */
  private handleGetAdapters(res: ServerResponse): void {
    try {
      const config = loadConfig()
      const desensitized = desensitizeConfig(config)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(desensitized))
    } catch (err) {
      logError('ImServer', `Failed to get adapters config: ${err}`)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Failed to read config' }))
    }
  }

  /** PUT /api/adapters — Update adapter config (shallow merge) */
  private async handleUpdateAdapters(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await this.readBody(req)
      const updates = JSON.parse(body) as Partial<AdapterConfig>

      const current = loadConfig()

      // Shallow merge with whitelist of top-level keys
      const whitelist: (keyof AdapterConfig)[] = [
        'serverUrl', 'defaultProjectDir', 'pairing',
        'telegram', 'feishu', 'dingtalk', 'wechat', 'whatsapp',
      ]

      for (const key of whitelist) {
        if (key in updates) {
          ;(current[key] as unknown) = updates[key]
        }
      }

      saveConfig(current)

      const desensitized = desensitizeConfig(current)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(desensitized))
    } catch (err) {
      logError('ImServer', `Failed to update adapters config: ${err}`)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Failed to update config' }))
    }
  }

  /** GET /api/sessions/recent-projects — List recent projects */
  private async handleListRecentProjects(res: ServerResponse): Promise<void> {
    try {
      const sessions = engineGateway.getActiveSessions()
      const projects = sessions.map((s: { sessionId: string; cwd?: string }) => ({
        name: s.cwd ? s.cwd.split(/[/\\]/).pop() ?? s.cwd : 'unknown',
        path: s.cwd ?? '',
      }))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(projects))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Failed to list projects' }))
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // WebSocket handler
  // ────────────────────────────────────────────────────────────────────────

  private handleWsConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.port}`)
    const path = url.pathname

    // Parse path: /ws/:sessionId (client) or /sdk/:sessionId (sdk)
    const parts = path.split('/').filter(Boolean)
    if (parts.length < 2 || (parts[0] !== 'ws' && parts[0] !== 'sdk')) {
      ws.close(1008, 'Invalid path')
      return
    }

    const channel = parts[0] as 'ws' | 'sdk'
    const sessionId = parts[1]

    if (!SESSION_ID_RE.test(sessionId)) {
      ws.close(1008, 'Invalid session ID')
      return
    }

    // Protocol version negotiation
    const protoVersion = url.searchParams.get('proto') ?? DEFAULT_PROTOCOL_VERSION
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(protoVersion)) {
      ws.close(1011, 'Unsupported protocol version')
      return
    }

    // Token authentication
    const token = url.searchParams.get('token')
    if (!token) {
      ws.close(1008, 'Missing token')
      return
    }

    const session = this.sessions.get(sessionId)
    if (!session || session.token !== token) {
      ws.close(1008, 'Invalid token')
      return
    }

    if (channel === 'ws') {
      // Client channel — IM adapter connects
      this.handleClientConnection(ws, session)
    } else {
      // SDK channel — CLI subprocess connects (not used in current architecture
      // since we use the Engine abstraction, but kept for compatibility)
      ws.close(1008, 'SDK channel not supported in this architecture')
    }
  }

  private handleClientConnection(ws: WebSocket, session: SessionRecord): void {
    session.clientWs = ws

    // Send connected message
    this.sendToClient(session, { type: 'connected', sessionId: session.sessionId })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        this.handleClientMessage(session, msg)
      } catch (err) {
        logError('ImServer', `Failed to parse client message: ${err}`)
      }
    })

    ws.on('close', () => {
      if (session.clientWs === ws) {
        session.clientWs = null
      }
      info('ImServer', `Client disconnected: ${session.sessionId}`)
    })

    ws.on('error', (err) => {
      logError('ImServer', `Client WS error: ${err.message}`)
    })

    info('ImServer', `Client connected: ${session.sessionId}`)
  }

  private async handleClientMessage(session: SessionRecord, msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'user_message': {
          await engineGateway.sendMessage(session.sessionId, msg.content)
          break
        }

        case 'permission_response': {
          if (msg.allowed) {
            await engineGateway.allowPermission(
              session.sessionId,
              msg.requestId,
              undefined,
              msg.rule === 'always' ? 'user_permanent' : 'user_temporary'
            )
          } else {
            await engineGateway.denyPermission(session.sessionId, msg.requestId, 'User denied')
          }
          break
        }

        case 'stop_generation': {
          await engineGateway.stop(session.sessionId)
          break
        }

        case 'ping': {
          // Ping is handled by WS protocol — no action needed
          break
        }

        default: {
          warn('ImServer', `Unknown message type: ${(msg as { type: string }).type}`)
        }
      }
    } catch (err) {
      logError('ImServer', `Failed to handle client message: ${err}`)
      this.sendToClient(session, {
        type: 'error',
        message: String(err),
        code: 'MESSAGE_HANDLER_ERROR',
      })
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Engine event handler
  // ────────────────────────────────────────────────────────────────────────

  private handleEngineEvent(sessionId: string, eventType: string, data: unknown): void {
    const session = this.sessions.get(sessionId)
    if (!session || !session.clientWs || session.clientWs.readyState !== WebSocket.OPEN) {
      return
    }

    const event = { sessionId, type: eventType as UnifiedEngineEvent['type'], data }
    const messages = translateEngineEvent(event)

    for (const msg of messages) {
      this.sendToClient(session, msg)
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────

  private sendToClient(session: SessionRecord, msg: ServerMessage): void {
    if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      session.clientWs.send(JSON.stringify(msg))
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => resolve(body))
      req.on('error', reject)
    })
  }
}
