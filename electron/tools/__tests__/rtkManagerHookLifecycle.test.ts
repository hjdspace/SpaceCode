// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * Hook verdict and lifecycle commands.
 *
 * `isHookInstalled` is the only signal the RTK panel has for "the patch is
 * live", and it is a three-level fallback:
 *
 *   1. `rtk init --show` — trust a Hook line that mentions rtk and is marked
 *      [ok] or [warn]; several optional components print "not found", so a
 *      substring scan of the whole output would report the hook as missing.
 *   2. the settings.json line of that same output, only when marked [ok].
 *   3. a recursive scan of ~/.claude/settings.json for any string containing
 *      "rtk" — the reliable one, because `rtk init -g --auto-patch` writes there.
 *
 * The lifecycle wrappers then decide what a failure costs the user: `install`
 * logs a warning when the hook is still absent after the CLI reported success,
 * `uninstall` swallows CLI errors, and `removeBinary` swallows filesystem
 * errors — so each is pinned to the state the panel reads back afterwards.
 */

const HOME = path.join(process.cwd(), 'home')
const USER_DATA = path.join(process.cwd(), 'userdata')

const rtk = vi.hoisted(() => ({
  existing: new Set<string>(),
  files: new Map<string, string>(),
  /** path -> how many further checks may see it; simulates a file disappearing */
  disappearsAfter: new Map<string, number>(),
  calls: [] as Array<{ cmd: string; args: string[]; options?: unknown }>,
  answers: new Map<string, { stdout?: string; stderr?: string; error?: boolean }>(),
  rmThrows: false,
  removed: [] as string[],
}))

const log = vi.hoisted(() => ({
  warns: [] as string[],
  infos: [] as string[],
  debugs: [] as string[],
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => {
    const key = String(p)
    const budget = rtk.disappearsAfter.get(key)
    if (budget !== undefined) {
      if (budget <= 0) return false
      rtk.disappearsAfter.set(key, budget - 1)
      return true
    }
    return rtk.existing.has(key) || rtk.files.has(key)
  },
  readFileSync: (p: string) => {
    const value = rtk.files.get(String(p))
    if (value === undefined) throw new Error(`ENOENT: ${p}`)
    return value
  },
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn((p: string, options?: { recursive?: boolean }) => {
    if (rtk.rmThrows) throw new Error(`EPERM: ${p}`)
    const key = String(p)
    rtk.removed.push(key)
    const prefix = key + path.sep
    if (options?.recursive) {
      for (const tracked of [...rtk.existing]) {
        if (tracked.startsWith(prefix)) rtk.existing.delete(tracked)
      }
    }
    rtk.existing.delete(key)
  }),
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
  chmodSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: () => [],
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: (
    cmd: string,
    args: string[],
    options: unknown,
    cb: (err: Error | null, stdout: string, stderr: string) => void,
  ) => {
    rtk.calls.push({ cmd, args, options })
    const answer = rtk.answers.get(args.join(' '))
    if (!answer) return cb(new Error('command not scripted'), '', '')
    if (answer.error) return cb(new Error('rtk exited with code 1'), '', answer.stderr ?? '')
    cb(null, answer.stdout ?? '', answer.stderr ?? '')
  },
}))

vi.mock('os', () => ({
  homedir: () => HOME,
}))

vi.mock('https', () => ({
  get: vi.fn(() => {
    throw new Error('rtkManager hit the network during a hook/lifecycle test')
  }),
  request: vi.fn(),
}))

vi.mock('stream/promises', () => ({
  pipeline: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? USER_DATA : path.join(process.cwd(), name)),
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => [])
  },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn((_tag: string, message: string) => {
    log.debugs.push(message)
  }),
  info: vi.fn((_tag: string, message: string) => {
    log.infos.push(message)
  }),
  warn: vi.fn((_tag: string, message: string) => {
    log.warns.push(message)
  }),
  error: vi.fn(),
}))

const ORIGINAL_PLATFORM = process.platform

type Manager = typeof import('../rtkManager')
type RtkManager = Manager['rtkManager']

async function loadManager(platform: NodeJS.Platform = 'linux'): Promise<RtkManager> {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  const mod = (await import('../rtkManager')) as Manager
  return mod.rtkManager
}

function installBinary(manager: RtkManager): string {
  const target = manager.getBinaryPath()
  rtk.existing.add(target)
  return target
}

