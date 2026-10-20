// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'path'

/**
 * `~/.pi/agent/mcp.json` 同时属于用户自己跑的 `pi` CLI，所以这里最关键的不是
 * 「能不能把配置写进去」，而是**写进去的时候不许动别人的东西**：
 * 手写的 server、`$schema` 这类顶层键、以及上一次的自己留下的条目，都要有确定的归宿。
 * 文件解析不了时必须拒绝写入 —— 覆盖一份坏 JSON 等于删掉用户的 server。
 *
 * 这台进程之外没有别的读者，所以 fs 用内存表替掉，electron 只为了
 * mcpConfigStore 在模块作用域取 userData 路径。
 */

const store = vi.hoisted(() => ({
  files: new Map<string, string>(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/fake-userdata', isPackaged: false },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => store.files.has(String(p)),
  readFileSync: (p: string) => {
    const value = store.files.get(String(p))
    if (value === undefined) throw new Error(`ENOENT: no such file, open '${p}'`)
    return value
  },
  writeFileSync: (p: string, data: string) => { store.files.set(String(p), String(data)) },
  mkdirSync: () => {},
  renameSync: (from: string, to: string) => {
    const value = store.files.get(String(from))
    if (value === undefined) throw new Error(`ENOENT: rename source '${from}'`)
    store.files.delete(String(from))
    store.files.set(String(to), value)
  },
}))

vi.mock('../mcpConfigResolver', () => ({
  builtinNameFromServerKey: () => null,
  resolveBuiltinMcp: () => ({ status: 'missing', error: 'not under test' }),
}))

import {
  isSpaceCodeOwned,
  mergeIntoPiFile,
  piMcpJsonPath,
  projectMcpForPi,
  readPiForeignServers,
  setPiForeignServerEnabled,
  syncPiMcpConfig,
} from '../piMcpProjection'
import type { PersistedMcpServer } from '../mcpConfigStore'

const HOME = '/fake-home'
const mcpPath = () => piMcpJsonPath(HOME)

function seedPiFile(content: unknown | string): void {
  store.files.set(
    join(HOME, '.pi', 'agent', 'mcp.json'),
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
  )
}

function readPiFileJson(): any {
  return JSON.parse(store.files.get(mcpPath()) as string)
}

beforeEach(() => {
  store.files.clear()
  delete process.env.PI_CODING_AGENT_DIR
})

describe('projectMcpForPi', () => {
  it('writes a pi-shaped stdio entry and drops every SpaceCode metadata field', () => {
    const { entries, skipped } = projectMcpForPi({
      'files-r-us': {
        id: 'uuid-1',
        name: 'Files R Us',
        enabled: true,
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'files-server'],
        env: { TOKEN: 'abc' },
        _source: 'settings.json',
        _configVersion: 3,
      } satisfies PersistedMcpServer,
    })

    expect(skipped).toEqual([])
    expect(entries).toHaveLength(1)
    // exposure=direct：留空的话 pi 默认 codemode 并自动激活它，等于往会话里塞一个
    // 界面没有卡片、权限闸也不拦的工具。
    expect(entries[0].entry).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'files-server'],
      env: { TOKEN: 'abc' },
      enabled: true,
      exposure: 'direct',
      _spacecode: { key: 'files-r-us' },
    })
  })

  it('keeps a disabled server in the file with enabled:false instead of dropping it', () => {
    const { entries } = projectMcpForPi({
      off: { name: 'off', command: 'noop', enabled: false },
    })
    expect(entries[0].entry.enabled).toBe(false)
  })

  it('rejects the legacy SSE transport rather than guessing a replacement URL', () => {
    const { entries, skipped } = projectMcpForPi({
      'old-sse': { type: 'sse', url: 'https://example.com/sse' },
    })
    expect(entries).toEqual([])
    expect(skipped).toEqual([expect.objectContaining({ key: 'old-sse', reason: 'unsupported-transport' })])
  })

  it('maps http entries onto url/headers and skips ones without a target', () => {
    const ok = projectMcpForPi({ cloud: { type: 'http', url: 'https://x/mcp', headers: { 'a': 'b' } } })
    expect(ok.entries[0].entry).toMatchObject({ type: 'http', url: 'https://x/mcp', headers: { a: 'b' } })

    const missing = projectMcpForPi({ broken: { type: 'http' } })
    expect(missing.skipped[0]).toMatchObject({ key: 'broken', reason: 'missing-target' })
  })

  it('sanitizes names pi would reject and disambiguates - / _ namespace clashes', () => {
    // pi 的命名空间只把 `-` 换成 `_`，大小写仍然敏感（core/mcp-servers.js:50）
    const { entries } = projectMcpForPi({
      'My Server.v2': { command: 'a' },
      My_Server_v2: { command: 'b' },
    })
    expect(entries.map(e => e.name)).toEqual(['My-Server-v2', 'My_Server_v2-2'])
  })

  it('skips a key that has no usable pi server name at all', () => {
    const { entries, skipped } = projectMcpForPi({ '···': { command: 'a' } })
    expect(entries).toEqual([])
    expect(skipped[0]).toMatchObject({ reason: 'invalid-name' })
  })
})

