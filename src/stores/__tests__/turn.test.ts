import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// fake api + fake sink，验证 Turn 能在 seam 处被替换
function makeFakeApi() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  return {
    claudeCode: {
      onStreamEvent: (cb: any) => { handlers.onStreamEvent = cb; return () => {} },
      onAssistant: (cb: any) => { handlers.onAssistant = cb; return () => {} },
      onToolUse: (cb: any) => { handlers.onToolUse = cb; return () => {} },
      onToolResult: (cb: any) => { handlers.onToolResult = cb; return () => {} },
      onResult: (cb: any) => { handlers.onResult = cb; return () => {} },
      onExit: (cb: any) => { handlers.onExit = cb; return () => {} },
      onError: (cb: any) => { handlers.onError = cb; return () => {} },
      onPermissionRequest: (cb: any) => { handlers.onPermissionRequest = cb; return () => {} },
      onPermissionRequestCancelled: (cb: any) => { handlers.onPermissionRequestCancelled = cb; return () => {} },
      sendMessage: vi.fn(),
      abort: vi.fn(),
      allowPermission: vi.fn(),
      denyPermission: vi.fn(),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
  }
}

describe('useTurnStore skeleton', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('can be constructed with a fake api', async () => {
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(makeFakeApi() as any)
    expect(turn).toBeTruthy()
    expect(typeof turn.sendMessage).toBe('function')
    expect(typeof turn.abort).toBe('function')
    expect(typeof turn.allowPermission).toBe('function')
  })
})
