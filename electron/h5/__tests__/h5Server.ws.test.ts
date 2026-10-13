// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'http'
import { EventEmitter } from 'events'
import { WebSocket } from 'ws'

/**
 * The WebSocket channel of the H5 server: handshake authorisation, the
 * `connected` greeting, and the fan-out of desktop/engine events to every
 * paired phone.
 *
 * Clients are real `ws` sockets against the real HTTP server, so the handshake,
 * the close codes and the framing are the library's own. The cases that need a
 * socket to *break* (transport error, half-closed peer) drive
 * `handleWsConnection` with a socket double instead, because those states cannot
 * be provoked deterministically over loopback.
 */

vi.mock('electron', async () => {
  const { electronMock } = await import('./h5TestKit')
  return electronMock
})

vi.mock('../../infra/logger', async () => {
  const { loggerStub } = await import('./h5TestKit')
  return loggerStub
})

vi.mock('../../engine/engineGateway', async () => {
  const { gatewayStub } = await import('./h5TestKit')
  return { engineGateway: gatewayStub, NotImplementedError: class NotImplementedError extends Error {} }
})

vi.mock('../../engine/engines/EngineFactory', async () => {
  const { engineFactoryStub } = await import('./h5TestKit')
  return { EngineFactory: engineFactoryStub }
})

vi.mock('../../session/sessionHistoryManager', async () => {
  const { historyStub } = await import('./h5TestKit')
  return { SessionHistoryManager: historyStub }
})

import { H5Server } from '../h5Server'
import {
  TEST_TOKEN,
  auth,
  emitRouteEvent,
  engineFactoryStub,
  loggerStub,
  resetEngineFactoryStub,
  resetGatewayStub,
  resetHistoryStub,
  resetRuntime,
  runtime,
  watchSocket,
  type SocketWatcher,
} from './h5TestKit'

const WRONG_TOKEN = 'h5_wrongtoken0000000000000'

interface SocketDouble extends EventEmitter {
  readyState: number
  sent: string[]
  closed: Array<{ code: number; reason: string }>
  send: (payload: string) => void
  close: (code: number, reason: string) => void
}

function makeSocket(readyState: number): SocketDouble {
  const emitter = new EventEmitter() as SocketDouble
  emitter.readyState = readyState
  emitter.sent = []
  emitter.closed = []
  emitter.send = (payload: string) => {
    emitter.sent.push(payload)
  }
  emitter.close = (code: number, reason: string) => {
    emitter.closed.push({ code, reason })
  }
  return emitter
}