describe('mergeIntoPiFile', () => {
  const owned = {
    type: 'stdio',
    command: 'ours',
    enabled: true,
    exposure: 'direct',
    _spacecode: { key: 'ours' },
  }

  it('preserves foreign servers and unrelated top-level keys', () => {
    const existing = {
      $schema: 'https://example.com/mcp-schema.json',
      autoEnableCodemode: false,
      mcpServers: {
        TraceWeave: { command: 'python', args: ['server.py'] },
        'stale-owned': owned,
      },
    }
    const projection = projectMcpForPi({ fresh: { command: 'npx', args: ['-y', 'x'] } })

    const { json, written } = mergeIntoPiFile(existing, projection)

    expect(json.$schema).toBe('https://example.com/mcp-schema.json')
    expect(json.autoEnableCodemode).toBe(false)
    expect((json.mcpServers as any).TraceWeave).toEqual({ command: 'python', args: ['server.py'] })
    // 上一轮写的、这一轮没再投影出来的条目才算该消失
    expect(json.mcpServers).not.toHaveProperty('stale-owned')
    expect(written.map(w => w.name)).toEqual(['fresh'])
  })

  it('lets the user’s own entry win a name race and reports the loser', () => {
    const existing = { mcpServers: { ours: { command: 'hand-written' } } }
    const projection = projectMcpForPi({ ours: { command: 'ours' } })

    const { json, written, skipped } = mergeIntoPiFile(existing, projection)

    expect((json.mcpServers as any).ours).toEqual({ command: 'hand-written' })
    expect(written).toEqual([])
    expect(skipped).toEqual([expect.objectContaining({ key: 'ours', reason: 'name-conflict' })])
  })
})

describe('syncPiMcpConfig', () => {
  it('writes an owned entry into the user-level pi file', () => {
    const result = syncPiMcpConfig({ app: { command: 'node', args: ['server.js'], enabled: true } }, HOME)

    expect(result.wrote).toBe(true)
    expect(result.path).toBe(mcpPath())
    expect(readPiFileJson().mcpServers.app).toMatchObject({
      type: 'stdio',
      command: 'node',
      exposure: 'direct',
      _spacecode: { key: 'app' },
    })
  })

  it('does not create a mcp.json for a config with nothing to project', () => {
    const result = syncPiMcpConfig({}, HOME)

    expect(result.wrote).toBe(false)
    expect(store.files.has(mcpPath())).toBe(false)
  })

  it('still writes when an owned entry has to be removed', () => {
    syncPiMcpConfig({ app: { command: 'node', enabled: true } }, HOME)

    const result = syncPiMcpConfig({}, HOME)

    expect(result.wrote).toBe(true)
    expect(readPiFileJson().mcpServers).toEqual({})
  })

  it('refuses to overwrite a file pi itself cannot read', () => {
    seedPiFile('{ this is not json')

    const result = syncPiMcpConfig({ app: { command: 'node' } }, HOME)

    expect(result.wrote).toBe(false)
    expect(result.error).toContain('not valid JSON')
    expect(store.files.get(mcpPath())).toBe('{ this is not json')
  })

  it('is idempotent: a second sync with the same input does not touch the disk', () => {
    const servers = { app: { command: 'node', args: ['-y'], enabled: true } }
    syncPiMcpConfig(servers, HOME)

    const before = store.files.get(mcpPath())
    const second = syncPiMcpConfig(servers, HOME)

    expect(second.wrote).toBe(false)
    expect(store.files.get(mcpPath())).toBe(before)
  })

  it('keeps the indentation of a file written with 4 spaces', () => {
    seedPiFile('{\n    "mcpServers": {\n        "hand": { "command": "x" }\n    }\n}\n')

    syncPiMcpConfig({ app: { command: 'node' } }, HOME)

    expect(store.files.get(mcpPath())).toContain('\n    "mcpServers"')
  })
})

