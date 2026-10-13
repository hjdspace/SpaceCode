// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * `rtk gain --all --format json` parsing. The CLI has shipped at least two
 * payload shapes, so every field is read through a fallback chain:
 *
 *   commands  summary.total_commands        → total_commands
 *   tokens    summary.total_saved           → summary.total_saved_tokens
 *             → total_saved_tokens          → tokens_saved
 *   dollars   summary.total_saved_usd       → total_saved_usd → usd_saved
 *             → estimated from tokens
 *   rate      summary.avg_savings_pct / 100 → save_rate
 *             → derived from summary totals  → derived from flat totals
 *
 * Two consequences make this worth pinning. First, an estimate that is skipped
 * (the guard reads a plain number, so `0` is "no data") or a rate that is
 * derived from a zero denominator changes what the RTK panel shows. Second,
 * nothing validates the values — a string, a negative or a percentage above 100
 * is handed straight to the renderer, which then does arithmetic on it.
 *
 * Payloads are fed through the public `getGainStats`, so a malformed document
 * has to degrade to `null` exactly like a failing CLI does.
 */

const HOME = path.join(process.cwd(), 'home')
const USER_DATA = path.join(process.cwd(), 'userdata')
const GAIN_ARGV = 'gain --all --format json'

const rtk = vi.hoisted(() => ({
  existing: new Set<string>(),
  calls: [] as Array<{ cmd: string; args: string[]; options?: unknown }>,
  answers: new Map<string, { stdout?: string; stderr?: string; error?: boolean }>(),
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => rtk.existing.has(String(p)),
  readFileSync: (p: string) => {
    throw new Error(`ENOENT: ${p}`)
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
    cb: (err: Error | null, stdout: string, stderr: string | undefined) => void,
  ) => {
    rtk.calls.push({ cmd, args, options })
    const answer = rtk.answers.get(args.join(' '))
    if (!answer) return cb(new Error('command not scripted'), '', undefined)
    if (answer.error) return cb(new Error('rtk exited with code 1'), '', answer.stderr)
    cb(null, answer.stdout ?? '', answer.stderr ?? '')
  },
}))

vi.mock('os', () => ({
  homedir: () => HOME,
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

type Manager = typeof import('../rtkManager')
type RtkManager = Manager['rtkManager']

async function loadManager(): Promise<RtkManager> {
  vi.resetModules()
  const mod = (await import('../rtkManager')) as Manager
  return mod.rtkManager
}

/** The manager's own path for the host platform, so these tests stay portable. */
function installBinary(manager: RtkManager): string {
  const target = manager.getBinaryPath()
  rtk.existing.add(target)
  return target
}

function scriptGain(payload: unknown): void {
  rtk.answers.set(GAIN_ARGV, { stdout: JSON.stringify(payload) })
}

function scriptGainRaw(stdout: string): void {
  rtk.answers.set(GAIN_ARGV, { stdout })
}

beforeEach(() => {
  rtk.existing.clear()
  rtk.calls = []
  rtk.answers.clear()
})

describe('summary field fallbacks', () => {
  it('reads the v0.43 token key when total_saved is absent', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_saved_tokens: 1200 } })

    const stats = await manager.getGainStats()
    expect(stats?.totalSavedTokens).toBe(1200)
    expect(stats?.totalSavedUsd).toBeCloseTo(0.0036, 6)
  })

  it('reads the pre-0.43 tokens_saved key when nothing else reports savings', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ tokens_saved: 999, total_commands: 7 })

    const stats = await manager.getGainStats()
    expect(stats?.totalCommands).toBe(7)
    expect(stats?.totalSavedTokens).toBe(999)
  })

  it('prefers the nested token key over the flat one', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_saved_tokens: 500 }, total_saved_tokens: 9000 })

    await expect(manager.getGainStats()).resolves.toMatchObject({ totalSavedTokens: 500 })
  })

  it('reads a flat USD figure when the summary reports none', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_saved: 10 }, total_saved_usd: 1.25 })

    await expect(manager.getGainStats()).resolves.toMatchObject({ totalSavedUsd: 1.25 })
  })

  it('estimates dollars at $3 per million input tokens', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_saved: 250_000 } })

    const stats = await manager.getGainStats()
    expect(stats?.totalSavedUsd).toBeCloseTo(0.75, 6)
  })

  it('reports no dollar figure for a zero-token summary', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_commands: 3, total_saved: 0 } })

    // The estimate guard is a truthiness test, so an honest "0 tokens saved" is
    // indistinguishable from "no data" downstream.
    await expect(manager.getGainStats()).resolves.toEqual({ totalCommands: 3, totalSavedTokens: 0 })
  })

  it('carries a negative saving into a negative dollar estimate', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_saved: -42_000 } })

    const stats = await manager.getGainStats()
    expect(stats?.totalSavedUsd).toBeCloseTo(-0.126, 6)
  })

  it('does not clamp a figure far beyond a plausible lifetime saving', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_saved: 1e15 } })

    const stats = await manager.getGainStats()
    expect(stats?.totalSavedUsd).toBeCloseTo(3e9, 3)
  })

  it('passes a non-numeric field straight through', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_commands: '412', total_saved: '1.5M' } })

    // Records a gap, not an endorsement: the estimate divides the raw value, so
    // a human-readable token count becomes NaN and the panel's "total saved"
    // reads NaN dollars instead of falling back to a plain zero.
    const stats = await manager.getGainStats()
    expect(stats?.totalCommands).toBe('412')
    expect(stats?.totalSavedTokens).toBe('1.5M')
    expect(stats?.totalSavedUsd).toBeNaN()
  })
})

