// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'
import type { BrowserUseInstallProgress } from '../../../src/types/browserUse'

/**
 * The browser-use install pipeline. What the renderer sees is a single percent
 * bar, so the product contract here is the *order* of the steps and the band
 * each one owns:
 *
 *   detecting 5 → installing_pip 15-55 → installing_playwright 55-95 → done 100
 *
 * Steps: find Python 3.11+ → find uv (AGENTS.md: uv beats pip, `pip install`
 * is only the fallback) → install browser-use → install the playwright Python
 * package *only when browser-use failed to pull it in* → install Chromium
 * (`uvx browser-use install`, else `playwright install chromium`).
 *
 * Two deliberate quirks are pinned below: npmmirror publishes no PyPI simple
 * index, so its pip URL is the Tsinghua one while its Playwright CDN is the
 * npmmirror mirror; and an unknown mirror name must inject neither, even though
 * the progress label still calls it npmmirror. Nothing here ever throws at the
 * caller — every failure comes back as `{ success: false, error }` plus an
 * `error` stage progress, because the settings panel renders that string
 * verbatim.
 */

interface SpawnSpec {
  stdout?: string
  stderr?: string
  code?: number
  error?: string
  hang?: boolean
}

interface FakeStream {
  on: (event: string, cb: (...args: unknown[]) => void) => void
  emit: (event: string, ...args: unknown[]) => void
}

interface FakeWindow {
  webContents: { send: (channel: string, payload: unknown) => void }
}

interface FakeChild {
  command: string
  args: string[]
  options: Record<string, unknown> | undefined
  killSignals: string[]
  stdout: FakeStream
  stderr: FakeStream
  kill: (signal?: string) => boolean
  on: (event: string, cb: (...args: unknown[]) => void) => void
  emit: (event: string, ...args: unknown[]) => void
}

const probe = vi.hoisted(() => {
  const progress: BrowserUseInstallProgress[] = []
  const sends: Array<{ window: number; channel: string }> = []
  const makeWindow = (index: number): FakeWindow => ({
    webContents: {
      send: (channel: string, payload: unknown) => {
        sends.push({ window: index, channel })
        if (channel === 'browser-use:installProgress') {
          progress.push(payload as BrowserUseInstallProgress)
        }
      },
    },
  })

  return {
    /** interpreter / uv lookup tables, keyed exactly like the source sees them */
    existing: new Set<string>(),
    which: new Map<string, string>(),
    versions: new Map<string, string>(),
    /** python modules that `import x` succeeds for */
    importable: new Set<string>(),
    /** stdout for `print(browser_use.__version__)` */
    versionPrint: 'unknown\n',
    versionPrintThrows: false,
    chromiumInstalled: true,
    execLog: [] as Array<{ cmd: string; args: string[] }>,
    /** install spawns, in call order */
    children: [] as FakeChild[],
    spawnPlan: [] as SpawnSpec[],
    progress,
    sends,
    makeWindow,
    windows: [] as FakeWindow[],
  }
})

vi.mock('child_process', () => {
  type Handlers = Map<string, Array<(...args: unknown[]) => void>>

  const createStream = (): FakeStream => {
    const handlers: Handlers = new Map()
    return {
      on: (event, cb) => {
        handlers.set(event, [...(handlers.get(event) ?? []), cb])
      },
      emit: (event, ...args) => {
        for (const cb of [...(handlers.get(event) ?? [])]) cb(...args)
      },
    }
  }

  const createChild = (
    command: string,
    args: string[],
    options: Record<string, unknown> | undefined,
  ): FakeChild => {
    const handlers: Handlers = new Map()
    const killSignals: string[] = []
    return {
      command,
      args,
      options,
      killSignals,
      stdout: createStream(),
      stderr: createStream(),
      kill: (signal) => {
        killSignals.push(String(signal))
        return true
      },
      on: (event, cb) => {
        handlers.set(event, [...(handlers.get(event) ?? []), cb])
      },
      emit: (event, ...args) => {
        for (const cb of [...(handlers.get(event) ?? [])]) cb(...args)
      },
    }
  }

  return {
    spawn: (command: string, args: string[], options?: Record<string, unknown>) => {
      const child = createChild(command, args, options)
      probe.children.push(child)
      const spec = probe.spawnPlan.shift() ?? {}
      if (spec.hang) return child
      // Listeners are attached synchronously right after spawn() returns, so a
      // microtask is indistinguishable from a real child that exits immediately.
      queueMicrotask(() => {
        if (spec.error) {
          child.emit('error', new Error(spec.error))
          return
        }
        if (spec.stdout) child.stdout.emit('data', Buffer.from(spec.stdout))
        if (spec.stderr) child.stderr.emit('data', Buffer.from(spec.stderr))
        child.emit('exit', spec.code ?? 0, null)
      })
      return child
    },
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
          if (probe.versionPrintThrows) throw new Error('AttributeError: no __version__')
          return probe.versionPrint
        }
        if (code === 'import browser_use' || code === 'import playwright') {
          const mod = code.split(' ')[1]
          if (!probe.importable.has(mod)) {
            throw new Error(`ModuleNotFoundError: No module named '${mod}'`)
          }
          return ''
        }
        if (code.startsWith('from playwright.sync_api')) {
          if (!probe.chromiumInstalled) throw new Error("Executable doesn't exist")
          return ''
        }
      }
      throw new Error(`unexpected execFileSync: ${cmd} ${args.join(' ')}`)
    },
  }
})

