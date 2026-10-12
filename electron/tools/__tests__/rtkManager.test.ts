// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * RTK manager — the token-savings CLI wrapper. Everything here is a fallback
 * chain, and each chain is where a silent break shows up as "统计不见了":
 *
 *   version: version.json → `rtk --version` banner → regex-optional raw trim
 *   hook:    `rtk init --show` hook line → settings.json line → settings.json scan
 *   stats:   v0.43 nested summary → flat legacy keys → USD estimated from tokens
 *
 * The constructor reads `app.getPath('userData')` and `process.platform`, so a
 * fresh module (and thus a fresh singleton) is imported per platform.
 */

const HOME = path.join(process.cwd(), 'home')
const USER_DATA = path.join(process.cwd(), 'userdata')

const rtk = vi.hoisted(() => ({
  existing: new Set<string>(),
  files: new Map<string, string>(),
  /** keyed by the argv.join(' ') the manager passes to execFile */
  answers: new Map<string, { stdout?: string; stderr?: string; error?: boolean }>(),
  calls: [] as Array<{ cmd: string; args: string[]; options?: unknown }>,
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => rtk.existing.has(String(p)) || rtk.files.has(String(p)),
  readFileSync: (p: string) => {
    const value = rtk.files.get(String(p))
    if (value === undefined) throw new Error(`ENOENT: ${p}`)
    return value
  },
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  createReadStream: vi.fn(),
  createWriteStream: vi.fn(),
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
  get: vi.fn(),
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
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const ORIGINAL_PLATFORM = process.platform

type Manager = typeof import('../rtkManager')

async function loadManager(platform: NodeJS.Platform): Promise<Manager['rtkManager']> {
  vi.resetModules()
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  const mod = (await import('../rtkManager')) as Manager
  return mod.rtkManager
}

function binaryPath(platform: NodeJS.Platform): string {
  return path.join(USER_DATA, 'rtk', platform === 'win32' ? 'rtk.exe' : 'rtk')
}

function installBinary(platform: NodeJS.Platform): string {
  const target = binaryPath(platform)
  rtk.existing.add(target)
  return target
}

function script(argv: string, answer: { stdout?: string; stderr?: string; error?: boolean }): void {
  rtk.answers.set(argv, answer)
}

function settingsHookContent(hooks: unknown): void {
  rtk.files.set(
    path.join(HOME, '.claude', 'settings.json'),
    JSON.stringify({ hooks }),
  )
}

beforeEach(() => {
  rtk.existing.clear()
  rtk.files.clear()
  rtk.answers.clear()
  rtk.calls = []
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
})

describe('binary location', () => {
  it('puts a bare-named binary under <userData>/rtk on posix', async () => {
    const manager = await loadManager('linux')

    expect(manager.getBinaryDir()).toBe(path.join(USER_DATA, 'rtk'))
    expect(manager.getBinaryPath()).toBe(path.join(USER_DATA, 'rtk', 'rtk'))
    expect(manager.isBinaryInstalled()).toBe(false)

    installBinary('linux')
    expect(manager.isBinaryInstalled()).toBe(true)
  })

  it('appends .exe on Windows', async () => {
    const manager = await loadManager('win32')

    expect(manager.getBinaryPath()).toBe(path.join(USER_DATA, 'rtk', 'rtk.exe'))
  })
})

describe('getVersion', () => {
  it('returns null without spawning anything when the binary is absent', async () => {
    const manager = await loadManager('linux')

    await expect(manager.getVersion()).resolves.toBeNull()
    expect(rtk.calls).toHaveLength(0)
  })

  it('trusts version.json and skips the subprocess entirely', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    rtk.files.set(path.join(USER_DATA, 'rtk', 'version.json'), JSON.stringify({ version: '0.43.1' }))

    await expect(manager.getVersion()).resolves.toBe('0.43.1')
    expect(rtk.calls).toHaveLength(0)
  })

  it('falls back to `rtk --version` when version.json is unreadable', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    rtk.files.set(path.join(USER_DATA, 'rtk', 'version.json'), '{ broken')
    script('--version', { stdout: 'rtk 0.28.2\n' })

    await expect(manager.getVersion()).resolves.toBe('0.28.2')
    expect(rtk.calls.map((c) => c.args)).toEqual([['--version']])
  })

  it('accepts an optional v prefix in the banner', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('--version', { stdout: 'rtk v0.43.10\n' })

    await expect(manager.getVersion()).resolves.toBe('0.43.10')
  })

  it('keeps unexpected banner text verbatim instead of reporting no version', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('--version', { stdout: '  rtk development build (local)  ' })

    await expect(manager.getVersion()).resolves.toBe('rtk development build (local)')
  })

  it('reports null when the binary refuses to answer', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('--version', { error: true })

    await expect(manager.getVersion()).resolves.toBeNull()
  })
})

