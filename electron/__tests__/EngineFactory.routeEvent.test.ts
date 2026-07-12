import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IEngine, EngineType } from '../engines/types'

type RouteListener = (sessionId: string, eventType: string, data: any) => void

function makeRouteEngine(type: EngineType): IEngine {
  const routeListeners: RouteListener[] = []
  return {
    type,
    startSession: vi.fn(async () => {}),
    sendMessage: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    getSessionStatus: vi.fn(() => null),
    getActiveSessions: vi.fn(() => []),
    setMainWindow: vi.fn(),
    onRouteEvent: vi.fn((listener: RouteListener) => {
      routeListeners.push(listener)
      return () => {
        const idx = routeListeners.indexOf(listener)
        if (idx >= 0) routeListeners.splice(idx, 1)
      }
    }),
    emit: (sessionId: string, eventType: string, data: any) => {
      for (const listener of routeListeners) {
        listener(sessionId, eventType, data)
      }
    },
  } as IEngine & { emit: RouteListener }
}

const mockState = vi.hoisted(() => {
  const engines: Record<string, IEngine & { emit: RouteListener }> = {}
  return {
    engines,
    reset() {
      for (const k of Object.keys(engines)) delete engines[k]
    },
    getEngine(type: string) {
      return engines[type]
    },
    makeAndStore(type: EngineType) {
      const engine = makeRouteEngine(type) as IEngine & { emit: RouteListener }
      engines[type] = engine
      return engine
    },
  }
})

vi.mock('../engines/ClaudeCodeEngine', () => ({
  ClaudeCodeEngine: class {
    constructor() {
      return mockState.makeAndStore('claude-code')
    }
  },
}))

vi.mock('../engines/PiEngine', () => ({
  PiEngine: class {
    constructor() {
      return mockState.makeAndStore('pi')
    }
  },
}))

describe('EngineFactory.onRouteEvent', () => {
  beforeEach(() => {
    vi.resetModules()
    mockState.reset()
  })

  it('forwards route events from engines created after subscription', async () => {
    const { EngineFactory } = await import('../engines/EngineFactory')
    const received: Array<{ sessionId: string; eventType: string; data: any }> = []

    const unsubscribe = EngineFactory.onRouteEvent((sessionId, eventType, data) => {
      received.push({ sessionId, eventType, data })
    })

    // Engine created AFTER subscription — must still receive events
    const engine = EngineFactory.getEngine('claude-code')
    const mockEngine = mockState.getEngine('claude-code')
    mockEngine.emit('test-session', 'result', { result: 'done' })

    expect(received).toEqual([
      { sessionId: 'test-session', eventType: 'result', data: { result: 'done' } },
    ])
    expect(engine).toBeDefined()

    unsubscribe()
    mockEngine.emit('test-session', 'result', { result: 'after-unsubscribe' })

    expect(received).toHaveLength(1)
  })

  it('forwards route events from engines that already existed at subscription time', async () => {
    const { EngineFactory } = await import('../engines/EngineFactory')

    // Create engine BEFORE subscribing
    EngineFactory.getEngine('claude-code')
    const mockEngine = mockState.getEngine('claude-code')

    const received: Array<{ sessionId: string; eventType: string; data: any }> = []
    const unsubscribe = EngineFactory.onRouteEvent((sessionId, eventType, data) => {
      received.push({ sessionId, eventType, data })
    })

    mockEngine.emit('pre-existing', 'assistant', { text: 'hello' })

    expect(received).toEqual([
      { sessionId: 'pre-existing', eventType: 'assistant', data: { text: 'hello' } },
    ])

    unsubscribe()
  })

  it('does not double-subscribe the same engine', async () => {
    const { EngineFactory } = await import('../engines/EngineFactory')

    EngineFactory.getEngine('claude-code')
    const mockEngine = mockState.getEngine('claude-code')

    const received: string[] = []
    EngineFactory.onRouteEvent((sessionId) => {
      received.push(sessionId)
    })
    EngineFactory.onRouteEvent((sessionId) => {
      received.push(sessionId)
    })

    mockEngine.emit('s1', 'result', {})

    // Two separate subscriptions → two deliveries
    expect(received).toEqual(['s1', 's1'])
  })
})
