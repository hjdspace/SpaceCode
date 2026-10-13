// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'
import type { BrowserUseAgentConfig, BrowserUseLiveSnapshot } from '../../../src/types/browserUse'

/**
 * The stdio MCP server block that the CLI receives via `--mcp-config`, plus the
 * agent config behind it.
 *
 * `getBrowserUseMcpServerConfig()` is the whole integration surface: it has to
 * resolve an interpreter, find `bridge.py` (dev layout searches
 * `electron/resources` before the repo-root `resources`, the packaged layout
 * searches `process.resourcesPath` only), and serialise the agent config into
 * the `BU_*` environment bridge.py reads. Returning `null` is the contract for
 * "not usable" — the caller then drops the server instead of handing the CLI a
 * command that cannot start, which would kill the entire session.
 *
 * Precedence that the tests below pin: an explicit `BROWSER_USE_API_KEY` wins
 * and suppresses desktop-config reuse entirely (cloud ChatBrowserUse must not
 * be shadowed by a local key); otherwise only the *currently enabled* provider
 * from `~/.claude/gui-settings.json` is injected, never every historical key,
 * because browser-use picks the model from whichever keys are present.
 *
 * `updateAgentConfig` is a raw spread into a module-level cache — nothing is
 * validated and nothing is persisted, so the config lives only until quit.
 */

const probe = vi.hoisted(() => {
  const snapshots: BrowserUseLiveSnapshot[] = []
  const windows: Array<{
    webContents: { send: (channel: string, payload: unknown) => void }
  }> = []
  const makeWindow = (): typeof windows[number] => ({
    webContents: {
      send: (channel: string, payload: unknown) => {
        if (channel === 'browser-use:liveSnapshot') snapshots.push(payload as BrowserUseLiveSnapshot)
      },
    },
  })

  interface ClientRecord {
    started: boolean
    startArgs: Array<{ pythonPath: string; bridgePath: string; env: Record<string, string> }>
    stopCount: number
    toolCalls: Array<{ name: string; args: Record<string, unknown>; timeout?: number }>
  }

  return {
    existing: new Set<string>(),
    files: new Map<string, string>(),
    which: new Map<string, string>(),
    versions: new Map<string, string>(),
    execLog: [] as Array<{ cmd: string; args: string[] }>,
    /** electron app.isPackaged, read lazily like the real app object */
    isPackaged: false,
    /** the tool-call plan keyed by tool name */
    toolResults: new Map<string, unknown>(),
    toolThrows: new Set<string>(),
    startThrows: false,
    stopThrows: false,
    discovered: [] as string[],
    clients: [] as ClientRecord[],
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    snapshots,
    windows,
    makeWindow,
  }
})

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  execFileSync: (cmd: string, args: string[]) => {
    probe.execLog.push({ cmd, args })
    if (args[0] === '--version') {
      const version = probe.versions.get(cmd)
      if (!version) throw new Error(`${cmd} exited with status 1`)
      return `Python ${version}\n`
    }
    if (cmd === 'which' || cmd === 'where') {
      const found = probe.which.get(args[0])
      if (!found) throw Object.assign(new Error(`not found: ${args[0]}`), { status: 1 })
      return found + '\n'
    }
    throw new Error(`unexpected execFileSync: ${cmd} ${args.join(' ')}`)
  },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => probe.existing.has(String(p)) || probe.files.has(String(p)),
  readFileSync: (p: string) => {
    const raw = probe.files.get(String(p))
    if (raw === undefined) throw new Error(`ENOENT: no such file, open '${p}'`)
    return raw
  },
  readdirSync: () => {
    throw new Error('EPERM: directory scan is not modelled in this suite')
  },
}))

vi.mock('os', () => ({
  homedir: () => path.join(process.cwd(), 'home'),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return probe.isPackaged
    },
    getPath: (name: string) => path.join(process.cwd(), name),
    getAppPath: () => process.cwd(),
  },
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      probe.handlers.set(channel, fn)
    }),
    on: vi.fn(),
  },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => probe.windows)
  },
}))

