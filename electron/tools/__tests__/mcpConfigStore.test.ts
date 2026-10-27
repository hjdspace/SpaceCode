// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * The MCP config store is the last gate before `--mcp-config <file>` is handed
 * to the Claude Code CLI. Two failure classes matter and both are silent:
 *
 * 1. A server entry that keeps SpaceCode metadata (id / name / enabled /
 *    _source) or lacks command/url fails the engine's schema validation and
 *    the CLI exits at startup — the whole session dies for one bad row.
 * 2. A deprecated key ('computer-use', an engine reserved name) reaching the
 *    file has the same effect.
 *
 * `MCP_CONFIG_PATH` is resolved at module scope from `app.getPath('userData')`,
 * so electron is mocked to a fixed directory and fs to an in-memory map; every
 * assertion goes through the exported functions, not the mock internals.
 */

const store = vi.hoisted(() => ({
  // Built here rather than as a module-level const: the electron mock factory
  // runs while mcpConfigStore is being imported, i.e. before any local const in
  // this file has been initialized.
  userData: process.cwd() + '/.fake-userdata',
  files: new Map<string, string>(),
  writeShouldThrow: false,
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => store.userData,
    isPackaged: false,
  },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => store.files.has(String(p)),
  readFileSync: (p: string) => {
    const value = store.files.get(String(p))
    if (value === undefined) throw new Error(`ENOENT: no such file, open '${p}'`)
    return value
  },
  writeFileSync: (p: string, data: string) => {
    if (store.writeShouldThrow) throw new Error('EDQUOT: quota exceeded')
    store.files.set(String(p), String(data))
  },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const resolver = vi.hoisted(() => ({
  builtinNameFromServerKey: vi.fn((_key: string) => null as string | null),
  resolveBuiltinMcp: vi.fn(),
  usesPackageManagerLauncher: vi.fn(
    (_config: { type: string; command?: string; args?: string[]; url?: string }) => false,
  ),
}))

vi.mock('../mcpConfigResolver', () => ({
  builtinNameFromServerKey: resolver.builtinNameFromServerKey,
  resolveBuiltinMcp: resolver.resolveBuiltinMcp,
  usesPackageManagerLauncher: resolver.usesPackageManagerLauncher,
}))

import { warn, error as logError } from '../../infra/logger'
import {
  anyServerNeedsPackageManagerLauncher,
  MCP_CONFIG_PATH,
  buildEnabledMcpConfig,
  loadMcpConfig,
  saveMcpConfig,
} from '../mcpConfigStore'

function writeRawConfig(value: unknown): void {
  store.files.set(MCP_CONFIG_PATH, JSON.stringify(value))
}

beforeEach(() => {
  store.files.clear()
  store.writeShouldThrow = false
  resolver.builtinNameFromServerKey.mockReset().mockReturnValue(null)
  resolver.resolveBuiltinMcp.mockReset()
  resolver.usesPackageManagerLauncher.mockReset().mockReturnValue(false)
})

describe('MCP_CONFIG_PATH', () => {
  it('lives under userData', () => {
    expect(MCP_CONFIG_PATH).toBe(path.join(store.userData, 'mcp-servers.json'))
  })
})

describe('loadMcpConfig', () => {
  it('returns an empty record when the file has never been written', () => {
    expect(loadMcpConfig()).toEqual({})
  })

  it('flattens the Claude Desktop nested shape', () => {
    writeRawConfig({ mcpServers: { fs: { command: 'npx', args: ['-y', 'fs'] } } })

    expect(loadMcpConfig()).toEqual({ fs: { command: 'npx', args: ['-y', 'fs'] } })
  })

  it('passes the flat shape through untouched', () => {
    writeRawConfig({ fs: { command: 'npx' }, db: { type: 'sse', url: 'http://x/sse' } })

    expect(Object.keys(loadMcpConfig())).toEqual(['fs', 'db'])
  })

  it('treats a top-level command field as a flat server rather than a nested wrapper', () => {
    // A file that is itself one server: { command, args, mcpServers? } must not
    // be mistaken for the nested shape, or the entry silently disappears.
    writeRawConfig({ command: 'python', args: ['bridge.py'], mcpServers: {} })

    expect(loadMcpConfig().command).toBe('python')
  })

  it('swallows a corrupt file and warns instead of blocking session start', () => {
    store.files.set(MCP_CONFIG_PATH, '{"mcpServers": ')

    expect(loadMcpConfig()).toEqual({})
    expect(warn).toHaveBeenCalled()
  })
})

describe('saveMcpConfig', () => {
  it('round-trips through loadMcpConfig', () => {
    saveMcpConfig({ fs: { command: 'npx', enabled: true } })

    expect(loadMcpConfig()).toEqual({ fs: { command: 'npx', enabled: true } })
  })

  it('lets a write failure propagate — the caller must not believe it saved', () => {
    store.writeShouldThrow = true

    expect(() => saveMcpConfig({ fs: { command: 'npx' } })).toThrow(/EDQUOT/)
    expect(logError).toHaveBeenCalled()
  })
})

describe('buildEnabledMcpConfig — filtering', () => {
  it('returns null when nothing is enabled, so the caller omits --mcp-config', () => {
    writeRawConfig({ a: { command: 'a', enabled: false } })

    expect(buildEnabledMcpConfig()).toBeNull()
  })

  it('drops disabled servers and claude.json-sourced ones', () => {
    writeRawConfig({
      off: { command: 'off', enabled: false },
      fromClaude: { command: 'c', _source: 'claude.json' },
      keep: { command: 'keep' },
    })

    expect(Object.keys(buildEnabledMcpConfig()!.mcpServers)).toEqual(['keep'])
  })

  it('drops a stdio server without a command and a remote server without a url', () => {
    writeRawConfig({
      noCommand: { type: 'stdio' },
      noUrl: { type: 'http' },
      ok: { command: 'npx' },
    })

    expect(Object.keys(buildEnabledMcpConfig()!.mcpServers)).toEqual(['ok'])
  })

  it('skips non-object entries instead of throwing on them', () => {
    writeRawConfig({ broken: null, ok: { command: 'npx' } })

    expect(Object.keys(buildEnabledMcpConfig()!.mcpServers)).toEqual(['ok'])
  })

  it('renames a deprecated key so an engine reserved name never reaches the CLI', () => {
    writeRawConfig({ 'computer-use': { command: 'cua-driver' } })

    const config = buildEnabledMcpConfig()!
    expect(Object.keys(config.mcpServers)).toEqual(['sc-computer-use'])
    expect(config.mcpServers['computer-use']).toBeUndefined()
  })
})

describe('buildEnabledMcpConfig — schema purity', () => {
  it('strips every SpaceCode metadata field', () => {
    writeRawConfig({
      fs: {
        id: 'srv-1',
        name: 'Filesystem',
        enabled: true,
        _source: 'settings.json',
        customFutureField: 'ignore me',
        command: 'npx',
        args: ['-y', 'server-filesystem'],
      },
    })

    expect(buildEnabledMcpConfig()!.mcpServers.fs).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'server-filesystem'],
    })
  })

  it('omits empty args and env rather than emitting zero-length containers', () => {
    writeRawConfig({ fs: { command: 'npx', args: [], env: {} } })

    expect(buildEnabledMcpConfig()!.mcpServers.fs).toEqual({ type: 'stdio', command: 'npx' })
  })

  it('keeps env on a stdio server', () => {
    writeRawConfig({ fs: { command: 'npx', env: { NODE_ENV: 'production' } } })

    expect(buildEnabledMcpConfig()!.mcpServers.fs.env).toEqual({ NODE_ENV: 'production' })
  })

  it('maps sse and http servers onto url + headers', () => {
    writeRawConfig({
      remote: { type: 'sse', url: 'http://127.0.0.1:8080/sse', headers: { Authorization: 'Bearer x' } },
      headless: { type: 'http', url: 'http://127.0.0.1:9090/mcp', headers: {} },
    })

    const { mcpServers } = buildEnabledMcpConfig()!
    expect(mcpServers.remote).toEqual({
      type: 'sse',
      url: 'http://127.0.0.1:8080/sse',
      headers: { Authorization: 'Bearer x' },
    })
    expect(mcpServers.headless).toEqual({ type: 'http', url: 'http://127.0.0.1:9090/mcp' })
  })

  it('defaults a server with no type to stdio', () => {
    writeRawConfig({ fs: { command: 'npx' } })

    expect(buildEnabledMcpConfig()!.mcpServers.fs.type).toBe('stdio')
  })
})

