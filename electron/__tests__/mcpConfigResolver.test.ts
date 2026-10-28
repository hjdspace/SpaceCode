import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the dependencies that do filesystem/system lookups
vi.mock('../tools/cuaDriverService', () => ({
  findCuaDriverBinary: vi.fn(() => null),
}))
vi.mock('../tools/browserUseService', () => ({
  getBrowserUseMcpServerConfig: vi.fn(() => null),
}))
vi.mock('../tools/localMcpService', () => ({
  findCdpBridgeExecutable: vi.fn(() => null),
  findChromeDevtoolsMcpLocal: vi.fn(() => null),
}))
vi.mock('../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import {
  detectBuiltinFromConfig,
  builtinNameFromServerKey,
  resolveBuiltinMcp,
  usesPackageManagerLauncher,
} from '../tools/mcpConfigResolver'
import { findCuaDriverBinary } from '../tools/cuaDriverService'
import { getBrowserUseMcpServerConfig } from '../tools/browserUseService'
import { findCdpBridgeExecutable, findChromeDevtoolsMcpLocal } from '../tools/localMcpService'

const ORIGINAL_PLATFORM = process.platform

/**
 * 解析器的 npx 回退形态按平台分叉（Windows 要包 `cmd /c`），用例必须显式声明
 * 自己跑在哪个平台上 —— 否则同一份断言在 Windows 和 CI 的 Linux 上只能对一个。
 */
function onPlatform(platform: NodeJS.Platform, run: () => void): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    run()
  } finally {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  }
}

