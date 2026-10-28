// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { SessionProcess, type SessionConfig } from '../sessionProcess'
import { sessionTempDir } from '../tempArtifacts'

/**
 * CLI argument assembly. The order and presence of these flags is the launch
 * contract with the Claude Code engine, so every conditional here is a real
 * product decision:
 *   - which model route the engine is told to use (proxy route IDs vs a raw
 *     model id, plus the `[1m]` 1M-context opt-in),
 *   - which temp `--settings` file gets written and what it must contain
 *     (proxy env-clearing vs native modelType vs RTK-hook-only),
 *   - whether on-disk MCP servers and the computer-use / browser-use system
 *     hints are injected,
 *   - and, critically, whether the session starts *fresh* (`--session-id`) or
 *     *continues* (`--resume`). Starting fresh against a transcript that already
 *     exists on disk makes the engine exit(1) with "Session ID ... already in
 *     use", so the resume detection has to mirror the engine's own resolution.
 *
 * We drive buildArgs directly (no spawn) with fs/os mocked so the writes and
 * existence checks are observable and deterministic.
 */

const HOME = vi.hoisted(() => '/home/u')
const TMP = vi.hoisted(() => '/tmp')

const fsp = vi.hoisted(() => ({
  exists: (() => false) as (p: string) => boolean,
  writes: [] as Array<{ path: string; content: string }>,
  removed: [] as string[],
  hooksRaw: null as string | null,
  realpathThrows: false,
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => fsp.exists(String(p)),
  mkdirSync: vi.fn(),
  writeFileSync: (p: unknown, c: unknown) => {
    fsp.writes.push({ path: String(p), content: String(c) })
  },
  rmSync: (p: unknown) => {
    fsp.removed.push(String(p))
  },
  readFileSync: () => fsp.hooksRaw ?? '{}',
  realpathSync: (p: unknown) => {
    if (fsp.realpathThrows) throw new Error('realpath failed')
    return String(p)
  },
  statSync: () => ({ isFile: () => true, size: 1_000_000 }),
  copyFileSync: vi.fn(),
  chmodSync: vi.fn(),
  readdirSync: () => [],
}))

vi.mock('os', () => ({
  homedir: () => HOME,
  tmpdir: () => TMP,
  platform: process.platform,
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn(() => HOME) },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  processRaw: vi.fn(), sdkMessage: vi.fn(), setSessionLogPath: vi.fn(), traceEvent: vi.fn(),
}))

const net = vi.hoisted(() => ({ proxyUrl: null as string | null }))
vi.mock('../../infra/proxyManager', () => ({
  proxyManager: { getProxyUrl: () => net.proxyUrl, start: vi.fn() },
  buildProxyConfigFromSettings: vi.fn(() => null),
}))

const mcp = vi.hoisted(() => ({
  config: null as { mcpServers: Record<string, unknown>; usesPackageManagerLauncher?: boolean } | null,
  throwOnBuild: false,
}))
vi.mock('../../tools/mcpConfigStore', () => ({
  buildEnabledMcpConfig: () => {
    if (mcp.throwOnBuild) throw new Error('disk gone')
    return mcp.config
  },
}))

vi.mock('../../tools/officeCliService', () => ({
  getOfficeCliInstallDir: vi.fn(() => '/office/bin'),
  syncInstalledOfficeCli: vi.fn(() => ({ copied: false, reason: 'up-to-date', bundledVersion: null, installedVersion: null })),
}))

vi.mock('../../tools/rtkManager', () => ({
  rtkManager: { isBinaryInstalled: vi.fn(() => false), getBinaryDir: vi.fn(() => '/rtk') },
}))

vi.mock('../engineChildProcess', () => ({
  killTree: vi.fn(),
  resolveBunPath: vi.fn(() => 'bun'),
  resolveBunPathForPackagedDesktop: vi.fn(() => null),
  isProbableBunExecutable: vi.fn(() => false),
  resolveCliRoot: vi.fn(() => '/engine-root'),
}))

const norm = (p: string) => p.replace(/\\/g, '/')

