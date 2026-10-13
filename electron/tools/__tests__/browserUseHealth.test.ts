// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * Health check and status aggregation — the two read-only surfaces the settings
 * panel and the `browser-use:doctor` IPC both render.
 *
 * `runHealthCheck()` has two modes and they must not be conflated. Without a
 * live MCP session it can only look at the machine, so it reports
 * python_runtime → browser_use_package → chromium_installation, and the
 * Chromium probe is deliberately skipped when the package itself is missing
 * (spawning an interpreter that cannot import browser_use is pure latency).
 * With a live session the bridge's own `health_report` decides: every check is
 * copied through and `ok` is *only* `overall === 'ok'` — a degraded report is
 * not a pass, and a report without structured content is not a check list.
 *
 * `getBrowserUseStatus()` layers the LLM credential source on top: desktop
 * (`~/.claude/gui-settings.json`) beats plain environment variables, and
 * `ready` folds to null whenever the gate is not met — the UI treats "not
 * ready" and "unknown" as the same grey dot.
 */

const probe = vi.hoisted(() => {
  const logs: string[] = []

  interface ClientRecord {
    started: boolean
    stopCount: number
    toolCalls: Array<{ name: string; timeout?: number }>
  }

  return {
    existing: new Set<string>(),
    files: new Map<string, string>(),
    dirEntries: new Map<string, string[]>(),
    which: new Map<string, string>(),
    versions: new Map<string, string>(),
    importable: new Set<string>(),
    versionPrint: 'unknown\n',
    versionPrintThrows: false,
    chromiumInstalled: true,
    execLog: [] as Array<{ cmd: string; args: string[] }>,
    /** makes every fs probe blow up, i.e. the "disk itself is the failure" path */
    statThrows: false,
    /** the client object itself raises when its state is read */
    isStartedThrows: false,
    toolResults: new Map<string, unknown>(),
    toolThrows: new Set<string>(),
    clients: [] as ClientRecord[],
    logs,
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
    if (args[0] === '-c') {
      const code = String(args[1])
      if (code.startsWith('import browser_use; print')) {
        if (probe.versionPrintThrows) throw new Error('AttributeError: module has no __version__')
        return probe.versionPrint
      }
      if (code === 'import browser_use' || code === 'import playwright') {
        const mod = code.split(' ')[1]
        if (!probe.importable.has(mod)) throw new Error(`ModuleNotFoundError: No module named '${mod}'`)
        return ''
      }
      if (code.startsWith('from playwright.sync_api')) {
        if (!probe.chromiumInstalled) throw new Error("Executable doesn't exist")
        return ''
      }
    }
    throw new Error(`unexpected execFileSync: ${cmd} ${args.join(' ')}`)
  },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => {
    if (probe.statThrows) throw new Error(`EACCES: permission denied, stat '${p}'`)
    return probe.existing.has(String(p)) || probe.files.has(String(p))
  },
  readFileSync: (p: string) => {
    const raw = probe.files.get(String(p))
    if (raw === undefined) throw new Error(`ENOENT: no such file, open '${p}'`)
    return raw
  },
  readdirSync: (dir: string) => {
    const entries = probe.dirEntries.get(String(dir))
    if (!entries) throw new Error(`ENOENT: ${dir}`)
    return entries
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
    static getAllWindows = vi.fn(() => [])
  },
}))

