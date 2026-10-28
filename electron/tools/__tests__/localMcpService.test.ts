// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join, resolve, win32 } from 'path'
import { accessSync, constants } from 'fs'
import { execFileSync } from 'child_process'

/**
 * localMcpService 只做"找"：uv tool / npm global 的固定布局 + PATH 兜底。
 * 契约上要守住的是每一层缺失时的降级方向——任何一个环节缺失都不能给出
 * 半残的启动配置（宁可 null，让 resolver 回退到钉版本 uvx/npx）。
 */

const HOME = vi.hoisted(() => '/home/u')

const fsp = vi.hoisted(() => ({
  exists: (() => false) as (p: string) => boolean,
  isFile: (() => true) as (p: string) => boolean,
  executable: (() => true) as (p: string) => boolean,
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => fsp.exists(String(p)),
  statSync: (p: unknown) => {
    if (!fsp.exists(String(p))) throw new Error('ENOENT')
    return { isFile: () => fsp.isFile(String(p)) }
  },
  accessSync: vi.fn((p: unknown, mode?: number) => {
    if (!fsp.exists(String(p))) throw new Error('ENOENT')
    if (mode === 1 && !fsp.executable(String(p))) throw new Error('EACCES')
  }),
  constants: { X_OK: 1 },
}))

vi.mock('os', () => ({ homedir: () => HOME }))

vi.mock('child_process', () => ({ execFileSync: vi.fn() }))

import { findCdpBridgeExecutable, findChromeDevtoolsMcpLocal } from '../localMcpService'

const originalPlatform = process.platform
const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = ['UV_TOOL_BIN_DIR', 'APPDATA', 'PATH', 'PATHEXT']

beforeEach(() => {
  vi.clearAllMocks()
  fsp.exists = () => false
  fsp.isFile = () => true
  fsp.executable = () => true
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  expect(execFileSync).not.toHaveBeenCalled()
})

describe('findCdpBridgeExecutable', () => {
  it('anchors relative PATH entries to the host directory instead of the future session cwd', () => {
    process.env.PATH = 'relative-tools'
    const candidate = join('relative-tools', 'cdp-bridge')
    fsp.exists = p => p === candidate

    expect(findCdpBridgeExecutable()).toBe(resolve(candidate))
  })

  it('resolves a PATH executable without spawning which and sees newly installed binaries', () => {
    process.env.PATH = '/first:/tools'
    const executable = join('/tools', 'cdp-bridge')
    expect(findCdpBridgeExecutable()).toBeNull()
    fsp.exists = p => p === executable

    expect(findCdpBridgeExecutable()).toBe(executable)

    // 成功结果也不能缓存：卸载后下一次解析应立即回退。
    fsp.exists = () => false
    expect(findCdpBridgeExecutable()).toBeNull()
  })

  it('skips directories named like executables on PATH', () => {
    process.env.PATH = '/first:/tools'
    const directory = join('/first', 'cdp-bridge')
    const executable = join('/tools', 'cdp-bridge')
    fsp.exists = p => p === directory || p === executable
    fsp.isFile = p => p !== directory

    expect(findCdpBridgeExecutable()).toBe(executable)
  })

  it('skips non-executable Unix files on PATH', () => {
    process.env.PATH = '/first:/tools'
    const notExecutable = join('/first', 'cdp-bridge')
    const executable = join('/tools', 'cdp-bridge')
    fsp.exists = p => p === notExecutable || p === executable
    fsp.executable = p => p !== notExecutable

    expect(findCdpBridgeExecutable()).toBe(executable)
    expect(accessSync).toHaveBeenCalledWith(notExecutable, constants.X_OK)
    expect(accessSync).toHaveBeenCalledWith(executable, constants.X_OK)

    fsp.executable = () => false
    expect(findCdpBridgeExecutable()).toBeNull()
  })

  it('prefers UV_TOOL_BIN_DIR when the executable exists there', () => {
    process.env.UV_TOOL_BIN_DIR = '/custom/tool-bin'
    const expected = join('/custom/tool-bin', 'cdp-bridge')
    fsp.exists = (p) => p === expected

    expect(findCdpBridgeExecutable()).toBe(expected)
  })

  it('falls back to ~/.local/bin and then to PATH', () => {
    const wellKnown = join(HOME, '.local', 'bin', 'cdp-bridge')
    expect(findCdpBridgeExecutable()).toBeNull() // 无任何安装

    fsp.exists = (p) => p === wellKnown
    expect(findCdpBridgeExecutable()).toBe(wellKnown)

    // well-known 缺失时走 PATH 查询
    process.env.PATH = '/usr/bin'
    const onPath = join('/usr/bin', 'cdp-bridge')
    fsp.exists = (p) => p === onPath
    expect(findCdpBridgeExecutable()).toBe(onPath)
  })

  it('looks for cdp-bridge.exe on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    // win32 分支的实现用 path.win32，期望值也要用同一套分隔符。
    const expected = win32.join(HOME, '.local', 'bin', 'cdp-bridge.exe')
    fsp.exists = (p) => p === expected

    expect(findCdpBridgeExecutable()).toBe(expected)
  })
})

