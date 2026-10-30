// @vitest-environment node
/**
 * 工作树：固定根目录、任务 id 白名单、复用/分支不符、Git 错误映射，
 * 以及从工作树采集 diff 与提交。
 */
import { describe, it, expect } from 'vitest'
import { join, resolve } from 'path'
import {
  buildBranchName,
  collectWorktreeState,
  gitErrorHint,
  isValidTaskId,
  mapGitFailure,
  parseWorktreeList,
  prepareWorktree,
  resolveWorktreePath,
  worktreeRelativePath,
  type GitRunner,
} from '../worktree'

const root = resolve('D:/repo')

interface Call {
  args: string[]
  cwd?: string
}

function fakeGit(responses: Array<{ ok?: boolean; stdout?: string; stderr?: string }>): {
  git: GitRunner
  calls: Call[]
} {
  const calls: Call[] = []
  let index = 0
  const git: GitRunner = async (args, cwd) => {
    calls.push({ args, cwd })
    const next = responses[index++] ?? { ok: true }
    return { ok: next.ok !== false, stdout: next.stdout ?? '', stderr: next.stderr ?? '' }
  }
  return { git, calls }
}

describe('task id and worktree path', () => {
  it('accepts a conservative id whitelist', () => {
    expect(isValidTaskId('bl-1')).toBe(true)
    expect(isValidTaskId('A_b-2')).toBe(true)
    expect(isValidTaskId('')).toBe(false)
    expect(isValidTaskId('../evil')).toBe(false)
    expect(isValidTaskId('a/b')).toBe(false)
    expect(isValidTaskId('C:\\evil')).toBe(false)
    expect(isValidTaskId('x'.repeat(65))).toBe(false)
  })

  it('keeps the worktree under the fixed root and rejects escapes', () => {
    const ok = resolveWorktreePath(root, 'bl-1')
    expect(ok).toMatchObject({
      ok: true,
      relative: '.spacecode/worktrees/bl-1',
      absolute: join(root, '.spacecode', 'worktrees', 'bl-1'),
    })

    expect(resolveWorktreePath(root, '../escape')).toEqual({ ok: false, error: 'invalid-task-id' })
    expect(worktreeRelativePath('bl-2')).toBe('.spacecode/worktrees/bl-2')
  })

  it('rejects a symlinked worktree path even when the target exists', () => {
    const result = resolveWorktreePath(root, 'bl-1', {
      isSymlink: (path) => path.endsWith('bl-1'),
    })
    expect(result).toEqual({ ok: false, error: 'invalid-task-id' })
  })
})

describe('branch naming', () => {
  it('uses agent/task-<id> for local tasks', () => {
    expect(buildBranchName({ taskId: 'bl-1' })).toBe('agent/task-bl-1')
  })

  it('uses agent/issue-<n>-<slug> for issue tasks with a bounded kebab slug', () => {
    expect(buildBranchName({ taskId: '7', issueNumber: 412, title: 'Session Refresh 丢失!' })).toBe(
      'agent/issue-412-session-refresh',
    )
    expect(buildBranchName({ taskId: '8', issueNumber: 9, title: '中文标题' })).toBe('agent/issue-9-task-8')
    const long = buildBranchName({ taskId: '9', issueNumber: 10, title: 'a'.repeat(80) })
    expect(long.length).toBeLessThanOrEqual('agent/issue-10-'.length + 40)
  })
})

describe('parseWorktreeList', () => {
  it('reads path, branch, bare and detached flags from porcelain output', () => {
    const stdout = [
      'worktree D:/repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree D:/repo/.spacecode/worktrees/bl-1',
      'HEAD def456',
      'branch refs/heads/agent/task-bl-1',
      '',
      'worktree D:/repo/.spacecode/worktrees/detached',
      'HEAD aaa111',
      'detached',
      '',
      'worktree D:/repo/bare.git',
      'bare',
      '',
    ].join('\n')

    expect(parseWorktreeList(stdout)).toEqual([
      { path: 'D:/repo', branch: 'refs/heads/main', bare: false, detached: false },
      { path: 'D:/repo/.spacecode/worktrees/bl-1', branch: 'refs/heads/agent/task-bl-1', bare: false, detached: false },
      { path: 'D:/repo/.spacecode/worktrees/detached', branch: null, bare: false, detached: true },
      { path: 'D:/repo/bare.git', branch: null, bare: true, detached: false },
    ])
  })
})

