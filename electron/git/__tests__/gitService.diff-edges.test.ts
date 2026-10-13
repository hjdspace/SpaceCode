// @vitest-environment node
/**
 * Diff edge-conditions: untracked files, binary content and empty files.
 *
 * `git diff` produces no output for untracked files, so the SCM viewer would show
 * a brand-new file as "no changes" unless gitService synthesises a diff. The
 * fallback is gated on `git ls-files --error-unmatch`: a tracked file with a clean
 * diff must stay null (there genuinely is nothing to show), while an untracked file
 * is read from disk and rendered as an all-additions hunk. Binary detection (a null
 * byte) and the trailing-newline / empty-file cases are the boundaries that decide
 * whether the synthetic hunk has any lines — a wrong count here mislabels every
 * "new file" badge in the panel.
 *
 * getFullDiff's untracked path likewise counts lines from the real file, so
 * countFileLines' newline handling is pinned here too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const probe = vi.hoisted(() => ({
  calls: [] as Array<{ args: string[] }>,
  queue: [] as Array<{ stdout: string; stderr: string; code: number | string }>,
  fileContent: undefined as Buffer | undefined,
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

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    readFileSync: () => {
      if (probe.fileContent === undefined) {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      }
      return probe.fileContent
    },
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

interface DiffResult {
  path: string
  hunks: Array<{ oldStart: number; newStart: number; content: string }>
  additions: number
  deletions: number
  isBinary: boolean
}

function seed(...results: Array<{ stdout?: string; stderr?: string; code?: number | string }>) {
  probe.queue.push(
    ...results.map(r => ({ stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 })),
  )
}
function isArg(args: string[], sub: string) {
  return args[0] === sub
}
const lsFilesCalls = () => probe.calls.filter(c => isArg(c.args, 'ls-files'))

beforeEach(() => {
  probe.calls = []
  probe.queue = []
  probe.fileContent = undefined
  registerGitIPCHandlers()
})

describe('getDiff — untracked fallback after a non-zero git diff', () => {
  it('synthesises an all-additions hunk for a new text file so it is visible in the viewer', async () => {
    probe.fileContent = Buffer.from('line one\nline two\nline three\n', 'utf8')
    seed({ stdout: '', stderr: 'fatal: bad', code: 1 }) // git diff fails
    seed({ stdout: '', stderr: 'did not match', code: 1 }) // ls-files --error-unmatch → untracked

    const result = (await handlers.getDiff!('/repo', 'new.txt', false)) as DiffResult

    expect(result).not.toBeNull()
    expect(result.additions).toBe(3)
    expect(result.deletions).toBe(0)
    expect(result.isBinary).toBe(false)
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].content.split('\n').every((l: string) => l.startsWith('+'))).toBe(true)
  })

  it('stays null when the file is actually tracked (clean diff, nothing to show)', async () => {
    seed({ stdout: '', stderr: 'boom', code: 2 }) // git diff fails
    seed({ stdout: 'a.ts\n', code: 0 }) // ls-files succeeds → tracked

    await expect(handlers.getDiff!('/repo', 'a.ts', false)).resolves.toBeNull()
    expect(lsFilesCalls()[0].args).toEqual(['ls-files', '--error-unmatch', '--', 'a.ts'])
  })

  it('flags a new binary file instead of emitting garbage lines', async () => {
    probe.fileContent = Buffer.from([0x00, 0x01, 0x02, 0xff])
    seed({ code: 1 })
    seed({ code: 1 })

    const result = (await handlers.getDiff!('/repo', 'blob.bin', false)) as DiffResult

    expect(result.isBinary).toBe(true)
    expect(result.hunks).toEqual([])
    expect(result.additions).toBe(0)
  })

  it('renders an empty new file as a zero-line result rather than one bogus line', async () => {
    probe.fileContent = Buffer.from('', 'utf8')
    seed({ code: 1 })
    seed({ code: 1 })

    const result = (await handlers.getDiff!('/repo', 'empty.txt', false)) as DiffResult

    expect(result.hunks).toEqual([])
    expect(result.additions).toBe(0)
    expect(result.isBinary).toBe(false)
  })

  it('drops the synthetic trailing line produced by a final newline', async () => {
    probe.fileContent = Buffer.from('a\nb\n', 'utf8')
    seed({ code: 1 })
    seed({ code: 1 })

    const result = (await handlers.getDiff!('/repo', 'ab.txt', false)) as DiffResult

    expect(result.additions).toBe(2)
    expect(result.hunks[0].content).toBe('+a\n+b')
  })

  it('gives up quietly when the untracked file cannot be read from disk', async () => {
    probe.fileContent = undefined // readFileSync throws
    seed({ code: 1 })
    seed({ code: 1 })

    await expect(handlers.getDiff!('/repo', 'vanished.txt', false)).resolves.toBeNull()
  })

  it('does not attempt the untracked fallback for a staged diff', async () => {
    seed({ code: 1 }) // staged diff fails; staged diffs are never untracked

    await expect(handlers.getDiff!('/repo', 'a.ts', true)).resolves.toBeNull()
    expect(lsFilesCalls()).toHaveLength(0)
  })
})

describe('getDiff — untracked fallback on an empty (but successful) diff', () => {
  it('recognises a new file when git diff succeeds with no hunks', async () => {
    probe.fileContent = Buffer.from('brand\nnew\n', 'utf8')
    seed({ stdout: '', code: 0 }) // git diff succeeds, prints nothing
    seed({ code: 1 }) // untracked

    const result = (await handlers.getDiff!('/repo', 'fresh.txt', false)) as DiffResult

    expect(result.additions).toBe(2)
    expect(result.hunks).toHaveLength(1)
  })

  it('returns the parsed (empty) result when the file is tracked but unchanged', async () => {
    seed({ stdout: '', code: 0 }) // git diff succeeds, prints nothing
    seed({ stdout: 'x.ts\n', code: 0 }) // tracked

    const result = (await handlers.getDiff!('/repo', 'x.ts', false)) as DiffResult
    // getUntrackedFileDiff returns null (tracked), so getDiff falls through to the
    // normal result object with zero hunks rather than null.
    expect(result).toEqual({ path: 'x.ts', hunks: [], additions: 0, deletions: 0, isBinary: false })
  })
})

describe('getFullDiff — line counts and hunk collection', () => {
  function fullDiffSeeds(opts: {
    stagedNumstat: string
    untrackedList: string
    stagedHunkDiff: string
  }) {
    seed({ stdout: 'true', code: 0 }) // isGitRepo
    seed({ stdout: opts.stagedNumstat, code: 0 }) // staged numstat
    seed({ stdout: '', code: 0 }) // unstaged numstat
    seed({ stdout: opts.untrackedList, code: 0 }) // ls-files --others
    seed({ stdout: opts.stagedHunkDiff, code: 0 }) // staged diff (hunks)
    seed({ stdout: '', code: 0 }) // unstaged diff (hunks)
  }

  it('counts untracked file lines via countFileLines and records staged hunks per path', async () => {
    probe.fileContent = Buffer.from('one\ntwo\nthree\n', 'utf8') // 3 lines for the untracked file
    fullDiffSeeds({
      stagedNumstat: '3\t1\tsrc/a.ts\n',
      untrackedList: 'new.txt\n',
      stagedHunkDiff: [
        'diff --git a/src/a.ts b/src/a.ts',
        'index 111..222 100644',
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,3 +1,4 @@',
        ' ctx',
        '-old',
        '+new1',
        '+new2',
      ].join('\n'),
    })

    const result = (await handlers.getFullDiff!('/repo')) as {
      stats: { filesCount: number; linesAdded: number; linesRemoved: number }
      files: Array<{ path: string; linesAdded: number; isUntracked?: boolean; isStaged?: boolean }>
      hunks: Record<string, unknown[]>
    }

    const untracked = result.files.find(f => f.path === 'new.txt')!
    expect(untracked.isUntracked).toBe(true)
    expect(untracked.linesAdded).toBe(3) // countFileLines of "one\ntwo\nthree\n"

    expect(result.hunks['src/a.ts']).toBeDefined()
    expect(result.hunks['src/a.ts']).toHaveLength(1)

    const staged = result.files.find(f => f.path === 'src/a.ts')!
    expect(staged.isStaged).toBe(true)
    expect(staged.linesAdded).toBe(3)
  })

  it('returns null when the staged numstat command fails', async () => {
    seed({ stdout: 'true', code: 0 }) // isGitRepo
    seed({ stdout: '', stderr: 'err', code: 1 }) // staged numstat fails

    await expect(handlers.getFullDiff!('/repo')).resolves.toBeNull()
  })
})
