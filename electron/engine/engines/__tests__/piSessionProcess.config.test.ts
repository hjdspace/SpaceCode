// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { PiSessionProcess } from '../PiSessionProcess'
import { resetPiCliProbeCache } from '../piCliResolver'
import type { EngineSessionConfig } from '../types'
import { info as loggerInfo, warn as loggerWarn } from '../../../infra/logger'

/**
 * Engine launch configuration: which cli.js to run, which flags and env vars the
 * pi CLI needs, and the models.json override that makes custom endpoints work.
 *
 * Two contracts matter more than the rest:
 *   - resolution → verdict. Which pi to spawn and whether its version clears the
 *     host floor is decided in piCliResolver (pinned there, along with the dev
 *     candidate order). What this suite pins is what PiSessionProcess does with
 *     that verdict: record it on the session, and refuse to start a session it
 *     cannot vouch for. A packaged build must never reach a user-installed `pi`
 *     or an `npx` pull — that is how the engine version escaped our control.
 *   - provider identity. The UI routinely pairs `provider=openai` with a
 *     third-party baseUrl. pi resolves models by provider name, so the baseUrl is
 *     mapped back to its canonical provider; when it is not a known one, the
 *     `openai-compat` provider is written into ~/.pi/agent/models.json because the
 *     built-in `openai` provider speaks the Responses API and third-party
 *     endpoints only implement Chat Completions.
 */

interface CompatModel {
  id: string
  name?: string
  reasoning?: boolean
  input?: string[]
  contextWindow?: number
  maxTokens?: number
}

interface ModelsJsonProvider {
  name?: string
  api?: string
  baseUrl?: string
  apiKey?: string
  compat?: Record<string, unknown>
  models?: CompatModel[]
  [key: string]: unknown
}

interface ModelsJson {
  providers: Record<string, ModelsJsonProvider>
}

interface PrivateConfigApi {
  resolveCliPath(): string
  buildArgs(): string[]
  buildEnv(): Record<string, string>
  writeModelsJsonOverride(provider: string, baseUrl: string): void
  detectProviderFromBaseUrl(baseUrl: string | undefined): string | undefined
  resolveEffectiveProvider(): string | undefined
  shouldUseCompatProvider(): boolean
}

