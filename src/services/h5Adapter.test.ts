// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createH5Adapter } from './h5Adapter'

describe('createH5Adapter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('结构满足 claudeCode 契约（含必选 onError）', () => {
    const adapter = createH5Adapter()
    expect(typeof adapter.startSession).toBe('function')
    expect(typeof adapter.onError).toBe('function')
    expect(typeof adapter.onAssistant).toBe('function')
    expect(typeof adapter.onInstallProgress).toBe('function')
  })

  it('setPermissionMode 显式拒绝并提示不支持', async () => {
    const adapter = createH5Adapter()
    await expect(adapter.setPermissionMode('sid', 'plan')).rejects.toThrow('暂不支持')
  })

  it('setModel 显式拒绝并提示不支持', async () => {
    const adapter = createH5Adapter()
    await expect(adapter.setModel('sid', 'opus')).rejects.toThrow('暂不支持')
  })

  it('调用方无 catch 的 no-op stub 走 warn 提示而非 throw', async () => {
    const adapter = createH5Adapter()
    await expect(adapter.suspendSession('sid')).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('暂不支持'))
  })

  it('查询型 stub 返回诚实的降级值', async () => {
    const adapter = createH5Adapter()
    await expect(adapter.getMcpStatus('sid')).resolves.toBeUndefined()
    await expect(adapter.getPendingPermissionRequestIds('sid')).resolves.toEqual([])
    await expect(adapter.detectInstalledCli()).resolves.toBeNull()
  })
})
