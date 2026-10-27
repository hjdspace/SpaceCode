// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'

/**
 * localMcpService 只做"找"：uv tool / npm global 的固定布局 + PATH 兜底。
 * 契约上要守住的是每一层缺失时的降级方向——任何一个环节缺失都不能给出
 * 半残的启动配置（宁可 null，让 resolver 回退到钉版本 uvx/npx）。
 */

const HOME = vi.hoisted(() => '/home/u')

const fsp = vi.hoisted(() => ({
  exists: (() => false) as (p: string) => boolean,
}))

const sh = vi.hoisted(() => ({
  // binName → where/which 返回的路径
  pathResults: {} as Record<string, string>,
  // 每次 PATH 探测都记下来：这些是真实的子进程，跑在会话 spawn 前的临界路径上
  probes: [] as string[],
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => fsp.exists(String(p)),
}))

vi.mock('os', () => ({ homedir: () => HOME }))

vi.mock('child_process', () => ({
  execFileSync: (_cmd: string, args: string[]) => {
    sh.probes.push(args[0])
    const found = sh.pathResults[args[0]]
    if (!found) throw new Error('not found')
    return found + '\n'
  },
}))

import { findCdpBridgeExecutable, findChromeDevtoolsMcpLocal } from '../localMcpService'

const originalPlatform = process.platform
const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = ['UV_TOOL_BIN_DIR', 'APPDATA']

beforeEach(() => {
  vi.clearAllMocks()
  fsp.exists = () => false
  sh.pathResults = {}
  sh.probes = []
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
})

describe('findCdpBridgeExecutable', () => {
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
    fsp.exists = (p) => p === '/usr/bin/cdp-bridge'
    sh.pathResults['cdp-bridge'] = '/usr/bin/cdp-bridge'
    expect(findCdpBridgeExecutable()).toBe('/usr/bin/cdp-bridge')
  })

  it('looks for cdp-bridge.exe on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const expected = join(HOME, '.local', 'bin', 'cdp-bridge.exe')
    fsp.exists = (p) => p === expected

    expect(findCdpBridgeExecutable()).toBe(expected)
  })
})

describe('findChromeDevtoolsMcpLocal', () => {
  const SHIM = '/usr/local/bin/chrome-devtools-mcp'
  const JS_ENTRY = join(
    '/usr/local/bin', 'node_modules', 'chrome-devtools-mcp',
    'build', 'src', 'bin', 'chrome-devtools-mcp.js',
  )

  it('upgrades a PATH-discovered shim to node + js entry', () => {
    sh.pathResults['chrome-devtools-mcp'] = SHIM
    sh.pathResults['node'] = '/usr/bin/node'
    fsp.exists = (p) => p === SHIM || p === JS_ENTRY || p === '/usr/bin/node'

    expect(findChromeDevtoolsMcpLocal()).toEqual({
      command: '/usr/bin/node',
      args: [JS_ENTRY],
    })
  })

  it('returns null when the js entry is missing beside the shim', () => {
    sh.pathResults['chrome-devtools-mcp'] = SHIM
    sh.pathResults['node'] = '/usr/bin/node'
    fsp.exists = (p) => p === SHIM || p === '/usr/bin/node'

    expect(findChromeDevtoolsMcpLocal()).toBeNull()
  })

  it('returns null when node is not on PATH', () => {
    sh.pathResults['chrome-devtools-mcp'] = SHIM
    fsp.exists = (p) => p === SHIM || p === JS_ENTRY

    expect(findChromeDevtoolsMcpLocal()).toBeNull()
  })

  it('shim 挨着 node 时，一次解析只起一个 `where node` 子进程', () => {
    // 兜底分支要靠 node 的位置找 shim，出口又要用 node 当 command —— 同一条答案。
    // 原先两处各起一次 which/execFile，而它跑在会话 spawn 前的临界路径上。
    const shimNextToNode = join('/usr/bin', 'chrome-devtools-mcp')
    const jsEntryNextToNode = join(
      '/usr/bin', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js',
    )
    sh.pathResults['node'] = '/usr/bin/node'
    fsp.exists = (p) => p === shimNextToNode || p === jsEntryNextToNode || p === '/usr/bin/node'

    expect(findChromeDevtoolsMcpLocal()).toEqual({
      command: '/usr/bin/node',
      args: [jsEntryNextToNode],
    })
    expect(sh.probes.filter(p => p === 'node')).toHaveLength(1)
  })

  it('returns null when nothing is installed', () => {
    expect(findChromeDevtoolsMcpLocal()).toBeNull()
  })

  it('checks the npm global dir on Windows before PATH', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    process.env.APPDATA = 'C:\\Users\\u\\AppData\\Roaming'
    const shim = join(process.env.APPDATA, 'npm', 'chrome-devtools-mcp.cmd')
    const jsEntry = join(
      process.env.APPDATA, 'npm', 'node_modules', 'chrome-devtools-mcp',
      'build', 'src', 'bin', 'chrome-devtools-mcp.js',
    )
    sh.pathResults['node'] = 'C:\\Program Files\\nodejs\\node.exe'
    fsp.exists = (p) => p === shim || p === jsEntry || p === 'C:\\Program Files\\nodejs\\node.exe'

    expect(findChromeDevtoolsMcpLocal()).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
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
    const shim = join(nodeDir, 'chrome-devtools-mcp.cmd')
    const jsEntry = join(
      nodeDir, 'node_modules', 'chrome-devtools-mcp',
      'build', 'src', 'bin', 'chrome-devtools-mcp.js',
    )
    sh.pathResults['node'] = join(nodeDir, 'node.exe')
    fsp.exists = (p) => p === shim || p === jsEntry || p === join(nodeDir, 'node.exe')

    expect(findChromeDevtoolsMcpLocal()).toEqual({
      command: join(nodeDir, 'node.exe'),
      args: [jsEntry],
    })
  })
})