function script(argv: string, answer: { stdout?: string; stderr?: string; error?: boolean }): void {
  rtk.answers.set(argv, answer)
}

/** Output of `rtk init --show` that gives the manager nothing to decide on. */
function unreadableStatus(): void {
  script('init --show', { stdout: 'rtk status\nOpenCode: not found\n' })
}

function settingsHooks(hooks: unknown): string {
  const settingsPath = path.join(HOME, '.claude', 'settings.json')
  rtk.files.set(settingsPath, JSON.stringify({ hooks }))
  return settingsPath
}

function optionsOf(argv: string): { timeout?: number; maxBuffer?: number } {
  const args = argv.split(' ')
  const call = rtk.calls.find((c) => c.args.join(' ') === args.join(' '))
  return (call?.options ?? {}) as { timeout?: number; maxBuffer?: number }
}

beforeEach(() => {
  rtk.existing.clear()
  rtk.files.clear()
  rtk.disappearsAfter.clear()
  rtk.calls = []
  rtk.answers.clear()
  rtk.rmThrows = false
  rtk.removed = []
  log.warns = []
  log.infos = []
  log.debugs = []
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
})

describe('hook verdict from `rtk init --show`', () => {
  it('accepts a warning-marked hook line as installed', async () => {
    const manager = await loadManager()
    installBinary(manager)
    script('init --show', { stdout: '[warn] Hook: rtk -> settings.json needs review' })

    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })

  it('does not read an [ok] prefix over the words "not installed"', async () => {
    const manager = await loadManager()
    installBinary(manager)
    script('init --show', { stdout: '[ok] Hook: rtk not installed yet' })

    await expect(manager.isHookInstalled()).resolves.toBe(false)
  })

  it('ignores a settings.json line that is not marked ok', async () => {
    const manager = await loadManager()
    installBinary(manager)
    script('init --show', { stdout: 'settings: [--] ~/.claude/settings.json has no rtk hook\n' })

    await expect(manager.isHookInstalled()).resolves.toBe(false)
  })

  it('probes with a short timeout so a hung rtk cannot stall the panel', async () => {
    const manager = await loadManager()
    installBinary(manager)
    unreadableStatus()

    await manager.isHookInstalled()
    expect(optionsOf('init --show').timeout).toBe(10_000)
  })
})

describe('hook verdict from ~/.claude/settings.json', () => {
  it('reports false when the settings file does not exist', async () => {
    const manager = await loadManager()
    installBinary(manager)
    unreadableStatus()

    await expect(manager.isHookInstalled()).resolves.toBe(false)
  })

  it('reads a hook written as a nested Windows command path', async () => {
    const manager = await loadManager()
    installBinary(manager)
    unreadableStatus()
    settingsHooks({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'C:\\Users\\me\\.local\\bin\\rtk.exe pre-tool-use' }] }],
    })

    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })

  it('does not count a hooks block that is a bare string', async () => {
    const manager = await loadManager()
    installBinary(manager)
    unreadableStatus()
    settingsHooks('rtk should have been an object')

    await expect(manager.isHookInstalled()).resolves.toBe(false)
  })

  it('skips null and primitive entries instead of throwing on them', async () => {
    const manager = await loadManager()
    installBinary(manager)
    unreadableStatus()
    settingsHooks({ PreToolUse: [null, 0, true, { command: 'nothing-else' }] })

    await expect(manager.isHookInstalled()).resolves.toBe(false)
  })

  it('finds the rtk entry when another tool hook is listed first', async () => {
    const manager = await loadManager()
    installBinary(manager)
    unreadableStatus()
    settingsHooks({ PostToolUse: [{ hooks: [{ type: 'command', command: 'echo done' }, { type: 'command', command: 'rtk post-tool-use' }] }] })

    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })
})