const HOME = '/home/u'
const APP_ROOT = '/app/root'
const RESOURCES = '/app/resources'
const SRC_DIR = path.resolve(__dirname, '..')
const DEV_CLI_1 = path.resolve(SRC_DIR, '..', '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const DEV_CLI_2 = path.resolve(SRC_DIR, '..', '..', '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const APP_CLI = path.join(APP_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const APP_MONOREPO_CLI = path.join(APP_ROOT, 'pi-engine', 'packages', 'coding-agent', 'dist', 'cli.js')
const RES_CLI = path.join(RESOURCES, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const RES_PI_ENGINE_CLI = path.join(RESOURCES, 'pi-engine', 'dist', 'cli.js')
/** #52 之后 packaged 分支唯一的落点：extraResources 搬出去的自包含 bundle */
const BUNDLED_CLI = path.join(RESOURCES, 'pi', 'dist', 'bundle', 'cli.js')
const BUNDLED_PKG_JSON = path.join(RESOURCES, 'pi', 'package.json')
/** 旧布局的两处落点：asar 里的 node_modules 副本与 resources 下的 node_modules */
const LEGACY_UNPACKED_CLI = path.join(RESOURCES, 'app.asar.unpacked', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const PI_AGENT_DIR = path.join(HOME, '.pi', 'agent')
const MODELS_JSON = path.join(PI_AGENT_DIR, 'models.json')

/** cli.js 所属包根的 package.json —— 解析器就靠它拿版本 */
function packageJsonFor(cli: string, version: string): void {
  H.files.set(path.join(path.dirname(path.dirname(cli)), 'package.json'), JSON.stringify({ version }))
}

const H = vi.hoisted(() => ({
  existing: new Set<string>(),
  files: new Map<string, string>(),
  writes: [] as Array<{ path: string; content: string }>,
  mkdirs: [] as string[],
  writeThrows: false,
  lookupCalls: [] as string[],
  lookupResult: null as string | null,
  versionProbeCalls: [] as string[][],
  versionProbeResult: null as string | null,
  isPackaged: false,
  appPath: '/app/root',
  appPathThrows: false,
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => H.existing.has(String(p)),
  mkdirSync: (p: unknown) => {
    H.mkdirs.push(String(p))
  },
  writeFileSync: (p: unknown, data: unknown) => {
    if (H.writeThrows) throw new Error('EPERM: operation not permitted')
    H.writes.push({ path: String(p), content: String(data) })
  },
  readFileSync: (p: unknown) => {
    const key = String(p)
    if (!H.files.has(key)) throw new Error(`ENOENT: no such file or open '${key}'`)
    return H.files.get(key) as string
  },
}))

vi.mock('os', () => ({ homedir: () => '/home/u' }))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return H.isPackaged
    },
    getAppPath() {
      if (H.appPathThrows) throw new Error('The app module is not available until app is ready')
      return H.appPath
    },
    getPath: () => '/home/u',
  },
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

vi.mock('../../../session/engineChildProcess', () => ({
  killTree: vi.fn(),
  isProbableBunExecutable: vi.fn(() => false),
}))

// 解析器现在静态 import child_process（不再是函数体里的 require），模块 mock 能拦住它 ——
// 否则这些用例会真的去 shell out `where pi`，撞上本机装着 pi 的机器就不可复现。
vi.mock('child_process', () => ({
  execSync: (cmd: string) => {
    H.lookupCalls.push(cmd)
    if (H.lookupResult === null) throw new Error(`${cmd} exited with code 1`)
    return H.lookupResult
  },
  execFileSync: (file: string, args: string[]) => {
    H.versionProbeCalls.push([file, ...args])
    if (H.versionProbeResult === null) throw new Error(`${file} exited with code 1`)
    return H.versionProbeResult
  },
  spawn: vi.fn(),
}))

const BASE: EngineSessionConfig = { cwd: '/ws' }
const ORIGINAL_PLATFORM = process.platform

function privates(proc: PiSessionProcess): PrivateConfigApi {
  return proc as unknown as PrivateConfigApi
}

let OPEN: PiSessionProcess[] = []

function newProc(config: Partial<EngineSessionConfig> = {}): PiSessionProcess {
  const proc = new PiSessionProcess('pi-config-0001', { ...BASE, ...config })
  OPEN.push(proc)
  return proc
}

/** The first line `where`/`which` prints is the one the resolver uses. */
function globalLookup(path1: string): void {
  H.lookupResult = `${path1}\r\nC:\\other\\pi.cmd\n`
  H.existing.add(path1)
}

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  }
}

function writtenModels(): ModelsJson {
  expect(H.writes).toHaveLength(1)
  return JSON.parse(H.writes[0].content) as ModelsJson
}

beforeEach(() => {
  vi.clearAllMocks()
  resetPiCliProbeCache()
  H.existing = new Set()
  H.files = new Map()
  H.writes = []
  H.mkdirs = []
  H.writeThrows = false
  H.lookupCalls = []
  H.lookupResult = null
  H.versionProbeCalls = []
  H.versionProbeResult = null
  H.isPackaged = false
  H.appPath = APP_ROOT
  H.appPathThrows = false
  OPEN = []
  delete process.env.CLAUDE_CONFIG_DIR
  Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true })
})

afterEach(() => {
  for (const proc of OPEN) proc.removeAllListeners()
  OPEN = []
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
})

