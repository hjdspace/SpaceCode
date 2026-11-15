// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { readMcpServers, readPlugins } from '../agentConfigReaders'
import { setHomeOverride } from '../fsutil'

let tmpDir: string
let configDir: string

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value))
}

function writeRaw(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

/** Lay down a plugin manifest at <cache>/<rel>/.claude-plugin/plugin.json. */
function writePlugin(rel: string, manifest: unknown): string {
  const manifestPath = path.join(configDir, 'plugins', 'cache', rel, '.claude-plugin', 'plugin.json')
  writeJson(manifestPath, manifest)
  return manifestPath
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-readers-'))
  configDir = path.join(tmpDir, 'claude-cfg')
  setHomeOverride(tmpDir)
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  setHomeOverride(null)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('readMcpServers', () => {
  const settingsPath = () => path.join(configDir, 'settings.json')

  it('未知 agent 返回空数组', () => {
    expect(readMcpServers('does-not-exist')).toEqual([])
  })

  it('配置文件不存在时返回空数组', () => {
    expect(readMcpServers('claude-code')).toEqual([])
  })

  it('JSON 损坏时返回空数组而不是抛错', () => {
    writeRaw(settingsPath(), '{ 这不是 JSON')
    expect(readMcpServers('claude-code')).toEqual([])
  })

  it('缺少 mcpServers 键时返回空数组', () => {
    writeJson(settingsPath(), { someOtherKey: {} })
    expect(readMcpServers('claude-code')).toEqual([])
  })

  it('mcpServers 不是对象时返回空数组', () => {
    writeJson(settingsPath(), { mcpServers: 'nope' })
    expect(readMcpServers('claude-code')).toEqual([])
  })

  it('command 型服务器读出 command 与 args 并标记 valid', () => {
    writeJson(settingsPath(), {
      mcpServers: { fs: { command: 'npx', args: ['-y', 'server-fs'] } },
    })
    expect(readMcpServers('claude-code')).toEqual([
      { name: 'fs', command: 'npx', args: ['-y', 'server-fs'], valid: true, message: 'configured' },
    ])
  })

  it('没有 command 时回退到 url', () => {
    writeJson(settingsPath(), {
      mcpServers: { remote: { url: 'https://example.com/mcp' } },
    })
    expect(readMcpServers('claude-code')).toEqual([
      {
        name: 'remote',
        command: 'https://example.com/mcp',
        args: [],
        valid: true,
        message: 'configured',
      },
    ])
  })

  it('command 优先于 url', () => {
    writeJson(settingsPath(), {
      mcpServers: { both: { command: 'bin', url: 'https://example.com' } },
    })
    expect(readMcpServers('claude-code')[0].command).toBe('bin')
  })

  it('command 与 url 都缺失时标记 missing command', () => {
    writeJson(settingsPath(), { mcpServers: { broken: { args: ['x'] } } })
    expect(readMcpServers('claude-code')).toEqual([
      { name: 'broken', command: '', args: ['x'], valid: false, message: 'missing command' },
    ])
  })

  it('command 不是字符串时按缺失处理', () => {
    writeJson(settingsPath(), { mcpServers: { weird: { command: 42 } } })
    expect(readMcpServers('claude-code')[0]).toMatchObject({ command: '', valid: false })
  })

  it('args 里的非字符串项被过滤掉', () => {
    writeJson(settingsPath(), {
      mcpServers: { mixed: { command: 'bin', args: ['ok', 7, null, true, 'also-ok'] } },
    })
    expect(readMcpServers('claude-code')[0].args).toEqual(['ok', 'also-ok'])
  })

  it('args 不是数组时按空数组处理', () => {
    writeJson(settingsPath(), { mcpServers: { noargs: { command: 'bin', args: 'oops' } } })
    expect(readMcpServers('claude-code')[0].args).toEqual([])
  })

  it('多个服务器全部映射，保留配置里的名字', () => {
    writeJson(settingsPath(), {
      mcpServers: { alpha: { command: 'a' }, beta: { command: 'b' } },
    })
    expect(readMcpServers('claude-code').map((s) => s.name)).toEqual(['alpha', 'beta'])
  })

  it('空的 mcpServers 对象返回空数组', () => {
    writeJson(settingsPath(), { mcpServers: {} })
    expect(readMcpServers('claude-code')).toEqual([])
  })
})

describe('readPlugins', () => {
  it('非 claude-code 的 agent 一律返回空数组', () => {
    writePlugin('market/demo', { name: 'demo' })
    expect(readPlugins('codex')).toEqual([])
    expect(readPlugins('cursor')).toEqual([])
  })

  it('缓存目录不存在时返回空数组', () => {
    expect(readPlugins('claude-code')).toEqual([])
  })

  it('读出插件并按 name@source 生成 id', () => {
    writePlugin('market/demo', { name: 'demo', version: '1.2.3' })
    expect(readPlugins('claude-code')).toEqual([
      {
        id: 'demo@market',
        name: 'demo',
        version: '1.2.3',
        enabled: true,
        source: 'claude-plugin:market',
      },
    ])
  })

  it('displayName 优先级：interface.displayName > displayName > name', () => {
    writePlugin('m/a', { name: 'a', displayName: 'A2', interface: { displayName: 'A1' } })
    writePlugin('m/b', { name: 'b', displayName: 'B2' })
    writePlugin('m/c', { name: 'c' })
    const byId = new Map(readPlugins('claude-code').map((p) => [p.id, p.name]))
    expect(byId.get('a@m')).toBe('A1')
    expect(byId.get('b@m')).toBe('B2')
    expect(byId.get('c@m')).toBe('c')
  })

  it('interface.displayName 不是字符串时回退到 displayName', () => {
    writePlugin('m/a', { name: 'a', displayName: 'Fallback', interface: { displayName: 99 } })
    expect(readPlugins('claude-code')[0].name).toBe('Fallback')
  })

  it('缺少 version 时为 null', () => {
    writePlugin('m/a', { name: 'a' })
    expect(readPlugins('claude-code')[0].version).toBeNull()
  })

  it('version 不是字符串时为 null', () => {
    writePlugin('m/a', { name: 'a', version: 3 })
    expect(readPlugins('claude-code')[0].version).toBeNull()
  })

  it('name 两侧空白被裁掉', () => {
    writePlugin('m/a', { name: '  padded  ' })
    expect(readPlugins('claude-code')[0]).toMatchObject({ id: 'padded@m', name: 'padded' })
  })

  it('name 缺失或为空的 manifest 被跳过', () => {
    writePlugin('m/noname', { version: '1.0.0' })
    writePlugin('m/blank', { name: '   ' })
    writePlugin('m/numeric', { name: 123 })
    writePlugin('m/good', { name: 'good' })
    expect(readPlugins('claude-code').map((p) => p.id)).toEqual(['good@m'])
  })

  it('manifest JSON 损坏时跳过该插件而不中断扫描', () => {
    writeRaw(
      path.join(configDir, 'plugins', 'cache', 'm', 'broken', '.claude-plugin', 'plugin.json'),
      '{ 损坏',
    )
    writePlugin('m/good', { name: 'good' })
    expect(readPlugins('claude-code').map((p) => p.id)).toEqual(['good@m'])
  })

  it('没有设置文件时默认 enabled', () => {
    writePlugin('m/a', { name: 'a' })
    expect(readPlugins('claude-code')[0].enabled).toBe(true)
  })

  it('enabledPlugins 按 name@source 精确命中', () => {
    writePlugin('m/a', { name: 'a' })
    writeJson(path.join(configDir, 'settings.json'), { enabledPlugins: { 'a@m': false } })
    expect(readPlugins('claude-code')[0].enabled).toBe(false)
  })

  it('enabledPlugins 退回到裸 name 命中', () => {
    writePlugin('m/a', { name: 'a' })
    writeJson(path.join(configDir, 'settings.json'), { enabledPlugins: { a: false } })
    expect(readPlugins('claude-code')[0].enabled).toBe(false)
  })

  it('name@source 优先于裸 name', () => {
    writePlugin('m/a', { name: 'a' })
    writeJson(path.join(configDir, 'settings.json'), {
      enabledPlugins: { 'a@m': true, a: false },
    })
    expect(readPlugins('claude-code')[0].enabled).toBe(true)
  })

  it('enabledPlugins 里的非布尔值被过滤，落回默认 true', () => {
    writePlugin('m/a', { name: 'a' })
    writeJson(path.join(configDir, 'settings.json'), {
      enabledPlugins: { 'a@m': 'false', a: null },
    })
    expect(readPlugins('claude-code')[0].enabled).toBe(true)
  })

  it('enabledPlugins 不是对象时按空处理', () => {
    writePlugin('m/a', { name: 'a' })
    writeJson(path.join(configDir, 'settings.json'), { enabledPlugins: 'nope' })
    expect(readPlugins('claude-code')[0].enabled).toBe(true)
  })

  it('设置文件 JSON 损坏时按空处理，插件仍默认 enabled', () => {
    writePlugin('m/a', { name: 'a' })
    writeRaw(path.join(configDir, 'settings.json'), '{ 损坏')
    expect(readPlugins('claude-code')[0].enabled).toBe(true)
  })

  it('同一 id 出现多次时保留版本号更大的那个', () => {
    writePlugin('m/old', { name: 'dup', version: '1.0.0' })
    writePlugin('m/new', { name: 'dup', version: '2.0.0' })
    const plugins = readPlugins('claude-code')
    expect(plugins).toHaveLength(1)
    expect(plugins[0].version).toBe('2.0.0')
  })

  it('同一 id 的旧版本在后也不覆盖新版本', () => {
    writePlugin('m/new', { name: 'dup', version: '2.0.0' })
    writePlugin('m/old', { name: 'dup', version: '1.0.0' })
    expect(readPlugins('claude-code')[0].version).toBe('2.0.0')
  })

  it('version 缺失的重复项按空串比较，不覆盖有版本的', () => {
    writePlugin('m/with', { name: 'dup', version: '1.0.0' })
    writePlugin('m/without', { name: 'dup' })
    expect(readPlugins('claude-code')[0].version).toBe('1.0.0')
  })

  it('结果按显示名排序', () => {
    writePlugin('m/z', { name: 'zeta' })
    writePlugin('m/a', { name: 'alpha' })
    writePlugin('m/m', { name: 'mid' })
    expect(readPlugins('claude-code').map((p) => p.name)).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('嵌套目录里的插件也能被发现', () => {
    writePlugin('market/vendor/deep/demo', { name: 'demo' })
    expect(readPlugins('claude-code').map((p) => p.id)).toEqual(['demo@market'])
  })

  it('命中 manifest 的目录不再向下递归', () => {
    writePlugin('m/outer', { name: 'outer' })
    writePlugin('m/outer/inner', { name: 'inner' })
    expect(readPlugins('claude-code').map((p) => p.id)).toEqual(['outer@m'])
  })

  it('超过 8 层的嵌套不再扫描', () => {
    // rel 路径 N 段会在 depth N-1 被检查，因此 9 段是上限、10 段被截断
    writePlugin('a/b/c/d/e/f/g/h/limit', { name: 'at-limit' })
    writePlugin('a/b/c/d/e/f/g/h/i/toodeep', { name: 'too-deep' })
    expect(readPlugins('claude-code').map((p) => p.id)).toEqual(['at-limit@a'])
  })

  it('缓存目录下的普通文件被忽略', () => {
    writeRaw(path.join(configDir, 'plugins', 'cache', 'README.md'), '# not a plugin')
    writePlugin('m/a', { name: 'a' })
    expect(readPlugins('claude-code').map((p) => p.id)).toEqual(['a@m'])
  })

  it('没有 .claude-plugin/plugin.json 的目录不产出插件', () => {
    writeRaw(path.join(configDir, 'plugins', 'cache', 'm', 'empty', 'SKILL.md'), '# skill')
    expect(readPlugins('claude-code')).toEqual([])
  })
})