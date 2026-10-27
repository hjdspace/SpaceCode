// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { SessionProcess, type SessionConfig } from '../sessionProcess'

/**
 * Environment construction for the engine child process.
 *
 * The engine reads its whole provider/feature surface from env, so a wrong key
 * here silently re-routes traffic (or breaks it). The contract:
 *   - each provider branch (openai / gemini / anthropic) only sets its own
 *     provider variables plus the compat Anthropic key,
 *   - a non-Anthropic provider is *forced through the local proxy* so 429s get
 *     retried — when the proxy is already up we clear every direct-provider
 *     var, when it is not we start it on demand from gui-settings.json,
 *   - a set of safety flags (UTF-8, task tools, file checkpointing, root) is
 *     injected unless the caller's own env already pinned them,
 *   - and tool directories (officecli / RTK) are prepended to PATH so the
 *     engine's Bash tool can find them.
 *
 * Windows-only machine probing (registry PATH, Python dirs, Git Bash) no longer
 * lives in this class — it moved to `spawnEnvironment.ts`, which is async,
 * cached, and has its own test. Forcing `process.platform = 'linux'` here makes
 * that whole branch resolve to an empty snapshot, so this file stays about env
 * assembly.
 */

const HOME = vi.hoisted(() => '/home/u')

const fsp = vi.hoisted(() => ({
  exists: (() => false) as (p: string) => boolean,
  readGui: null as string | null,
  copies: [] as Array<{ from: string; to: string }>,
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => fsp.exists(String(p)),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: () => fsp.readGui ?? '{}',
  copyFileSync: (from: unknown, to: unknown) => {
    fsp.copies.push({ from: String(from), to: String(to) })
  },
  chmodSync: vi.fn(),
  readdirSync: () => [],
  realpathSync: (p: unknown) => String(p),
  statSync: () => ({ isFile: () => true, size: 1_000_000 }),
}))

vi.mock('os', () => ({
  homedir: () => HOME,
  tmpdir: () => '/tmp',
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: vi.fn((name: string) => (name === 'home' ? HOME : HOME)) },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  processRaw: vi.fn(), sdkMessage: vi.fn(), setSessionLogPath: vi.fn(), traceEvent: vi.fn(),
}))

const net = vi.hoisted(() => ({
  proxyUrl: null as string | null,
  startUrl: null as string | null,
  startCalls: 0,
}))
vi.mock('../../infra/proxyManager', () => ({
  proxyManager: {
    getProxyUrl: () => net.proxyUrl,
    start: vi.fn(async () => {
      net.startCalls++
      net.proxyUrl = net.startUrl
      // 真实 start() 的签名是 Promise<string>，buildEnv 用的就是它排空队列后的返回值
      return net.startUrl
    }),
  },
  buildProxyConfigFromSettings: vi.fn(() => ({ upstreamProvider: 'x' })),
}))

// buildEnv 不再自己读 MCP 存储：握手预算由 buildArgs 的解析结论作为入参传进来。
vi.mock('../../tools/mcpConfigStore', () => ({
  buildEnabledMcpConfig: vi.fn(() => null),
}))

const officeCli = vi.hoisted(() => ({
  syncCalls: 0,
  result: {
    copied: false as boolean,
    reason: 'up-to-date' as string,
    bundledVersion: '1.0.157' as string | null,
    installedVersion: '1.0.157' as string | null,
  },
}))
vi.mock('../../tools/officeCliService', () => ({
  getOfficeCliInstallDir: () => '/office/bin',
  syncInstalledOfficeCli: () => {
    officeCli.syncCalls++
    return officeCli.result
  },
}))

const rtk = vi.hoisted(() => ({ installed: false, dir: '/rtk/bin' }))
vi.mock('../../tools/rtkManager', () => ({
  rtkManager: {
    isBinaryInstalled: () => rtk.installed,
    getBinaryDir: () => rtk.dir,
  },
}))

vi.mock('../engineChildProcess', () => ({
  killTree: vi.fn(),
  resolveBunPath: vi.fn(() => 'bun'),
  resolveBunPathForPackagedDesktop: vi.fn(() => null),
  isProbableBunExecutable: vi.fn(() => false),
  resolveCliRoot: vi.fn(() => '/engine-root'),
}))

