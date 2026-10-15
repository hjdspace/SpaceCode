// @vitest-environment node
/**
 * discardChanges against real temporary git repositories.
 *
 * The product contract is "discard leaves the worktree clean for exactly the
 * requested paths", and only real git can show that: a mocked execFile happily
 * accepts `checkout HEAD -- untracked.txt`, while real git rejects the whole
 * argv ("pathspec did not match") and restores nothing — which is how a mixed
 * discard used to report success while every modification stayed put. These
 * tests pin the resulting state on disk, not the argv.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { registerGitIPCHandlers, type GitDiscardResult } from '../gitService'

const handlers = vi.hoisted(() => ({}) as Record<string, (...args: unknown[]) => unknown>)

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

vi.mock('@/shared/handlerRegistry', () => ({
  registerHandlers: vi.fn(
    (_ipc: unknown, _ch: unknown, _prefix: string, h: Record<string, (...a: unknown[]) => unknown>) => {
      Object.assign(handlers, h)
    },
  ),
}))

const GIT_BINARY = process.platform === 'win32' ? 'git.exe' : 'git'

function git(args: string[], cwd: string): string {
  return execFileSync(GIT_BINARY, args, { cwd, encoding: 'utf8' })
}

function initRepo(dir: string): string {
  git(['init', '-q', '.'], dir)
  git(['config', 'user.email', 'test@example.com'], dir)
  git(['config', 'user.name', 'Test'], dir)
  git(['config', 'core.autocrlf', 'false'], dir)
  return dir
}

function read(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** Paths are passed git-style (forward slashes), as parsed from `git status`. */
function discard(...paths: string[]): Promise<GitDiscardResult> {
  return handlers.discardChanges!(repo, paths) as Promise<GitDiscardResult>
}

let repo: string
let scratch: string[] = []

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key]
  registerGitIPCHandlers()

  scratch = []
  repo = initRepo(mkdtempSync(join(tmpdir(), 'spacecode-discard-')))
  writeFileSync(join(repo, 'tracked.txt'), 'before\n')
  writeFileSync(join(repo, 'untouched.txt'), 'untouched\n')
  git(['add', '--', 'tracked.txt', 'untouched.txt'], repo)
  git(['commit', '-q', '-m', 'init'], repo)
})

afterEach(() => {
  for (const dir of [repo, ...scratch]) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('discardChanges (real repository)', () => {
  it('discards a tracked modification and an untracked file given in the same call', async () => {
    writeFileSync(join(repo, 'tracked.txt'), 'after\n')
    writeFileSync(join(repo, 'new.txt'), 'brand new\n')

    const result = await discard('tracked.txt', 'new.txt')

    expect(result.success).toBe(true)
    expect(result.failedPaths).toEqual([])
    expect(read(join(repo, 'tracked.txt'))).toBe('before\n')
    expect(read(join(repo, 'new.txt'))).toBeNull()
  })

  it('discards a tracked modification, a staged addition and an untracked file together', async () => {
    writeFileSync(join(repo, 'tracked.txt'), 'after\n')
    writeFileSync(join(repo, 'stagedNew.txt'), 'staged\n')
    git(['add', '--', 'stagedNew.txt'], repo)
    writeFileSync(join(repo, 'stagedNew.txt'), 'staged then edited\n') // `AM` — reaches 丢弃全部
    writeFileSync(join(repo, 'new.txt'), 'brand new\n')

    const result = await discard('tracked.txt', 'stagedNew.txt', 'new.txt')

    expect(result).toEqual({ success: true, failedPaths: [] })
    expect(read(join(repo, 'stagedNew.txt'))).toBeNull()
    expect(git(['status', '--porcelain', '-uall'], repo)).toBe('')
  })

  it('restores tracked modifications when no untracked path is involved', async () => {
    writeFileSync(join(repo, 'tracked.txt'), 'after\n')
    writeFileSync(join(repo, 'untouched.txt'), 'still untouched\n')

    const result = await discard('tracked.txt')

    expect(result).toEqual({ success: true, failedPaths: [] })
    expect(read(join(repo, 'tracked.txt'))).toBe('before\n')
    expect(read(join(repo, 'untouched.txt'))).toBe('still untouched\n')
  })

  it('deletes untracked files only, reaching into an untracked directory without taking its sibling', async () => {
    mkdirSync(join(repo, 'newDir'))
    writeFileSync(join(repo, 'new.txt'), 'brand new\n')
    writeFileSync(join(repo, 'newDir', 'inner.txt'), 'inner\n')
    writeFileSync(join(repo, 'newDir', 'sibling.txt'), 'sibling\n')

    const result = await discard('new.txt', 'newDir/inner.txt')

    expect(result).toEqual({ success: true, failedPaths: [] })
    expect(read(join(repo, 'new.txt'))).toBeNull()
    expect(read(join(repo, 'newDir', 'inner.txt'))).toBeNull()
    expect(read(join(repo, 'newDir', 'sibling.txt'))).toBe('sibling\n')
    expect(read(join(repo, 'tracked.txt'))).toBe('before\n')
  })

  it('restores a deleted tracked file instead of leaving the deletion behind', async () => {
    rmSync(join(repo, 'tracked.txt'))

    const result = await discard('tracked.txt')

    expect(result.success).toBe(true)
    expect(read(join(repo, 'tracked.txt'))).toBe('before\n')
  })

  it('still discards untracked files in a repository that has no commit yet', async () => {
    const unborn = initRepo(mkdtempSync(join(tmpdir(), 'spacecode-discard-unborn-')))
    scratch.push(unborn)
    writeFileSync(join(unborn, 'new.txt'), 'brand new\n')

    const result = (await handlers.discardChanges!(unborn, ['new.txt'])) as GitDiscardResult

    expect(result).toEqual({ success: true, failedPaths: [] })
    expect(read(join(unborn, 'new.txt'))).toBeNull()
  })

  it('short-circuits an empty request instead of handing git an empty pathspec', async () => {
    writeFileSync(join(repo, 'tracked.txt'), 'after\n')

    const result = await discard()

    expect(result).toEqual({ success: true, failedPaths: [] })
    expect(read(join(repo, 'tracked.txt'))).toBe('after\n')
    expect(git(['status', '--porcelain', '-uall'], repo)).toContain(' M tracked.txt')
  })
})
