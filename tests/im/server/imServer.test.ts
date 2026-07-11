import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import type { ServerMessage } from '@electron/im/adapters/common/types'

// Mock h5EngineService to avoid Electron dependency
vi.mock('@electron/h5EngineService', () => ({
  h5EngineService: {
    startSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    allowPermission: vi.fn().mockResolvedValue(undefined),
    denyPermission: vi.fn().mockResolvedValue(undefined),
    onRouteEvent: vi.fn().mockReturnValue(() => {}),
    getActiveSessions: vi.fn().mockReturnValue([]),
  },
}))

// Mock logger to avoid Electron dependency
vi.mock('@electron/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

import { ImServer } from '@electron/imServer/imServer'

describe('ImServer', () => {
  let server: ImServer
  let baseUrl: string
  let wsUrl: string

  beforeEach(async () => {
    server = new ImServer()
    const { port } = await server.start(0, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${port}`
    wsUrl = `ws://127.0.0.1:${port}`
  })

  afterEach(async () => {
    server.stop()
  })

  describe('HTTP REST API', () => {
    it('GET /health should return server status', async () => {
      const res = await fetch(`${baseUrl}/health`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('ok')
      expect(data.port).toBeGreaterThan(0)
    })

    it('GET /api/adapters should return desensitized config', async () => {
      const res = await fetch(`${baseUrl}/api/adapters`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toHaveProperty('serverUrl')
      expect(data).toHaveProperty('telegram')
      expect(data).toHaveProperty('feishu')
    })

    it('POST /api/sessions should create a session and return token', async () => {
      const res = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: '/tmp/test' }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.sessionId).toBeDefined()
      expect(data.token).toBeDefined()
      expect(data.sessionId).toHaveLength(36) // UUID format
    })

    it('POST /api/sessions should reject missing workDir', async () => {
      const res = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('GET /api/sessions/:id should return 404 for non-existent session', async () => {
      const res = await fetch(`${baseUrl}/api/sessions/non-existent-id`)
      expect(res.status).toBe(404)
    })

    it('GET /api/sessions/:id should return session info for existing session', async () => {
      // Create a session first
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: '/tmp/test' }),
      })
      const { sessionId } = await createRes.json()

      // Check it exists
      const res = await fetch(`${baseUrl}/api/sessions/${sessionId}`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.sessionId).toBe(sessionId)
      expect(data.workDir).toBe('/tmp/test')
    })
  })

  describe('WebSocket', () => {
    it('should reject WS connection without token', async () => {
      // Create a session first
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: '/tmp/test' }),
      })
      const { sessionId } = await createRes.json()

      // Try to connect without token
      const ws = new WebSocket(`${wsUrl}/ws/${sessionId}?proto=v1`)
      const closed = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code))
      })
      ws.on('error', () => {}) // suppress unhandled error

      const closeCode = await closed
      expect(closeCode).toBe(1008) // policy violation
    })

    it('should reject WS connection with wrong token', async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: '/tmp/test' }),
      })
      const { sessionId } = await createRes.json()

      const ws = new WebSocket(`${wsUrl}/ws/${sessionId}?proto=v1&token=wrong-token`)
      const closed = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code))
      })
      ws.on('error', () => {})

      const closeCode = await closed
      expect(closeCode).toBe(1008)
    })

    it('should accept WS connection with correct token and send connected message', async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: '/tmp/test' }),
      })
      const { sessionId, token } = await createRes.json()

      const ws = new WebSocket(`${wsUrl}/ws/${sessionId}?proto=v1&token=${token}`)

      const firstMessage = await new Promise<ServerMessage>((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()) as ServerMessage)
        })
        ws.on('error', () => {})
      })

      expect(firstMessage.type).toBe('connected')
      expect(firstMessage).toHaveProperty('sessionId', sessionId)

      ws.close()
    })

    it('should reject unsupported protocol version', async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: '/tmp/test' }),
      })
      const { sessionId, token } = await createRes.json()

      const ws = new WebSocket(`${wsUrl}/ws/${sessionId}?proto=v99&token=${token}`)
      const closed = new Promise<number>((resolve) => {
        ws.on('close', (code) => resolve(code))
      })
      ws.on('error', () => {})

      const closeCode = await closed
      expect(closeCode).toBe(1011) // internal error (unsupported version)
    })

    it('should handle user_message via WS', async () => {
      const createRes = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDir: '/tmp/test' }),
      })
      const { sessionId, token } = await createRes.json()

      const ws = new WebSocket(`${wsUrl}/ws/${sessionId}?proto=v1&token=${token}`)

      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve())
      })

      ws.send(JSON.stringify({ type: 'user_message', content: 'hello' }))

      // Wait a bit for the message to be processed
      await new Promise((r) => setTimeout(r, 100))

      // The mock h5EngineService.sendMessage should have been called
      const { h5EngineService } = await import('@electron/h5EngineService')
      expect(h5EngineService.sendMessage).toHaveBeenCalledWith(sessionId, 'hello')

      ws.close()
    })
  })
})
