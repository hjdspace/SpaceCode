// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 内置预设的本地化安装。
 *
 * 这条链路会往用户机器上写东西（uv tool bin / npm 全局 prefix），所以它的
 * 契约一半是"该装的时候装对"，另一半是"不该装的时候一个子进程都不起"：
 * - 只有 cdp-bridge / chrome-devtools 这两个 launcher 形态的预设能装；用户把
 *   command 改写过（resolver 会报 fallback-original）就 absolutely 不装；
 * - 装完必须用同一个发现函数复验，报成功但找不到入口的按失败处理 —— 因为
 *   resolver 下次 spawn 仍然找不到，悄悄"成功"只会让用户以为已经本地化了；
 * - 任何失败都不改配置：下次 spawn 照旧回落到钉版本 launcher。
 *
 * Windows 的 npm 是 .cmd 垫片，shell:false 下 spawn 会 EINVAL，所以命令形态
 * 按平台分叉 —— 和 mcpConfigResolver 的 `cmd /c npx` 同一个教训。
 */

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const finder = vi.hoisted(() => ({
  cdpBridge: vi.fn((): string | null => null),
  chromeDevtools: vi.fn((): { command: string; args: string[] } | null => null),
}))

vi.mock('../localMcpService', () => ({
  findCdpBridgeExecutable: finder.cdpBridge,
  findChromeDevtoolsMcpLocal: finder.chromeDevtools,
}))

// resolver 从 browserUseService / cuaDriverService 里拉了几十个发现函数；
// 这里只关心 installer 用到的 findUv，其余给个不会碰到的空实现。
vi.mock('../browserUseService', () => ({
  getBrowserUseMcpServerConfig: vi.fn(() => null),
  findUv: vi.fn((): string | null => null),
}))
vi.mock('../cuaDriverService', () => ({
  findCuaDriverBinary: vi.fn((): string | null => null),
}))

const installer = vi.hoisted(() => ({
  runStreamingInstaller: vi.fn(
    async (
      _cmd: string,
      _args: string[],
      _opts: { onProgress: (p: { stage: string; message: string; percent?: number }) => void },
    ): Promise<{ code: number; stderr: string }> => ({ code: 0, stderr: '' }),
  ),
}))
vi.mock('../../engine/cliDetector', () => ({
  runStreamingInstaller: installer.runStreamingInstaller,
}))

import { findUv } from '../browserUseService'
import { localizeBuiltinMcp, type LocalizeSource } from '../builtinMcpInstaller'
import { PINNED_CDP_BRIDGE, PINNED_CHROME_DEVTOOLS_MCP } from '../mcpConfigResolver'

const ORIGINAL_PLATFORM = process.platform

/** 平台分叉的断言必须显式声明跑在哪个平台上，否则 CI（linux）和本机（win32）只能对一个 */
async function onPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T>): Promise<T> {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return await run()
  } finally {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  }
}

const noop = () => {}
const uvSource: LocalizeSource = { type: 'stdio', command: 'uvx', args: ['cdp-bridge@latest'] }
const npxSource: LocalizeSource = { type: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] }

const calledCommands = () =>
  installer.runStreamingInstaller.mock.calls.map(c => [c[0] as string, ...(c[1] as string[])])

beforeEach(() => {
  finder.cdpBridge.mockReset().mockReturnValue(null)
  finder.chromeDevtools.mockReset().mockReturnValue(null)
  vi.mocked(findUv).mockReset().mockReturnValue(null)
  installer.runStreamingInstaller.mockReset().mockResolvedValue({ code: 0, stderr: '' })
})

describe('该不该装', () => {
  it('非 launcher 形态的内置预设（cua-driver）不起任何安装子进程', async () => {
    const result = await localizeBuiltinMcp('sc-computer-use', { command: 'cua-driver', args: ['mcp'] }, noop)

    expect(result).toEqual({ status: 'not-applicable' })
    expect(installer.runStreamingInstaller).not.toHaveBeenCalled()
  })

  it('用户把内置项的 command 改写过就不装 —— resolver 本来也走不到本地入口', async () => {
    // 装了也只是往用户机器上多写一份没人执行的文件。
    const result = await localizeBuiltinMcp('cdp-bridge', { command: 'python', args: ['server.py'] }, noop)

    expect(result).toEqual({ status: 'not-applicable' })
    expect(installer.runStreamingInstaller).not.toHaveBeenCalled()
  })

  it('远程类型（sse/http）不装', async () => {
    const result = await localizeBuiltinMcp('cdp-bridge', { type: 'http' }, noop)

    expect(result).toEqual({ status: 'not-applicable' })
    expect(installer.runStreamingInstaller).not.toHaveBeenCalled()
  })

  it('本地已经有了就跳过，不做版本比较也不自动升级', async () => {
    finder.cdpBridge.mockReturnValue('/home/u/.local/bin/cdp-bridge')

    const result = await localizeBuiltinMcp('cdp-bridge', uvSource, noop)

    expect(result).toEqual({ status: 'already-local' })
    expect(installer.runStreamingInstaller).not.toHaveBeenCalled()
  })

  it('uv 缺失时只报错，不顺手去装 uv（那是设置页上另一个显式动作）', async () => {
    const result = await localizeBuiltinMcp('cdp-bridge', uvSource, noop)

    expect(result.status).toBe('failed')
    expect((result as { error: string }).error).toContain('uv not found')
    expect(installer.runStreamingInstaller).not.toHaveBeenCalled()
  })
})

