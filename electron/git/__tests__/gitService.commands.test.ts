// @vitest-environment node
/**
 * Command-construction and success/failure wiring for the write-style and
 * read-style git handlers (stage/unstage/branch ops, log, show, discard,
 * remote ops, raw/staged diff, commit diff).
 *
 * These handlers are thin wrappers around gitExec, but their product contract is
 * entirely in (a) the exact argv they build — a wrong flag silently stages the
 * wrong thing or reverts nothing — and (b) how they translate a non-zero exit into
 * a boolean/{success,error} shape the renderer can act on. The tests pin both, and
 * exercise the fallback paths (discard→clean, for-each-ref→none) that only fire on
 * failure.
 *
 * No real git is ever executed: child_process is mocked so push/pull/reset/checkout
 * are asserted at the argv level only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LOG_FIELD_SEP } from '../gitParsers'

const probe = vi.hoisted(() => ({
  calls: [] as Array<{ args: string[] }>,
  queue: [] as Array<{ stdout: string; stderr: string; code: number | string }>,
}))

vi.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: unknown, stdout: string, stderr: string) => void,
  ) => {
    probe.calls.push({ args })
    const r = probe.queue.shift() ?? { stdout: '', stderr: '', code: 0 }
    if (r.code === 0) cb(null, r.stdout, r.stderr)
    else cb(Object.assign(new Error(r.stderr || 'git failed'), { code: r.code }), r.stdout, r.stderr)
  },
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { handle: vi.fn(), handleOnce: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const handlers = vi.hoisted(() => ({}) as Record<string, (...args: unknown[]) => unknown>)

vi.mock('@/shared/handlerRegistry', () => ({
  registerHandlers: vi.fn(
    (_ipc: unknown, _ch: unknown, _prefix: string, h: Record<string, (...a: unknown[]) => unknown>) => {
      for (const k of Object.keys(handlers)) delete handlers[k]
      Object.assign(handlers, h)
    },
  ),
}))

import { registerGitIPCHandlers } from '../gitService'

function seed(...results: Array<{ stdout?: string; stderr?: string; code?: number | string }>) {
  probe.queue.push(
    ...results.map(r => ({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 })),
  )
}
function lastArgs(): string[] {
  return probe.calls[probe.calls.length - 1].args
}
function call(fn: string, ...args: unknown[]) {
  return handlers[fn]!(...args)
}

beforeEach(() => {
  probe.calls = []
  probe.queue = []
  registerGitIPCHandlers()
})

describe('staging commands', () => {
  it('stage passes every path after a `--` separator so dashes cannot be read as flags', async () => {
    seed({ code: 0 })
    await expect(call('stage', '/repo', ['a.ts', '-rf'])).resolves.toBe(true)
    expect(lastArgs()).toEqual(['add', '--', 'a.ts', '-rf'])
  })

  it('stage reports failure when git add exits non-zero', async () => {
    seed({ stderr: 'failed', code: 1 })
    await expect(call('stage', '/repo', ['a.ts'])).resolves.toBe(false)
  })

  it('unstage resets HEAD against the explicit path list', async () => {
    seed({ code: 0 })
    await expect(call('unstage', '/repo', ['a.ts'])).resolves.toBe(true)
    expect(lastArgs()).toEqual(['reset', 'HEAD', '--', 'a.ts'])
  })

  it('stageAll and unstageAll use the whole-worktree forms', async () => {
    seed({ code: 0 })
    await expect(call('stageAll', '/repo')).resolves.toBe(true)
    expect(lastArgs()).toEqual(['add', '-A'])

    seed({ code: 0 })
    await expect(call('unstageAll', '/repo')).resolves.toBe(true)
    expect(lastArgs()).toEqual(['reset', 'HEAD'])
  })
})

describe('branch mutation commands', () => {
  it('checkout returns the stderr verbatim on failure', async () => {
    seed({ code: 0 })
    await expect(call('checkout', '/repo', 'dev')).resolves.toEqual({ success: true, error: undefined })
    expect(lastArgs()).toEqual(['checkout', 'dev'])

    seed({ stderr: 'your local changes would be overwritten', code: 1 })
    const res = await call('checkout', '/repo', 'dev') as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toBe('your local changes would be overwritten')
  })

  it('createBranch switches to `checkout -b` only when asked to switch', async () => {
    seed({ code: 0 })
    await call('createBranch', '/repo', 'feat', false)
    expect(lastArgs()).toEqual(['branch', 'feat'])

    seed({ code: 0 })
    await call('createBranch', '/repo', 'feat', true)
    expect(lastArgs()).toEqual(['checkout', '-b', 'feat'])
  })

  it('deleteBranch picks -D for force and -d otherwise', async () => {
    seed({ code: 0 })
    await call('deleteBranch', '/repo', 'old', true)
    expect(lastArgs()).toEqual(['branch', '-D', 'old'])

    seed({ code: 0 })
    await call('deleteBranch', '/repo', 'old', false)
    expect(lastArgs()).toEqual(['branch', '-d', 'old'])
  })
})

describe('remote commands', () => {
  it.each([
    ['pull', ['pull']],
    ['push', ['push']],
    ['stash', ['stash']],
    ['stashPop', ['stash', 'pop']],
  ] as const)('%s maps exit status to success/error', async (fn, expectedArgs) => {
    seed({ code: 0 })
    await expect(call(fn, '/repo')).resolves.toEqual({ success: true, error: undefined })
    expect(lastArgs()).toEqual(expectedArgs)

    seed({ stderr: 'network down', code: 1 })
    const res = await call(fn, '/repo') as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toBe('network down')
  })

  it('fetchAll prunes stale refs across all remotes', async () => {
    seed({ code: 0 })
    await expect(call('fetchAll', '/repo')).resolves.toEqual({ success: true })
    expect(lastArgs()).toEqual(['fetch', '--all', '--prune'])
  })
})

describe('getLog orchestration', () => {
  it('defaults to 50 entries and returns parsed rows', async () => {
    const row = (h: string, s: string) => [h, h + 's', 'subject ' + h, 'Annie', '2026-01-01', 'HEAD', s].join(LOG_FIELD_SEP)
    seed({ stdout: [row('aaa', 'bbb'), row('ccc', 'ddd')].join('\n'), code: 0 })

    const entries = await call('getLog', '/repo') as Array<{ hash: string }>

    expect(lastArgs()[1]).toBe('--max-count=50')
    expect(entries).toHaveLength(2)
    expect(entries[0].hash).toBe('aaa')
  })

  it('honours an explicit count', async () => {
    seed({ stdout: '', code: 0 })
    await call('getLog', '/repo', 7)
    expect(lastArgs()[1]).toBe('--max-count=7')
  })

  it('returns an empty history when git log fails (e.g. empty repo)', async () => {
    seed({ stderr: 'does not have any commits yet', code: 128 })
    await expect(call('getLog', '/repo')).resolves.toEqual([])
  })
})

describe('showFile / raw diff readers', () => {
  it('showFile reads the committed blob by default and the index blob when asked', async () => {
    seed({ stdout: 'contents', code: 0 })
    await expect(call('showFile', '/repo', 'a.ts')).resolves.toBe('contents')
    expect(lastArgs()).toEqual(['show', 'HEAD:a.ts'])

    seed({ stdout: 'staged', code: 0 })
    await call('showFile', '/repo', 'a.ts', true)
    expect(lastArgs()).toEqual(['show', ':a.ts'])
  })

  it('showFile returns null when the object cannot be shown', async () => {
    seed({ stderr: 'bad object', code: 128 })
    await expect(call('showFile', '/repo', 'gone.ts')).resolves.toBeNull()
  })

  it('getStagedDiff reads the cached diff and yields empty string on failure', async () => {
    seed({ stdout: 'diff body', code: 0 })
    await expect(call('getStagedDiff', '/repo')).resolves.toBe('diff body')
    expect(lastArgs()).toEqual(['diff', '--cached', '--no-color', '--unified=3'])

    seed({ code: 1 })
    await expect(call('getStagedDiff', '/repo')).resolves.toBe('')
  })

  it('getRawDiff prepends the quotePath global and adds --cached only when staged', async () => {
    seed({ stdout: 'x', code: 0 })
    await call('getRawDiff', '/repo', 'a.ts', false)
    expect(lastArgs()).toEqual(['-c', 'core.quotePath=false', 'diff', '--no-color', '--unified=3', '--', 'a.ts'])

    seed({ stdout: 'x', code: 0 })
    await call('getRawDiff', '/repo', 'a.ts', true)
    expect(lastArgs()).toEqual([
      '-c', 'core.quotePath=false', 'diff', '--no-color', '--unified=3', '--cached', '--', 'a.ts',
    ])
  })
})

describe('discardChanges fallback', () => {
  it('restores tracked files via checkout HEAD and reports success', async () => {
    seed({ code: 0 })
    await expect(call('discardChanges', '/repo', ['a.ts'])).resolves.toBe(true)
    expect(lastArgs()).toEqual(['checkout', 'HEAD', '--', 'a.ts'])
  })

  it('falls back to git clean for untracked files when checkout HEAD fails', async () => {
    seed({ stderr: 'not tracked', code: 1 }) // checkout HEAD fails
    seed({ code: 0 }) // clean succeeds

    await expect(call('discardChanges', '/repo', ['new.ts'])).resolves.toBe(true)
    expect(lastArgs()).toEqual(['clean', '-f', '--', 'new.ts'])
  })

  it('reports failure when neither checkout nor clean succeeds', async () => {
    seed({ code: 1 })
    seed({ code: 1 })
    await expect(call('discardChanges', '/repo', ['x'])).resolves.toBe(false)
  })
})

describe('getCommitDiff', () => {
  it('uses `git show` for a normal commit so root commits still render', async () => {
    seed({ stdout: 'hash parent1\n', code: 0 }) // one parent → not a merge
    seed({ stdout: 'patch', code: 0 })

    await expect(call('getCommitDiff', '/repo', 'hash')).resolves.toBe('patch')
    expect(lastArgs()).toEqual(['-c', 'core.quotePath=false', 'show', '--format=', '--no-color', '--unified=3', 'hash'])
  })

  it('diffs a merge commit against its first parent instead of the unreadable combined diff', async () => {
    seed({ stdout: 'm p1 p2\n', code: 0 }) // two parents → merge
    seed({ stdout: 'patch', code: 0 })

    await call('getCommitDiff', '/repo', 'm', 'src/a.ts')
    expect(lastArgs()).toEqual([
      '-c', 'core.quotePath=false', 'diff', '--no-color', '--unified=3', 'p1', 'm', '--', 'src/a.ts',
    ])
  })

  it('returns an empty patch when the diff command fails', async () => {
    seed({ stdout: 'hash p\n', code: 0 })
    seed({ code: 1 })
    await expect(call('getCommitDiff', '/repo', 'hash')).resolves.toBe('')
  })
})
