// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'
import type { BrowserUseLiveSnapshot } from '../../../src/types/browserUse'
import type { McpToolResult } from '../../../src/types/computerUse'

/**
 * The live session surface: tool calls, navigation, and the screenshot carousel
 * that feeds the preview panel.
 *
 * One long-lived MCP client is shared by every call, created lazily from
 * (interpreter, bridge.py, BU_* env) — so a call before the runtime is ready has
 * to fail loudly with the same two reasons the config surface uses, and a second
 * call must reuse the session instead of spawning a second Python process.
 *
 * The polling loop is a background timer, and the product decision baked into it
 * is: the preview never breaks the app. A screenshot failure still publishes a
 * snapshot (without the image), a `get_info` failure publishes nothing at all,
 * and neither is allowed to surface as an unhandled rejection. The snapshot's
 * `totalSteps` is read from the live agent config, so a settings change shows up
 * on the next tick without restarting the bridge.
 */

interface ClientRecord {
  started: boolean
  startArgs: Array<{ pythonPath: string; bridgePath: string; env: Record<string, string> }>
  stopCount: number
  toolCalls: Array<{ name: string; args: Record<string, unknown>; timeout?: number }>
}

const probe = vi.hoisted(() => {
  const snapshots: BrowserUseLiveSnapshot[] = []
  const makeWindow = () => ({
    webContents: {
      send: (channel: string, payload: unknown) => {
        if (channel === 'browser-use:liveSnapshot') snapshots.push(payload as BrowserUseLiveSnapshot)
      },
    },
  })

  return {
    existing: new Set<string>(),
    files: new Map<string, string>(),
    which: new Map<string, string>(),
    versions: new Map<string, string>(),
    toolResults: new Map<string, McpToolResult>(),
    toolThrows: new Set<string>(),
    startThrows: false,
    discovered: [] as string[],
    clients: [] as ClientRecord[],
    windows: [] as Array<{ webContents: { send: (channel: string, payload: unknown) => void } }>,
    snapshots,
    makeWindow,
  }
})

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  execFileSync: (cmd: string, args: string[]) => {
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
    isPackaged: false,
    getPath: (name: string) => path.join(process.cwd(), name),
    getAppPath: () => process.cwd(),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => probe.windows)
  },
}))