describe('save rate', () => {
  it('converts a percentage to the 0-1 ratio the panel expects', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { avg_savings_pct: 37.5 } })

    await expect(manager.getGainStats()).resolves.toMatchObject({ saveRate: 0.375 })
  })

  it('keeps a zero percentage as a zero rate', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { avg_savings_pct: 0 } })

    await expect(manager.getGainStats()).resolves.toMatchObject({ saveRate: 0 })
  })

  it('does not cap a percentage above 100', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { avg_savings_pct: 250 } })

    await expect(manager.getGainStats()).resolves.toMatchObject({ saveRate: 2.5 })
  })

  it('takes the legacy flat save_rate without dividing it', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ save_rate: 0.42 })

    await expect(manager.getGainStats()).resolves.toMatchObject({ saveRate: 0.42 })
  })

  it('derives the rate from the summary totals when no percentage is printed', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_commands: 10, total_saved: 300, total_input: 700 } })

    await expect(manager.getGainStats()).resolves.toMatchObject({ saveRate: 0.3 })
  })

  it('reports a zero rate instead of dividing by a zero denominator', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_commands: 10, total_saved: 0, total_input: 0 } })

    await expect(manager.getGainStats()).resolves.toMatchObject({ saveRate: 0 })
  })

  it('derives the rate from the pre-0.43 flat totals', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ total_commands: 4, total_saved_tokens: 100, total_tokens: 900 })

    await expect(manager.getGainStats()).resolves.toMatchObject({ saveRate: 0.1 })
  })

  it('leaves the rate unset when the payload reports no commands at all', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { total_saved: 500, total_input: 0 } })

    const stats = await manager.getGainStats()
    expect(stats?.saveRate).toBeUndefined()
  })
})