describe('prepareWorktree', () => {
  const input = {
    repoRoot: root,
    taskId: 'bl-1',
    branch: 'agent/task-bl-1',
    baseBranch: 'main',
  }
  const expectedAbsolute = join(root, '.spacecode', 'worktrees', 'bl-1')

  it('creates a fresh worktree under the fixed root', async () => {
    const { git, calls } = fakeGit([{ stdout: '' }, { ok: true }])
    const result = await prepareWorktree(input, { git, pathExists: () => false, isSymlink: () => false })
    expect(result).toEqual({
      ok: true,
      worktree: {
        absolute: expectedAbsolute,
        relative: '.spacecode/worktrees/bl-1',
        branch: 'agent/task-bl-1',
        reused: false,
      },
    })
    expect(calls[1].args).toEqual(['worktree', 'add', '-b', 'agent/task-bl-1', expectedAbsolute, 'main'])
  })

  it('reuses an existing worktree already on the task branch', async () => {
    const list = `worktree ${expectedAbsolute}\nHEAD abc\nbranch refs/heads/agent/task-bl-1\n\n`
    const { git, calls } = fakeGit([{ stdout: list }])
    const result = await prepareWorktree(input, { git, pathExists: () => true, isSymlink: () => false })
    expect(result).toMatchObject({ ok: true, worktree: { reused: true, relative: '.spacecode/worktrees/bl-1' } })
    expect(calls).toHaveLength(1)
  })

  it('blocks when the existing worktree is on a different branch', async () => {
    const list = `worktree ${expectedAbsolute}\nHEAD abc\nbranch refs/heads/agent/task-other\n\n`
    const { git, calls } = fakeGit([{ stdout: list }])
    const result = await prepareWorktree(input, { git, pathExists: () => true, isSymlink: () => false })
    expect(result).toMatchObject({ ok: false, error: 'worktree-mismatch' })
    expect(calls).toHaveLength(1)
  })

  it('blocks when the task branch is already checked out elsewhere', async () => {
    const list = `worktree D:/repo/.spacecode/worktrees/other\nHEAD abc\nbranch refs/heads/agent/task-bl-1\n\n`
    const { git, calls } = fakeGit([{ stdout: list }])
    const result = await prepareWorktree(input, { git, pathExists: () => false, isSymlink: () => false })
    expect(result).toMatchObject({ ok: false, error: 'branch-in-use' })
    expect(calls).toHaveLength(1)
  })

  it('rejects invalid ids and symlinked paths before touching git', async () => {
    const { git, calls } = fakeGit([])
    expect(await prepareWorktree({ ...input, taskId: '../x' }, { git })).toEqual({
      ok: false,
      error: 'invalid-task-id',
    })
    expect(
      await prepareWorktree(input, { git, pathExists: () => true, isSymlink: () => true }),
    ).toEqual({ ok: false, error: 'invalid-task-id' })
    expect(calls).toHaveLength(0)
  })

  it('maps git failures to readable causes', async () => {
    const notRepo = fakeGit([{ ok: false, stderr: 'fatal: not a git repository (or any of the parent directories)' }])
    expect(
      await prepareWorktree(input, { git: notRepo.git, pathExists: () => false, isSymlink: () => false }),
    ).toMatchObject({ ok: false, error: 'not-git-repo' })

    const occupied = fakeGit([{ stdout: '' }, { ok: false, stderr: "fatal: a branch named 'agent/task-bl-1' already exists" }])
    expect(
      await prepareWorktree(input, { git: occupied.git, pathExists: () => false, isSymlink: () => false }),
    ).toMatchObject({ ok: false, error: 'branch-in-use' })

    const longPath = fakeGit([{ stdout: '' }, { ok: false, stderr: 'error: unable to create file: Filename too long' }])
    const result = await prepareWorktree(input, {
      git: longPath.git,
      pathExists: () => false,
      isSymlink: () => false,
      platform: 'win32',
    })
    expect(result).toMatchObject({ ok: false, error: 'path-too-long' })
  })
})