vi.mock('../browserUseMcpClient', () => ({
  BrowserUseMcpClient: class {
    record: ClientRecord = { started: false, startArgs: [], stopCount: 0, toolCalls: [] }

    constructor() {
      probe.clients.push(this.record)
    }

    get isStarted(): boolean {
      return this.record.started
    }

    async start(pythonPath: string, bridgePath: string, env?: Record<string, string>): Promise<void> {
      this.record.startArgs.push({ pythonPath, bridgePath, env: env ?? {} })
      if (probe.startThrows) throw new Error('browser-use MCP initialize timed out after 30000ms')
      this.record.started = true
    }

    async stop(): Promise<void> {
      this.record.stopCount += 1
      this.record.started = false
    }

    async callTool(name: string, args: Record<string, unknown>, timeout?: number): Promise<McpToolResult> {
      this.record.toolCalls.push({ name, args, timeout })
      if (probe.toolThrows.has(name)) throw new Error(`browser-use tools/call ${name} timed out`)
      return probe.toolResults.get(name) ?? {
        data: null,
        images: [],
        imageMimeTypes: [],
        structuredContent: null,
        isError: false,
      }
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

const LINUX_PY = '/usr/bin/python3'
const DEV_BRIDGE = path.join(process.cwd(), 'electron', 'resources', 'browser-use', 'bridge.py')

function toolResult(partial: Partial<McpToolResult>): McpToolResult {
  return {
    data: null,
    images: [],
    imageMimeTypes: [],
    structuredContent: null,
    isError: false,
    ...partial,
  }
}

async function loadService(platform: NodeJS.Platform = 'linux'): Promise<Service> {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  for (const key of ENV_KEYS) delete process.env[key]
  probe.windows = [probe.makeWindow()]
  return (await import('../browserUseService')) as Service
}

function runtimeReady(): void {
  probe.which.set('python3', LINUX_PY)
  probe.existing.add(LINUX_PY)
  probe.versions.set(LINUX_PY, '3.12.1')
  probe.existing.add(DEV_BRIDGE)
}

const POLL_MS = 2_000

beforeEach(() => {
  probe.existing.clear()
  probe.files.clear()
  probe.which.clear()
  probe.versions.clear()
  probe.toolResults.clear()
  probe.toolThrows.clear()
  probe.startThrows = false
  probe.discovered = []
  probe.clients.length = 0
  probe.snapshots.length = 0
  probe.windows = []
  vi.useFakeTimers()
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('callBrowserUseTool', () => {
  it('starts the bridge on the resolved interpreter and flattens the tool result', async () => {
    runtimeReady()
    probe.toolResults.set('browse', toolResult({
      data: { url: 'https://example.com', title: 'Example Domain', steps_used: 4 },
      images: ['BASE64PNG'],
      isError: false,
    }))
    const svc = await loadService()

    await expect(svc.callBrowserUseTool('browse', { task: 'open example' })).resolves.toEqual({
      data: { url: 'https://example.com', title: 'Example Domain', steps_used: 4 },
      screenshots: ['BASE64PNG'],
      currentUrl: 'https://example.com',
      pageTitle: 'Example Domain',
      isError: false,
      stepsUsed: 4,
    })
    expect(probe.clients).toHaveLength(1)
    expect(probe.clients[0].startArgs[0].pythonPath).toBe(LINUX_PY)
    expect(probe.clients[0].startArgs[0].bridgePath).toBe(DEV_BRIDGE)
    // the default agent block, and no credential the user never configured
    expect(probe.clients[0].startArgs[0].env).toEqual({
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
    })
    expect(probe.clients[0].toolCalls).toEqual([
      { name: 'browse', args: { task: 'open example' }, timeout: undefined },
    ])
  })

  it('reports the interpreter or the bridge script as the reason a call cannot start', async () => {
    const svc = await loadService()
    await expect(svc.callBrowserUseTool('browse', {})).rejects.toThrow('Python 3.11+ not found')

    probe.which.set('python3', LINUX_PY)
    probe.existing.add(LINUX_PY)
    probe.versions.set(LINUX_PY, '3.12.1')
    await expect(svc.callBrowserUseTool('browse', {})).rejects.toThrow(
      'Browser-use bridge script not found',
    )
    expect(probe.clients).toHaveLength(0)
  })

  it('keeps text-only results as text and leaves the browser fields empty', async () => {
    runtimeReady()
    probe.toolResults.set('scrape', toolResult({ data: 'no browser session yet', isError: true }))
    const svc = await loadService()

    await expect(svc.callBrowserUseTool('scrape', { url: 'https://example.com' })).resolves.toEqual({
      data: 'no browser session yet',
      screenshots: [],
      currentUrl: null,
      pageTitle: null,
      isError: true,
      stepsUsed: 0,
    })
  })

  it('treats a null or partial payload as no browser state instead of guessing', async () => {
    runtimeReady()
    const svc = await loadService()

    probe.toolResults.set('a', toolResult({ data: null }))
    expect(await svc.callBrowserUseTool('a', {})).toMatchObject({ currentUrl: null, stepsUsed: 0 })

    probe.toolResults.set('b', toolResult({ data: { title: 'only a title' } }))
    expect(await svc.callBrowserUseTool('b', {})).toMatchObject({
      currentUrl: null,
      pageTitle: 'only a title',
      stepsUsed: 0,
    })

    probe.toolResults.set('c', toolResult({ data: [1, 2, 3] }))
    expect(await svc.callBrowserUseTool('c', {})).toMatchObject({ data: [1, 2, 3], stepsUsed: 0 })
  })

  it('reuses the live session for every later call', async () => {
    runtimeReady()
    const svc = await loadService()

    await svc.callBrowserUseTool('navigate', { url: 'https://a.example' })
    await svc.callBrowserUseTool('navigate', { url: 'https://b.example' })

    expect(probe.clients).toHaveLength(1)
    expect(probe.clients[0].startArgs).toHaveLength(1)
    expect(probe.clients[0].toolCalls.map((c) => c.args)).toEqual([
      { url: 'https://a.example' },
      { url: 'https://b.example' },
    ])
  })

  it('builds a fresh session after a failed handshake rather than reusing a broken one', async () => {
    runtimeReady()
    probe.startThrows = true
    const svc = await loadService()

    await expect(svc.callBrowserUseTool('browse', {})).rejects.toThrow('initialize timed out')

    probe.startThrows = false
    await expect(svc.callBrowserUseTool('browse', {})).resolves.toMatchObject({ isError: false })
    expect(probe.clients).toHaveLength(2)
    expect(probe.clients[1].started).toBe(true)
  })

  it('propagates a tool failure to the renderer instead of masking it as empty data', async () => {
    runtimeReady()
    probe.toolThrows.add('browse')
    const svc = await loadService()

    await expect(svc.callBrowserUseTool('browse', { task: 'x' })).rejects.toThrow(
      'browser-use tools/call browse timed out',
    )
  })

  it('routes browserNavigate through the navigate tool contract', async () => {
    runtimeReady()
    probe.toolResults.set('navigate', toolResult({ data: { url: 'https://example.com' } }))
    const svc = await loadService()

    const result = await svc.browserNavigate('https://example.com')

    expect(probe.clients[0].toolCalls).toEqual([{ name: 'navigate', args: { url: 'https://example.com' }, timeout: undefined }])
    expect(result.currentUrl).toBe('https://example.com')
  })
})

describe('screenshot polling', () => {
  it('publishes a snapshot every tick with the live agent budget', async () => {
    runtimeReady()
    probe.discovered.push('browse')
    probe.toolResults.set('get_info', toolResult({ data: { url: 'https://a.example', title: 'A' } }))
    probe.toolResults.set('screenshot', toolResult({ images: ['AAA'], imageMimeTypes: ['image/png'] }))
    const svc = await loadService()
    svc.updateAgentConfig({ maxSteps: 7 })

    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(probe.snapshots).toEqual([
      {
        screenshot: 'AAA',
        url: 'https://a.example',
        title: 'A',
        currentStep: 0,
        totalSteps: 7,
        agentStatus: 'running',
        lastAction: null,
      },
    ])
    await expect(svc.getLiveSnapshot()).resolves.toEqual(probe.snapshots[0])
  })

  it('asks for the page state and the image with their own budgets', async () => {
    runtimeReady()
    probe.toolResults.set('get_info', toolResult({ data: { url: 'https://a.example' } }))
    const svc = await loadService()

    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS)

    const polling = probe.clients[0].toolCalls.filter((c) => c.name !== 'browse')
    expect(polling).toEqual([
      { name: 'get_info', args: {}, timeout: 10_000 },
      { name: 'screenshot', args: {}, timeout: 15_000 },
    ])
  })

  it('still publishes the page when the screenshot call fails', async () => {
    runtimeReady()
    probe.toolResults.set('get_info', toolResult({ data: { url: 'https://a.example', title: 'A' } }))
    probe.toolThrows.add('screenshot')
    const svc = await loadService()

    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(probe.snapshots).toEqual([
      {
        screenshot: null,
        url: 'https://a.example',
        title: 'A',
        currentStep: 0,
        totalSteps: 50,
        agentStatus: 'idle',
        lastAction: null,
      },
    ])
  })

  it('reports idle until the bridge advertises a browse tool', async () => {
    runtimeReady()
    probe.discovered = []
    // a page-state object without a url is answered with an empty one, not undefined
    probe.toolResults.set('get_info', toolResult({ data: { title: 'A' } }))
    const svc = await loadService()

    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(probe.snapshots[0]).toMatchObject({
      url: '',
      title: 'A',
      agentStatus: 'idle',
      screenshot: null,
    })
  })

  it('stops polling the moment the bridge has died', async () => {
    runtimeReady()
    probe.toolResults.set('get_info', toolResult({ data: { url: 'https://a.example' } }))
    const svc = await loadService()

    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS)
    // the Python child exits: the client flips itself off but the interval is
    // still armed, and the next tick must notice rather than call a dead session
    probe.clients[0].started = false
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)

    expect(probe.clients[0].toolCalls.filter((c) => c.name === 'get_info')).toHaveLength(1)
    expect(probe.snapshots).toHaveLength(1)
  })

  it('publishes nothing when there is no browser session to look at', async () => {
    runtimeReady()
    const svc = await loadService()

    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)

    // get_info answered with no data at all, so no frame is invented
    expect(probe.snapshots).toEqual([])
    await expect(svc.getLiveSnapshot()).resolves.toBeNull()
  })

  it('ignores a page state the bridge returned as plain text', async () => {
    runtimeReady()
    probe.toolResults.set('get_info', toolResult({ data: 'Browser not started' }))
    const svc = await loadService()

    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(probe.snapshots).toEqual([])
  })

  it('swallows a failing poll instead of crashing the main process', async () => {
    runtimeReady()
    probe.toolThrows.add('get_info')
    const svc = await loadService()

    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)

    expect(probe.snapshots).toEqual([])
    expect(probe.clients[0].toolCalls.filter((c) => c.name === 'get_info')).toHaveLength(2)
  })

  it('stops the carousel when the session is cleaned up', async () => {
    runtimeReady()
    probe.toolResults.set('get_info', toolResult({ data: { url: 'https://a.example' } }))
    const svc = await loadService()

    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await svc.cleanupBrowserUseMcp()
    await vi.advanceTimersByTimeAsync(POLL_MS * 5)

    expect(probe.snapshots).toHaveLength(1)
    expect(probe.clients[0].toolCalls.filter((c) => c.name === 'get_info')).toHaveLength(1)
    expect(probe.clients[0].stopCount).toBe(1)
  })

  it('replaces the carousel instead of stacking one per session', async () => {
    runtimeReady()
    probe.toolResults.set('get_info', toolResult({ data: { url: 'https://a.example' } }))
    const svc = await loadService()

    await svc.callBrowserUseTool('browse', {})
    await svc.cleanupBrowserUseMcp()
    await svc.callBrowserUseTool('browse', {})
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(probe.clients).toHaveLength(2)
    expect(probe.snapshots).toHaveLength(1)
  })
})