vi.mock('../browserUseMcpClient', () => ({
  BrowserUseMcpClient: class {
    record = { started: false, stopCount: 0, toolCalls: [] as Array<{ name: string; timeout?: number }> }

    constructor() {
      probe.clients.push(this.record)
    }

    get isStarted(): boolean {
      if (probe.isStartedThrows) throw new Error('browser-use client is in a broken state')
      return this.record.started
    }

    async start(): Promise<void> {
      this.record.started = true
    }

    async stop(): Promise<void> {
      this.record.stopCount += 1
      this.record.started = false
    }

    async callTool(name: string, _args: Record<string, unknown>, timeout?: number): Promise<unknown> {
      this.record.toolCalls.push({ name, timeout })
      if (probe.toolThrows.has(name)) throw new Error(`browser-use tools/call ${name} failed`)
      return probe.toolResults.get(name) ?? { data: null, images: [], imageMimeTypes: [], structuredContent: null, isError: false }
    }

    hasTool(): boolean {
      return false
    }
  },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: (tag: string, msg: string) => {
    probe.logs.push(`${tag}: ${msg}`)
  },
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

const HOME = path.join(process.cwd(), 'home')
const GUI_SETTINGS = path.join(HOME, '.claude', 'gui-settings.json')
/** posix literals hardcoded in the source — never rebuilt with the host join() */
const LINUX_PY = '/usr/bin/python3'
const DEV_BRIDGE = path.join(process.cwd(), 'electron', 'resources', 'browser-use', 'bridge.py')

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

/** open a session so runHealthCheck switches to the bridge's own report */
async function startSession(svc: Service): Promise<void> {
  await svc.callBrowserUseTool('get_info', {})
  expect(probe.clients[0].started).toBe(true)
}

function healthReport(overall: string, checks: unknown[]): void {
  probe.toolResults.set('health_report', {
    data: null,
    images: [],
    imageMimeTypes: [],
    structuredContent: { overall, checks },
    isError: false,
  })
}

beforeEach(() => {
  probe.existing.clear()
  probe.files.clear()
  probe.dirEntries.clear()
  probe.which.clear()
  probe.versions.clear()
  probe.importable.clear()
  probe.versionPrint = 'unknown\n'
  probe.versionPrintThrows = false
  probe.chromiumInstalled = true
  probe.execLog = []
  probe.statThrows = false
  probe.isStartedThrows = false
  probe.toolResults.clear()
  probe.toolThrows.clear()
  probe.clients.length = 0
  probe.logs.length = 0
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('runHealthCheck — offline probing', () => {
  it('passes all three machine-level checks and says so with the interpreter path', async () => {
    const py = pythonReady('3.11.9')
    probe.importable.add('browser_use')
    const svc = await loadService()

    await expect(svc.runHealthCheck()).resolves.toEqual({
      ok: true,
      checks: [
        { label: 'python_runtime', status: 'pass', message: `Python 3.11.9 at ${py}` },
        { label: 'browser_use_package', status: 'pass', message: 'browser-use is installed' },
        { label: 'chromium_installation', status: 'pass', message: 'Chromium is installed' },
      ],
    })
  })

  it('reports only the missing package and skips the Chromium probe it cannot run', async () => {
    pythonReady()
    const svc = await loadService()

    const result = await svc.runHealthCheck()

    expect(result).toEqual({
      ok: false,
      checks: [
        { label: 'python_runtime', status: 'pass', message: `Python 3.12.1 at ${LINUX_PY}` },
        {
          label: 'browser_use_package',
          status: 'fail',
          message: 'browser-use is NOT installed',
          hint: 'Run: pip install browser-use',
        },
      ],
    })
    // the Chromium check spawns a browser — it must not run without the package
    expect(probe.execLog.filter((c) => c.args[1]?.toString().startsWith('from playwright'))).toEqual([])
  })

  it('keeps the Chromium failure as its own row with the repair command', async () => {
    pythonReady()
    probe.importable.add('browser_use')
    probe.chromiumInstalled = false
    const svc = await loadService()

    await expect(svc.runHealthCheck()).resolves.toEqual({
      ok: false,
      checks: [
        { label: 'python_runtime', status: 'pass', message: `Python 3.12.1 at ${LINUX_PY}` },
        { label: 'browser_use_package', status: 'pass', message: 'browser-use is installed' },
        {
          label: 'chromium_installation',
          status: 'fail',
          message: 'Chromium is NOT installed',
          hint: 'Run: playwright install chromium',
        },
      ],
    })
  })

  it('fails the whole report on the missing interpreter without probing packages', async () => {
    const svc = await loadService()

    await expect(svc.runHealthCheck()).resolves.toEqual({
      ok: false,
      checks: [
        {
          label: 'python_runtime',
          status: 'fail',
          message: 'Python 3.11+ not found',
          hint: 'Install Python 3.11+ from python.org',
        },
      ],
    })
    expect(probe.execLog.filter((c) => c.args[0] === '-c')).toEqual([])
  })

  it('degrades to a single readable row instead of throwing when the filesystem blows up', async () => {
    pythonReady()
    probe.statThrows = true
    const svc = await loadService()

    const result = await svc.runHealthCheck()

    expect(result.ok).toBe(false)
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].label).toBe('health_check')
    expect(result.checks[0].status).toBe('fail')
    expect(result.checks[0].hint).toBe('Ensure browser-use is properly installed')
    expect(probe.logs.some((l) => l.includes('health check failed'))).toBe(true)
  })
})

describe('runHealthCheck — live bridge report', () => {
  it('copies every reported check through and keeps ok tied to the overall field', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    healthReport('ok', [
      { name: 'browser', status: 'pass', message: 'chromium v1161' },
      { name: 'network', status: 'fail', message: 'offline', hint: 'check the VPN' },
    ])
    await startSession(svc)

    await expect(svc.runHealthCheck()).resolves.toEqual({
      ok: true,
      checks: [
        { label: 'python_runtime', status: 'pass', message: `Python 3.12.1 at ${LINUX_PY}` },
        { label: 'browser', status: 'pass', message: 'chromium v1161' },
        { label: 'network', status: 'fail', message: 'offline', hint: 'check the VPN' },
      ],
    })
  })

  it('treats a degraded report as a failure even when most rows pass', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    healthReport('degraded', [
      { name: 'browser', status: 'pass', message: 'chromium v1161' },
      { name: 'llm', status: 'skip', message: 'no key' },
    ])
    await startSession(svc)

    const result = await svc.runHealthCheck()

    expect(result.ok).toBe(false)
    expect(result.checks.map((c) => c.status)).toEqual(['pass', 'pass', 'skip'])
  })

  it('normalises an unnamed or unstatused row rather than rendering undefined in the panel', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    healthReport('ok', [{}, { name: 'x', status: 'fail' }])
    await startSession(svc)

    const result = await svc.runHealthCheck()

    expect(result.checks.slice(1)).toEqual([
      { label: '', status: 'skip', message: '', hint: undefined },
      { label: 'x', status: 'fail', message: '', hint: undefined },
    ])
    // overall decides, so an unknown row still reads as healthy
    expect(result.ok).toBe(true)
  })

  it('ignores a non-array checks field instead of throwing on it', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    probe.toolResults.set('health_report', {
      data: null,
      images: [],
      imageMimeTypes: [],
      structuredContent: { overall: 'ok', checks: 'not-a-list' },
      isError: false,
    })
    await startSession(svc)

    await expect(svc.runHealthCheck()).resolves.toEqual({
      ok: true,
      checks: [{ label: 'python_runtime', status: 'pass', message: `Python 3.12.1 at ${LINUX_PY}` }],
    })
  })

  it('reports not-ok with only the interpreter row when the bridge answers without structure', async () => {
    pythonReady()
    bridgeReady()
    const svc = await loadService()
    await startSession(svc)

    await expect(svc.runHealthCheck()).resolves.toEqual({
      ok: false,
      checks: [{ label: 'python_runtime', status: 'pass', message: `Python 3.12.1 at ${LINUX_PY}` }],
    })
  })

  it('names the MCP connection as the failing component when the call blows up', async () => {
    pythonReady()
    bridgeReady()
    probe.toolThrows.add('health_report')
    const svc = await loadService()
    await startSession(svc)

    const result = await svc.runHealthCheck()

    expect(result.ok).toBe(false)
    expect(result.checks.map((c) => c.label)).toEqual(['python_runtime', 'mcp_connection'])
    expect(result.checks[1]).toMatchObject({
      status: 'fail',
      hint: 'Try restarting the browser-use service',
    })
    expect(result.checks[1].message).toContain('browser-use tools/call health_report failed')
  })
})