describe('time series', () => {
  it('renames the snake_case daily fields the panel reads', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({
      daily: [
        { date: '2026-04-01', commands: 12, saved_tokens: 90_000, extra: 'ignored' },
        { date: '2026-04-02', commands: 3, savedTokens: 4_000 },
      ],
    })

    await expect(manager.getGainStats()).resolves.toEqual({
      daily: [
        { date: '2026-04-01', commands: 12, savedTokens: 90_000 },
        { date: '2026-04-02', commands: 3, savedTokens: 4_000 },
      ],
    })
  })

  it('fills gaps of an empty daily entry instead of failing', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ daily: [{}] })

    await expect(manager.getGainStats()).resolves.toEqual({
      daily: [{ date: '', commands: 0, savedTokens: 0 }],
    })
  })

  it('reads a daily array nested in the summary', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { daily: [{ date: '2026-04-03', commands: 1, saved_tokens: 10 }] } })

    await expect(manager.getGainStats()).resolves.toEqual({
      daily: [{ date: '2026-04-03', commands: 1, savedTokens: 10 }],
    })
  })

  it('maps the weekly window boundaries', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({
      weekly: [{ week_start: '2026-03-30', week_end: '2026-04-05', commands: 40, saved_tokens: 300_000 }],
    })

    await expect(manager.getGainStats()).resolves.toEqual({
      weekly: [
        { weekStart: '2026-03-30', weekEnd: '2026-04-05', commands: 40, savedTokens: 300_000 },
      ],
    })
  })

  it('defaults missing weekly boundaries to an empty range', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { weekly: [{ commands: 2 }] } })

    await expect(manager.getGainStats()).resolves.toEqual({
      weekly: [{ weekStart: '', weekEnd: '', commands: 2, savedTokens: 0 }],
    })
  })

  it('maps the monthly buckets', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ monthly: [{ month: '2026-04', commands: 250, saved_tokens: 7_500_000 }] })

    await expect(manager.getGainStats()).resolves.toEqual({
      monthly: [{ month: '2026-04', commands: 250, savedTokens: 7_500_000 }],
    })
  })

  it('defaults an empty monthly bucket and accepts a camelCase token field', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ summary: { monthly: [{}, { month: '2026-05', savedTokens: 12 }] } })

    await expect(manager.getGainStats()).resolves.toEqual({
      monthly: [{ month: '', commands: 0, savedTokens: 0 }, { month: '2026-05', commands: 0, savedTokens: 12 }],
    })
  })

  it('ignores a series field that is not an array', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ daily: { '2026-04-01': 90_000 }, weekly: 'none', monthly: 3 })

    await expect(manager.getGainStats()).resolves.toEqual({})
  })

  it('passes a per-command breakdown through untouched', async () => {
    const manager = await loadManager()
    installBinary(manager)
    const byCommand = { cargo: { commands: 30, savedTokens: 220_000 } }
    scriptGain({ by_command: byCommand })

    const stats = await manager.getGainStats()
    expect(stats?.byCommand).toEqual(byCommand)
  })

  it('keeps an empty series array as an empty series', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGain({ daily: [], monthly: [] })

    await expect(manager.getGainStats()).resolves.toEqual({ daily: [], monthly: [] })
  })
})

describe('unusable output', () => {
  it('returns null for an empty stdout', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGainRaw('')

    await expect(manager.getGainStats()).resolves.toBeNull()
  })

  it('returns null when the CLI prints the literal null', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGainRaw('null')

    await expect(manager.getGainStats()).resolves.toBeNull()
  })

  it('returns an all-empty stats object for a bare JSON object', async () => {
    const manager = await loadManager()
    installBinary(manager)
    scriptGainRaw('{}')

    // A valid but empty document is "stats" to the caller: the panel renders
    // zeros rather than the "no data" state it would show for null.
    await expect(manager.getGainStats()).resolves.toEqual({})
  })

  it('returns null when the CLI exits non-zero and writes no stderr', async () => {
    const manager = await loadManager()
    const target = installBinary(manager)
    rtk.answers.set(GAIN_ARGV, { error: true })

    await expect(manager.getGainStats()).resolves.toBeNull()
    const failure = rtk.calls[0]
    expect(failure?.cmd).toBe(target)
    expect((failure?.options as { timeout: number }).timeout).toBe(15_000)
    expect((failure?.options as { maxBuffer: number }).maxBuffer).toBe(5 * 1024 * 1024)
  })
})
