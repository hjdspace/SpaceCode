// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { PiSessionProcess } from '../PiSessionProcess'
import type { EngineSessionConfig } from '../types'
import { info as loggerInfo, warn as loggerWarn } from '../../../infra/logger'

/**
 * Engine launch configuration: which cli.js to run, which flags and env vars the
 * pi CLI needs, and the models.json override that makes custom endpoints work.
 *
 * Two contracts matter more than the rest:
 *   - resolution order. The bundled copy under node_modules wins over the app
 *     path, which wins over cwd, which wins over packaged resources, and only
 *     then a global `pi` / `npx`. A wrong pick launches a stale engine or ENOENTs.
 *     A global lookup result is only trusted if the file it names really exists.
 *   - provider identity. The UI routinely pairs `provider=openai` with a
 *     third-party baseUrl. pi resolves models by provider name, so the baseUrl is
 *     mapped back to its canonical provider; when it is not a known one, the
 *     `openai-compat` provider is written into ~/.pi/agent/models.json because the
 *     built-in `openai` provider speaks the Responses API and third-party
 *     endpoints only implement Chat Completions.
 *
 * NOTE ON THE `require` SEAM: resolveCliPath() reads child_process through a
 * function-body `require('child_process')`, which bypasses Vitest's module mock
 * (verified) — a test that reaches that line would shell out `where`/`which` for
 * real. The suite therefore stubs `execSync` on the real module object, which is
 * exactly the object the source destructures at call time.
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
const PI_AGENT_DIR = path.join(HOME, '.pi', 'agent')
const MODELS_JSON = path.join(PI_AGENT_DIR, 'models.json')

const H = vi.hoisted(() => ({
  existing: new Set<string>(),
  files: new Map<string, string>(),
  writes: [] as Array<{ path: string; content: string }>,
  mkdirs: [] as string[],
  writeThrows: false,
  lookupCalls: [] as string[],
  lookupResult: null as string | null,
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

const BASE: EngineSessionConfig = { cwd: '/ws' }
const ORIGINAL_PLATFORM = process.platform
const realChildProcess = require('child_process') as typeof import('child_process')
const ORIGINAL_EXEC_SYNC = realChildProcess.execSync

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
  H.existing = new Set()
  H.files = new Map()
  H.writes = []
  H.mkdirs = []
  H.writeThrows = false
  H.lookupCalls = []
  H.lookupResult = null
  H.isPackaged = false
  H.appPath = APP_ROOT
  H.appPathThrows = false
  OPEN = []
  delete process.env.CLAUDE_CONFIG_DIR
  Object.defineProperty(realChildProcess, 'execSync', {
    configurable: true,
    writable: true,
    value: (cmd: string) => {
      H.lookupCalls.push(cmd)
      if (H.lookupResult === null) throw new Error(`${cmd} exited with code 1`)
      return H.lookupResult
    },
  })
  Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true })
})

afterEach(() => {
  for (const proc of OPEN) proc.removeAllListeners()
  OPEN = []
  Object.defineProperty(realChildProcess, 'execSync', {
    configurable: true,
    writable: true,
    value: ORIGINAL_EXEC_SYNC,
  })
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
})

describe('resolveCliPath — bundled copy wins over every later strategy', () => {
  it('takes the node_modules sibling of the compiled electron bundle first', () => {
    H.existing.add(DEV_CLI_1).add(DEV_CLI_2).add(APP_CLI).add(RES_CLI)

    expect(privates(newProc()).resolveCliPath()).toBe(DEV_CLI_1)
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining(`CLI resolved (__dirname-relative): ${DEV_CLI_1}`))
  })

  it('walks to the second dev candidate when the first is not installed', () => {
    H.existing.add(DEV_CLI_2)

    expect(privates(newProc()).resolveCliPath()).toBe(DEV_CLI_2)
  })

  it('uses the app path in a dev build when nothing resolves relative to the bundle', () => {
    H.existing.add(APP_CLI)

    expect(privates(newProc()).resolveCliPath()).toBe(APP_CLI)
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('CLI resolved (appPath-relative)'))
  })

  it('prefers the installed package over the local pi-engine monorepo checkout', () => {
    H.existing.add(APP_CLI).add(APP_MONOREPO_CLI)

    expect(privates(newProc()).resolveCliPath()).toBe(APP_CLI)
  })

  it('falls back to the local pi-engine monorepo checkout', () => {
    H.existing.add(APP_MONOREPO_CLI)

    expect(privates(newProc()).resolveCliPath()).toBe(APP_MONOREPO_CLI)
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('CLI resolved (local pi-engine)'))
  })

  it('derives the app root from the directory holding the asar archive', () => {
    // a packaged app path points inside the archive, which no child process can read
    H.appPath = path.join(APP_ROOT, 'resources', 'app.asar')
    H.existing.add(path.join(APP_ROOT, 'resources', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'))

    expect(privates(newProc()).resolveCliPath()).toBe(
      path.join(APP_ROOT, 'resources', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'),
    )
  })

  it('skips the app-path strategy while the app module is not ready', () => {
    // a distinct cwd keeps strategy 3's candidate apart from the dev candidates
    const elsewhere = path.resolve('/', 'elsewhere')
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(elsewhere)
    H.appPathThrows = true
    H.existing.add(path.join(elsewhere, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'))

    try {
      expect(privates(newProc()).resolveCliPath()).toBe(
        path.join(elsewhere, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'),
      )
    } finally {
      cwdSpy.mockRestore()
    }
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('CLI resolved (cwd-relative)'))
  })

  it('reads the packaged resources directory in order', () => {
    H.isPackaged = true
    H.existing.add(RES_CLI)
    expect(privates(newProc()).resolveCliPath()).toBe(RES_CLI)

    H.writes = []
    H.isPackaged = true
    H.existing = new Set([RES_PI_ENGINE_CLI])
    expect(privates(newProc()).resolveCliPath()).toBe(RES_PI_ENGINE_CLI)
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('CLI resolved (packaged)'))
  })

  it('copes with a packaged build that has no resources path', () => {
    H.isPackaged = true
    Object.defineProperty(process, 'resourcesPath', { value: undefined, configurable: true })

    // the candidates become relative paths; nothing on disk matches, so the resolver
    // ends on the global lookup instead of resolving to a bogus location
    H.lookupResult = null
    expect(privates(newProc()).resolveCliPath()).toBe('npx')
  })

  it('never consults the dev app path in a packaged build', () => {
    H.isPackaged = true
    H.existing.add(APP_CLI)

    // the app-path candidate is dev-only, so the resolver lands on the global lookup
    globalLookup('C:\\tools\\pi.exe')
    expect(withPlatform('win32', () => privates(newProc()).resolveCliPath())).toBe('pi')
  })
})

describe('resolveCliPath — global pi lookup', () => {
  it('trusts a where hit on Windows only after checking the file exists', () => {
    const pi = 'C:\\tools\\pi.exe'
    globalLookup(pi)

    expect(withPlatform('win32', () => privates(newProc()).resolveCliPath())).toBe('pi')
    expect(H.lookupCalls).toEqual(['where pi'])
    expect(H.existing.has(pi)).toBe(true)
    expect(loggerInfo).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining("CLI resolved (global 'pi' command): C:\\tools\\pi.exe"))
  })

  it('asks `which pi` on a posix platform', () => {
    globalLookup('/usr/local/bin/pi')

    expect(withPlatform('linux', () => privates(newProc()).resolveCliPath())).toBe('pi')
    expect(H.lookupCalls).toEqual(['which pi'])
  })

  it('drops a stale lookup entry whose file has disappeared', () => {
    H.lookupResult = 'C:\\tools\\pi.exe\n'

    expect(privates(newProc()).resolveCliPath()).toBe('npx')
    expect(loggerWarn).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('No pi CLI found, falling back to npx'))
  })

  it('drops a lookup that printed nothing but whitespace', () => {
    H.lookupResult = '  \n  \n'
    H.existing.add('C:\\tools\\pi.exe')

    expect(privates(newProc()).resolveCliPath()).toBe('npx')
  })

  it('trims the lookup banner before taking the first path', () => {
    // `where` can decorate its answer; trim swallows the leading blank lines and the
    // padding, so the first real path is what gets verified
    H.lookupResult = '\n\n   C:\\tools\\pi.exe   \n'
    H.existing.add('C:\\tools\\pi.exe')

    expect(privates(newProc()).resolveCliPath()).toBe('pi')
  })

  it('falls back to npx when the lookup command itself fails', () => {
    H.lookupResult = null

    expect(privates(newProc()).resolveCliPath()).toBe('npx')
    expect(loggerWarn).toHaveBeenCalledWith('PiSessionProcess', expect.stringContaining('falling back to npx'))
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