describe('buildEnabledMcpConfig — builtin delegation', () => {
  it('overwrites command, args and env when the resolver finds the builtin locally', () => {
    writeRawConfig({ 'cua-driver': { command: 'npx', args: ['fallback'], env: { A: '1' } } })
    resolver.builtinNameFromServerKey.mockReturnValue('cua-driver')
    resolver.resolveBuiltinMcp.mockReturnValue({
      status: 'resolved',
      config: { command: '/opt/cua-driver', args: ['--mcp'], env: { B: '2' } },
    })

    expect(buildEnabledMcpConfig()!.mcpServers['cua-driver']).toEqual({
      type: 'stdio',
      command: '/opt/cua-driver',
      args: ['--mcp'],
      env: { A: '1', B: '2' },
    })
    expect(resolver.resolveBuiltinMcp).toHaveBeenCalledWith('cua-driver', {
      command: 'npx',
      args: ['fallback'],
    })
  })

  it('keeps the original config when the resolver reports a user-rewritten command', () => {
    // cdp-bridge / chrome-devtools 的 command 被用户改写成非 uvx/npx 形态时，
    // 运行时覆盖必须让位：按用户配置原样注入 CLI。
    writeRawConfig({ 'cdp-bridge': { command: 'uvx', args: ['cdp-bridge@latest'] } })
    resolver.builtinNameFromServerKey.mockReturnValue('cdp-bridge')
    resolver.resolveBuiltinMcp.mockReturnValue({ status: 'fallback-original' })

    expect(buildEnabledMcpConfig()!.mcpServers['cdp-bridge']).toEqual({
      type: 'stdio',
      command: 'uvx',
      args: ['cdp-bridge@latest'],
    })
  })

  it('keeps the original command when a builtin dependency is missing', () => {
    // One unresolvable builtin must not take the whole session down: the CLI
    // fails that server alone and the remaining servers still load.
    writeRawConfig({ 'cua-driver': { command: 'npx', args: ['fallback'] } })
    resolver.builtinNameFromServerKey.mockReturnValue('cua-driver')
    resolver.resolveBuiltinMcp.mockReturnValue({ status: 'missing', reason: 'binary not found' })

    expect(buildEnabledMcpConfig()!.mcpServers['cua-driver']).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['fallback'],
    })
  })

  it('does not delegate for remote server types', () => {
    writeRawConfig({ 'browser-use': { type: 'http', url: 'http://127.0.0.1:3000/mcp' } })
    resolver.builtinNameFromServerKey.mockReturnValue('browser-use')

    expect(resolver.resolveBuiltinMcp).not.toHaveBeenCalled()
    expect(buildEnabledMcpConfig()!.mcpServers['browser-use'].type).toBe('http')
  })

  it('delegates under the renamed key, not the deprecated one', () => {
    writeRawConfig({ 'computer-use': { command: 'npx' } })
    resolver.builtinNameFromServerKey.mockImplementation((key: string) => (key === 'sc-computer-use' ? 'cua-driver' : null))
    resolver.resolveBuiltinMcp.mockReturnValue({ status: 'resolved', config: { command: '/opt/cua' } })

    buildEnabledMcpConfig()
    expect(resolver.builtinNameFromServerKey).toHaveBeenCalledWith('sc-computer-use')
  })
})

