// @vitest-environment node
/**
 * getStatus orchestration — how gitService turns git status output into the
 * staged/unstaged/untracked/conflicted buckets the SCM panel renders.
 *
 * The contract that matters: gitService tries `--porcelain=v2` first and silently
 * degrades to `--porcelain` (v1) when git is too old, because a failed v2 parse
 * would otherwise hide every change from the user. Branch/upstream/ahead-behind
 * are gathered from dedicated rev-parse/rev-list calls, and only fall back to the
 * porcelain header lines when those calls do not yield the value. All parsing must
 * tolerate CRLF output (Windows git) and honour `-c core.quotePath=false` (the
 * global option must precede the subcommand or non-ASCII paths break).
 *
 * fs.watch is neutralised because getStatus auto-arms a watcher for detected repos.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const probe = vi.hoisted(() => ({
  calls: [] as Array<{ args: string[]; cwd?: string }>,
  queue: [] as Array<{ stdout: string; stderr: string; code: number | string }>,
}))

vi.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    options: { cwd?: string },
    cb: (err: unknown, stdout: string, stderr: string) => void,
  ) => {
    probe.calls.push({ args, cwd: options?.cwd })
    const r = probe.queue.shift() ?? { stdout: '', stderr: '', code: 0 }
    if (r.code === 0) cb(null, r.stdout, r.stderr)
    else cb(Object.assign(new Error(r.stderr || 'git failed'), { code: r.code }), r.stdout, r.stderr)
  },
}))

// Neutralise fs.watch (getStatus auto-starts the file watcher); keep the rest of fs real.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    watch: () => ({ on: () => undefined, close: () => undefined }),
  }
})

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

interface StatusBucket {
  path: string
  originalPath?: string
  statusCode: string
  status: string
  staged: boolean
  isTracked: boolean
}
interface StatusResult {
  isRepo: boolean
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: StatusBucket[]
  unstaged: StatusBucket[]
  untracked: StatusBucket[]
  conflicted: StatusBucket[]
}

function seed(...results: Array<{ stdout?: string; stderr?: string; code?: number | string }>) {
  probe.queue.push(
    ...results.map(r => ({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 })),
  )
}

function gitRootTrue() {
  seed({ stdout: 'true', code: 0 })
}

async function getStatus(cwd = '/repo'): Promise<StatusResult> {
  return handlers.getStatus!(cwd) as Promise<StatusResult>
}

beforeEach(() => {
  probe.calls = []
  probe.queue = []
  registerGitIPCHandlers()
})

describe('getStatus — repository gate', () => {
  it('returns an all-empty result (isRepo false) and stops issuing commands when not a repo', async () => {
    seed({ stdout: 'false', code: 0 })

    const result = await getStatus()

    expect(result.isRepo).toBe(false)
    expect(result.staged).toEqual([])
    // Only the is-inside-work-tree probe runs; nothing else is queried
    expect(probe.calls).toHaveLength(1)
    expect(probe.calls[0].args).toEqual(['rev-parse', '--is-inside-work-tree'])
  })
})

describe('getStatus — branch / upstream resolution', () => {
  it('queries branch, upstream and ahead/behind with dedicated plumbing commands', async () => {
    gitRootTrue()
    seed({ stdout: 'main\n', code: 0 }) // rev-parse HEAD
    seed({ stdout: 'origin/main\n', code: 0 }) // rev-parse @{upstream}
    seed({ stdout: '3\t5\n', code: 0 }) // rev-list --left-right --count → behind 3, ahead 5
    seed({ stdout: '', code: 0 }) // porcelain v2 clean

    const result = await getStatus()

    expect(result.branch).toBe('main')
    expect(result.upstream).toBe('origin/main')
    expect(result.behind).toBe(3)
    expect(result.ahead).toBe(5)
    expect(result.isRepo).toBe(true)
    const abCall = probe.calls.find(c => c.args[0] === 'rev-list')
    expect(abCall!.args).toEqual(['rev-list', '--left-right', '--count', 'origin/main...HEAD'])
  })

  it('recovers upstream and ahead/behind from porcelain v2 header lines when plumbing fails', async () => {
    gitRootTrue()
    seed({ stdout: 'main\n', code: 0 }) // branch
    seed({ stdout: '', stderr: 'no upstream', code: 128 }) // rev-parse @{upstream} fails → no rev-list
    seed({
      stdout: ['# branch.upstream origin/feature', '# branch.ab +2 -7', '? new.txt'].join('\n'),
      code: 0,
    })

    const result = await getStatus()

    expect(result.upstream).toBe('origin/feature')
    expect(result.ahead).toBe(2)
    expect(result.behind).toBe(7)
    expect(result.untracked).toHaveLength(1)
  })
})

describe('getStatus — porcelain v2 parsing', () => {
  function richV2Output() {
    return [
      '# branch.oid deadbeef',
      '# branch.head main',
      '1 M. N... 100644 100644 100644 a b src/staged-mod.ts',
      '1 .M N... 100644 100644 100644 a b src/unstaged-mod.ts',
      '1 A. N... 100644 100644 100644 a b src/staged-add.ts',
      '1 DD N... 100644 100644 100644 a b src/both-del.ts',
      '1 AA N... 100644 100644 100644 a b src/both-add.ts',
      '2 R. N... 100644 100644 100644 a b 090 new/name.ts\told/name.ts',
      'u UU N... 100644 100644 100644 100644 a b c src/unmerged.ts',
      '? src/untracked.ts',
      '! src/ignored.ts',
    ].join('\n')
  }

  it('classifies ordinary, rename, unmerged, untracked and ignored entries', async () => {
    gitRootTrue()
    seed({ stdout: 'main\n', code: 0 })
    seed({ stdout: '', stderr: 'x', code: 128 })
    seed({ stdout: richV2Output(), code: 0 })

    const result = await getStatus()

    // staged: M.(mod), A.(add), DD, AA, R.(rename)
    expect(result.staged.map((f: any) => f.path).sort()).toEqual([
      'new/name.ts',
      'src/both-add.ts',
      'src/both-del.ts',
      'src/staged-add.ts',
      'src/staged-mod.ts',
    ])
    // unstaged: .M, DD, AA
    expect(result.unstaged.map((f: any) => f.path).sort()).toEqual([
      'src/both-add.ts',
      'src/both-del.ts',
      'src/unstaged-mod.ts',
    ])
    // conflicted: DD, AA, unmerged u-entry
    expect(result.conflicted.map((f: any) => f.path).sort()).toEqual([
      'src/both-add.ts',
      'src/both-del.ts',
      'src/unmerged.ts',
    ])
    expect(result.untracked).toHaveLength(1)
    // ignored lines are skipped entirely
    expect(JSON.stringify(result)).not.toContain('src/ignored.ts')
  })

  it('attaches originalPath and renamed status to staged rename entries', async () => {
    gitRootTrue()
    seed({ stdout: 'main\n', code: 0 })
    seed({ stdout: '', code: 128 })
    seed({
      stdout: '2 R. N... 100644 100644 100644 a b 090 new/name.ts\told/name.ts',
      code: 0,
    })

    const result = await getStatus()
    const renamed = result.staged.find(f => f.path === 'new/name.ts')

    expect(renamed).toBeDefined()
    expect(renamed!.originalPath).toBe('old/name.ts')
    expect(renamed!.status).toBe('renamed')
    expect(renamed!.staged).toBe(true)
  })

  it('parses paths containing spaces and non-ASCII without quoting', async () => {
    gitRootTrue()
    seed({ stdout: 'main\n', code: 0 })
    seed({ stdout: '', code: 128 })
    seed({
      stdout: '1 .M N... 100644 100644 100644 a b docs/用户 手册.md',
      code: 0,
    })

    const result = await getStatus()
    const statusCall = probe.calls.find(c => c.args.includes('status'))

    expect(result.unstaged[0].path).toBe('docs/用户 手册.md')
    // -c core.quotePath=false must precede the subcommand to disable octal escaping
    expect(statusCall!.args.slice(0, 2)).toEqual(['-c', 'core.quotePath=false'])
    expect(statusCall!.args[2]).toBe('status')
  })

  it('tolerates CRLF line endings from Windows git', async () => {
    gitRootTrue()
    seed({ stdout: 'main\r\n', code: 0 })
    seed({ stdout: '', code: 128 })
    seed({
      stdout: ['1 .M N... 100644 100644 100644 a b src/a.ts', '? src/new.ts'].join('\r\n') + '\r\n',
      code: 0,
    })

    const result = await getStatus()

    expect(result.branch).toBe('main')
    expect(result.unstaged[0].path).toBe('src/a.ts')
    // trailing \r must not leak into the untracked path
    expect(result.untracked[0].path).toBe('src/new.ts')
  })

  it('returns a clean-repo result (empty buckets) when status output is blank', async () => {
    gitRootTrue()
    seed({ stdout: 'main\n', code: 0 })
    seed({ stdout: 'origin/main\n', code: 0 })
    seed({ stdout: '0\t0\n', code: 0 })
    seed({ stdout: '\n', code: 0 })

    const result = await getStatus()

    expect(result.isRepo).toBe(true)
    expect(result.staged).toEqual([])
    expect(result.unstaged).toEqual([])
    expect(result.untracked).toEqual([])
  })
})

describe('getStatus — porcelain v1 fallback', () => {
  it('degrades to --porcelain v1 when the v2 command exits non-zero', async () => {
    gitRootTrue()
    seed({ stdout: 'main\n', code: 0 })
    seed({ stdout: '', code: 128 })
    seed({ stdout: '', stderr: 'unknown option porcelain=v2', code: 1 }) // v2 fails
    seed({
      stdout: [
        'M  src/staged.ts',
        ' M src/unstaged.ts',
        '?? src/untracked.ts',
        '!! src/ignored.ts',
        'UU src/conflict.ts',
        'R  old.ts -> new.ts',
      ].join('\n'),
      code: 0,
    })

    const result = await getStatus()

    expect(result.staged.map((f: any) => f.path).sort()).toEqual([
      'new.ts',
      'src/conflict.ts',
      'src/staged.ts',
    ])
    expect(result.unstaged.map((f: any) => f.path).sort()).toEqual([
      'src/conflict.ts',
      'src/unstaged.ts',
    ])
    expect(result.untracked.map((f: any) => f.path)).toEqual(['src/untracked.ts'])
    expect(result.conflicted.map((f: any) => f.path)).toEqual(['src/conflict.ts'])
    const renamed = result.staged.find(f => f.path === 'new.ts')
    expect(renamed!.originalPath).toBe('old.ts')
    expect(JSON.stringify(result)).not.toContain('src/ignored.ts')
  })

  it('issues the v1 status with quotePath disabled and renames enabled', async () => {
    gitRootTrue()
    seed({ stdout: 'main\n', code: 0 })
    seed({ stdout: '', code: 128 })
    seed({ stdout: '', code: 1 }) // v2 fails
    seed({ stdout: ' M src/a.ts', code: 0 })

    await getStatus()
    const v1Call = probe.calls.find(c => c.args.includes('--porcelain') && !c.args.includes('--porcelain=v2'))

    expect(v1Call!.args).toEqual(['-c', 'core.quotePath=false', 'status', '--porcelain', '--renames', '-uall'])
  })

  it('returns an empty-but-valid repo result when v1 status also fails', async () => {
    gitRootTrue()
    seed({ stdout: 'main\n', code: 0 })
    seed({ stdout: '', code: 128 })
    seed({ stdout: '', code: 1 }) // v2 fails
    seed({ stdout: '', stderr: 'fatal: repo corrupt', code: 128 }) // v1 also fails

    const result = await getStatus()

    expect(result.isRepo).toBe(true)
    expect(result.branch).toBe('main')
    expect(result.staged).toEqual([])
    expect(result.unstaged).toEqual([])
  })
})