describe('getBrowserUseStatus', () => {
  it('describes a machine with nothing installed', async () => {
    const svc = await loadService()

    expect(await svc.getBrowserUseStatus()).toEqual({
      platform: 'linux',
      platformSupported: true,
      installed: false,
      pythonPath: null,
      pythonVersion: null,
      browserUseVersion: null,
      chromiumInstalled: false,
      uvInstalled: false,
      source: null,
      llmConfigured: false,
      llmProvider: 'ChatBrowserUse',
      llmModel: 'bu-2-0',
      llmSource: null,
      ready: null,
      checks: [
        {
          label: 'python_runtime',
          status: 'fail',
          message: 'Python 3.11+ not found',
          hint: 'Install Python 3.11+ from python.org',
        },
      ],
      error: null,
    })
  })

  it('reports a fully provisioned machine as ready with the env credential source', async () => {
    const uv = '/opt/bin/uv'
    probe.which.set('uv', uv)
    probe.existing.add(uv)
    pythonReady('3.12.4')
    probe.importable.add('browser_use')
    probe.versionPrint = '0.7.7\n'
    const svc = await loadService('linux', { ANTHROPIC_API_KEY: 'sk-ant-env' })

    const status = await svc.getBrowserUseStatus()

    expect(status).toMatchObject({
      installed: true,
      pythonPath: LINUX_PY,
      pythonVersion: '3.12.4',
      browserUseVersion: '0.7.7',
      chromiumInstalled: true,
      uvInstalled: true,
      source: 'system',
      llmConfigured: true,
      llmSource: 'env',
      ready: true,
    })
    // an env-only setup has no provider name to report, so the agent default stands
    expect(status.llmProvider).toBe('ChatBrowserUse')
    expect(status.llmModel).toBe('bu-2-0')
  })

  it('prefers the desktop settings file over environment variables for the LLM source', async () => {
    pythonReady()
    probe.importable.add('browser_use')
    probe.versionPrint = '0.7.7\n'
    guiSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { apiKey: 'sk-desk', sonnetModel: 'gpt-5-mini' },
    })
    const svc = await loadService('linux', { OPENAI_API_KEY: 'sk-env' })

    const status = await svc.getBrowserUseStatus()

    expect(status).toMatchObject({
      llmConfigured: true,
      llmProvider: 'OpenAI',
      llmModel: 'gpt-5-mini',
      llmSource: 'desktop',
      ready: true,
    })
  })

  it('keeps an installed-but-unusable browser as not ready', async () => {
    pythonReady()
    probe.importable.add('browser_use')
    probe.chromiumInstalled = false
    const svc = await loadService('linux', { OPENAI_API_KEY: 'sk-env' })

    const status = await svc.getBrowserUseStatus()

    expect(status.installed).toBe(true)
    expect(status.chromiumInstalled).toBe(false)
    // `ready || null` means a failing gate is reported as null, never false
    expect(status.ready).toBeNull()
  })

  it('reports the package as installed when the version banner is unreadable', async () => {
    pythonReady()
    probe.importable.add('browser_use')
    probe.versionPrint = 'unknown\n'
    const svc = await loadService('linux', { OPENAI_API_KEY: 'sk-env' })

    const status = await svc.getBrowserUseStatus()

    expect(status.installed).toBe(true)
    expect(status.browserUseVersion).toBeNull()
    // readiness does not depend on the version string, only on the import
    expect(status.ready).toBe(true)
  })

  it('survives an interpreter that raises while printing its own version', async () => {
    pythonReady()
    probe.importable.add('browser_use')
    probe.versionPrintThrows = true
    const svc = await loadService('linux', { GOOGLE_API_KEY: 'g-env' })

    const status = await svc.getBrowserUseStatus()

    expect(status.browserUseVersion).toBeNull()
    expect(status.llmProvider).toBe('ChatBrowserUse')
  })

  it('refuses to promise readiness on a platform the bridge does not support', async () => {
    pythonReady()
    probe.importable.add('browser_use')
    probe.versionPrint = '0.7.7\n'
    const svc = await loadService('freebsd', { ANTHROPIC_API_KEY: 'sk-ant' })

    const status = await svc.getBrowserUseStatus()

    expect(status.platform).toBe('freebsd')
    expect(status.platformSupported).toBe(false)
    expect(status.ready).toBeNull()
    expect(status.installed).toBe(true)
  })

  it('keeps a Windows machine on the win32 platform label the UI switches on', async () => {
    const winPy = 'C:\\Python312\\python.exe'
    probe.which.set('python', winPy)
    probe.existing.add(winPy)
    probe.versions.set(winPy, '3.11.9')
    probe.importable.add('browser_use')
    probe.versionPrint = '0.7.7\n'
    const svc = await loadService('win32', { ANTHROPIC_API_KEY: 'sk-ant' })

    const status = await svc.getBrowserUseStatus()

    expect(status).toMatchObject({
      platform: 'win32',
      platformSupported: true,
      pythonPath: winPy,
      installed: true,
      ready: true,
    })
    expect(status.checks.map((c) => c.label)).toEqual([
      'python_runtime',
      'browser_use_package',
      'chromium_installation',
    ])
  })

  it('surfaces one readable row when the client object itself is unreadable', async () => {
    // Reading the session state throws, so the report cannot be built at all;
    // status still answers with a single row instead of failing the IPC call.
    pythonReady()
    bridgeReady()
    probe.importable.add('browser_use')
    probe.versionPrint = '0.7.7\n'
    const svc = await loadService('linux', { ANTHROPIC_API_KEY: 'sk-ant' })
    await startSession(svc)
    probe.isStartedThrows = true

    const status = await svc.getBrowserUseStatus()

    expect(status.ready).toBeNull()
    expect(status.checks).toEqual([
      {
        label: 'health_check',
        status: 'fail',
        message: 'Health check failed: Error: browser-use client is in a broken state',
        hint: 'Ensure browser-use is properly installed',
      },
    ])
  })

  it('asks the running bridge for the health rows instead of re-probing packages', async () => {
    // readiness still folds in the local Chromium probe, so the two sources mix.
    pythonReady()
    bridgeReady()
    probe.importable.add('browser_use')
    probe.versionPrint = '0.7.7\n'
    healthReport('ok', [{ name: 'browser', status: 'pass', message: 'chromium v1161' }])
    const svc = await loadService('linux', { ANTHROPIC_API_KEY: 'sk-ant' })
    await startSession(svc)

    const status = await svc.getBrowserUseStatus()

    expect(status.checks.map((c) => c.label)).toEqual(['python_runtime', 'browser'])
    expect(status.ready).toBe(true)
    expect(probe.clients[0].toolCalls.map((c) => c.name)).toContain('health_report')
  })
})