vi.mock('fs', () => ({
  existsSync: (p: string) => probe.existing.has(String(p)),
  readFileSync: vi.fn(() => ''),
  // %LOCALAPPDATA%\Programs\Python is deleted in beforeEach, so the installer
  // never reaches a directory scan here; failing loudly keeps it that way.
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
  BrowserUseMcpClient: class {},
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

const HOME = path.join(process.cwd(), 'home')
/** posix literals hardcoded in the source — never rebuilt with the host join() */
const LINUX_PY = '/usr/bin/python3'
const WIN_PY = 'C:\\Python312\\python.exe'

async function loadService(
  platform: NodeJS.Platform,
  env: Record<string, string> = {},
): Promise<Service> {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)
  return (await import('../browserUseService')) as Service
}

/** A working interpreter on PATH; `versions` is what decides acceptance. */
function pythonOnPath(version: string, platform: NodeJS.Platform): string {
  const target = platform === 'win32' ? WIN_PY : LINUX_PY
  probe.which.set(platform === 'win32' ? 'python' : 'python3', target)
  probe.existing.add(target)
  probe.versions.set(target, version)
  return target
}

/** uv is found through PATH first, so that is where the tests put it. */
function uvOnPath(bin = '/opt/bin/uv'): string {
  // registered under both names so the probe order is platform independent
  probe.which.set('uv', bin)
  probe.which.set('uv.exe', bin)
  probe.existing.add(bin)
  return bin
}

function spawnedCommands(): string[] {
  return probe.children.map((c) => `${c.command} ${c.args.join(' ')}`)
}

function percents(): string[] {
  return probe.progress.map((p) => `${p.stage}:${p.percent}`)
}

function labels(): string[] {
  return probe.progress.map((p) => `${p.percent} ${p.message}`)
}

function envOf(child: FakeChild | undefined): Record<string, string> {
  return (child?.options?.env ?? {}) as Record<string, string>
}

beforeEach(() => {
  probe.existing.clear()
  probe.which.clear()
  probe.versions.clear()
  probe.importable.clear()
  // browser-use is what the installer is asked to provide; playwright is
  // already there unless a test removes it.
  probe.importable.add('playwright')
  probe.versionPrint = 'unknown\n'
  probe.versionPrintThrows = false
  probe.chromiumInstalled = true
  probe.execLog = []
  probe.children = []
  probe.spawnPlan = []
  probe.progress.length = 0
  probe.sends.length = 0
  probe.windows = [probe.makeWindow(0)]
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
  vi.useRealTimers()
})

describe('installBrowserUse — step order and progress bands', () => {
  it('walks the documented percent bands when uv handles both installs', async () => {
    const uv = uvOnPath()
    const py = pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')

    await expect(svc.installBrowserUse()).resolves.toEqual({ success: true })

    expect(percents()).toEqual([
      'detecting:5',
      'installing_pip:15',
      'installing_pip:50',
      'installing_pip:55',
      'installing_playwright:95',
      'done:100',
    ])
    expect(labels()[1]).toBe('15 找到 Python 3.12.1，正在使用 uv 安装 browser-use...')
    expect(labels()[5]).toBe('100 Browser-Use 安装完成！')
    // uv owns both steps: `uv pip install` for the package, `uvx ... install` for the browser.
    expect(spawnedCommands()).toEqual([
      `${uv} pip install browser-use --python ${py} --upgrade`,
      `${uv} x browser-use install`,
    ])
  })

  it('falls back to python -m pip and the playwright CLI when uv is absent', async () => {
    const py = pythonOnPath('3.11.4', 'linux')
    const svc = await loadService('linux')

    await expect(svc.installBrowserUse()).resolves.toEqual({ success: true })

    expect(spawnedCommands()).toEqual([
      `${py} -m pip install browser-use --upgrade --disable-pip-version-check`,
      `${py} -m playwright install chromium`,
    ])
    expect(probe.progress[1].message).toContain('正在使用 pip 安装 browser-use')
  })

  it('stops before touching the network when no interpreter passes the 3.11 gate', async () => {
    pythonOnPath('3.10.13', 'linux')
    const svc = await loadService('linux')

    await expect(svc.installBrowserUse()).resolves.toEqual({
      success: false,
      error: 'Python 3.11+ not found. Please install Python from python.org',
    })
    expect(percents()).toEqual(['detecting:5', 'error:100'])
    expect(probe.children).toEqual([])
  })

  it('skips the browser-use pip step entirely when the import already works', async () => {
    const uv = uvOnPath()
    pythonOnPath('3.12.1', 'linux')
    probe.importable.add('browser_use')
    const svc = await loadService('linux')

    await expect(svc.installBrowserUse({ useMirror: false, mirrorType: 'tsinghua' })).resolves.toEqual({
      success: true,
    })
    expect(spawnedCommands()).toEqual([`${uv} x browser-use install`])
    expect(labels()[2]).toBe('50 browser-use 已安装，正在检查 Playwright...')
  })

  it('installs the playwright package itself when browser-use left it out', async () => {
    const py = pythonOnPath('3.12.1', 'linux')
    probe.importable = new Set(['browser_use'])
    probe.spawnPlan = [
      {
        stdout: 'Downloading playwright-1.49.0-py3-none-any.whl (40 MB)\nSuccessfully installed playwright-1.49.0\n',
      },
    ]
    const svc = await loadService('linux')

    await expect(svc.installBrowserUse()).resolves.toEqual({ success: true })

    expect(spawnedCommands()).toEqual([
      `${py} -m pip install playwright --upgrade --disable-pip-version-check`,
      `${py} -m playwright install chromium`,
    ])
    // this step owns the narrow 52-55 band between the two big ones
    expect(percents()).toEqual([
      'detecting:5',
      'installing_pip:15',
      'installing_pip:50',
      'installing_pip:52',
      'installing_pip:54',
      'installing_pip:55',
      'installing_pip:55',
      'installing_playwright:95',
      'done:100',
    ])
    expect(labels()[4]).toBe('54 下载中: playwright-1.49.0-py3-none-any.whl (40 MB)')
  })

  it('broadcasts every progress tick to all renderer windows', async () => {
    pythonOnPath('3.12.1', 'linux')
    probe.windows = [probe.makeWindow(0), probe.makeWindow(1)]
    const svc = await loadService('linux')

    await svc.installBrowserUse()

    // 6 ticks, each delivered to both windows
    expect(probe.sends).toHaveLength(12)
    expect(new Set(probe.sends.map((s) => s.channel))).toEqual(new Set(['browser-use:installProgress']))
    expect(probe.sends.map((s) => s.window)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1])
    expect(percents().filter((_, i) => i % 2 === 0)).toEqual([
      'detecting:5',
      'installing_pip:15',
      'installing_pip:50',
      'installing_pip:55',
      'installing_playwright:95',
      'done:100',
    ])
  })
})

describe('installBrowserUse — uv discovery', () => {
  it('honours UV_PATH and never probes PATH for uv', async () => {
    const uv = path.join(HOME, 'tools', 'uv')
    probe.existing.add(uv)
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux', { UV_PATH: uv })

    await svc.installBrowserUse()

    expect(probe.children[0].command).toBe(uv)
    expect(probe.execLog.filter((c) => c.cmd === 'which' && c.args[0] === 'uv')).toEqual([])
  })

  it('drops a UV_PATH pointing at a deleted binary and installs with pip', async () => {
    const py = pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux', { UV_PATH: path.join(HOME, 'tools', 'gone') })

    await svc.installBrowserUse()

    expect(probe.children[0].command).toBe(py)
  })

  it('knows the uv installer locations under ~/.local/bin and ~/.cargo/bin', async () => {
    const cargo = path.join(HOME, '.cargo', 'bin', 'uv')
    probe.existing.add(cargo)
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')

    await svc.installBrowserUse()

    expect(probe.children.map((c) => c.command)).toEqual([cargo, cargo])
  })

  it('looks for uv.exe on the Windows PATH before the known locations', async () => {
    probe.which.set('python', WIN_PY)
    probe.existing.add(WIN_PY)
    probe.versions.set(WIN_PY, '3.12.1')
    const uvExe = path.join('C:\\', 'tools', 'uv.exe')
    probe.which.set('uv.exe', uvExe)
    probe.existing.add(uvExe)
    const svc = await loadService('win32')

    await svc.installBrowserUse()

    expect(probe.children[0].command).toBe(uvExe)
    expect(probe.execLog.filter((c) => c.cmd === 'where').map((c) => c.args[0])).toEqual([
      'python',
      'uv',
      'uv.exe',
    ])
  })
})

describe('installBrowserUse — China mirrors', () => {
  const TSINGHUA = 'https://pypi.tuna.tsinghua.edu.cn/simple'

  it('passes the Tsinghua index plus its trusted host to pip and the CDN to Playwright', async () => {
    const uv = uvOnPath()
    const py = pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')

    await svc.installBrowserUse({ useMirror: true, mirrorType: 'tsinghua' })

    expect(probe.children[0].args).toEqual([
      'pip', 'install', 'browser-use', '--python', py, '--upgrade',
      '-i', TSINGHUA, '--trusted-host', 'pypi.tuna.tsinghua.edu.cn',
    ])
    expect(envOf(probe.children[1]).PLAYWRIGHT_DOWNLOAD_HOST).toBe(
      'https://npmmirror.com/mirrors/playwright',
    )
    expect(labels()[1]).toContain('（清华 镜像）')
  })

  it('uses the Aliyun index but the official Playwright CDN, which Aliyun does not mirror', async () => {
    const py = pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')

    await svc.installBrowserUse({ useMirror: true, mirrorType: 'aliyun' })

    expect(probe.children[0].args).toEqual([
      '-m', 'pip', 'install', 'browser-use', '--upgrade', '--disable-pip-version-check',
      '-i', 'https://mirrors.aliyun.com/pypi/simple/',
      '--trusted-host', 'mirrors.aliyun.com',
    ])
    expect(envOf(probe.children[1]).PLAYWRIGHT_DOWNLOAD_HOST).toBe('https://playwright.azureedge.net')
    expect(labels()[1]).toContain('（阿里 镜像）')
  })

  it('falls back to the Tsinghua index for npmmirror, which publishes no PyPI simple index', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')

    await svc.installBrowserUse({ useMirror: true, mirrorType: 'npmmirror' })

    expect(probe.children[0].args).toContain(TSINGHUA)
    expect(envOf(probe.children[1]).PLAYWRIGHT_DOWNLOAD_HOST).toBe(
      'https://npmmirror.com/mirrors/playwright',
    )
    expect(labels()[1]).toContain('（npmmirror 镜像）')
  })

  it('injects neither index nor CDN for an unknown mirror name', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    const bogus = { useMirror: true, mirrorType: 'juju' } as unknown as {
      useMirror: boolean
      mirrorType: 'tsinghua'
    }

    await svc.installBrowserUse(bogus)

    expect(probe.children[0].args).not.toContain('-i')
    expect('PLAYWRIGHT_DOWNLOAD_HOST' in envOf(probe.children[1])).toBe(false)
    // the label still claims npmmirror even though nothing was mirrored
    expect(labels()[1]).toContain('（npmmirror 镜像）')
  })

  it('inherits the parent environment only on the Chromium step', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')

    await svc.installBrowserUse()

    // pip install is spawned without an env override; only Chromium builds one.
    expect(probe.children[0].options).toEqual({ stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    expect(probe.children[1].options).toMatchObject({ stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    expect('PLAYWRIGHT_DOWNLOAD_HOST' in envOf(probe.children[1])).toBe(false)
  })
})

describe('installBrowserUse — progress parsing', () => {
  it('maps pip stdout lines onto the collect / download / install sub-bands', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.spawnPlan = [
      {
        stdout:
          '\nCollecting browser-use\n' +
          'Downloading browser_use-0.7.7-py3-none-any.whl (1.2 MB)\n' +
          'Installing collected packages: browser-use\n' +
          'Successfully installed browser-use-0.7.7\n',
      },
    ]

    await svc.installBrowserUse()

    expect(labels()).toEqual([
      '5 正在检测 Python 3.11+...',
      '15 找到 Python 3.12.1，正在使用 pip 安装 browser-use...',
      '17 正在解析依赖: browser-use',
      '20 下载中: browser_use-0.7.7-py3-none-any.whl (1.2 MB)',
      '44 正在安装依赖包...',
      '50 browser-use 安装成功',
      // the exit-0 tick lands on the same 50 the success line already used
      '50 browser-use 安装完成，正在检查 Playwright...',
      '55 正在安装 Playwright Chromium...',
      '95 Playwright Chromium 安装完成。',
      '100 Browser-Use 安装完成！',
    ])
  })

  it('reads uv output from stderr too and keeps "Installed N packages" in the install band', async () => {
    // uv resolves before downloading, and both tools put progress on stderr.
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.spawnPlan = [
      {
        stderr:
          'Resolved 120 packages in 42ms\n' +
          'Downloading pydantic-2.11-py3.whl (2 MB)\n' +
          'Installed 120 packages in 88ms\n',
      },
    ]

    await svc.installBrowserUse()

    expect(labels().slice(2, 5)).toEqual([
      '17 正在解析依赖: 120 packages in 42ms',
      '20 下载中: pydantic-2.11-py3.whl (2 MB)',
      '44 正在安装依赖包...',
    ])
  })

  it('translates Playwright download output into the 60-95 band', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.importable.add('browser_use')
    probe.spawnPlan = [
      {
        stdout: [
          'Downloading Chromium 131.0.6778.87 from https://cdn',
          'Downloading OpenSSL 3.0 from https://cdn',
          'Installing required system packages',
          'Chromium 131.0.6778.87 downloaded',
          'Validating chromium binaries',
          'Chromium 131.0.6778.85 (playwright chromium v1161) installed',
          'Downloading Chromium from https://cdn',
        ].join('\n'),
      },
    ]

    await svc.installBrowserUse()

    expect(
      probe.progress
        .filter((p) => p.stage === 'installing_playwright')
        .map((p) => `${p.percent} ${p.message}`),
    ).toEqual([
      '60 正在下载 Chromium 131.0.6778.87...',
      '70 正在安装 Chromium...',
      '85 Chromium 下载完成，正在解压...',
      '90 正在验证安装...',
      '95 Chromium 安装完成',
      // a banner without a version number still counts as a download, just unnamed
      '60 正在下载 Chromium ...',
      '95 Playwright Chromium 安装完成。',
    ])
  })
})