describe('cdp-bridge：uv tool install', () => {
  it('装钉版本，并在装完后用同一个发现函数复验', async () => {
    vi.mocked(findUv).mockReturnValue('/usr/bin/uv')
    // 第一次（装前）null，第二次（复验）命中 —— 复验不过就是 failed
    finder.cdpBridge.mockReturnValueOnce(null).mockReturnValue('/home/u/.local/bin/cdp-bridge')

    const result = await localizeBuiltinMcp('cdp-bridge', uvSource, noop)

    expect(result).toEqual({ status: 'localized' })
    expect(installer.runStreamingInstaller).toHaveBeenCalledWith(
      '/usr/bin/uv',
      ['tool', 'install', PINNED_CDP_BRIDGE],
      expect.objectContaining({ ceiling: 85 }),
    )
  })

  it('装成功但发现不了按失败处理，不让 UI 显示一个下次 spawn 用不上的状态', async () => {
    vi.mocked(findUv).mockReturnValue('/usr/bin/uv')

    const result = await localizeBuiltinMcp('cdp-bridge', uvSource, noop)

    expect(result.status).toBe('failed')
    expect((result as { error: string }).error).toContain('not discoverable')
  })

  it('非零退出码带着 stderr 末行报失败', async () => {
    vi.mocked(findUv).mockReturnValue('/usr/bin/uv')
    installer.runStreamingInstaller.mockResolvedValue({
      code: 2,
      stderr: 'line one\nerror: failed to download from index\n',
    })

    const result = await localizeBuiltinMcp('cdp-bridge', uvSource, noop)

    expect(result.status).toBe('failed')
    expect((result as { error: string }).error).toContain('exited 2')
    expect((result as { error: string }).error).toContain('failed to download from index')
    expect((result as { error: string }).error).not.toContain('line one')
  })
})

describe('chrome-devtools：npm install -g', () => {
  it('Windows 上包一层 cmd /c，绕开 .cmd 垫片在 shell:false 下的 EINVAL', async () => {
    await onPlatform('win32', async () => {
      finder.chromeDevtools
        .mockReturnValueOnce(null)
        .mockReturnValue({ command: '/node/node.exe', args: ['/node/pkg/build/src/bin/chrome-devtools-mcp.js'] })

      const result = await localizeBuiltinMcp('chrome-devtools', npxSource, noop)

      expect(result).toEqual({ status: 'localized' })
      expect(calledCommands()).toEqual([
        ['cmd', '/c', 'npm', 'install', '-g', '--allow-scripts=chrome-devtools-mcp', PINNED_CHROME_DEVTOOLS_MCP],
      ])
    })
  })

  it('非 Windows 直接 spawn npm', async () => {
    await onPlatform('linux', async () => {
      finder.chromeDevtools
        .mockReturnValueOnce(null)
        .mockReturnValue({ command: '/usr/bin/node', args: ['/npm/pkg/build/src/bin/chrome-devtools-mcp.js'] })

      await localizeBuiltinMcp('chrome-devtools', npxSource, noop)

      expect(calledCommands()).toEqual([
        ['npm', 'install', '-g', '--allow-scripts=chrome-devtools-mcp', PINNED_CHROME_DEVTOOLS_MCP],
      ])
    })
  })

  it('复验拿不到 js 入口就是失败：只装出 shim 也算没装上', async () => {
    await onPlatform('linux', async () => {
      // finder 一直返回 null（npm 全局目录里没有这个包，或 js 入口缺失）
      const result = await localizeBuiltinMcp('chrome-devtools', npxSource, noop)

      expect(result.status).toBe('failed')
      expect((result as { error: string }).error).toContain('not discoverable')
    })
  })
})

describe('并发与进度', () => {
  it('同一个 key 连点两次只装一次，装完释放，第三次会真的再装', async () => {
    vi.mocked(findUv).mockReturnValue('/usr/bin/uv')
    let release: (v: { code: number; stderr: string }) => void = () => {}
    installer.runStreamingInstaller.mockImplementationOnce(
      () => new Promise(resolve => { release = resolve }),
    )

    const first = localizeBuiltinMcp('cdp-bridge', uvSource, noop)
    const second = localizeBuiltinMcp('cdp-bridge', uvSource, noop)
    expect(second).toBe(first)

    release({ code: 0, stderr: '' })
    await Promise.all([first, second])
    expect(installer.runStreamingInstaller).toHaveBeenCalledTimes(1)

    // 在飞槽位已释放：下一次启用（比如用户改配置后重新启用）仍会装
    vi.mocked(findUv).mockReturnValue('/usr/bin/uv')
    await localizeBuiltinMcp('cdp-bridge', uvSource, noop)
    expect(installer.runStreamingInstaller).toHaveBeenCalledTimes(2)
  })

  it('安装器的进度原样转给调用方', async () => {
    vi.mocked(findUv).mockReturnValue('/usr/bin/uv')
    finder.cdpBridge.mockReturnValueOnce(null).mockReturnValue('/home/u/.local/bin/cdp-bridge')
    const seen: Array<{ stage: string }> = []
    installer.runStreamingInstaller.mockImplementationOnce(async (_cmd, _args, opts) => {
      opts.onProgress({ stage: 'downloading', message: 'resolving', percent: 42 })
      return { code: 0, stderr: '' }
    })

    await localizeBuiltinMcp('cdp-bridge', uvSource, p => seen.push(p as { stage: string }))

    expect(seen.map(s => s.stage)).toEqual(['downloading', 'done'])
  })
})