function buildArgs(overrides: Partial<SessionConfig> = {}, sessionId = 'sess-args-0001'): string[] {
  const config: SessionConfig = { cwd: '/tmp/ws', provider: 'anthropic', permissionMode: 'default', ...overrides }
  const proc = new SessionProcess(sessionId, config)
  try {
    return (proc as any).buildArgs(proc.config) as string[]
  } finally {
    proc.removeAllListeners()
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function settingsContent(args: string[]): Record<string, any> | null {
  const p = flag(args, '--settings')
  if (!p) return null
  const rec = fsp.writes.find((w) => w.path === p)
  return rec ? JSON.parse(rec.content) : null
}

beforeEach(() => {
  fsp.writes = []
  fsp.removed = []
  fsp.exists = () => false
  fsp.hooksRaw = null
  fsp.realpathThrows = false
  net.proxyUrl = null
  mcp.config = null
  mcp.throwOnBuild = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildArgs — base protocol flags', () => {
  it('opens the stream-json stdio protocol and starts in the configured permission mode', () => {
    const args = buildArgs()
    expect(args.slice(0, 9)).toEqual([
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode', 'default',
    ])
    // --dangerously-skip-permissions 的启动优先级高于 --permission-mode，
    // 一起传等于先起在全放行再指望控制请求改回去，所以非 bypass 意图一律不带它。
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(flag(args, '--permission-prompt-tool')).toBe('stdio')
    expect(flag(args, '--thinking')).toBe('disabled')
  })

  it('only grants bypass at startup when the user asked for 完全信任', () => {
    const args = buildArgs({ permissionMode: 'bypassPermissions' })
    expect(flag(args, '--permission-mode')).toBe('bypassPermissions')
    expect(args).toContain('--dangerously-skip-permissions')
  })

  it('reflects optional config flags only when the caller set them', () => {
    const args = buildArgs({
      effortLevel: 'high',
      systemPrompt: 'be terse',
      maxTurns: 5,
      maxBudgetUsd: 2.5,
      agent: 'general-purpose',
      allowedTools: ['Bash', 'Read'],
      thinkingEnabled: true,
      permissionMode: 'plan',
    })
    expect(flag(args, '--effort')).toBe('high')
    expect(flag(args, '--system-prompt')).toBe('be terse')
    expect(flag(args, '--max-turns')).toBe('5')
    expect(flag(args, '--max-budget-usd')).toBe('2.5')
    expect(flag(args, '--agent')).toBe('general-purpose')
    expect(flag(args, '--thinking')).toBe('enabled')
    expect(flag(args, '--permission-mode')).toBe('plan')
    // allowedTools spreads each tool as its own argv entry
    const i = args.indexOf('--allowedTools')
    expect(args.slice(i, i + 3)).toEqual(['--allowedTools', 'Bash', 'Read'])
  })

  /**
   * 档位必须先跟**引擎**词汇表求交再下发。内部引擎（bundle 2.8.4）对不认的 `--effort`
   * 值抛 InvalidArgumentError 让进程 exit 1，安装版 CLI（2.1.227）才只是 warn 后回落默认 ——
   * 所以传一个它不认的档不是"降级"而是"引擎进程异常"。UI 那层过滤挡不住持久化的旧值，
   * 这一道是兜底。探针见 src/shared/__tests__/effort.engineProbe.test.ts。
   */
  it.each([
    { engineSource: undefined, effortLevel: 'xhigh', expect: 'high', why: '缺省按 bundled 算' },
    { engineSource: 'bundled', effortLevel: 'xhigh', expect: 'high', why: '内部引擎没有 xhigh，向下取最近一档' },
    { engineSource: 'bundled', effortLevel: 'max', expect: 'max', why: 'max 是内部引擎认的最高档，不动它' },
    { engineSource: 'installed', effortLevel: 'xhigh', expect: 'xhigh', why: '安装版认 xhigh，不该被误钳' },
  ] as const)(
    'spawns --effort $expect on $engineSource when the config says $effortLevel ($why)',
    ({ engineSource, effortLevel, expect: expected }) => {
      expect(flag(buildArgs({ engineSource, effortLevel }), '--effort')).toBe(expected)
    },
  )

  it('omits --allowedTools entirely when the list is empty so the engine allows all', () => {
    expect(buildArgs({ allowedTools: [] })).not.toContain('--allowedTools')
  })
})

describe('buildArgs — --settings file selection', () => {
  it('writes an env-clearing anthropic settings file when a non-Anthropic provider can use the proxy', () => {
    net.proxyUrl = 'http://127.0.0.1:9'
    const args = buildArgs({ provider: 'openai', model: 'sonnet' })
    const content = settingsContent(args)!
    expect(content.modelType).toBe('anthropic')
    expect(content.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9')
    expect(content.env.ANTHROPIC_API_KEY).toBe('sk-spacecode-proxy')
    expect(content.env.OPENAI_BASE_URL).toBe('')
    expect(content.env.GEMINI_BASE_URL).toBe('')
  })

  it('writes a native modelType settings file when there is no proxy to route through', () => {
    net.proxyUrl = null
    const args = buildArgs({ provider: 'gemini', model: 'gemini-2.5-pro' })
    const content = settingsContent(args)!
    expect(content.modelType).toBe('gemini')
    expect(content.model).toBe('gemini-2.5-pro')
    expect(content.env).toBeUndefined()
  })

  it('merges global RTK hooks into the proxy settings so the PreToolUse hook survives the override', () => {
    net.proxyUrl = 'http://127.0.0.1:9'
    fsp.hooksRaw = JSON.stringify({ hooks: { PreToolUse: [{ h: 1 }] } })
    fsp.exists = (p) => norm(p).endsWith('/settings.json')
    const args = buildArgs({ provider: 'openai', model: 'sonnet', rtkEnabled: true })
    const content = settingsContent(args)!
    expect(content.hooks).toEqual({ PreToolUse: [{ h: 1 }] })
  })

  it('drops a settings file when RTK is on but there are no global hooks to preserve', () => {
    fsp.exists = () => false
    const args = buildArgs({ provider: 'anthropic', rtkEnabled: true })
    expect(args).not.toContain('--settings')
  })
})

describe('buildArgs — non-proxy model route & 1M opt-in', () => {
  it('appends [1m] to a raw model id only when the configured window exceeds 200K', () => {
    const small = buildArgs({ provider: 'anthropic', model: 'claude-sonnet-4-6', modelContextWindows: { 'claude-sonnet-4-6': 128_000 } })
    expect(flag(small, '--model')).toBe('claude-sonnet-4-6')

    const big = buildArgs({ provider: 'anthropic', model: 'claude-sonnet-4-6', modelContextWindows: { 'claude-sonnet-4-6': 400_000 } })
    expect(flag(big, '--model')).toBe('claude-sonnet-4-6[1m]')
  })

  it('does not double the [1m] suffix when the model already carries it', () => {
    const args = buildArgs({ provider: 'anthropic', model: 'gpt-5[1m]', modelContextWindows: { 'gpt-5[1m]': 1_000_000 } })
    expect(flag(args, '--model')).toBe('gpt-5[1m]')
  })

  it('leaves the model flag off when no model is configured', () => {
    expect(buildArgs({ provider: 'anthropic' })).not.toContain('--model')
  })
})

describe('buildArgs — MCP config & system-prompt hints', () => {
  it('injects --mcp-config and appends the computer-use hint when that server is enabled', () => {
    mcp.config = { mcpServers: { 'sc-computer-use': { command: 'cua-driver' } } }
    const args = buildArgs()
    expect(args).toContain('--mcp-config')
    const append = flag(args, '--append-system-prompt')!
    expect(append).toContain('mcp__sc-computer-use__')
    // every session also gets the AskUserQuestion guidance regardless of MCP state
    expect(append).toContain('AskUserQuestion')
  })

  it('appends the browser-use hint independently of computer-use', () => {
    mcp.config = { mcpServers: { 'browser-use': { command: 'python' } } }
    const args = buildArgs()
    const append = flag(args, '--append-system-prompt')!
    expect(append).toContain('mcp__browser-use__')
    expect(append).not.toContain('mcp__sc-computer-use__')
  })

  it('skips --mcp-config when nothing is enabled so the CLI falls back to ~/.claude.json', () => {
    mcp.config = { mcpServers: {} }
    const args = buildArgs()
    expect(args).not.toContain('--mcp-config')
    expect(flag(args, '--append-system-prompt')).not.toContain('mcp__sc-computer-use__')
  })

  it('still builds args when the MCP store throws — injection failure must not abort the session', () => {
    mcp.throwOnBuild = true
    const args = buildArgs()
    expect(args).toContain('--permission-prompt-tool')
    expect(args).not.toContain('--mcp-config')
    mcp.throwOnBuild = false
  })

  it('writes the pure CLI payload to --mcp-config — the host-side budget field never reaches the file', () => {
    mcp.config = {
      mcpServers: { 'cdp-bridge': { type: 'stdio', command: 'uvx', args: ['cdp-bridge@0.1.25'] } },
      usesPackageManagerLauncher: true,
    }
    buildArgs()

    const written = fsp.writes.find(w => w.content.includes('mcpServers'))!
    expect(Object.keys(JSON.parse(written.content))).toEqual(['mcpServers'])
  })

  it('carries this spawn\'s launcher verdict to the handshake budget, and drops it when the servers go away', () => {
    // resume / 重启在同一个 SessionProcess 上再跑一次 buildArgs，
    // 上一轮的预算结论不能留着把 MCP_TIMEOUT 一直抬在 30s。
    const config: SessionConfig = { cwd: '/tmp/ws', provider: 'anthropic', permissionMode: 'default' }
    const proc = new SessionProcess('sess-args-budget', config)
    try {
      mcp.config = {
        mcpServers: { 'cdp-bridge': { type: 'stdio', command: '/home/u/.local/bin/cdp-bridge' } },
        usesPackageManagerLauncher: true,
      }
      ;(proc as any).buildArgs(config)
      expect(proc.spawnedMcpUsesLauncher).toBe(true)

      mcp.config = { mcpServers: { fs: { type: 'stdio', command: 'node' } }, usesPackageManagerLauncher: false }
      ;(proc as any).buildArgs(config)
      expect(proc.spawnedMcpUsesLauncher).toBe(false)

      mcp.config = null
      ;(proc as any).buildArgs(config)
      expect(proc.spawnedMcpUsesLauncher).toBe(false)
    } finally {
      proc.removeAllListeners()
    }
  })
})

describe('buildArgs — resume vs fresh session-id', () => {
  it('honours an explicit resumeSessionId over every other continuation rule', () => {
    const args = buildArgs({ resumeSessionId: 'engine-old-99' })
    expect(flag(args, '--resume')).toBe('engine-old-99')
    expect(args).not.toContain('--session-id')
  })

  it('resumes a suspended session through its remembered engine id', () => {
    const proc = new SessionProcess('sess-susp', { cwd: '/tmp/ws', provider: 'anthropic' })
    proc.engineSessionId = 'engine-susp-1'
    proc.status = 'suspended'
    const args = (proc as any).buildArgs(proc.config) as string[]
    expect(flag(args, '--resume')).toBe('engine-susp-1')
    proc.removeAllListeners()
  })

  it('switches to --resume when the transcript jsonl already exists on disk', () => {
    fsp.exists = (p) => norm(p).includes('/projects/') && norm(p).endsWith('/sess-transcript-7.jsonl')
    const args = buildArgs({}, 'sess-transcript-7')
    expect(flag(args, '--resume')).toBe('sess-transcript-7')
    expect(args).not.toContain('--session-id')
  })

  it('falls back to a fresh --session-id when there is no transcript yet', () => {
    const args = buildArgs({}, 'sess-fresh-1')
    expect(flag(args, '--session-id')).toBe('sess-fresh-1')
    expect(args).not.toContain('--resume')
  })

  it('survives a realpath failure during transcript lookup', () => {
    fsp.realpathThrows = true
    const args = buildArgs({}, 'sess-realpath-throw')
    expect(flag(args, '--session-id')).toBe('sess-realpath-throw')
  })
})

describe('buildArgs — oversized system prompt goes through a file', () => {
  // Design mode embeds a whole DESIGN.md + tokens.css in the system prompt; 34 of the
  // 150 shipped design systems exceed Windows' 32,767-char command-line limit.
  const longPrompt = 'x'.repeat(30_000)

  it('externalizes a prompt that would overflow the command line', () => {
    const args = buildArgs({ systemPrompt: longPrompt }, 'sess-longprompt-1')
    expect(args).not.toContain('--system-prompt')
    const promptPath = flag(args, '--system-prompt-file')!
    // 目录名带 uid 后缀（POSIX 上 /tmp 多用户共享），不能在测试里写死。
    expect(norm(path.dirname(promptPath))).toBe(norm(sessionTempDir()))
    expect(path.basename(promptPath)).toMatch(/^system-prompt-sess-longprompt-1-\d+-[a-z0-9]+\.txt$/)
    expect(fsp.writes.find(w => w.path === promptPath)?.content).toBe(longPrompt)
  })

  it('keeps a short prompt inline — installed CLIs are not required to read the file flag', () => {
    const args = buildArgs({ systemPrompt: 'be terse' })
    expect(flag(args, '--system-prompt')).toBe('be terse')
    expect(args).not.toContain('--system-prompt-file')
    expect(fsp.writes.some(w => norm(w.path).includes('system-prompt-'))).toBe(false)
  })

  it('still passes the append-system-prompt inline when the main prompt moves to a file', () => {
    mcp.config = { mcpServers: { 'browser-use': { command: 'python' } } }
    const args = buildArgs({ systemPrompt: longPrompt })
    expect(flag(args, '--append-system-prompt')).toContain('mcp__browser-use__')
  })
})

describe('temp artifact cleanup', () => {
  it('杀死进程时回收本次 spawn 写下的 settings / mcp / system-prompt 文件', () => {
    net.proxyUrl = 'http://127.0.0.1:9'
    mcp.config = { mcpServers: { 'browser-use': { command: 'python' } } }
    const proc = new SessionProcess('sess-cleanup-1', {
      cwd: '/tmp/ws',
      provider: 'openai',
      permissionMode: 'default',
      systemPrompt: 'x'.repeat(30_000),
    })

    ;(proc as any).buildArgs(proc.config)
    const written = fsp.writes.map(w => norm(w.path))
    expect(written).toHaveLength(3)

    proc.kill()

    expect(fsp.removed.map(norm)).toEqual(expect.arrayContaining(written))
    proc.removeAllListeners()
  })
})

describe('buildArgs — working directory add-on', () => {
  it('grants the engine access to ~/.claude when it exists', () => {
    fsp.exists = (p) => norm(p) === '/home/u/.claude'
    const args = buildArgs()
    // the value is produced by the host path.join, so normalise separators
    expect(norm(flag(args, '--add-dir')!)).toBe('/home/u/.claude')
  })
})