describe('mcpConfigResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── detectBuiltinFromConfig ──────────────────────────────────

  describe('detectBuiltinFromConfig', () => {
    it('detects cua-driver by command name', () => {
      const result = detectBuiltinFromConfig({
        type: 'stdio',
        command: 'cua-driver',
        args: [],
      })
      expect(result).toBe('cua-driver')
    })

    it('detects browser-use by python + bridge.py pattern', () => {
      const result = detectBuiltinFromConfig({
        type: 'stdio',
        command: 'python',
        args: ['bridge.py', '--mcp'],
      })
      expect(result).toBe('browser-use')
    })

    it('detects browser-use with python3 command', () => {
      const result = detectBuiltinFromConfig({
        type: 'stdio',
        command: 'python3',
        args: ['/some/path/bridge.py', '--mcp'],
      })
      expect(result).toBe('browser-use')
    })

    it('detects browser-use with backslash path on windows', () => {
      const result = detectBuiltinFromConfig({
        type: 'stdio',
        command: 'python',
        args: ['C:\\path\\to\\bridge.py'],
      })
      expect(result).toBe('browser-use')
    })

    it('detects cdp-bridge by uvx + package spec pattern', () => {
      expect(
        detectBuiltinFromConfig({
          type: 'stdio',
          command: 'uvx',
          args: ['cdp-bridge@latest'],
        }),
      ).toBe('cdp-bridge')
    })

    it('detects cdp-bridge with bare package name and absolute uvx.exe path', () => {
      expect(
        detectBuiltinFromConfig({
          type: 'stdio',
          command: 'C:\\tools\\uv\\uvx.exe',
          args: ['cdp-bridge'],
        }),
      ).toBe('cdp-bridge')
    })

    it('detects chrome-devtools by npx + package spec pattern', () => {
      expect(
        detectBuiltinFromConfig({
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        }),
      ).toBe('chrome-devtools')
    })

    it('detects chrome-devtools with npx.cmd launcher and pinned spec', () => {
      expect(
        detectBuiltinFromConfig({
          type: 'stdio',
          command: 'npx.cmd',
          args: ['chrome-devtools-mcp@0.9.0', '--headless'],
        }),
      ).toBe('chrome-devtools')
    })

    it('does not detect cdp-bridge for uvx running another package', () => {
      expect(
        detectBuiltinFromConfig({ type: 'stdio', command: 'uvx', args: ['other-mcp@latest'] }),
      ).toBeNull()
    })

    it('does not detect the launcher presets for non-stdio types', () => {
      expect(
        detectBuiltinFromConfig({ type: 'http', command: 'uvx', args: ['cdp-bridge@latest'] }),
      ).toBeNull()
      expect(
        detectBuiltinFromConfig({ type: 'sse', command: 'npx', args: ['-y', 'chrome-devtools-mcp'] }),
      ).toBeNull()
    })

    it('returns null for non-builtin commands', () => {
      expect(
        detectBuiltinFromConfig({ type: 'stdio', command: 'npx', args: ['some-server'] }),
      ).toBeNull()
    })

    it('returns null for python without bridge.py in args', () => {
      expect(
        detectBuiltinFromConfig({
          type: 'stdio',
          command: 'python',
          args: ['some-other.py'],
        }),
      ).toBeNull()
    })

    it('returns null for SSE type configs', () => {
      expect(
        detectBuiltinFromConfig({ type: 'sse', url: 'http://localhost:3000' }),
      ).toBeNull()
    })

    it('returns null when command is undefined', () => {
      expect(detectBuiltinFromConfig({ type: 'stdio' })).toBeNull()
    })

    it('does not detect browser-use for non-stdio type', () => {
      expect(
        detectBuiltinFromConfig({
          type: 'sse',
          command: 'python',
          args: ['bridge.py'],
        }),
      ).toBeNull()
    })
  })

  // ── builtinNameFromServerKey ─────────────────────────────────

  describe('builtinNameFromServerKey', () => {
    it('maps sc-computer-use to cua-driver', () => {
      expect(builtinNameFromServerKey('sc-computer-use')).toBe('cua-driver')
    })

    it('maps browser-use to browser-use', () => {
      expect(builtinNameFromServerKey('browser-use')).toBe('browser-use')
    })

    it('maps cdp-bridge and chrome-devtools keys to their builtin names', () => {
      expect(builtinNameFromServerKey('cdp-bridge')).toBe('cdp-bridge')
      expect(builtinNameFromServerKey('chrome-devtools')).toBe('chrome-devtools')
    })

    it('returns null for non-builtin server keys', () => {
      expect(builtinNameFromServerKey('my-custom-server')).toBeNull()
      expect(builtinNameFromServerKey('git')).toBeNull()
    })

    it('returns null for deprecated key computer-use (must be migrated first)', () => {
      // The old 'computer-use' key should be migrated to 'sc-computer-use' by
      // buildEnabledMcpConfig's DEPRECATED_KEY_ALIASES before reaching the resolver.
      expect(builtinNameFromServerKey('computer-use')).toBeNull()
    })
  })

  // ── resolveBuiltinMcp ────────────────────────────────────────

  describe('resolveBuiltinMcp', () => {
    it('resolves cua-driver when binary is found', () => {
      vi.mocked(findCuaDriverBinary).mockReturnValue('/usr/local/bin/cua-driver')

      const result = resolveBuiltinMcp('cua-driver')

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.config.command).toBe('/usr/local/bin/cua-driver')
        expect(result.config.env).toEqual({ CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' })
      }
    })

    it('returns missing when cua-driver binary is not found', () => {
      vi.mocked(findCuaDriverBinary).mockReturnValue(null)

      const result = resolveBuiltinMcp('cua-driver')

      expect(result.status).toBe('missing')
      if (result.status === 'missing') {
        expect(result.error).toContain('cua-driver binary not found')
      }
    })

    it('resolves browser-use when Python and bridge.py are available', () => {
      vi.mocked(getBrowserUseMcpServerConfig).mockReturnValue({
        command: '/usr/bin/python3',
        args: ['/path/to/bridge.py', '--mcp'],
        env: { BROWSER_USE_API_KEY: 'test-key' },
      })

      const result = resolveBuiltinMcp('browser-use')

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.config.command).toBe('/usr/bin/python3')
        expect(result.config.args).toEqual(['/path/to/bridge.py', '--mcp'])
        expect(result.config.env).toEqual({ BROWSER_USE_API_KEY: 'test-key' })
      }
    })

    it('returns missing when browser-use Python is not available', () => {
      vi.mocked(getBrowserUseMcpServerConfig).mockReturnValue(null)

      const result = resolveBuiltinMcp('browser-use')

      expect(result.status).toBe('missing')
      if (result.status === 'missing') {
        expect(result.error).toContain('Python 3.11+')
      }
    })
  })

  // ── resolveBuiltinMcp — cdp-bridge / chrome-devtools（uvx/npx 预设）──

  describe('resolveBuiltinMcp — launcher presets', () => {
    it('falls back to the original config when the command is not the preset launcher', () => {
      // 用户把内置服务器的 command 改写成别的形态时，不覆盖其配置
      expect(
        resolveBuiltinMcp('cdp-bridge', { command: 'python', args: ['server.py'] }).status,
      ).toBe('fallback-original')
      expect(
        resolveBuiltinMcp('chrome-devtools', { command: 'node', args: ['x.js'] }).status,
      ).toBe('fallback-original')
      expect(resolveBuiltinMcp('cdp-bridge').status).toBe('fallback-original')
      expect(resolveBuiltinMcp('chrome-devtools').status).toBe('fallback-original')
    })

    it('resolves cdp-bridge to the local executable and strips the uvx spec args', () => {
      vi.mocked(findCdpBridgeExecutable).mockReturnValue('/home/u/.local/bin/cdp-bridge')

      const result = resolveBuiltinMcp('cdp-bridge', {
        command: 'uvx',
        args: ['cdp-bridge@latest', '--port', '9222'],
      })

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.config.command).toBe('/home/u/.local/bin/cdp-bridge')
        expect(result.config.args).toEqual(['--port', '9222'])
      }
    })

    it('strips -y from local chrome-devtools args and appends server flags after the js entry', () => {
      vi.mocked(findChromeDevtoolsMcpLocal).mockReturnValue({
        command: '/usr/bin/node',
        args: ['/npm/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js'],
      })

      const result = resolveBuiltinMcp('chrome-devtools', {
        command: 'npx',
        args: ['-y', 'chrome-devtools-mcp@latest', '--headless'],
      })

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.config.command).toBe('/usr/bin/node')
        expect(result.config.args).toEqual([
          '/npm/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js',
          '--headless',
        ])
      }
    })

    it('pins the cdp-bridge version in the uvx fallback and keeps server flags', () => {
      vi.mocked(findCdpBridgeExecutable).mockReturnValue(null)

      const result = resolveBuiltinMcp('cdp-bridge', {
        command: 'uvx',
        args: ['cdp-bridge@latest', '--port', '9222'],
      })

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.config.command).toBe('uvx')
        expect(result.config.args).toEqual(['cdp-bridge@0.1.25', '--port', '9222'])
      }
    })

    it('prepends the pinned spec when the cdp-bridge args carry no package spec', () => {
      vi.mocked(findCdpBridgeExecutable).mockReturnValue(null)

      const result = resolveBuiltinMcp('cdp-bridge', { command: 'uvx', args: ['--foo'] })

      expect(result.status).toBe('resolved')
      if (result.status === 'resolved') {
        expect(result.config.args).toEqual(['cdp-bridge@0.1.25', '--foo'])
      }
    })

    it('pins the chrome-devtools-mcp version in the npx fallback, ensuring -y', () => {
      vi.mocked(findChromeDevtoolsMcpLocal).mockReturnValue(null)

      onPlatform('linux', () => {
        const result = resolveBuiltinMcp('chrome-devtools', {
          command: 'npx',
          args: ['chrome-devtools-mcp@latest'],
        })

        expect(result.status).toBe('resolved')
        if (result.status === 'resolved') {
          expect(result.config.command).toBe('npx')
          expect(result.config.args).toEqual(['-y', 'chrome-devtools-mcp@1.12.0'])
        }
      })
    })

    it('keeps existing -y and extra flags in the npx fallback', () => {
      vi.mocked(findChromeDevtoolsMcpLocal).mockReturnValue(null)

      onPlatform('linux', () => {
        const result = resolveBuiltinMcp('chrome-devtools', {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--headless', 'true'],
        })

        expect(result.status).toBe('resolved')
        if (result.status === 'resolved') {
          expect(result.config.args).toEqual(['-y', 'chrome-devtools-mcp@1.12.0', '--headless', 'true'])
        }
      })
    })

    // Windows 上裸 npx 是 npx.cmd 垫片，引擎的 shell:false spawn 只认 `名称.exe`，
    // 直接传 npx 会 ENOENT 并停在 CONNECT_TIMEOUT。必须包成 cmd /c npx。
    it('wraps the npx fallback in `cmd /c` on Windows', () => {
      vi.mocked(findChromeDevtoolsMcpLocal).mockReturnValue(null)

      onPlatform('win32', () => {
        const result = resolveBuiltinMcp('chrome-devtools', {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--headless'],
        })

        expect(result.status).toBe('resolved')
        if (result.status === 'resolved') {
          expect(result.config.command).toBe('cmd')
          expect(result.config.args).toEqual([
            '/c', 'npx', '-y', 'chrome-devtools-mcp@1.12.0', '--headless',
          ])
        }
      })
    })

    it('normalises npx.cmd and absolute npx paths to the same `cmd /c npx` form', () => {
      // cmd /c "<绝对路径>" 在路径含空格时要么静默无输出要么语法错误，
      // 所以统一交给 cmd 走 PATH 解析，而不是把用户写的路径塞进去。
      vi.mocked(findChromeDevtoolsMcpLocal).mockReturnValue(null)

      onPlatform('win32', () => {
        for (const command of ['npx.cmd', 'C:\\Program Files\\nodejs\\npx.cmd']) {
          const result = resolveBuiltinMcp('chrome-devtools', {
            command,
            args: ['-y', 'chrome-devtools-mcp@latest'],
          })

          expect(result.status).toBe('resolved')
          if (result.status === 'resolved') {
            expect(result.config.command).toBe('cmd')
            expect(result.config.args).toEqual(['/c', 'npx', '-y', 'chrome-devtools-mcp@1.12.0'])
          }
        }
      })
    })

    it('still prefers the local node entry on Windows — it spawns without a shell', () => {
      vi.mocked(findChromeDevtoolsMcpLocal).mockReturnValue({
        command: 'D:\\node\\node.exe',
        args: ['D:\\node\\node_modules\\chrome-devtools-mcp\\build\\src\\bin\\chrome-devtools-mcp.js'],
      })

      onPlatform('win32', () => {
        const result = resolveBuiltinMcp('chrome-devtools', {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        })

        expect(result.status).toBe('resolved')
        if (result.status === 'resolved') {
          expect(result.config.command).toBe('D:\\node\\node.exe')
          expect(result.config.args).toEqual([
            'D:\\node\\node_modules\\chrome-devtools-mcp\\build\\src\\bin\\chrome-devtools-mcp.js',
          ])
        }
      })
    })

    it('defaults to the pinned spec when the original preset args are absent', () => {
      vi.mocked(findCdpBridgeExecutable).mockReturnValue(null)
      vi.mocked(findChromeDevtoolsMcpLocal).mockReturnValue(null)

      onPlatform('linux', () => {
        const cdp = resolveBuiltinMcp('cdp-bridge', { command: 'uvx' })
        const devtools = resolveBuiltinMcp('chrome-devtools', { command: 'npx' })

        expect(cdp.status).toBe('resolved')
        expect((cdp as { config: { args: string[] } }).config.args).toEqual(['cdp-bridge@0.1.25'])
        expect(devtools.status).toBe('resolved')
        expect((devtools as { config: { args: string[] } }).config.args).toEqual([
          '-y',
          'chrome-devtools-mcp@1.12.0',
        ])
      })
    })
  })

  // ── usesPackageManagerLauncher — 握手预算的判据 ──────────────

  describe('usesPackageManagerLauncher', () => {
    const stdio = (command: string | undefined, args?: string[]) =>
      ({ type: 'stdio' as const, command, args })

    it('recognises the launcher presets, including .cmd and absolute-path spellings', () => {
      for (const command of ['uvx', 'uvx.cmd', 'C:\\tools\\uv\\uvx.exe', '/usr/local/bin/uvx']) {
        expect(usesPackageManagerLauncher(stdio(command, ['pkg@latest']))).toBe(true)
      }
      for (const command of ['npx', 'npx.cmd', 'D:\\node\\npx.CMD']) {
        expect(usesPackageManagerLauncher(stdio(command, ['-y', 'pkg@latest']))).toBe(true)
      }
    })

    it('rules out servers that start a real executable without a package manager', () => {
      for (
        const command of [
          'node', 'python', 'python3', 'cua-driver',
          '/opt/bin/mcp-server', 'D:\\tools\\server.exe',
        ]
      ) {
        expect(usesPackageManagerLauncher(stdio(command))).toBe(false)
      }
    })

    it('is false for remote transports and for a missing command', () => {
      expect(usesPackageManagerLauncher({ type: 'http', url: 'https://x/mcp' })).toBe(false)
      expect(usesPackageManagerLauncher({ type: 'sse', url: 'https://x/sse' })).toBe(false)
      expect(usesPackageManagerLauncher(stdio(undefined))).toBe(false)
      // 只看 basename，不能因为参数里出现 npx 就误判
      expect(usesPackageManagerLauncher(stdio('node', ['npx-cli.js']))).toBe(false)
    })

    it('sees through the cmd /c wrapper this module itself emits on Windows', () => {
      // 判据是在解析器覆盖**之后**问的，而 Windows 的 npx 回退形态就是
      // `cmd /c npx …`。看漏这层壳会把预算从 30s 压到 15s，
      // 把一个只是慢的 npx 服务器判成 CONNECT_TIMEOUT。
      expect(usesPackageManagerLauncher(stdio('cmd', ['/c', 'npx', '-y', 'pkg@1']))).toBe(true)
      expect(usesPackageManagerLauncher(stdio('C:\\Windows\\System32\\cmd.exe', ['/c', 'uvx', 'pkg']))).toBe(true)
      // 壳里包的是真二进制就不该算
      expect(usesPackageManagerLauncher(stdio('cmd', ['/c', 'node', 'server.js']))).toBe(false)
      expect(usesPackageManagerLauncher(stdio('cmd', ['/c']))).toBe(false)
      expect(usesPackageManagerLauncher(stdio('cmd'))).toBe(false)
    })

    it('keeps the launcher verdict true for the config resolveBuiltinMcp actually injects on Windows', () => {
      // 这条是上面那个洞的回归闸：两个函数串起来跑，而不是各测各的。
      onPlatform('win32', () => {
        const resolved = resolveBuiltinMcp('chrome-devtools', {
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        })
        expect(resolved.status).toBe('resolved')
        if (resolved.status !== 'resolved') return

        const injected = stdio(resolved.config.command, resolved.config.args)
        expect(injected.command).toBe('cmd')
        expect(usesPackageManagerLauncher(injected)).toBe(true)
      })
    })
  })
})