describe('install', () => {
  it('patches globally with a 30 second budget and confirms the hook', async () => {
    const manager = await loadManager()
    const target = installBinary(manager)
    script('init -g --auto-patch', { stdout: 'PreToolUse hook written to settings.json' })
    script('init --show', { stdout: '[ok] Hook: rtk -> ~/.claude/settings.json' })

    await expect(manager.install()).resolves.toBeUndefined()

    expect(rtk.calls.map((call) => call.cmd)).toEqual([target, target])
    expect(rtk.calls[0].args).toEqual(['init', '-g', '--auto-patch'])
    expect(optionsOf('init -g --auto-patch').timeout).toBe(30_000)
    expect(log.warns).toEqual([])
  })

  it('only warns when the CLI claims success but no hook can be found', async () => {
    const manager = await loadManager()
    installBinary(manager)
    script('init -g --auto-patch', { stdout: 'done' })
    unreadableStatus()

    // The panel still sees hookInstalled: false, so the install button stays
    // available; the lie is confined to the CLI's own report.
    await expect(manager.install()).resolves.toBeUndefined()
    expect(log.warns).toContain('RTK hook not detected after install — verifying via settings.json')
    await expect(manager.isHookInstalled()).resolves.toBe(false)
  })

  it('propagates a CLI failure instead of reporting an install', async () => {
    const manager = await loadManager()
    installBinary(manager)
    script('init -g --auto-patch', { error: true, stderr: 'rtk: settings.json is not valid JSON' })

    await expect(manager.install()).rejects.toThrow(
      'RTK command failed: rtk exited with code 1 | stderr: rtk: settings.json is not valid JSON',
    )
  })
})

describe('uninstall', () => {
  it('does nothing when no binary is installed', async () => {
    const manager = await loadManager()

    await expect(manager.uninstall()).resolves.toBeUndefined()
    expect(rtk.calls).toEqual([])
  })

  it('runs the documented uninstall switch with a 30 second budget', async () => {
    const manager = await loadManager()
    installBinary(manager)
    settingsHooks({ PreToolUse: [{ hooks: [{ command: 'rtk pre-tool-use' }] }] })
    script('init -g --uninstall', { stdout: 'hook removed' })

    await expect(manager.uninstall()).resolves.toBeUndefined()
    expect(rtk.calls[0].args).toEqual(['init', '-g', '--uninstall'])
    expect(optionsOf('init -g --uninstall').timeout).toBe(30_000)
  })

  it('swallows a CLI failure, leaving the hook live and the caller told nothing', async () => {
    const manager = await loadManager()
    installBinary(manager)
    settingsHooks({ PreToolUse: [{ hooks: [{ command: 'rtk pre-tool-use' }] }] })
    script('init -g --uninstall', { error: true, stderr: 'permission denied' })

    await expect(manager.uninstall()).resolves.toBeUndefined()
    expect(log.warns).toContain('Failed to uninstall RTK hook')
    // The state the panel reads back is unchanged: the user believes the hook is
    // gone while every tool call is still being patched.
    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })
})

describe('removeBinary', () => {
  it('deletes the whole rtk directory', async () => {
    const manager = await loadManager()
    const target = installBinary(manager)

    manager.removeBinary()

    expect(rtk.removed).toEqual([manager.getBinaryDir()])
    expect(rtk.existing.has(target)).toBe(false)
    expect(manager.isBinaryInstalled()).toBe(false)
  })

  it('reports the binary as installed when the delete is refused', async () => {
    const manager = await loadManager()
    installBinary(manager)
    rtk.rmThrows = true

    // Silent failure: nothing throws, so the caller clears its "installed" flag
    // while the executable is still on disk and still picked up by turn.
    expect(() => manager.removeBinary()).not.toThrow()
    expect(log.warns).toContain('Failed to remove RTK binary')
    expect(manager.isBinaryInstalled()).toBe(true)
  })
})

describe('status and the vanished-binary guard', () => {
  it('reports an uninstalled tool as a full stop on Windows too', async () => {
    const manager = await loadManager('win32')

    await expect(manager.getStatus()).resolves.toEqual({
      binaryInstalled: false,
      version: null,
      hookInstalled: false,
      platform: 'win32',
      binaryPath: path.join(USER_DATA, 'rtk', 'rtk.exe'),
      isWindows: true,
    })
    expect(rtk.calls).toEqual([])
  })

  it('degrades to null when the binary disappears between checks', async () => {
    const manager = await loadManager()
    const target = installBinary(manager)
    // The presence check passes once, then the file is gone by the time the
    // command is about to run — execRtk must refuse to spawn it.
    rtk.disappearsAfter.set(target, 1)

    await expect(manager.getGainStats()).resolves.toBeNull()
    expect(rtk.calls).toEqual([])
  })

  it('reports no version when the binary disappears mid-call', async () => {
    const manager = await loadManager()
    const target = installBinary(manager)
    rtk.disappearsAfter.set(target, 1)

    await expect(manager.getVersion()).resolves.toBeNull()
    expect(rtk.calls).toEqual([])
  })
})