describe('H5Server websocket channel', () => {
  let server: H5Server
  let port = 0
  const clients: SocketWatcher[] = []

  function connect(token: string | null): SocketWatcher {
    const query = token === null ? '' : `?token=${token}`
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`)
    const watcher = watchSocket(ws)
    clients.push(watcher)
    return watcher
  }

  /** Resolves once the socket is gone, whatever the reason. */
  async function settle(client: SocketWatcher): Promise<void> {
    await client.closed()
  }

  beforeEach(async () => {
    resetRuntime()
    resetGatewayStub()
    resetHistoryStub()
    resetEngineFactoryStub()
    server = new H5Server(auth)
    port = (await server.start(0)).port
  })

  afterEach(() => {
    for (const client of clients) {
      if (client.ws.readyState !== WebSocket.CLOSED) client.ws.terminate()
    }
    clients.length = 0
    server.stop()
  })

  describe('handshake', () => {
    it('drops a connection that presents no token', async () => {
      const client = connect(null)

      expect(await client.closed()).toEqual({ code: 4001, reason: 'Unauthorized' })
      expect(server.getStatus().connectedClients).toBe(0)
    })

    it('drops a connection with the wrong token', async () => {
      const client = connect(WRONG_TOKEN)

      expect((await client.closed()).code).toBe(4001)
      expect(auth.validateToken).toHaveBeenCalledWith(WRONG_TOKEN)
    })

    it('accepts the token in the query string and counts the client', async () => {
      const client = connect(TEST_TOKEN)

      expect((await client.next()).type).toBe('connected')
      expect(server.getStatus().connectedClients).toBe(1)
    })

    it('greets a new client with the desktop session it should open', async () => {
      server.setMirrorSession('sess-mirror', '/work/mirror')
      const client = connect(TEST_TOKEN)

      expect(await client.next()).toEqual({
        type: 'connected',
        data: { projectPath: '/work/mirror', sessionId: 'sess-mirror' },
      })
    })

    it('greets a new client with nulls when nothing is mirrored yet', async () => {
      const client = connect(TEST_TOKEN)

      expect(await client.next()).toEqual({
        type: 'connected',
        data: { projectPath: null, sessionId: null },
      })
    })

    it('refuses a peer once the paired token has been cleared', async () => {
      runtime.settings = { ...runtime.settings, token: null }

      const client = connect(TEST_TOKEN)

      expect((await client.closed()).code).toBe(4001)
    })
  })

  describe('push traffic', () => {
    it('forwards a desktop session change to every connected client', async () => {
      const first = connect(TEST_TOKEN)
      const second = connect(TEST_TOKEN)
      await first.next()
      await second.next()

      server.setMirrorSession('sess-2', '/work/two')

      expect(await first.next()).toEqual({
        type: 'session_changed',
        data: { sessionId: 'sess-2', projectPath: '/work/two' },
      })
      expect((await second.next()).type).toBe('session_changed')
    })

    it('forwards engine route events with their session id', async () => {
      const client = connect(TEST_TOKEN)
      await client.next()

      expect(emitRouteEvent('sess-7', 'assistant', { text: 'hi' })).toBe(1)

      expect(await client.next()).toEqual({
        type: 'assistant',
        sessionId: 'sess-7',
        data: { text: 'hi' },
      })
    })

    it('forwards events for sessions that are not the mirrored one', async () => {
      // the client filters by session; the server must not drop the frames
      server.setMirrorSession('sess-mirror', '/work/mirror')
      const client = connect(TEST_TOKEN)
      await client.next()

      emitRouteEvent('sess-other', 'tool', { name: 'bash' })

      expect(await client.next()).toMatchObject({ type: 'tool', sessionId: 'sess-other' })
    })

    it('fans an event out to all peers but only to open ones', async () => {
      const live = connect(TEST_TOKEN)
      await live.next()

      emitRouteEvent('sess-1', 'assistant', { text: 'x' })

      expect((await live.next()).sessionId).toBe('sess-1')
    })
  })

  describe('client messages', () => {
    it('ignores a JSON frame without derailing the socket', async () => {
      const client = connect(TEST_TOKEN)
      await client.next()

      client.ws.send(JSON.stringify({ type: 'ping', data: { now: 1 } }))
      server.setMirrorSession('sess-ping', '/work/ping')

      expect((await client.next()).type).toBe('session_changed')
      await vi.waitFor(() =>
        expect(loggerStub.debug).toHaveBeenCalledWith(
          'H5Server',
          expect.stringContaining('WS message from client: ping'),
        ),
      )
    })

    it('survives a garbage frame', async () => {
      const client = connect(TEST_TOKEN)
      await client.next()

      client.ws.send('<<not json>>')
      server.setMirrorSession('sess-garbage', '/work/garbage')

      expect((await client.next()).type).toBe('session_changed')
      expect(client.ws.readyState).toBe(WebSocket.OPEN)
    })

    it('survives an empty frame', async () => {
      const client = connect(TEST_TOKEN)
      await client.next()

      client.ws.send('')
      server.setMirrorSession(null, null)

      expect((await client.next()).type).toBe('session_changed')
    })
  })

  describe('lifecycle', () => {
    it('removes the client from the roster when it disconnects', async () => {
      const client = connect(TEST_TOKEN)
      await client.next()
      expect(server.getStatus().connectedClients).toBe(1)

      client.ws.close()
      await settle(client)
      // the server prunes its own roster on the matching close event, which
      // lands a tick after the client-side acknowledgement
      await vi.waitFor(() => expect(server.getStatus().connectedClients).toBe(0))

      expect(server.getStatus().connectedClients).toBe(0)
      expect(() => server.setMirrorSession('sess-x', '/work/x')).not.toThrow()
    })

    it('closes live clients with going-away when the server stops', async () => {
      const client = connect(TEST_TOKEN)
      await client.next()
      const closing = client.closed()

      server.stop()

      expect(await closing).toEqual({ code: 1001, reason: 'Server shutting down' })
      expect(server.getStatus()).toMatchObject({ running: false, connectedClients: 0 })
    })

    it('unsubscribes the engine listener when the server stops', async () => {
      const client = connect(TEST_TOKEN)
      await client.next()
      expect(engineFactoryStub.listeners).toHaveLength(1)

      server.stop()

      expect(engineFactoryStub.unsubscribeCalls).toBe(1)
      expect(engineFactoryStub.listeners).toHaveLength(0)
      expect(() => emitRouteEvent('sess-1', 'assistant', {})).not.toThrow()
      server = new H5Server(auth)
    })
  })

  describe('handleWsConnection with a socket double', () => {
    type HandleWs = (ws: WebSocket, req: IncomingMessage) => void

    function privateHandleWs(): HandleWs {
      const target = server as unknown as { handleWsConnection: HandleWs }
      return target.handleWsConnection.bind(target)
    }

    function request(url: string | undefined): IncomingMessage {
      return { url, headers: { host: '127.0.0.1' } } as unknown as IncomingMessage
    }

    function roster(): Set<unknown> {
      return (server as unknown as { clients: Set<unknown> }).clients
    }

    it('closes an unauthorised socket before registering it', () => {
      const ws = makeSocket(WebSocket.OPEN)

      privateHandleWs()(ws as unknown as WebSocket, request('/ws?token=nope'))

      expect(ws.closed).toEqual([{ code: 4001, reason: 'Unauthorized' }])
      expect(ws.sent).toEqual([])
      expect(roster().size).toBe(0)
    })

    it('registers an authorised socket and greets it', () => {
      const ws = makeSocket(WebSocket.OPEN)

      privateHandleWs()(ws as unknown as WebSocket, request(`/ws?token=${TEST_TOKEN}`))

      expect(roster().size).toBe(1)
      expect(ws.sent).toHaveLength(1)
      expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'connected' })
    })

    it('drops the socket from the roster when its transport errors', () => {
      const ws = makeSocket(WebSocket.OPEN)
      privateHandleWs()(ws as unknown as WebSocket, request(`/ws?token=${TEST_TOKEN}`))
      expect(roster().size).toBe(1)

      ws.emit('error', new Error('ECONNRESET'))

      expect(roster().size).toBe(0)
    })

    it('ignores a malformed frame and still prunes the socket on close', () => {
      const ws = makeSocket(WebSocket.OPEN)
      privateHandleWs()(ws as unknown as WebSocket, request(`/ws?token=${TEST_TOKEN}`))

      ws.emit('message', Buffer.from('{"type":'))
      ws.emit('close')

      expect(roster().size).toBe(0)
    })

    it('defaults the request target when the client sent no url', () => {
      const ws = makeSocket(WebSocket.OPEN)

      privateHandleWs()(ws as unknown as WebSocket, { headers: {} } as unknown as IncomingMessage)

      expect(ws.closed).toEqual([{ code: 4001, reason: 'Unauthorized' }])
    })

    it('does not write to a peer that is no longer open', () => {
      const closing = makeSocket(WebSocket.CLOSING)
      privateHandleWs()(closing as unknown as WebSocket, request(`/ws?token=${TEST_TOKEN}`))
      const live = makeSocket(WebSocket.OPEN)
      privateHandleWs()(live as unknown as WebSocket, request(`/ws?token=${TEST_TOKEN}`))
      live.sent = []
      closing.sent = []

      server.setMirrorSession('sess-broadcast', '/work/broadcast')

      expect(live.sent).toHaveLength(1)
      expect(closing.sent).toEqual([])
    })

    it('keeps broadcasting to healthy peers when one peer is dead', () => {
      const dead = makeSocket(WebSocket.CLOSED)
      privateHandleWs()(dead as unknown as WebSocket, request(`/ws?token=${TEST_TOKEN}`))
      const healthy = makeSocket(WebSocket.OPEN)
      privateHandleWs()(healthy as unknown as WebSocket, request(`/ws?token=${TEST_TOKEN}`))
      healthy.sent = []

      expect(() => emitRouteEvent('sess-1', 'assistant', { text: 'x' })).not.toThrow()
      expect(healthy.sent).toHaveLength(1)
    })
  })
})