describe('findChromeDevtoolsMcpLocal', () => {
  // 使用非静态 npm 目录，确保 PATH 用例确实经过 PATH 扫描。
  const BIN = '/opt/npm/bin'
  const SHIM = join(BIN, 'chrome-devtools-mcp')
  const NODE = join('/usr/bin', 'node')
  const JS_ENTRY = join(
    BIN, 'node_modules', 'chrome-devtools-mcp',
    'build', 'src', 'bin', 'chrome-devtools-mcp.js',
  )

  it('finds Windows shims and node on PATH without blocking where processes', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const bin = 'C:\\Program Files\\nodejs'
    process.env.PATH = `C:\\missing;"${bin}"`
    process.env.PATHEXT = '.EXE;.CMD'
    const node = win32.join(bin, 'node.EXE')
    const shim = win32.join(bin, 'chrome-devtools-mcp.CMD')
    const entry = win32.join(bin, 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js')
    fsp.exists = p => [node, shim, entry].includes(p)
    // Windows 不应使用 Unix 的执行权限检查。
    fsp.executable = () => false

    expect(findChromeDevtoolsMcpLocal()).toEqual({ command: node, args: [entry] })
    expect(accessSync).not.toHaveBeenCalled()
  })

  it('upgrades a PATH-discovered shim to node + js entry', () => {
    process.env.PATH = `${BIN}:/usr/bin`
    fsp.exists = (p) => p === SHIM || p === JS_ENTRY || p === NODE

    expect(findChromeDevtoolsMcpLocal()).toEqual({
      command: NODE,
      args: [JS_ENTRY],
    })
  })

  it('finds a Unix npm global installation outside PATH', () => {
    process.env.PATH = '/usr/bin'
    const shim = join('/usr/local/bin', 'chrome-devtools-mcp')
    const entry = join(
      '/usr/local/bin', 'node_modules', 'chrome-devtools-mcp',
      'build', 'src', 'bin', 'chrome-devtools-mcp.js',
    )
    fsp.exists = (p) => p === shim || p === entry || p === NODE

    expect(findChromeDevtoolsMcpLocal()).toEqual({ command: NODE, args: [entry] })
  })

  it('returns null when the js entry is missing beside the shim', () => {
    process.env.PATH = `${BIN}:/usr/bin`
    fsp.exists = (p) => p === SHIM || p === NODE

    expect(findChromeDevtoolsMcpLocal()).toBeNull()
  })

  it('returns null when node is not on PATH', () => {
    process.env.PATH = `${BIN}:/usr/bin`
    fsp.exists = (p) => p === SHIM || p === JS_ENTRY

    expect(findChromeDevtoolsMcpLocal()).toBeNull()
  })

  it('finds a shim next to node without spawning a PATH probe', () => {
    process.env.PATH = '/usr/bin'
    const shimNextToNode = join('/usr/bin', 'chrome-devtools-mcp')
    const jsEntryNextToNode = join(
      '/usr/bin', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js',
    )
    fsp.exists = (p) => p === shimNextToNode || p === jsEntryNextToNode || p === NODE
    // shim 不可直接执行，PATH 扫描跳过它；node 旁的布局仍可升级为 node + JS。
    fsp.executable = (p) => p !== shimNextToNode

    expect(findChromeDevtoolsMcpLocal()).toEqual({
      command: NODE,
      args: [jsEntryNextToNode],
    })
  })

  it('returns null when nothing is installed', () => {
    expect(findChromeDevtoolsMcpLocal()).toBeNull()
  })

  it('checks the npm global dir on Windows before PATH', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    process.env.APPDATA = 'C:\\Users\\u\\AppData\\Roaming'
    const shim = win32.join(process.env.APPDATA, 'npm', 'chrome-devtools-mcp.cmd')
    const jsEntry = win32.join(
      process.env.APPDATA, 'npm', 'node_modules', 'chrome-devtools-mcp',
      'build', 'src', 'bin', 'chrome-devtools-mcp.js',
    )
    const nodeDir = 'C:\\Program Files\\nodejs'
    process.env.PATH = nodeDir
    process.env.PATHEXT = '.exe;.cmd'
    const node = win32.join(nodeDir, 'node.exe')
    const pathShim = win32.join(nodeDir, 'chrome-devtools-mcp.cmd')
    const pathEntry = win32.join(
      nodeDir, 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js',
    )
    fsp.exists = (p) => [shim, jsEntry, node, pathShim, pathEntry].includes(p)

    expect(findChromeDevtoolsMcpLocal()).toEqual({
      command: node,
      args: [jsEntry],
    })
  })

  it('finds shims installed next to node when npm prefix is not %APPDATA%\\npm', () => {
    // 真实环境里 npm 的全局 bin 未必是 %APPDATA%\npm —— 解压版 Node / 自定义
    // prefix 时，全局 shim 直接落在 node.exe 旁边（本机就是
    // D:\program\node-v24.18.0-win-x64），%APPDATA%\npm 压根不存在。
    // 只认默认位置会让已安装的用户白白退回 npx。
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    process.env.APPDATA = 'C:\\Users\\u\\AppData\\Roaming'
    const nodeDir = 'D:\\program\\node-v24.18.0-win-x64'
    const shim = win32.join(nodeDir, 'chrome-devtools-mcp.cmd')
    const jsEntry = win32.join(
      nodeDir, 'node_modules', 'chrome-devtools-mcp',
      'build', 'src', 'bin', 'chrome-devtools-mcp.js',
    )
    process.env.PATH = nodeDir
    // PATH 只识别 .exe，让此用例覆盖 node 目录兜底，而非直接发现 .cmd。
    process.env.PATHEXT = '.exe'
    const node = win32.join(nodeDir, 'node.exe')
    fsp.exists = (p) => p === shim || p === jsEntry || p === node

    expect(findChromeDevtoolsMcpLocal()).toEqual({
      command: node,
      args: [jsEntry],
    })
  })
})
