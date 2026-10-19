// @vitest-environment node
/**
 * 会话改动 review 链路上的两个新 git IPC。
 *
 * getReviewDiff 存在的理由是 review 面板要的是"相对上次提交改了什么"：旧的
 * `getDiff(cwd, path, false)` 只看工作区↔索引，文件一旦被 stage 就返回空 hunks，
 * 面板显示"Diff 不可用"。unborn HEAD（仓库还没有提交）时 git diff HEAD 会直接失败，
 * 必须退回索引口径，否则新仓库里所有 review 都打不开。
 *
 * getChangeStats 是回合窗口比对的采样源：只要 numstat + mtime/size，不收集 diff 正文
 * （getFullDiff 每次要多跑两遍全文 diff）。工作区里已删除的文件 statSync 失败，
 * 必须留 -1 而不是抛错，否则整个采样跟着崩。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

const probe = vi.hoisted(() => ({
  calls: [] as Array<{ args: string[] }>,
  queue: [] as Array<{ stdout: string; stderr: string; code: number | string }>,
  stats: new Map<string, { mtimeMs: number; size: number }>(),
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
    statSync: (target: string) => {
      const hit = probe.stats.get(target)
      if (!hit) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return { mtimeMs: hit.mtimeMs, size: hit.size }
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
}

interface ChangeStats {
  generatedAt: number
  files: Array<{
    path: string
    insertions: number
    deletions: number
    isUntracked: boolean
    mtimeMs: number
    size: number
  }>
}

function seed(stdout: string, code = 0, stderr = '') {
  probe.queue.push({ stdout, stderr, code })
}

beforeEach(() => {
  registerGitIPCHandlers()
  probe.calls.length = 0
  probe.queue.length = 0
  probe.stats.clear()
  probe.fileContent = undefined
})

describe('getReviewDiff — HEAD ↔ 工作区', () => {
  it('已 stage 的文件也能拿到 diff（这正是 getDiff 未暂存口径丢掉的场景）', async () => {
    seed([
      'diff --git a/src/a.ts b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' ctx',
      '+added',
    ].join('\n'))

    const result = (await handlers.getReviewDiff!('/repo', 'src/a.ts')) as DiffResult

    expect(probe.calls[0].args).toContain('HEAD')
    expect(result.hunks).toHaveLength(1)
    expect(result.additions).toBe(1)
  })

  it('unborn HEAD 时退回索引口径而不是直接返回 null', async () => {
    seed('', 128, "fatal: bad revision 'HEAD'")
    seed([
      'diff --git a/new.ts b/new.ts',
      '@@ -0,0 +1,1 @@',
      '+hello',
    ].join('\n'))

    const result = (await handlers.getReviewDiff!('/repo', 'new.ts')) as DiffResult

    expect(result.hunks).toHaveLength(1)
    expect(result.additions).toBe(1)
    expect(probe.calls[1].args).toContain('--cached')
  })

  it('非零退出且不是 unborn HEAD 的其它失败不静默兜底', async () => {
    seed('', 128, 'fatal: not a git repository')

    await expect(handlers.getReviewDiff!('/repo', 'src/a.ts')).resolves.toBeNull()
  })

  it('HEAD 里没这个文件（未跟踪新建）时合成全量新增 hunk', async () => {
    seed('') // git diff HEAD → 空
    seed('', 1, 'did not match') // ls-files --error-unmatch → 未跟踪
    probe.fileContent = Buffer.from('line1\nline2\n', 'utf8')

    const result = (await handlers.getReviewDiff!('/repo', 'brand-new.ts')) as DiffResult

    expect(result.hunks).toHaveLength(1)
    expect(result.additions).toBe(2)
  })
})

describe('getChangeStats — 回合窗口采样', () => {
  it('返回 HEAD 相对的行数与文件指纹', async () => {
    seed('true') // isGitRepo
    seed('4\t2\tsrc/a.ts\n') // diff HEAD --numstat
    seed('docs/new.md\n') // ls-files --others
    probe.stats.set(join('/repo', 'src/a.ts'), { mtimeMs: 1_700_000_000_000, size: 512 })
    probe.stats.set(join('/repo', 'docs/new.md'), { mtimeMs: 1_700_000_000_500, size: 9 })
    probe.fileContent = Buffer.from('a\nb\n', 'utf8')

    const result = (await handlers.getChangeStats!('/repo')) as ChangeStats

    expect(result.files).toHaveLength(2)
    const a = result.files.find(f => f.path === 'src/a.ts')!
    expect(a.insertions).toBe(4)
    expect(a.deletions).toBe(2)
    expect(a.isUntracked).toBe(false)
    expect(a.mtimeMs).toBe(1_700_000_000_000)

    const created = result.files.find(f => f.path === 'docs/new.md')!
    expect(created.isUntracked).toBe(true)
    expect(created.insertions).toBe(2)
    expect(created.size).toBe(9)

    // 只要 numstat + 文件清单，绝不跑全文 diff
    const verbs = probe.calls.map(c => c.args.filter(a => a === 'diff').length).reduce((s, n) => s + n, 0)
    expect(verbs).toBe(1)
  })

  it('二进制文件行数记 0 但仍算一次改动', async () => {
    seed('true')
    seed('-\t-\tbin/x.png\n')
    seed('')
    probe.stats.set(join('/repo', 'bin/x.png'), { mtimeMs: 111, size: 4096 })

    const result = (await handlers.getChangeStats!('/repo')) as ChangeStats

    expect(result.files[0]).toMatchObject({ path: 'bin/x.png', insertions: 0, deletions: 0 })
    expect(result.files[0].mtimeMs).toBe(111)
  })

  it('工作区里已被删除的文件保留 -1 指纹而不是抛错', async () => {
    seed('true')
    seed('0\t7\tgone.ts\n')
    seed('')

    const result = (await handlers.getChangeStats!('/repo')) as ChangeStats

    expect(result.files[0]).toMatchObject({ path: 'gone.ts', deletions: 7, mtimeMs: -1, size: -1 })
  })

  it('unborn HEAD 时分两段（索引 + 工作区）求并集', async () => {
    seed('true')
    seed('', 128, "fatal: bad revision 'HEAD'") // diff HEAD 失败
    seed('3\t0\tstaged.ts\n') // --cached numstat
    seed('1\t1\tworktree.ts\n') // worktree numstat
    seed('')
    probe.stats.set(join('/repo', 'staged.ts'), { mtimeMs: 10, size: 30 })
    probe.stats.set(join('/repo', 'worktree.ts'), { mtimeMs: 20, size: 40 })

    const result = (await handlers.getChangeStats!('/repo')) as ChangeStats

    expect(result.files.map(f => f.path).sort()).toEqual(['staged.ts', 'worktree.ts'])
  })

  it('不是 git 仓库时返回 null', async () => {
    seed('false') // isGitRepo

    await expect(handlers.getChangeStats!('/repo')).resolves.toBeNull()
  })
})