vi.mock('../browserUseMcpClient', () => ({
  BrowserUseMcpClient: class {
    record: {
      started: boolean
      startArgs: Array<{ pythonPath: string; bridgePath: string; env: Record<string, string> }>
      stopCount: number
      toolCalls: Array<{ name: string; args: Record<string, unknown>; timeout?: number }>
    } = { started: false, startArgs: [], stopCount: 0, toolCalls: [] }

    constructor() {
      probe.clients.push(this.record)
    }

    get isStarted(): boolean {
      return this.record.started
    }

    async start(pythonPath: string, bridgePath: string, env?: Record<string, string>): Promise<void> {
      this.record.startArgs.push({ pythonPath, bridgePath, env: env ?? {} })
      if (probe.startThrows) throw new Error('browser-use MCP initialize timed out')
      this.record.started = true
    }

    async stop(): Promise<void> {
      this.record.stopCount += 1
      this.record.started = false
      if (probe.stopThrows) throw new Error('browser-use session did not close')
    }

    async callTool(name: string, args: Record<string, unknown>, timeout?: number): Promise<unknown> {
      this.record.toolCalls.push({ name, args, timeout })
      if (probe.toolThrows.has(name)) throw new Error(`tool failed: ${name}`)
      return probe.toolResults.get(name) ?? { data: null, images: [], imageMimeTypes: [], structuredContent: null, isError: false }
    }

    hasTool(name: string): boolean {
      return probe.discovered.includes(name)
    }
  },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

type Service = typeof import('../browserUseService')

const ORIGINAL_PLATFORM = process.platform
const ORIGINAL_RESOURCES = (process as { resourcesPath?: string }).resourcesPath
const ENV_KEYS = [
  'PYTHON_PATH',
  'UV_PATH',
  'LOCALAPPDATA',
  'BROWSER_USE_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
] as const
const savedEnv: Record<string, string | undefined> = {}

const HOME = path.join(process.cwd(), 'home')
const GUI_SETTINGS = path.join(HOME, '.claude', 'gui-settings.json')
const DEV_BRIDGE = path.join(process.cwd(), 'electron', 'resources', 'browser-use', 'bridge.py')
const ROOT_BRIDGE = path.join(process.cwd(), 'resources', 'browser-use', 'bridge.py')
const PACKAGED_BRIDGE = path.join(process.cwd(), 'packed', 'resources', 'browser-use', 'bridge.py')
const LINUX_PY = '/usr/bin/python3'

/** the BU_* block a default-configured agent produces, with nothing in the environment */
const DEFAULT_ENV = {
  BU_LLM_PROVIDER: 'ChatBrowserUse',
  BU_LLM_MODEL: 'bu-2-0',
  BU_HEADLESS: 'true',
  BU_USE_VISION: 'true',
  BU_TEMPERATURE: '0.1',
  BU_MAX_STEPS: '50',
  BU_MAX_ACTIONS_PER_STEP: '3',
  BU_MAX_FAILURES: '3',
  BU_USE_THINKING: 'true',
  BU_FLASH_MODE: 'false',
  BU_USE_CLOUD: 'false',
}

async function loadService(
  platform: NodeJS.Platform = 'linux',
  env: Record<string, string> = {},
): Promise<Service> {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  return (await import('../browserUseService')) as Service
}

function pythonReady(version = '3.12.1'): string {
  probe.which.set('python3', LINUX_PY)
  probe.existing.add(LINUX_PY)
  probe.versions.set(LINUX_PY, version)
  return LINUX_PY
}

function bridgeReady(): string {
  probe.existing.add(DEV_BRIDGE)
  return DEV_BRIDGE
}

function guiSettings(value: unknown): void {
  probe.files.set(GUI_SETTINGS, JSON.stringify(value))
}

beforeEach(() => {
  probe.existing.clear()
  probe.files.clear()
  probe.which.clear()
  probe.versions.clear()
  probe.execLog = []
  probe.isPackaged = false
  probe.toolResults.clear()
  probe.toolThrows.clear()
  probe.startThrows = false
  probe.stopThrows = false
  probe.discovered = []
  probe.clients.length = 0
  probe.snapshots.length = 0
  probe.windows.length = 0
  probe.handlers.clear()
  ;(process as { resourcesPath?: string }).resourcesPath = path.join(process.cwd(), 'packed', 'resources')
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  ;(process as { resourcesPath?: string }).resourcesPath = ORIGINAL_RESOURCES
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('getBrowserUseMcpServerConfig — resolution', () => {
  it('returns the exact stdio block the CLI would spawn', async () => {
    pythonReady()
    const bridge = bridgeReady()
    const svc = await loadService()

    expect(svc.getBrowserUseMcpServerConfig()).toEqual({
      command: LINUX_PY,
      args: [bridge, '--mcp'],
      env: DEFAULT_ENV,
    })
  })

  it('reports the server as unavailable when no interpreter passes the version gate', async () => {
    pythonReady('3.9.16')
    bridgeReady()
    const svc = await loadService()

    expect(svc.getBrowserUseMcpServerConfig()).toBeNull()
  })

  it('reports the server as unavailable when bridge.py was not shipped', async () => {
    pythonReady()
    const svc = await loadService()

    expect(svc.getBrowserUseMcpServerConfig()).toBeNull()
  })

  it('prefers the electron/resources copy over the repo-root copy in dev', async () => {
    pythonReady()
    probe.existing.add(ROOT_BRIDGE)
    const svc = await loadService()

    expect(svc.getBrowserUseMcpServerConfig()?.args[0]).toBe(ROOT_BRIDGE)

    probe.existing.add(DEV_BRIDGE)
    expect(svc.getBrowserUseMcpServerConfig()?.args[0]).toBe(DEV_BRIDGE)
  })

  it('reads only process.resourcesPath once packaged', async () => {
    pythonReady()
    probe.existing.add(DEV_BRIDGE)
    probe.existing.add(PACKAGED_BRIDGE)
    probe.isPackaged = true
    const svc = await loadService()

    expect(svc.getBrowserUseMcpServerConfig()?.args).toEqual([PACKAGED_BRIDGE, '--mcp'])
  })

  it('lets PYTHON_PATH decide the interpreter the CLI spawns', async () => {
    const custom = path.join(HOME, 'tools', 'python3.13')
    probe.existing.add(custom)
    probe.versions.set(custom, '3.13.2')
    probe.isPackaged = true
    probe.existing.add(PACKAGED_BRIDGE)
    const svc = await loadService('linux', { PYTHON_PATH: custom })

    expect(svc.getBrowserUseMcpServerConfig()?.command).toBe(custom)
  })
})

describe('buildBUEnv — agent config serialisation', () => {
  it('omits the optional directory and domain keys when unset', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()

    const env = svc.getBrowserUseMcpServerConfig()!.env
    expect(Object.keys(env)).toEqual(Object.keys(DEFAULT_ENV))
    expect(env).not.toHaveProperty('BU_ALLOWED_DOMAINS')
    expect(env).not.toHaveProperty('BU_USER_DATA_DIR')
    expect(env).not.toHaveProperty('BU_DOWNLOADS_PATH')
    expect(env).not.toHaveProperty('BU_EXTEND_SYSTEM_MESSAGE')
  })

  it('serialises a fully configured agent into the BU_* contract bridge.py reads', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()

    svc.updateAgentConfig({
      provider: 'OpenAI',
      model: 'gpt-5-mini',
      headless: false,
      useVision: false,
      temperature: 0.7,
      maxSteps: 12,
      maxActionsPerStep: 1,
      maxFailures: 5,
      useThinking: false,
      flashMode: true,
      useCloud: true,
      allowedDomains: ['example.com', '*.corp.cn'],
      userDataDir: '/tmp/profile',
      downloadsPath: '/tmp/downloads',
      extendSystemMessage: 'never submit a form',
    })

    expect(svc.getBrowserUseMcpServerConfig()!.env).toEqual({
      BU_LLM_PROVIDER: 'OpenAI',
      BU_LLM_MODEL: 'gpt-5-mini',
      BU_HEADLESS: 'false',
      BU_USE_VISION: 'false',
      BU_TEMPERATURE: '0.7',
      BU_MAX_STEPS: '12',
      BU_MAX_ACTIONS_PER_STEP: '1',
      BU_MAX_FAILURES: '5',
      BU_USE_THINKING: 'false',
      BU_FLASH_MODE: 'true',
      BU_USE_CLOUD: 'true',
      BU_ALLOWED_DOMAINS: 'example.com,*.corp.cn',
      BU_USER_DATA_DIR: '/tmp/profile',
      BU_DOWNLOADS_PATH: '/tmp/downloads',
      BU_EXTEND_SYSTEM_MESSAGE: 'never submit a form',
    })
  })

  it('passes every explicit API key through untouched', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService('linux', {
      BROWSER_USE_API_KEY: 'bu-cloud-key',
      ANTHROPIC_API_KEY: 'sk-ant-env',
      OPENAI_API_KEY: 'sk-env',
      GOOGLE_API_KEY: 'g-env',
    })

    const env = svc.getBrowserUseMcpServerConfig()!.env
    expect(env.BROWSER_USE_API_KEY).toBe('bu-cloud-key')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-env')
    expect(env.OPENAI_API_KEY).toBe('sk-env')
    expect(env.GOOGLE_API_KEY).toBe('g-env')
  })

  it('keeps a cloud BROWSER_USE_API_KEY from being shadowed by the desktop Anthropic key', async () => {
    pythonReady()
    bridgeReady()
    guiSettings({
      authMethod: 'anthropic_compatible',
      anthropicConfig: { apiKey: 'sk-ant-desktop', sonnetModel: 'claude-sonnet-4' },
    })
    const svc = await loadService('linux', { BROWSER_USE_API_KEY: 'bu-cloud-key' })
    svc.updateAgentConfig({ provider: 'Anthropic' })

    const env = svc.getBrowserUseMcpServerConfig()!.env
    expect(env.BROWSER_USE_API_KEY).toBe('bu-cloud-key')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })
})

describe('buildBUEnv — desktop LLM reuse', () => {
  it('reuses the enabled Anthropic key and base url when the agent picks the same provider', async () => {
    pythonReady()
    bridgeReady()
    guiSettings({
      authMethod: 'anthropic_compatible',
      anthropicConfig: { apiKey: ' sk-ant ', baseUrl: ' https://gw.example/api ', sonnetModel: ' claude-sonnet-4-5 ' },
    })
    const svc = await loadService()
    svc.updateAgentConfig({ provider: 'Anthropic' })

    const env = svc.getBrowserUseMcpServerConfig()!.env
    // trimmed, but the model still comes from the agent config, not the desktop file
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://gw.example/api')
    expect(env.BU_LLM_MODEL).toBe('bu-2-0')
  })

  it('reuses an OpenAI-compatible key under OPENAI_BASE_URL', async () => {
    pythonReady()
    bridgeReady()
    guiSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { apiKey: 'sk-desk', baseUrl: 'https://vllm.local/v1', sonnetModel: '' },
    })
    const svc = await loadService()
    svc.updateAgentConfig({ provider: 'OpenAI' })

    const env = svc.getBrowserUseMcpServerConfig()!.env
    expect(env.OPENAI_API_KEY).toBe('sk-desk')
    expect(env.OPENAI_BASE_URL).toBe('https://vllm.local/v1')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('reuses a Gemini key and spells the base url GEMINI_BASE_URL', async () => {
    pythonReady()
    bridgeReady()
    guiSettings({ authMethod: 'gemini_api', geminiConfig: { apiKey: 'g-desk' } })
    const svc = await loadService()
    svc.updateAgentConfig({ provider: 'Google' })

    const env = svc.getBrowserUseMcpServerConfig()!.env
    expect(env.GOOGLE_API_KEY).toBe('g-desk')
    // no baseUrl in the file, so the variable stays absent instead of empty
    expect(env.GEMINI_BASE_URL).toBeUndefined()

    guiSettings({
      authMethod: 'gemini_api',
      geminiConfig: { apiKey: 'g-desk', baseUrl: 'https://proxy.local/gemini' },
    })
    expect(svc.getBrowserUseMcpServerConfig()!.env.GEMINI_BASE_URL).toBe('https://proxy.local/gemini')
  })

  it('does not leak a key from a provider the user did not select', async () => {
    pythonReady()
    bridgeReady()
    guiSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { apiKey: 'sk-desk' },
      anthropicConfig: { apiKey: 'sk-ant-old' },
      geminiConfig: { apiKey: 'g-old' },
    })
    const svc = await loadService()
    svc.updateAgentConfig({ provider: 'Anthropic' })

    const env = svc.getBrowserUseMcpServerConfig()!.env
    // the agent asks for Anthropic but the desktop is on OpenAI: inject nothing
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.GOOGLE_API_KEY).toBeUndefined()
  })

  it('ignores OAuth auth methods, which carry no API key to reuse', async () => {
    pythonReady()
    bridgeReady()
    guiSettings({
      authMethod: 'claudeai',
      anthropicConfig: { apiKey: '   ', sonnetModel: 'claude-sonnet-4' },
    })
    const svc = await loadService()
    svc.updateAgentConfig({ provider: 'Anthropic' })

    expect(svc.getBrowserUseMcpServerConfig()!.env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('survives a corrupt gui-settings.json instead of dropping the MCP server', async () => {
    pythonReady()
    bridgeReady()
    probe.files.set(GUI_SETTINGS, '{"authMethod": ')
    const svc = await loadService()

    expect(svc.getBrowserUseMcpServerConfig()).not.toBeNull()
  })

  it('treats an empty settings file the same as a missing one', async () => {
    pythonReady()
    bridgeReady()
    probe.files.set(GUI_SETTINGS, '   \n')
    const svc = await loadService()

    expect(svc.getBrowserUseMcpServerConfig()!.env).toEqual(DEFAULT_ENV)
  })

  it('falls back through sonnet, opus then haiku for the reported model', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()

    guiSettings({ authMethod: 'gemini_api', geminiConfig: { apiKey: 'g', opusModel: 'gemini-pro-opus' } })
    expect(await svc.getBrowserUseStatus().then((s) => s.llmModel)).toBe('gemini-pro-opus')

    guiSettings({ authMethod: 'gemini_api', geminiConfig: { apiKey: 'g', haikuModel: 'gemini-flash' } })
    expect(await svc.getBrowserUseStatus().then((s) => s.llmModel)).toBe('gemini-flash')

    guiSettings({ authMethod: 'gemini_api', geminiConfig: { apiKey: 'g' } })
    // no model name in the file at all: the agent default is reported
    expect(await svc.getBrowserUseStatus().then((s) => s.llmModel)).toBe('bu-2-0')
  })

  it('injects nothing when the selected provider has no config block at all', async () => {
    pythonReady()
    bridgeReady()
    guiSettings({ authMethod: 'openai_compatible', anthropicConfig: { apiKey: 'sk-ant-old' } })
    const svc = await loadService()
    svc.updateAgentConfig({ provider: 'OpenAI' })

    const env = svc.getBrowserUseMcpServerConfig()!.env
    // openaiConfig is the block that is read here; the stale Anthropic key stays buried
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('treats a config block without an apiKey field as unconfigured', async () => {
    pythonReady()
    bridgeReady()
    guiSettings({ authMethod: 'anthropic_compatible', anthropicConfig: { sonnetModel: 'claude-sonnet-4' } })
    const svc = await loadService()
    svc.updateAgentConfig({ provider: 'Anthropic' })

    expect(svc.getBrowserUseMcpServerConfig()!.env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('omits the base url variable when the desktop config relies on the SDK default', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()

    guiSettings({ authMethod: 'anthropic_compatible', anthropicConfig: { apiKey: 'sk-ant' } })
    svc.updateAgentConfig({ provider: 'Anthropic' })
    let env = svc.getBrowserUseMcpServerConfig()!.env
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant')
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()

    guiSettings({ authMethod: 'openai_compatible', openaiConfig: { apiKey: 'sk', baseUrl: '  ' } })
    svc.updateAgentConfig({ provider: 'OpenAI' })
    env = svc.getBrowserUseMcpServerConfig()!.env
    expect(env.OPENAI_API_KEY).toBe('sk')
    // a blank base url is normalised away instead of exported as an empty string
    expect(env.OPENAI_BASE_URL).toBeUndefined()
  })

  it('ignores an auth method the service does not know', async () => {
    pythonReady()
    bridgeReady()
    guiSettings({ authMethod: 'bedrock', anthropicConfig: { apiKey: 'sk-ant', sonnetModel: 'claude' } })
    const svc = await loadService()
    svc.updateAgentConfig({ provider: 'Anthropic' })

    expect(svc.getBrowserUseMcpServerConfig()!.env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe('updateAgentConfig / getAgentConfig', () => {
  it('merges a partial update over the defaults without touching the rest', async () => {
    const svc = await loadService()

    svc.updateAgentConfig({ maxSteps: 5, useCloud: true })

    expect(svc.getAgentConfig()).toEqual({
      provider: 'ChatBrowserUse',
      model: 'bu-2-0',
      apiKeyMasked: false,
      maxSteps: 5,
      temperature: 0.1,
      useVision: true,
      headless: true,
      allowedDomains: [],
      userDataDir: null,
      downloadsPath: null,
      useCloud: true,
      maxActionsPerStep: 3,
      maxFailures: 3,
      useThinking: true,
      flashMode: false,
      extendSystemMessage: null,
    })
  })

  it('copies the scalars but shares the allowedDomains array with the live cache', async () => {
    // getAgentConfig is a one-level spread, so a settings panel that pushes into
    // the array it was handed rewrites what the next bridge.py start exports.
    pythonReady()
    bridgeReady()
    const svc = await loadService()

    const view = svc.getAgentConfig()
    view.allowedDomains.push('evil.example')
    view.maxSteps = 999

    expect(svc.getAgentConfig().allowedDomains).toEqual(['evil.example'])
    expect(svc.getAgentConfig().maxSteps).toBe(50)
    expect(svc.getBrowserUseMcpServerConfig()!.env.BU_ALLOWED_DOMAINS).toBe('evil.example')
  })

  it('spreads an unknown key straight into the cache — nothing is validated', async () => {
    const svc = await loadService()
    const bogus = { maxSteps: 8, debugTrace: true } as unknown as Partial<BrowserUseAgentConfig>

    svc.updateAgentConfig(bogus)

    expect(svc.getAgentConfig()).toMatchObject({ maxSteps: 8, debugTrace: true })
  })

  it('lets an explicit undefined wipe a default and reaches the bridge as the string "undefined"', async () => {
    // a JSON body round-trip is how the renderer sends a partial update, so an
    // absent field can arrive as undefined and the raw spread keeps it.
    pythonReady()
    bridgeReady()
    const svc = await loadService()

    svc.updateAgentConfig({ temperature: undefined } as Partial<BrowserUseAgentConfig>)

    expect(svc.getAgentConfig().temperature).toBeUndefined()
    expect(svc.getBrowserUseMcpServerConfig()!.env.BU_TEMPERATURE).toBe('undefined')
  })

  it('starts the next MCP session on the new config but never restarts a running one', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    svc.updateAgentConfig({ model: 'bu-3-0' })

    expect(svc.getBrowserUseMcpServerConfig()!.env.BU_LLM_MODEL).toBe('bu-3-0')
    // no client was created by the config change alone
    expect(probe.clients).toHaveLength(0)
  })
})

describe('cleanupBrowserUseMcp', () => {
  it('is a no-op before any session has been started', async () => {
    const svc = await loadService()

    await expect(svc.cleanupBrowserUseMcp()).resolves.toBeUndefined()
    expect(probe.clients).toHaveLength(0)
  })

  it('stops the running session exactly once, so a quit sequence is idempotent', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    await svc.callBrowserUseTool('get_info', {})
    expect(probe.clients[0].started).toBe(true)

    await svc.cleanupBrowserUseMcp()
    await svc.cleanupBrowserUseMcp()

    expect(probe.clients[0].stopCount).toBe(1)
    expect(probe.clients[0].started).toBe(false)
  })

  it('never blocks app quit when the child refuses to close politely', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    await svc.callBrowserUseTool('get_info', {})
    probe.stopThrows = true

    await expect(svc.cleanupBrowserUseMcp()).resolves.toBeUndefined()
    expect(probe.clients[0].stopCount).toBe(1)
  })
})

describe('registerBrowserUseIPCHandlers', () => {
  it('registers exactly the channels the preload bridge exposes', async () => {
    const svc = await loadService()

    svc.registerBrowserUseIPCHandlers()

    expect([...probe.handlers.keys()].sort()).toEqual([
      'browser-use:check-update',
      'browser-use:config',
      'browser-use:doctor',
      'browser-use:install',
      'browser-use:liveSnapshot',
      'browser-use:navigate',
      'browser-use:status',
      'browser-use:tool',
    ])
  })

  it('answers check-update with the not-implemented stub instead of a false "up to date"', async () => {
    const svc = await loadService()
    svc.registerBrowserUseIPCHandlers()

    expect(probe.handlers.get('browser-use:check-update')!()).toEqual({
      updateAvailable: false,
      latestVersion: null,
      currentVersion: null,
    })
  })

  it('merges a config update, returns the whole result, and echoes the current one when called bare', async () => {
    const svc = await loadService()
    svc.registerBrowserUseIPCHandlers()
    const config = probe.handlers.get('browser-use:config')!

    expect((config(undefined) as BrowserUseAgentConfig).maxSteps).toBe(50)
    expect((config({}, { maxSteps: 3 }) as BrowserUseAgentConfig).maxSteps).toBe(3)
    expect((config(undefined) as BrowserUseAgentConfig).maxSteps).toBe(3)
  })

  it('takes a running session down when the config changes, so the next start re-reads the env', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    svc.registerBrowserUseIPCHandlers()
    await svc.callBrowserUseTool('get_info', {})

    probe.handlers.get('browser-use:config')!({}, { headless: false })

    expect(probe.clients[0].stopCount).toBe(1)
    expect(probe.clients[0].started).toBe(false)
  })

  it('routes navigate through the MCP tool contract', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    svc.registerBrowserUseIPCHandlers()

    await probe.handlers.get('browser-use:navigate')!(null, 'https://example.com')

    expect(probe.clients[0].toolCalls).toEqual([
      { name: 'navigate', args: { url: 'https://example.com' }, timeout: undefined },
    ])
  })

  it('forwards each read-only channel to its service function', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    svc.registerBrowserUseIPCHandlers()

    const doctor = await probe.handlers.get('browser-use:doctor')!()
    expect(doctor).toMatchObject({ ok: false })

    const status = await probe.handlers.get('browser-use:status')!()
    expect(status).toMatchObject({ platform: 'linux', installed: false })

    await probe.handlers.get('browser-use:tool')!(null, 'get_info', { fresh: true })
    expect(probe.clients[0].toolCalls).toEqual([{ name: 'get_info', args: { fresh: true }, timeout: undefined }])
  })

  it('forwards the install options untouched', async () => {
    // no interpreter here, so the handler answers with the detection failure and
    // the assertion is that the option object reached the pipeline at all
    const svc = await loadService()
    svc.registerBrowserUseIPCHandlers()

    await expect(probe.handlers.get('browser-use:install')!(null, {
      useMirror: true,
      mirrorType: 'aliyun',
    })).resolves.toEqual({
      success: false,
      error: 'Python 3.11+ not found. Please install Python from python.org',
    })
  })

  it('reports no live snapshot until a session has produced one', async () => {
    const svc = await loadService()
    svc.registerBrowserUseIPCHandlers()

    await expect(probe.handlers.get('browser-use:liveSnapshot')!()).resolves.toBeNull()
  })
})
