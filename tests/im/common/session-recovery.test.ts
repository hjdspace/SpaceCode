import { describe, it, expect, vi } from 'vitest'
import { SessionRecovery } from '@electron/im/adapters/common/session-recovery'
import type { RecoverySessionStore, RecoveryBridge, RecoveryHttpClient } from '@electron/im/adapters/common/session-recovery'

function createMocks(overrides?: {
  stored?: { sessionId: string; workDir: string } | null
  bridgeSessionId?: string | null
  bridgeConnected?: boolean
  sessionExists?: boolean
}) {
  const stored = overrides?.stored ?? null
  const bridgeSessionId = overrides?.bridgeSessionId ?? null
  const bridgeConnected = overrides?.bridgeConnected ?? false
  const sessionExists = overrides?.sessionExists ?? true

  const store: RecoverySessionStore = {
    get: vi.fn().mockReturnValue(stored),
    delete: vi.fn(),
  }

  const bridge: RecoveryBridge = {
    sessionId: bridgeSessionId,
    isConnected: bridgeConnected,
    connectSession: vi.fn().mockResolvedValue(undefined),
    resetSession: vi.fn(),
  }

  const httpClient: RecoveryHttpClient = {
    sessionExists: vi.fn().mockResolvedValue(sessionExists),
  }

  return { store, bridge, httpClient }
}

describe('SessionRecovery', () => {
  it('should return null when no stored binding exists', async () => {
    const { store, bridge, httpClient } = createMocks({ stored: null })
    const recovery = new SessionRecovery({ store, bridge, httpClient })

    const result = await recovery.recover('chat1')

    expect(result).toBeNull()
    expect(bridge.resetSession).not.toHaveBeenCalled()
  })

  it('should reset stale bridge when no stored binding exists but bridge has old session', async () => {
    const { store, bridge, httpClient } = createMocks({
      stored: null,
      bridgeSessionId: 'old-session',
    })
    const recovery = new SessionRecovery({ store, bridge, httpClient })

    const result = await recovery.recover('chat1')

    expect(result).toBeNull()
    expect(bridge.resetSession).toHaveBeenCalled()
  })

  it('should reset bridge if sessionId differs from stored', async () => {
    const { store, bridge, httpClient } = createMocks({
      stored: { sessionId: 'new-session', workDir: '/tmp/work' },
      bridgeSessionId: 'old-session',
      bridgeConnected: true,
    })
    const recovery = new SessionRecovery({ store, bridge, httpClient })

    await recovery.recover('chat1')

    expect(bridge.resetSession).toHaveBeenCalled()
  })

  it('should skip HTTP check if bridge is already OPEN for the same session', async () => {
    const { store, bridge, httpClient } = createMocks({
      stored: { sessionId: 'sess1', workDir: '/tmp/work' },
      bridgeSessionId: 'sess1',
      bridgeConnected: true,
    })
    const recovery = new SessionRecovery({ store, bridge, httpClient })

    const result = await recovery.recover('chat1')

    expect(result).toEqual({ sessionId: 'sess1', workDir: '/tmp/work' })
    expect(httpClient.sessionExists).not.toHaveBeenCalled()
    expect(bridge.connectSession).not.toHaveBeenCalled()
  })

  it('should check session existence via HTTP and connect if exists', async () => {
    const { store, bridge, httpClient } = createMocks({
      stored: { sessionId: 'sess1', workDir: '/tmp/work' },
      sessionExists: true,
    })
    const recovery = new SessionRecovery({ store, bridge, httpClient })

    const result = await recovery.recover('chat1')

    expect(httpClient.sessionExists).toHaveBeenCalledWith('sess1')
    expect(bridge.connectSession).toHaveBeenCalledWith('sess1', '/tmp/work')
    expect(result).toEqual({ sessionId: 'sess1', workDir: '/tmp/work' })
  })

  it('should clean up when session does not exist (404)', async () => {
    const { store, bridge, httpClient } = createMocks({
      stored: { sessionId: 'sess1', workDir: '/tmp/work' },
      sessionExists: false,
    })
    const recovery = new SessionRecovery({ store, bridge, httpClient })

    const result = await recovery.recover('chat1')

    expect(result).toBeNull()
    expect(store.delete).toHaveBeenCalledWith('chat1')
    expect(bridge.resetSession).toHaveBeenCalled()
  })

  it('should assume session exists on network error and try to connect', async () => {
    const { store, bridge, httpClient } = createMocks({
      stored: { sessionId: 'sess1', workDir: '/tmp/work' },
    })
    httpClient.sessionExists = vi.fn().mockRejectedValue(new Error('network error'))

    const recovery = new SessionRecovery({ store, bridge, httpClient })

    const result = await recovery.recover('chat1')

    expect(result).toEqual({ sessionId: 'sess1', workDir: '/tmp/work' })
    expect(bridge.connectSession).toHaveBeenCalled()
  })

  it('should clean up if connectSession fails', async () => {
    const { store, bridge, httpClient } = createMocks({
      stored: { sessionId: 'sess1', workDir: '/tmp/work' },
    })
    bridge.connectSession = vi.fn().mockRejectedValue(new Error('connect failed'))

    const recovery = new SessionRecovery({ store, bridge, httpClient })

    const result = await recovery.recover('chat1')

    expect(result).toBeNull()
    expect(store.delete).toHaveBeenCalledWith('chat1')
  })
})