describe('isHookInstalled', () => {
  it('returns false without probing when the binary is absent', async () => {
    const manager = await loadManager('linux')

    await expect(manager.isHookInstalled()).resolves.toBe(false)
    expect(rtk.calls).toHaveLength(0)
  })

  it('accepts an [ok] hook line mentioning rtk', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('init --show', { stdout: 'rtk status\n[ok] Hook: rtk init -g installed\n' })

    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })

  it('is not fooled by optional components reporting not found', async () => {
    // The naive substring check this replaced treated any "not found" in the
    // whole output as a missing hook, even though OpenCode/Cursor are optional.
    const manager = await loadManager('linux')
    installBinary('linux')
    script('init --show', {
      stdout: ['[--] OpenCode: not found', '[--] Cursor: not found', '[ok] Hook: rtk -> ~/.claude/settings.json'].join('\n'),
    })

    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })

  it('accepts an [ok] settings.json line when no hook line is printed', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('init --show', { stdout: 'settings: [ok] ~/.claude/settings.json\n' })

    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })

  it('falls back to settings.json when the hook line says not installed', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('init --show', { stdout: '[--] Hook: not installed — run rtk init -g\n' })
    settingsHookContent({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk pre-tool-use' }] }] })

    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })

  it('falls back to settings.json when the probe command fails', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('init --show', { error: true, stderr: 'rtk: unknown subcommand' })
    settingsHookContent({ hooks: [{ command: '/usr/local/bin/rtk hook' }] })

    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })
})

describe('settings.json hook scan', () => {
  it('finds rtk nested inside arrays and objects', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('init --show', { stdout: 'no machine-readable status\n' })
    settingsHookContent({ PreToolUse: { nested: [{ command: 'RTK pre-tool-use' }] } })

    await expect(manager.isHookInstalled()).resolves.toBe(true)
  })

  it('reports false when the hooks block has no rtk command', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('init --show', { stdout: 'no machine-readable status\n' })
    settingsHookContent({ PreToolUse: [{ command: 'some-other-tool' }] })

    await expect(manager.isHookInstalled()).resolves.toBe(false)
  })

  it('reports false when settings.json has no hooks block at all', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('init --show', { stdout: 'no machine-readable status\n' })
    rtk.files.set(path.join(HOME, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet' }))

    await expect(manager.isHookInstalled()).resolves.toBe(false)
  })

  it('reports false on a corrupt settings.json', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script('init --show', { stdout: 'no machine-readable status\n' })
    rtk.files.set(path.join(HOME, '.claude', 'settings.json'), '{"hooks": [')

    await expect(manager.isHookInstalled()).resolves.toBe(false)
  })
})

describe('getStatus', () => {
  it('reports the fields the RTK panel reads', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    rtk.files.set(path.join(USER_DATA, 'rtk', 'version.json'), JSON.stringify({ version: '0.43.1' }))
    script('init --show', { stdout: '[ok] Hook: rtk init -g\n' })

    await expect(manager.getStatus()).resolves.toEqual({
      binaryInstalled: true,
      version: '0.43.1',
      hookInstalled: true,
      platform: 'linux',
      binaryPath: path.join(USER_DATA, 'rtk', 'rtk'),
      isWindows: false,
    })
  })
})

describe('getGainStats', () => {
  const gainArgs = 'gain --all --format json'

  it('returns null without probing when the binary is absent', async () => {
    const manager = await loadManager('linux')

    await expect(manager.getGainStats()).resolves.toBeNull()
    expect(rtk.calls).toHaveLength(0)
  })

  it('maps the v0.43 nested summary and converts the percent to a rate', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script(gainArgs, {
      stdout: JSON.stringify({
        summary: { total_commands: 412, total_saved: 1_500_000, avg_savings_pct: 37.5 },
      }),
    })

    await expect(manager.getGainStats()).resolves.toMatchObject({
      totalCommands: 412,
      totalSavedTokens: 1_500_000,
      saveRate: 0.375,
    })
  })

  it('estimates the USD saving from tokens when the CLI reports none', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script(gainArgs, { stdout: JSON.stringify({ summary: { total_saved: 1_000_000 } }) })

    const stats = await manager.getGainStats()
    // 1M tokens at ~$3/M input tokens.
    expect(stats?.totalSavedUsd).toBeCloseTo(3, 5)
  })

  it('keeps a reported USD figure instead of estimating', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script(gainArgs, { stdout: JSON.stringify({ summary: { total_saved: 1_000_000, total_saved_usd: 42.5 } }) })

    await expect(manager.getGainStats()).resolves.toMatchObject({ totalSavedUsd: 42.5 })
  })

  it('still reads the pre-0.43 flat payload', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script(gainArgs, { stdout: JSON.stringify({ total_commands: 90, total_saved_tokens: 250_000, usd_saved: 0.75 }) })

    await expect(manager.getGainStats()).resolves.toMatchObject({
      totalCommands: 90,
      totalSavedTokens: 250_000,
      totalSavedUsd: 0.75,
    })
  })

  it('returns null when the command fails or prints something unparseable', async () => {
    const manager = await loadManager('linux')
    installBinary('linux')
    script(gainArgs, { stdout: 'rtk gain: no data collected yet' })
    await expect(manager.getGainStats()).resolves.toBeNull()

    script(gainArgs, { error: true })
    await expect(manager.getGainStats()).resolves.toBeNull()
  })
})