describe('installBrowserUse — failure reporting', () => {
  it('reports the pip stderr verbatim and never starts the Chromium step', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.spawnPlan = [
      { code: 1, stderr: 'ERROR: Could not find a version that satisfies the requirement browser-use\n' },
    ]

    const result = await svc.installBrowserUse()

    expect(result).toEqual({
      success: false,
      error:
        '安装 browser-use 失败: Error: ERROR: Could not find a version that satisfies the requirement browser-use',
    })
    expect(percents()).toEqual(['detecting:5', 'installing_pip:15', 'error:100'])
    expect(probe.children).toHaveLength(1)
  })

  it('keeps an access-denied error visible so the user knows to retry with elevated rights', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.spawnPlan = [{ code: 1, stderr: "OSError: [WinError 5] 拒绝访问。: 'site-packages'" }]

    await expect(svc.installBrowserUse()).resolves.toEqual({
      success: false,
      error: "安装 browser-use 失败: Error: OSError: [WinError 5] 拒绝访问。: 'site-packages'",
    })
  })

  it('names the exit code when the installer dies without any output', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.spawnPlan = [{ code: 137 }]

    await expect(svc.installBrowserUse()).resolves.toEqual({
      success: false,
      error: '安装 browser-use 失败: Error: install exited with code 137',
    })
  })

  it('turns a spawn error into an install failure instead of an unhandled rejection', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.spawnPlan = [{ error: 'spawn ENOENT' }]

    await expect(svc.installBrowserUse()).resolves.toEqual({
      success: false,
      error: '安装 browser-use 失败: Error: spawn ENOENT',
    })
    expect(percents().slice(-1)).toEqual(['error:100'])
  })

  it('blames the Playwright package step when that second install fails', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    // browser-use is already there, so the very first spawn is the playwright package
    probe.importable = new Set(['browser_use'])
    probe.spawnPlan = [{ code: 1, stderr: 'no matching distribution for playwright' }]

    await expect(svc.installBrowserUse()).resolves.toEqual({
      success: false,
      error: '安装 Playwright 包失败: Error: no matching distribution for playwright',
    })
    expect(percents()).toEqual([
      'detecting:5',
      'installing_pip:15',
      'installing_pip:50',
      'installing_pip:52',
      'error:100',
    ])
  })

  it('replaces "No module named playwright" with the command the user has to run', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.importable.add('browser_use')
    probe.spawnPlan = [{ code: 1, stderr: '/usr/bin/python3: No module named playwright\n' }]

    await expect(svc.installBrowserUse()).resolves.toEqual({
      success: false,
      error: '安装 Chromium 失败: Error: Playwright Python 包未安装。请先运行: pip install playwright，然后重试安装。',
    })
    expect(percents().slice(-1)).toEqual(['error:100'])
  })

  it('keeps any other Chromium stderr as the failure reason', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.spawnPlan = [{ code: 0 }, { code: 1, stderr: 'Download failed: ECONNRESET' }]

    await expect(svc.installBrowserUse()).resolves.toEqual({
      success: false,
      error: '安装 Chromium 失败: Error: Download failed: ECONNRESET',
    })
    expect(percents().slice(-1)).toEqual(['error:100'])
  })

  it('falls back to the exit code when Chromium dies silently', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.importable.add('browser_use')
    probe.spawnPlan = [{ code: 3 }]

    await expect(svc.installBrowserUse()).resolves.toEqual({
      success: false,
      error: '安装 Chromium 失败: Error: chromium install exited with code 3',
    })
  })

  it('surfaces an OS refusal to launch the Chromium installer', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.importable.add('browser_use')
    probe.spawnPlan = [{ error: 'spawn EACCES' }]

    await expect(svc.installBrowserUse()).resolves.toEqual({
      success: false,
      error: '安装 Chromium 失败: Error: spawn EACCES',
    })
  })
})

