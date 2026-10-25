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

/**
 * 票 09 第 4 条的另一半：上面那些用例说"该碰的碰对了"，这里说"除此之外一条都没碰"。
 *
 * 整层 `electronAPI` 换成会记录**属性全路径**的 Proxy（只记录一层拦不住把 `openExternal`
 * 换成 `openPath` 那种改法）。卡片能请求的四个动作里只有 copy 与 openLink 经这条端口
 * （expand 在组件内收口、submit 走提交端口，两者由 GenuiCardFrame 的用例钉住），
 * 跑完之后被读到的路径必须只有剪贴板写与外链开这两条 —— 以后谁给适配器接上
 * `ipcRenderer`、文件系统或引擎入口，这里立刻红。
 */
describe('桌面适配器可触达的宿主能力是封闭的', () => {
  function trackEnv<T extends object>(label: string, target: T, touched: string[]): T {
    return new Proxy(target, {
      get(object, key) {
        const value = Reflect.get(object, key)
        if (typeof key !== 'string') return value
        const path = `${label}.${key}`
        touched.push(path)
        return value !== null && typeof value === 'object' ? trackEnv(path, value as object, touched) : value
      },
    }) as T
  }

  it('copy 与 openLink 跑完，读到的属性路径只有那两条', async () => {
    const touched: string[] = []
    const api = {
      clipboard: { writeText: async () => {} },
      shell: { openExternal: async () => {} },
    }
    const port = createDesktopCardActionPort({
      electronAPI: trackEnv('electronAPI', api, touched) as CardActionEnv['electronAPI'],
    })

    await port.copyText('hello')
    await port.openExternal('https://example.com/docs')

    expect([...new Set(touched)].sort()).toEqual([
      'electronAPI.clipboard',
      'electronAPI.clipboard.writeText',
      'electronAPI.shell',
      'electronAPI.shell.openExternal',
    ])
  })

  it('记录器不是恒空的：别的键被读过就一定会留下', async () => {
    const touched: string[] = []
    const api = { clipboard: { writeText: async () => {} }, shell: { openPath: async () => {} } }
    const tracked = trackEnv('electronAPI', api, touched) as CardActionEnv['electronAPI']

    await createDesktopCardActionPort({ electronAPI: tracked }).copyText('x')
    // 模拟"适配器被人多接了一条通路"：只要读了 shell，记录里就会出现
    void (tracked as { shell: { openPath: () => Promise<void> } }).shell.openPath()

    expect(touched).toContain('electronAPI.shell')
    expect(touched).toContain('electronAPI.shell.openPath')
  })
})