describe('resolveCliPath — 打包态只认随产物走的那份 pi (#52)', () => {
  it('spawn resources/pi 里的 bundled 入口，并把版本记到会话上', () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI).add(LEGACY_UNPACKED_CLI).add(RES_CLI)
    H.files.set(BUNDLED_PKG_JSON, JSON.stringify({ version: '1.3.0' }))
    globalLookup('C:\\tools\\pi.exe')

    const proc = newProc()

    expect(privates(proc).resolveCliPath()).toBe(BUNDLED_CLI)
    expect(proc.engineVersion).toBe('1.3.0')
    expect(proc.engineVersionCompatible).toBe(true)
    // 用户机器上装没装 pi 与打包版无关：一次都不该去查询
    expect(H.lookupCalls).toEqual([])
  })

  it('bundled 不在就抛，绝不退回旧 asar 副本或用户全局的 pi', () => {
    H.isPackaged = true
    H.existing.add(LEGACY_UNPACKED_CLI).add(RES_CLI)
    globalLookup('C:\\tools\\pi.exe')

    const proc = newProc()

    expect(() => privates(proc).resolveCliPath()).toThrow(/bundled pi shipped with this build is missing/)
    expect(proc.engineVersion).toBeNull()
    expect(proc.engineVersionCompatible).toBe(false)
    expect(H.lookupCalls).toEqual([])
  })

  it('bundled 版本低于能力下限时拒绝起会话，并把读到的版本留在会话上', () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI)
    H.files.set(BUNDLED_PKG_JSON, JSON.stringify({ version: '0.73.0' }))

    const proc = newProc()

    expect(() => privates(proc).resolveCliPath()).toThrow(/below the required 1\.0\.0/)
    expect(proc.engineVersion).toBe('0.73.0')
    expect(proc.engineVersionCompatible).toBe(false)
  })

  it('读不到 bundled 的 package.json 也算无从核验 —— 光搬 bundle 不搬清单是不行的', () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI)

    const proc = newProc()

    expect(() => privates(proc).resolveCliPath()).toThrow(/could not be verified/)
    expect(proc.engineVersion).toBeNull()
    expect(proc.engineVersionCompatible).toBe(false)
  })
})

describe('resolveCliPath — dev 里的候选（顺序细节钉在 piCliResolver.test.ts）', () => {
  it('用编译产物旁的 node_modules 副本并记下它的版本', () => {
    H.existing.add(DEV_CLI_1).add(DEV_CLI_2).add(APP_CLI)
    packageJsonFor(DEV_CLI_1, '1.3.0')

    const proc = newProc()

    expect(privates(proc).resolveCliPath()).toBe(DEV_CLI_1)
    expect(proc.engineVersion).toBe('1.3.0')
  })

  it('本机全局装的 pi 版本够格才用，且是靠 --version 探针问出来的', () => {
    globalLookup('C:\\tools\\pi.exe')
    H.versionProbeResult = '1.3.0\n'

    const proc = newProc()

    expect(withPlatform('win32', () => privates(proc).resolveCliPath())).toBe('pi')
    expect(proc.engineVersion).toBe('1.3.0')
    expect(H.lookupCalls).toEqual(['where pi'])
    expect(H.versionProbeCalls).toEqual([['pi', '--version']])
  })

  it('全局 pi 版本问不出来就不起 —— 旧实现会退到 npx 拉一个没人管版本的引擎', () => {
    globalLookup('C:\\tools\\pi.exe')
    H.versionProbeResult = null

    const proc = newProc()

    expect(() => privates(proc).resolveCliPath()).toThrow(/could not be verified/)
    expect(proc.engineVersionCompatible).toBe(false)
  })

  it('盘上没有任何候选时抛错，不再返回 npx', () => {
    const proc = newProc()

    expect(() => privates(proc).resolveCliPath()).toThrow(/no pi CLI found/)
    expect(loggerWarn).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('Pi unavailable | reason=not-found'))
  })
})

