/**
 * shell.openExternal 的三路行为：Electron 直通 → H5 用新标签页 → 双无静默。
 *
 * 预览 iframe 已经不再授予 allow-popups，外链全靠宿主这段调用兜底；H5 没有主进程
 * Shell，如果不回退到 window.open，移动端的产物外链会变成死链。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = vi.hoisted(() => ({
  electronAPI: null as { shell?: { openExternal: (url: string) => Promise<void> } } | null,
  isH5: false,
}))

vi.mock('../_context', () => ({
  get electronAPI() {
    return H.electronAPI
  },
  get _isH5Mode() {
    return H.isH5
  },
}))

type ShellModule = typeof import('../shell')

async function importFresh(): Promise<ShellModule> {
  vi.resetModules()
  return import('../shell')
}

beforeEach(() => {
  H.electronAPI = null
  H.isH5 = false
  vi.restoreAllMocks()
})

describe('shell.openExternal', () => {
  it('Electron 在场时直通主进程', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    H.electronAPI = { shell: { openExternal } }
    const { shell } = await importFresh()

    await shell.openExternal('https://example.com/a')

    expect(openExternal).toHaveBeenCalledWith('https://example.com/a')
  })

  it('H5 用新标签页打开，并切断 opener', async () => {
    H.isH5 = true
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { shell } = await importFresh()

    await shell.openExternal('https://example.com/h5')

    expect(open).toHaveBeenCalledWith('https://example.com/h5', '_blank', 'noopener,noreferrer')
  })

  it('既无 electronAPI 也非 H5 时静默成功，不尝试开窗口', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { shell } = await importFresh()

    await expect(shell.openExternal('https://example.com/x')).resolves.toBeUndefined()
    expect(open).not.toHaveBeenCalled()
  })
})