const norm = (p: string) => p.replace(/\\/g, '/')
const ENV_KEYS = [
  'CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS',
  'PYTHONUTF8',
  'PYTHONIOENCODING',
  'CLAUDE_CODE_ENABLE_TASKS',
  'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
  'CLAUDE_CODE_GIT_BASH_PATH',
  'MCP_TIMEOUT',
]

const originalPlatform = process.platform
const savedEnv: Record<string, string | undefined> = {}

async function buildEnv(
  overrides: Partial<SessionConfig> = {},
  mcpUsesLauncher = false,
): Promise<Record<string, string>> {
  const config: SessionConfig = { cwd: '/tmp/ws', ...overrides }
  const proc = new SessionProcess('sess-env-0001', config)
  try {
    return (await (proc as any).buildEnv(config, mcpUsesLauncher)) as Record<string, string>
  } finally {
    proc.removeAllListeners()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fsp.exists = () => false
  fsp.readGui = null
  fsp.copies = []
  net.proxyUrl = null
  net.startUrl = null
  net.startCalls = 0
  rtk.installed = false
  rtk.dir = '/rtk/bin'
  officeCli.syncCalls = 0
  officeCli.result = { copied: false, reason: 'up-to-date', bundledVersion: '1.0.157', installedVersion: '1.0.157' }
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

describe('buildEnv — per-provider variables', () => {
  it('gives an Anthropic session the desktop entrypoint and the compat key, but no proxy vars', async () => {
    const env = await buildEnv({ provider: 'anthropic', apiKey: 'sk-a', baseUrl: 'https://api' })
    expect(env.LLM_PROVIDER).toBe('anthropic')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-a')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api')
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe('claude-desktop')
    expect(env.CLAUDE_CODE_ROOT).toBe('/engine-root')
    expect(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBeUndefined()
  })

  it('sets the OpenAI direct vars and mirrors the key into the Anthropic slot for gateway compat', async () => {
    const env = await buildEnv({ provider: 'openai', apiKey: 'sk-o', baseUrl: 'https://o', model: 'gpt-5', thinkingEnabled: true })
    expect(env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(env.OPENAI_API_KEY).toBe('sk-o')
    expect(env.OPENAI_BASE_URL).toBe('https://o')
    expect(env.OPENAI_MODEL).toBe('gpt-5')
    expect(env.OPENAI_ENABLE_THINKING).toBe('1')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-o') // compat fallback, proxy was not reachable
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
  })

  it('sets the Gemini direct vars without touching OpenAI', async () => {
    const env = await buildEnv({ provider: 'gemini', apiKey: 'sk-g', baseUrl: 'https://g', model: 'gemini-2.5' })
    expect(env.CLAUDE_CODE_USE_GEMINI).toBe('1')
    expect(env.GEMINI_API_KEY).toBe('sk-g')
    expect(env.GEMINI_MODEL).toBe('gemini-2.5')
    expect(env.OPENAI_API_KEY).toBeUndefined()
  })
})

describe('buildEnv — non-Anthropic providers forced through the proxy', () => {
  it('clears every direct-provider var when the proxy is already up', async () => {
    net.proxyUrl = 'http://127.0.0.1:9'
    const env = await buildEnv({ provider: 'openai', model: 'gpt-5', baseUrl: 'https://o', apiKey: 'sk-o' })
    expect(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).toBe('1')
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-spacecode-proxy')
    expect(env.OPENAI_MODEL).toBe('')
    expect(env.OPENAI_BASE_URL).toBe('')
    expect(env.GEMINI_API_KEY).toBe('')
  })

  it('starts the proxy on demand from gui-settings.json when it is not yet running', async () => {
    net.startUrl = 'http://127.0.0.1:1234'
    fsp.readGui = JSON.stringify({ authMethod: 'openai_compatible', openaiConfig: { baseUrl: 'https://o', apiKey: 'sk' } })
    fsp.exists = (p) => norm(p).endsWith('/gui-settings.json')

    const env = await buildEnv({ provider: 'openai', model: 'gpt-5' })

    expect(net.startCalls).toBe(1)
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:1234')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-spacecode-proxy')
    expect(env.OPENAI_MODEL).toBe('')
  })

  it('degrades to direct provider vars when there is no gui-settings to build a proxy config from', async () => {
    fsp.exists = () => false // gui-settings.json missing → buildProxyConfig null
    const env = await buildEnv({ provider: 'openai', apiKey: 'sk-o', model: 'gpt-5' })
    expect(net.startCalls).toBe(0)
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.OPENAI_MODEL).toBe('gpt-5') // direct path kept
  })
})

describe('buildEnv — safety defaults & overrides', () => {
  it('injects the UTF-8 / task / checkpointing defaults when the host env left them unset', async () => {
    const env = await buildEnv({ provider: 'anthropic' })
    expect(env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS).toBe('80000')
    expect(env.PYTHONUTF8).toBe('1')
    expect(env.PYTHONIOENCODING).toBe('utf-8')
    expect(env.CLAUDE_CODE_ENABLE_TASKS).toBe('1')
    expect(env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING).toBe('1')
  })

  it('tightens the MCP handshake timeout to 15s when the caller left MCP_TIMEOUT unset', async () => {
    // engine 默认 30s：任一 MCP 握手挂住都会把 system/init 拖到 40s+。
    const env = await buildEnv({ provider: 'anthropic' })
    expect(env.MCP_TIMEOUT).toBe('15000')
  })

  it('gives the full 30s budget only when this spawn actually injects a launcher-shaped server', async () => {
    // uvx/npx 每次启动都要做包解析，uv 还会按 PyPI 的 max-age=600 周期性回源。
    // 实测 cdp-bridge 握手 4.7-5.4s（缓存新鲜）→ 6.9-10.8s（回源 + 并发），
    // 15s 预算会把本来健康的服务器判成 CONNECT_TIMEOUT。
    // 判据来自 buildArgs 解析之后的形态：预设被本地安装直连时走上面的 15s，
    // 磁盘上那条 uvx 记录不再单独把预算抬起来。
    const env = await buildEnv({ provider: 'anthropic' }, true)
    expect(env.MCP_TIMEOUT).toBe('30000')
  })

  it('respects an MCP_TIMEOUT the caller already pinned instead of overwriting it', async () => {
    process.env.MCP_TIMEOUT = '30000'
    const env = await buildEnv({ provider: 'anthropic' })
    expect(env.MCP_TIMEOUT).toBeUndefined()
  })

  it('respects a value the caller already pinned in process.env instead of overwriting it', async () => {
    process.env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS = '9999'
    const env = await buildEnv({ provider: 'anthropic' })
    expect(env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS).toBeUndefined()
  })

  it('passes the configured context window through to the auto-compact threshold', async () => {
    const env = await buildEnv({ provider: 'anthropic', model: 'm', modelContextWindows: { m: 250_000 } })
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('250000')
  })
})

describe('buildEnv — tool directory PATH injection', () => {
  it('reconciles the user-level officecli copy before every spawn and prepends its dir to PATH', async () => {
    // The copy/upgrade decision belongs to officeCliService (see
    // __tests__/officeCliInstallSync.test.ts); what this seam must guarantee is
    // that it runs before the CLI child starts, so Bash finds a current binary.
    officeCli.result = { copied: true, reason: 'outdated', bundledVersion: '1.0.157', installedVersion: '1.0.149' }
    fsp.exists = (p) => {
      const n = norm(p)
      return n === '/office/bin'
    }
    const env = await buildEnv({ provider: 'anthropic' })
    expect(officeCli.syncCalls).toBe(1)
    expect(env.PATH?.split(path.delimiter)[0]).toBe('/office/bin')
  })

  it('prepends the RTK bin dir only when the RTK binary is actually installed', async () => {
    rtk.installed = true
    const env = await buildEnv({ provider: 'anthropic', rtkEnabled: true })
    expect(env.PATH?.split(path.delimiter)[0]).toBe('/rtk/bin')
  })

  it('leaves PATH untouched when RTK is enabled but its binary was never installed', async () => {
    rtk.installed = false
    fsp.exists = () => false
    const env = await buildEnv({ provider: 'anthropic', rtkEnabled: true })
    expect(env.PATH).toBeUndefined()
  })
})