describe('installBrowserUse — timeouts', () => {
  it('kills a pip install that stalls for 10 minutes', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.spawnPlan = [{ hang: true }]
    vi.useFakeTimers()

    const pending = svc.installBrowserUse()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(pending).resolves.toEqual({
      success: false,
      error: '安装 browser-use 失败: Error: 安装超时（10 分钟），请尝试使用中国镜像源',
    })
    expect(probe.children[0].killSignals).toEqual(['SIGKILL'])
  })

  it('kills a Chromium download that stalls for 15 minutes', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    probe.importable.add('browser_use')
    probe.spawnPlan = [{ hang: true }]
    vi.useFakeTimers()

    const pending = svc.installBrowserUse()
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(pending).resolves.toEqual({
      success: false,
      error: '安装 Chromium 失败: Error: Chromium 下载超时（15 分钟），请尝试使用中国镜像源',
    })
    expect(probe.children[0].killSignals).toEqual(['SIGKILL'])
  })

  it('clears the watchdog once the installer exits so a finished run is never killed', async () => {
    pythonOnPath('3.12.1', 'linux')
    const svc = await loadService('linux')
    vi.useFakeTimers()

    await expect(svc.installBrowserUse()).resolves.toEqual({ success: true })
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)

    expect(probe.children.flatMap((c) => c.killSignals)).toEqual([])
  })
})
