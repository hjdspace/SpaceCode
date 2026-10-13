// @vitest-environment node
/**
 * getBranches orchestration — the branch list the SCM/graph panel is built from.
 *
 * gitService prefers `for-each-ref` (locale- and padding-independent, machine
 * parseable) and only degrades to `git branch -a` when the modern command is
 * unavailable (very old git). Two correctness contracts drive the branches:
 *   1. A branch is marked `current` either by for-each-ref's HEAD marker OR by
 *      matching rev-parse's current branch, because in detached HEAD the marker
 *      field is blank yet the checked-out branch must still be recognisable.
 *   2. Symbolic refs (origin/HEAD) and malformed/short lines are dropped so the
 *      panel never shows a phantom branch.
 * ahead/behind parsing itself lives in gitParsers and is tested there; here we
 * only verify getBranches feeds it the right field and maps the rest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

interface Branch {
  name: string
  current: boolean
  isRemote: boolean
  upstream?: string
  ahead?: number
  behind?: number
}

function seed(...results: Array<{ stdout?: string; stderr?: string; code?: number | string }>) {
  probe.queue.push(
    ...results.map(r => ({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 })),
  )
}

function getBranches(): Promise<Branch[]> {
  return handlers.getBranches!('/repo') as Promise<Branch[]>
}

beforeEach(() => {
  probe.calls = []
  probe.queue = []
  registerGitIPCHandlers()
})

describe('getBranches — for-each-ref path', () => {
  function forEachRefOutput() {
    return [
      'refs/heads/main|main|*||origin/main|ahead 2, behind 1',
      'refs/heads/dev|dev| ||origin/dev|behind 3',
      'refs/heads/plain|plain| ||||',
      'refs/remotes/origin/main|origin/main| ||||',
      'refs/remotes/origin/HEAD|origin/HEAD| |ref: refs/remotes/origin/main||',
      'refs/heads/broken|',
      '',
    ].join('\n')
  }

  it('queries for-each-ref with the six-field pipe format over heads and remotes', async () => {
    seed({ stdout: forEachRefOutput(), code: 0 })
    seed({ stdout: 'main\n', code: 0 })

    await getBranches()
    const fer = probe.calls.find(c => c.args[0] === 'for-each-ref')!

    expect(fer.args).toContain('refs/heads')
    expect(fer.args).toContain('refs/remotes')
    expect(fer.args[1]).toMatch(/^\-\-format=%\(refname\)\|/)
  })

  it('maps local/remote branches, marks the HEAD-marker branch current and drops symbolic refs', async () => {
    seed({ stdout: forEachRefOutput(), code: 0 })
    seed({ stdout: 'main\n', code: 0 })

    const branches = await getBranches()
    const names = branches.map(b => b.name)

    expect(names).toEqual(['main', 'dev', 'plain', 'origin/main'])
    expect(branches.find(b => b.name === 'main')!.current).toBe(true)
    expect(branches.find(b => b.name === 'main')!.ahead).toBe(2)
    expect(branches.find(b => b.name === 'main')!.behind).toBe(1)
    expect(branches.find(b => b.name === 'dev')!.current).toBe(false)
    expect(branches.find(b => b.name === 'origin/main')!.isRemote).toBe(true)
    expect(branches.find(b => b.name === 'plain')!.upstream).toBeUndefined()
  })

  it('marks a local branch current by name when the HEAD marker is blank (detached-HEAD shape)', async () => {
    seed({ stdout: 'refs/heads/release|release| ||origin/release|', code: 0 })
    seed({ stdout: 'release\n', code: 0 })

    const branches = await getBranches()

    expect(branches[0].current).toBe(true)
  })

  it('leaves every branch uncirculated when rev-parse reports detached HEAD', async () => {
    seed({ stdout: 'refs/heads/main|main| ||||', code: 0 })
    seed({ stdout: 'HEAD\n', code: 0 })

    const branches = await getBranches()

    expect(branches[0].current).toBe(false)
  })

  it('returns an empty list for a repository with no branches', async () => {
    seed({ stdout: '', code: 0 })
    seed({ stdout: 'HEAD\n', code: 0 })

    await expect(getBranches()).resolves.toEqual([])
  })
})

describe('getBranches — git branch -a fallback', () => {
  it('falls back when for-each-ref exits non-zero and strips the remotes/ prefix', async () => {
    seed({ stdout: '', stderr: 'unknown command', code: 1 }) // for-each-ref fails
    seed({ stdout: 'main\n', code: 0 }) // rev-parse HEAD inside fallback
    seed({
      stdout: [
        '* main',
        '  dev',
        '  remotes/origin/main',
        '  remotes/origin/HEAD -> origin/main',
        '(HEAD detached at abc123)',
        '',
      ].join('\n'),
      code: 0,
    })

    const branches = await getBranches()
    const names = branches.map(b => b.name)

    expect(names).toEqual(['main', 'dev', 'origin/main'])
    expect(branches.find(b => b.name === 'main')!.current).toBe(true)
    expect(branches.find(b => b.name === 'origin/main')!.isRemote).toBe(true)
  })

  it('marks the fallback branch current by matching rev-parse even without the * marker', async () => {
    seed({ stdout: '', code: 1 }) // for-each-ref fails
    seed({ stdout: 'feature\n', code: 0 })
    seed({ stdout: '  feature\n  other\n', code: 0 })

    const branches = await getBranches()

    expect(branches.find(b => b.name === 'feature')!.current).toBe(true)
    expect(branches.find(b => b.name === 'other')!.current).toBe(false)
  })

  it('returns an empty list when the fallback branch command also fails', async () => {
    seed({ stdout: '', code: 1 }) // for-each-ref fails
    seed({ stdout: 'main\n', code: 0 }) // rev-parse HEAD
    seed({ stdout: '', stderr: 'fatal: bad', code: 128 }) // branch -a fails

    await expect(getBranches()).resolves.toEqual([])
  })
})
