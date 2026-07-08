import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  type RouteListener = (sessionId: string, eventType: string, data: any) => void
  type Engine = {
    type: string
    onRouteEvent?: (listener: RouteListener) => () => void
    emit?: RouteListener
  }

  const engines: Engine[] = []
  const engineCreatedListeners: Array<(engine: Engine) => void> = []

  function makeRouteEngine(type = 'claude-code'): Engine {
    const routeListeners: RouteListener[] = []
    return {
      type,
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
    }
  }

  return {
    engines,
    engineCreatedListeners,
    makeRouteEngine,
    reset() {
      engines.splice(0)
      engineCreatedListeners.splice(0)
    },
    addEngine(engine: Engine) {
      engines.push(engine)
      for (const listener of engineCreatedListeners) {
        listener(engine)
      }
    },
  }
})

vi.mock('../engines/EngineFactory', () => ({
  EngineFactory: {
    getAllEngines: () => mockState.engines,
    onEngineCreated: (listener: (engine: any) => void) => {
      mockState.engineCreatedListeners.push(listener)
      return () => {
        const idx = mockState.engineCreatedListeners.indexOf(listener)
        if (idx >= 0) mockState.engineCreatedListeners.splice(idx, 1)
      }
    },
    getEngine: vi.fn(),
  },
}))

describe('h5EngineService route events', () => {
  beforeEach(() => {
    vi.resetModules()
    mockState.reset()
  })

  it('forwards route events from engines created after the H5 server subscribes', async () => {
    const { h5EngineService } = await import('../h5EngineService')
    const received: Array<{ sessionId: string; eventType: string; data: any }> = []

    const unsubscribe = h5EngineService.onRouteEvent((sessionId, eventType, data) => {
      received.push({ sessionId, eventType, data })
    })

    const engine = mockState.makeRouteEngine()
    mockState.addEngine(engine)
    engine.emit?.('h5-session', 'result', { result: 'done' })

    expect(received).toEqual([
      { sessionId: 'h5-session', eventType: 'result', data: { result: 'done' } },
    ])

    unsubscribe()
    engine.emit?.('h5-session', 'result', { result: 'after-unsubscribe' })

    expect(received).toHaveLength(1)
  })
})
