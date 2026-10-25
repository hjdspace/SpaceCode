/**
 * 动作的平台适配器（票 03 第 2、4 条）。
 *
 * 桌面经 Electron 主进程（剪贴板 / 外链），H5 走浏览器 API。这里注入假环境，
 * 只断言「落到哪个平台 API」与「不可用时是否 reject（宿主据此给可见错误）」。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createDesktopCardActionPort,
  createH5CardActionPort,
  resolveCardActionPort,
  type CardActionEnv,
} from '../cardActionAdapters'

function desktopEnv() {
  const writeText = vi.fn(async () => {})
  const openExternal = vi.fn(async () => {})
  const env: CardActionEnv = {
    electronAPI: {
      shell: { openExternal },
      clipboard: { writeText },
    },
  }
  return { env, writeText, openExternal }
}

describe('桌面适配器', () => {
  it('复制与开外链都走 Electron 暴露的桥', async () => {
    const { env, writeText, openExternal } = desktopEnv()
    const port = createDesktopCardActionPort(env)

    await port.copyText('hello')
    await port.openExternal('https://example.com')

    expect(writeText).toHaveBeenCalledWith('hello')
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('桥不可用时 reject，而不是静默成功', async () => {
    const port = createDesktopCardActionPort({ electronAPI: {} })
    await expect(port.copyText('x')).rejects.toThrow()
    await expect(port.openExternal('https://example.com')).rejects.toThrow()
  })
})

describe('H5 适配器', () => {
  it('复制走浏览器 Clipboard API，外链用 noopener 新窗口', async () => {
    const writeText = vi.fn(async () => {})
    // 带 noopener 时浏览器按规范返回 null；这不是失败信号
    const open = vi.fn(() => null)
    const port = createH5CardActionPort({ navigator: { clipboard: { writeText } }, open })

    await port.copyText('hello')
    await port.openExternal('https://example.com')

    expect(writeText).toHaveBeenCalledWith('hello')
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener')
  })

  it('Clipboard 或 window.open 不可用时 reject', async () => {
    const unavailable = createH5CardActionPort({ navigator: {} })
    await expect(unavailable.copyText('x')).rejects.toThrow()
    await expect(unavailable.openExternal('https://example.com')).rejects.toThrow()
  })
})

describe('平台判定', () => {
  it('有 Electron 桥走桌面适配器，没有则走 H5 适配器', async () => {
    const { env, openExternal } = desktopEnv()
    await resolveCardActionPort(env).openExternal('https://a.dev')
    expect(openExternal).toHaveBeenCalledOnce()

    const open = vi.fn(() => ({}) as Window)
    await resolveCardActionPort({ navigator: {}, open }).openExternal('https://b.dev')
    expect(open).toHaveBeenCalledOnce()
  })
})