describe('git error mapping', () => {
  it('recognises permission, long-path and branch-in-use text', () => {
    expect(mapGitFailure('fatal: not a git repository')).toBe('not-git-repo')
    expect(mapGitFailure('error: Permission denied (publickey)')).toBe('permission')
    expect(mapGitFailure('EACCES: permission denied')).toBe('permission')
    expect(mapGitFailure('error: Filename too long')).toBe('path-too-long')
    expect(mapGitFailure("fatal: 'agent/task-x' is already checked out at ...")).toBe('branch-in-use')
    expect(mapGitFailure('fatal: something odd')).toBe('git-error')
  })

  it('suggests core.longpaths on Windows only', () => {
    expect(gitErrorHint('path-too-long', 'win32')).toContain('core.longpaths')
    expect(gitErrorHint('path-too-long', 'darwin')).toBeNull()
    expect(gitErrorHint('permission', 'win32')).toBeNull()
  })
})

describe('collectWorktreeState', () => {
  const wt = join(root, '.spacecode', 'worktrees', 'bl-1')

  const aPatch = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,4 @@',
    ' ctx',
    '-old',
    '+new1',
    '+new2',
  ].join('\n')

  it('parses numstat, patches, commits and cleanliness', async () => {
    const { git, calls } = fakeGit([
      { stdout: '3\t1\tsrc/a.ts\n0\t0\tREADME.md\n-\t-\tassets/logo.png\n' },
      { stdout: aPatch },
      { stdout: 'abc123\tfeat: first\ndef456\tfix: second\n' },
      { stdout: '' },
    ])
    const state = await collectWorktreeState(root, 'bl-1', 'main', { git })
    expect(state).toEqual({
      diff: {
        additions: 3,
        deletions: 1,
        files: [
          {
            path: 'src/a.ts',
            additions: 3,
            deletions: 1,
            kind: 'patch',
            hunks: [
              {
                header: '@@ -1,2 +1,4 @@',
                lines: [
                  { kind: 'ctx', oldLine: 1, newLine: 1, text: 'ctx' },
                  { kind: 'del', oldLine: 2, text: 'old' },
                  { kind: 'add', newLine: 2, text: 'new1' },
                  { kind: 'add', newLine: 3, text: 'new2' },
                ],
              },
            ],
            truncated: false,
          },
          { path: 'README.md', additions: 0, deletions: 0, kind: 'missing' },
          { path: 'assets/logo.png', additions: 0, deletions: 0, kind: 'binary' },
        ],
      },
      commits: [
        { sha: 'abc123', message: 'feat: first' },
        { sha: 'def456', message: 'fix: second' },
      ],
      clean: true,
    })
    expect(calls.map((call) => call.cwd)).toEqual([wt, wt, wt, wt])
    expect(calls[0].args).toEqual(['diff', '--numstat', 'main'])
    expect(calls[1].args).toEqual(['diff', '--unified=3', 'main'])
    expect(calls[2].args).toEqual(['log', '--format=%H%x09%s', 'main..HEAD'])
    expect(calls[3].args).toEqual(['status', '--porcelain'])
  })

  it('keeps counts when the patch call fails, marking files missing', async () => {
    const { git } = fakeGit([
      { stdout: '2\t1\tsrc/a.ts\n' },
      { ok: false, stderr: 'fatal: unable to read' },
      { stdout: '' },
      { stdout: '' },
    ])
    const state = await collectWorktreeState(root, 'bl-1', 'main', { git })
    expect(state?.diff).toEqual({
      additions: 2,
      deletions: 1,
      files: [{ path: 'src/a.ts', additions: 2, deletions: 1, kind: 'missing' }],
    })
  })

  it('marks a dirty worktree and returns null when git cannot read it', async () => {
    const dirty = fakeGit([
      { stdout: '1\t0\ta.ts\n' },
      { stdout: '' },
      { stdout: '' },
      { stdout: ' M a.ts\n' },
    ])
    expect(await collectWorktreeState(root, 'bl-1', 'main', { git: dirty.git })).toMatchObject({ clean: false })

    const broken = fakeGit([{ ok: false, stderr: 'fatal: not a git repository' }])
    expect(await collectWorktreeState(root, 'bl-1', 'main', { git: broken.git })).toBeNull()
  })
})