describe('buildArgs — provider and model selection', () => {
  it('passes the configured provider and model through', () => {
    const proc = newProc({ provider: 'anthropic', model: 'claude-sonnet-4' })
    expect(privates(proc).buildArgs()).toEqual(['--provider', 'anthropic', '--model', 'claude-sonnet-4'])
  })

  it('normalises the provider and strips its own prefix from the model id', () => {
    const proc = newProc({ provider: ' OpenAI ', model: 'OpenAI/GPT-4o' })
    expect(privates(proc).buildArgs()).toEqual(['--provider', 'openai', '--model', 'GPT-4o'])
  })

  it('keeps the model id when no provider was resolved', () => {
    const proc = newProc({ model: 'openai/gpt-4o' })
    expect(privates(proc).buildArgs()).toEqual(['--model', 'openai/gpt-4o'])
  })

  it('keeps a foreign provider prefix on the model id', () => {
    const proc = newProc({ provider: 'anthropic', model: 'openai/gpt-4o' })
    expect(privates(proc).buildArgs()).toEqual(['--provider', 'anthropic', '--model', 'openai/gpt-4o'])
  })

  it('appends the api key, thinking level and prompt flags in CLI order', () => {
    const proc = newProc({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      apiKey: 'sk-abc',
      thinkingEnabled: true,
      systemPrompt: 'be terse',
      appendSystemPrompt: 'respond in Chinese',
    })

    expect(privates(proc).buildArgs()).toEqual([
      '--provider', 'anthropic',
      '--model', 'claude-sonnet-4',
      '--api-key', 'sk-abc',
      '--thinking', 'medium',
      '--system-prompt', 'be terse',
      '--append-system-prompt', 'respond in Chinese',
    ])
  })

  it('routes a third-party openai endpoint through the compat provider', () => {
    const proc = newProc({ provider: 'openai', baseUrl: 'https://llm.internal.example/v1', model: 'gpt-4o' })

    expect(privates(proc).buildArgs()).toEqual(['--provider', 'openai-compat', '--model', 'gpt-4o'])
  })

  it('leaves an openai/-prefixed model id intact while switching to the compat provider', () => {
    // only the models.json entry has its prefix stripped, the CLI flag does not —
    // flagged: the engine receives `--provider openai-compat --model openai/gpt-4o`
    const proc = newProc({ provider: 'openai', baseUrl: 'https://llm.internal.example/v1', model: 'openai/gpt-4o' })

    expect(privates(proc).buildArgs()).toEqual(['--provider', 'openai-compat', '--model', 'openai/gpt-4o'])
  })

  it('emits no model flag when the session has no model yet', () => {
    const proc = newProc({ provider: 'anthropic' })

    expect(privates(proc).buildArgs()).toEqual(['--provider', 'anthropic'])
  })

  it('emits no provider flag at all for a blank provider', () => {
    const proc = newProc({ provider: '   ', model: 'm' })

    expect(privates(proc).buildArgs()).toEqual(['--model', 'm'])
  })
})