describe('readPiForeignServers', () => {
  it('lists only the entries SpaceCode does not own, with pi’s rejection reasons as codes', () => {
    seedPiFile({
      mcpServers: {
        ours: { command: 'x', _spacecode: { key: 'ours' } },
        TraceWeave: { command: 'python', args: ['server.py'], cwd: '/srv' },
        old: { type: 'sse', url: 'https://example.com/sse' },
        empty: { description: 'nothing to launch' },
        broken: 'not-an-object',
      },
    })

    const foreign = readPiForeignServers(HOME)

    expect(foreign.map(f => f.name)).toEqual(['TraceWeave', 'old', 'empty', 'broken'])
    expect(foreign[0]).toMatchObject({ transport: 'stdio', target: 'python server.py', enabled: true, invalid: null })
    expect(foreign[1]).toMatchObject({ transport: 'unknown', invalid: 'legacy-sse' })
    expect(foreign[2]).toMatchObject({ invalid: 'missing-target' })
    expect(foreign[3]).toMatchObject({ invalid: 'not-an-object', enabled: false })
  })

  it('returns nothing when the file is absent or unparseable', () => {
    expect(readPiForeignServers(HOME)).toEqual([])
    seedPiFile('###')
    expect(readPiForeignServers(HOME)).toEqual([])
  })
})

describe('setPiForeignServerEnabled', () => {
  it('flips only the enabled flag and leaves the rest of the user’s entry alone', () => {
    seedPiFile({
      $schema: 'https://example.com/schema.json',
      mcpServers: { TraceWeave: { command: 'python', args: ['server.py'], env: { K: 'V' } } },
    })

    const result = setPiForeignServerEnabled('TraceWeave', false, HOME)

    expect(result).toEqual({ ok: true })
    const written = readPiFileJson()
    expect(written.$schema).toBe('https://example.com/schema.json')
    expect(written.mcpServers.TraceWeave).toEqual({
      command: 'python',
      args: ['server.py'],
      env: { K: 'V' },
      enabled: false,
    })
  })

  it('refuses to edit an entry the MCP panel already owns', () => {
    syncPiMcpConfig({ app: { command: 'node', enabled: true } }, HOME)

    expect(setPiForeignServerEnabled('app', false, HOME)).toEqual({ ok: false, reason: 'managed-by-panel' })
  })

  it('reports a missing entry instead of writing one', () => {
    seedPiFile({ mcpServers: { other: { command: 'x' } } })
    expect(setPiForeignServerEnabled('ghost', true, HOME)).toEqual({ ok: false, reason: 'not-found' })
    expect(store.files.get(mcpPath())).toContain('"other"')
  })
})

describe('isSpaceCodeOwned', () => {
  it('recognizes only our own marker shape', () => {
    expect(isSpaceCodeOwned({ _spacecode: { key: 'a' } })).toBe(true)
    expect(isSpaceCodeOwned({ _spacecode: 'a' })).toBe(false)
    expect(isSpaceCodeOwned({ description: 'pi-only' })).toBe(false)
    expect(isSpaceCodeOwned(null)).toBe(false)
  })
})