describe('anyServerNeedsPackageManagerLauncher', () => {
  it('is false when there is no config file at all', () => {
    expect(anyServerNeedsPackageManagerLauncher()).toBe(false)
    expect(resolver.usesPackageManagerLauncher).not.toHaveBeenCalled()
  })

  it('is true as soon as one enabled server uses a launcher', () => {
    writeRawConfig({
      'sc-computer-use': { type: 'stdio', command: 'cua-driver', args: ['mcp'] },
      'cdp-bridge': { type: 'stdio', command: 'uvx', args: ['cdp-bridge@latest'] },
    })
    resolver.usesPackageManagerLauncher.mockImplementation(
      (config: { command?: string }) => config.command === 'uvx',
    )

    expect(anyServerNeedsPackageManagerLauncher()).toBe(true)
  })

  it('skips disabled servers — turning a preset off must not buy everyone a longer timeout', () => {
    writeRawConfig({
      'cdp-bridge': { type: 'stdio', command: 'uvx', enabled: false },
    })
    resolver.usesPackageManagerLauncher.mockReturnValue(true)

    expect(anyServerNeedsPackageManagerLauncher()).toBe(false)
  })

  it('skips claude.json servers, which buildEnabledMcpConfig never injects either', () => {
    // 这些由 CLI 自己发现，SpaceCode 不为它们的启动成本负责。
    writeRawConfig({
      'someone-elses-npx': { type: 'stdio', command: 'npx', _source: 'claude.json' },
    })
    resolver.usesPackageManagerLauncher.mockReturnValue(true)

    expect(anyServerNeedsPackageManagerLauncher()).toBe(false)
  })

  it('hands the predicate the type so remote servers can be ruled out', () => {
    writeRawConfig({ 'cloud': { type: 'http', url: 'https://api.example.com/mcp' } })

    anyServerNeedsPackageManagerLauncher()

    expect(resolver.usesPackageManagerLauncher).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'http', url: 'https://api.example.com/mcp' }),
    )
  })

  it('treats a missing type as stdio, matching buildEnabledMcpConfig', () => {
    writeRawConfig({ 'legacy': { command: 'npx', args: ['-y', 'pkg'] } })

    anyServerNeedsPackageManagerLauncher()

    expect(resolver.usesPackageManagerLauncher).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stdio', command: 'npx' }),
    )
  })
})