describe('provider inference from baseUrl', () => {
  const cases: Array<[string, string]> = [
    ['https://openrouter.ai/api/v1', 'openrouter'],
    ['https://api.deepseek.com/v1', 'deepseek'],
    ['https://api.groq.com/openai/v1', 'groq'],
    ['https://api.x.ai/v1', 'xai'],
    ['https://api.cerebras.ai/v1', 'cerebras'],
    ['https://api.moonshot.ai/v1', 'moonshotai'],
    ['https://api.moonshot.cn/v1', 'moonshotai-cn'],
    ['https://api.minimax.io/v1', 'minimax'],
    ['https://api.minimaxi.com/v1', 'minimax-cn'],
    ['https://api.mistral.ai/v1', 'mistral'],
    ['https://ai-gateway.vercel.sh/v1', 'vercel-ai-gateway'],
    ['https://api.fireworks.ai/inference/v1', 'fireworks'],
    ['https://api.z.ai/api/paas/v4', 'zai'],
    ['https://generativelanguage.googleapis.com/v1beta', 'google'],
    ['https://api.anthropic.com/v1', 'anthropic'],
  ]

  it('maps every known OpenAI-compatible endpoint to its pi provider id', () => {
    for (const [baseUrl, provider] of cases) {
      const proc = newProc({ provider: 'openai', baseUrl })
      expect(privates(proc).resolveEffectiveProvider(), baseUrl).toBe(provider)
    }
  })

  it('matches the endpoint case-insensitively', () => {
    const proc = newProc({ provider: 'openai', baseUrl: 'https://OPENROUTER.AI/api/v1' })

    expect(privates(proc).detectProviderFromBaseUrl('https://OPENROUTER.AI/api/v1')).toBe('openrouter')
    expect(privates(proc).resolveEffectiveProvider()).toBe('openrouter')
  })

  it('keeps the configured provider for an endpoint it does not recognise', () => {
    const proc = newProc({ provider: 'OpenAI', baseUrl: 'https://llm.internal.example/v1' })

    expect(privates(proc).detectProviderFromBaseUrl('https://llm.internal.example/v1')).toBeUndefined()
    expect(privates(proc).resolveEffectiveProvider()).toBe('openai')
  })

  it('has nothing to infer without a base url', () => {
    const proc = newProc({ provider: 'anthropic' })

    expect(privates(proc).detectProviderFromBaseUrl(undefined)).toBeUndefined()
    expect(privates(proc).detectProviderFromBaseUrl('')).toBeUndefined()
    expect(privates(proc).resolveEffectiveProvider()).toBe('anthropic')
  })

  it('only switches to the compat provider for a bare openai endpoint that is not OpenAI', () => {
    const matrix: Array<[Partial<EngineSessionConfig>, boolean]> = [
      [{ provider: 'openai', baseUrl: 'https://llm.internal.example/v1' }, true],
      [{ provider: 'openai', baseUrl: 'https://API.OPENAI.COM/v1' }, false],
      [{ provider: 'openai' }, false],
      [{ provider: 'anthropic', baseUrl: 'https://llm.internal.example/v1' }, false],
      [{ provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1' }, false],
    ]

    for (const [config, expected] of matrix) {
      expect(privates(newProc(config)).shouldUseCompatProvider(), JSON.stringify(config)).toBe(expected)
    }
  })
})

describe('buildEnv — auth plumbing', () => {
  const keyByProvider: Array<[string, string]> = [
    ['openai', 'OPENAI_API_KEY'],
    ['openrouter', 'OPENROUTER_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['google', 'GEMINI_API_KEY'],
    ['deepseek', 'DEEPSEEK_API_KEY'],
    ['groq', 'GROQ_API_KEY'],
    ['xai', 'XAI_API_KEY'],
    ['cerebras', 'CEREBRAS_API_KEY'],
    ['moonshotai', 'MOONSHOT_API_KEY'],
    ['moonshotai-cn', 'MOONSHOT_API_KEY'],
    ['minimax', 'MINIMAX_API_KEY'],
    ['minimax-cn', 'MINIMAX_API_KEY'],
    ['mistral', 'MISTRAL_API_KEY'],
    ['vercel-ai-gateway', 'AI_GATEWAY_API_KEY'],
    ['fireworks', 'FIREWORKS_API_KEY'],
    ['zai', 'ZAI_API_KEY'],
  ]

  it('exports the key under the variable pi-ai reads for that provider', () => {
    for (const [provider, envKey] of keyByProvider) {
      H.writes = []
      const proc = newProc({ provider, apiKey: `sk-${provider}` })

      expect(privates(proc).buildEnv(), provider).toEqual({ [envKey]: `sk-${provider}` })
    }
  })

  it('assumes an anthropic-shaped key for a provider pi does not know', () => {
    const proc = newProc({ provider: 'ollama', apiKey: 'sk-local' })

    expect(privates(proc).buildEnv()).toEqual({ ANTHROPIC_API_KEY: 'sk-local' })
  })

  it('exports OPENAI_API_KEY for the compat provider', () => {
    const proc = newProc({ provider: 'openai', baseUrl: 'https://llm.internal.example/v1', apiKey: 'sk-internal' })

    expect(privates(proc).buildEnv()).toEqual({ OPENAI_API_KEY: 'sk-internal' })
  })

  it('exports no credential when none is configured, but still pins the base url', () => {
    const proc = newProc({ provider: 'anthropic', baseUrl: 'https://llm.internal.example/v1' })

    expect(privates(proc).buildEnv()).toEqual({})
    // the endpoint override does not depend on having a key
    expect(H.writes).toHaveLength(1)
    expect(writtenModels().providers.anthropic).toEqual({ baseUrl: 'https://llm.internal.example/v1' })
  })

  it('writes the models.json override only once both provider and base url are known', () => {
    // a baseUrl with no inferable provider cannot be baked into models.json
    const noProvider = newProc({ baseUrl: 'https://llm.internal.example/v1', apiKey: 'sk-x' })
    expect(privates(noProvider).buildEnv()).toEqual({ ANTHROPIC_API_KEY: 'sk-x' })
    expect(H.writes).toEqual([])

    const withProvider = newProc({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x' })
    expect(privates(withProvider).buildEnv()).toEqual({ DEEPSEEK_API_KEY: 'sk-x' })
    expect(H.writes).toHaveLength(1)
  })
})

describe('writeModelsJsonOverride', () => {
  it('describes the compat provider with the chat-completions api and its own model entry', () => {
    H.existing.add(PI_AGENT_DIR)
    const proc = newProc({ provider: 'openai', baseUrl: 'https://llm.internal.example/v1', model: 'openai/gpt-4o' })

    privates(proc).writeModelsJsonOverride('openai', 'https://llm.internal.example/v1')

    const written = writtenModels()
    expect(written.providers['openai-compat']).toEqual({
      name: 'OpenAI Compatible',
      api: 'openai-completions',
      baseUrl: 'https://llm.internal.example/v1',
      // $ 前缀不是风格问题：pi >=0.77 起只有 $NAME / ${NAME} 算环境变量引用，
      // 裸 'OPENAI_API_KEY' 会被当作字面量提交上去当 key 用，直接 401。
      apiKey: '$OPENAI_API_KEY',
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: 'max_tokens',
        supportsStrictMode: false,
      },
      models: [
        { id: 'gpt-4o', name: 'gpt-4o', reasoning: false, input: ['text', 'image'], contextWindow: 128000, maxTokens: 16384 },
      ],
    })
    expect(H.writes[0].path).toBe(MODELS_JSON)
  })

  it('registers the user-configured context window instead of pi 的默认 128000', () => {
    H.existing.add(PI_AGENT_DIR)
    const proc = newProc({
      provider: 'openai',
      baseUrl: 'https://llm.internal.example/v1',
      model: 'openai/qwen-audit',
      modelContextWindows: { 'qwen-audit': 32000, 'other-model': 8000 },
    })

    privates(proc).writeModelsJsonOverride('openai', 'https://llm.internal.example/v1')

    expect(writtenModels().providers['openai-compat'].models).toEqual([
      { id: 'qwen-audit', name: 'qwen-audit', reasoning: false, input: ['text', 'image'], contextWindow: 32000, maxTokens: 16384 },
    ])
  })

  it('窗口按带 provider 前缀的原始模型名也能查到', () => {
    H.existing.add(PI_AGENT_DIR)
    const proc = newProc({
      provider: 'openai',
      baseUrl: 'https://llm.internal.example/v1',
      model: 'openai/kimi-k3',
      modelContextWindows: { 'openai/kimi-k3': 64000 },
    })

    privates(proc).writeModelsJsonOverride('openai', 'https://llm.internal.example/v1')

    expect(writtenModels().providers['openai-compat'].models?.[0]?.contextWindow).toBe(64000)
  })

  it('非法窗口值不参与注册', () => {
    H.existing.add(PI_AGENT_DIR)
    const proc = newProc({
      provider: 'openai',
      baseUrl: 'https://llm.internal.example/v1',
      model: 'qwen-audit',
      modelContextWindows: { 'qwen-audit': 0 },
    })

    privates(proc).writeModelsJsonOverride('openai', 'https://llm.internal.example/v1')

    expect(writtenModels().providers['openai-compat'].models?.[0]?.contextWindow).toBe(128000)
  })

  it('omits the model list when the session has no model configured', () => {
    H.existing.add(PI_AGENT_DIR)
    const proc = newProc({ provider: 'openai', baseUrl: 'https://llm.internal.example/v1' })

    privates(proc).writeModelsJsonOverride('openai', 'https://llm.internal.example/v1')

    const compat = writtenModels().providers['openai-compat']
    expect(compat.baseUrl).toBe('https://llm.internal.example/v1')
    expect(compat.models).toBeUndefined()
  })

  it('replaces a stale entry for the same model instead of duplicating it', () => {
    H.existing.add(PI_AGENT_DIR)
    H.existing.add(MODELS_JSON)
    H.files.set(
      MODELS_JSON,
      JSON.stringify({
        providers: {
          'openai-compat': { models: [{ id: 'gpt-4o', name: 'stale' }, { id: 'other-model' }] },
        },
      }),
    )
    const proc = newProc({ provider: 'openai', baseUrl: 'https://llm.internal.example/v1', model: 'gpt-4o' })

    privates(proc).writeModelsJsonOverride('openai', 'https://llm.internal.example/v1')

    const models = writtenModels().providers['openai-compat'].models as CompatModel[]
    expect(models.map((m) => m.id)).toEqual(['other-model', 'gpt-4o'])
  })

  it('only overrides the base url for a provider pi already ships', () => {
    H.existing.add(PI_AGENT_DIR)
    H.existing.add(MODELS_JSON)
    H.files.set(MODELS_JSON, JSON.stringify({ providers: { google: { baseUrl: 'https://old.example' }, custom: { name: 'keep me' } } }))
    const proc = newProc({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' })

    privates(proc).writeModelsJsonOverride('deepseek', 'https://api.deepseek.com/v1')

    const written = writtenModels()
    expect(written.providers.deepseek).toEqual({ baseUrl: 'https://api.deepseek.com/v1' })
    expect(written.providers.custom).toEqual({ name: 'keep me' })
    expect(written.providers['openai-compat']).toBeUndefined()
  })

  it('keeps the other settings of a provider entry that already exists', () => {
    H.existing.add(PI_AGENT_DIR)
    H.existing.add(MODELS_JSON)
    H.files.set(MODELS_JSON, JSON.stringify({ providers: { groq: { baseUrl: 'https://stale.example', apiKey: 'GROQ_API_KEY', models: [{ id: 'keep' }] } } }))
    const proc = newProc({ provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })

    privates(proc).writeModelsJsonOverride('groq', 'https://api.groq.com/openai/v1')

    expect(writtenModels().providers.groq).toEqual({
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'GROQ_API_KEY',
      models: [{ id: 'keep' }],
    })
  })

  it('starts over from an empty provider map when models.json is unparseable', () => {
    H.existing.add(PI_AGENT_DIR)
    H.existing.add(MODELS_JSON)
    H.files.set(MODELS_JSON, '{"providers": <<<half written>>>')
    const proc = newProc({ provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })

    privates(proc).writeModelsJsonOverride('groq', 'https://api.groq.com/openai/v1')

    expect(writtenModels()).toEqual({ providers: { groq: { baseUrl: 'https://api.groq.com/openai/v1' } } })
  })

  it('adds the providers map when the existing file has none', () => {
    H.existing.add(PI_AGENT_DIR)
    H.existing.add(MODELS_JSON)
    H.files.set(MODELS_JSON, '{}')
    const proc = newProc({ provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })

    privates(proc).writeModelsJsonOverride('groq', 'https://api.groq.com/openai/v1')

    expect(writtenModels()).toEqual({ providers: { groq: { baseUrl: 'https://api.groq.com/openai/v1' } } })
  })

  it('creates the pi agent directory when it is missing', () => {
    const proc = newProc({ provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })

    privates(proc).writeModelsJsonOverride('groq', 'https://api.groq.com/openai/v1')

    expect(H.mkdirs).toEqual([PI_AGENT_DIR])
  })

  it('leaves an existing pi agent directory alone', () => {
    H.existing.add(PI_AGENT_DIR)
    const proc = newProc({ provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })

    privates(proc).writeModelsJsonOverride('groq', 'https://api.groq.com/openai/v1')

    expect(H.mkdirs).toEqual([])
  })

  it('degrades to a warning when the override cannot be written', () => {
    H.existing.add(PI_AGENT_DIR)
    H.writeThrows = true
    const proc = newProc({ provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })

    expect(() => privates(proc).writeModelsJsonOverride('groq', 'https://api.groq.com/openai/v1')).not.toThrow()
    expect(loggerWarn).toHaveBeenCalledWith(
      'PiSessionProcess',
      expect.stringContaining('[pi-confi] Failed to write models.json override'),
      expect.any(Error),
    )
  })
})
