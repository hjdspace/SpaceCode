/**
 * Tests for gitService diff/commit logic.
 *
 * These tests mock child_process.execFile to feed controlled git output,
 * verifying the parsing and error-handling behaviour of the internal
 * getDiff, getFullDiff, commit, and applyHunkPatch functions.
 *
 * Design note: gitService.ts exposes only registerGitIPCHandlers, so we
 * mock execFile + electron + logger and call the registered IPC handlers
 * through a fake registerHandlers harness — exercising the real functions
 * end-to-end through the module's interface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Shared state via vi.hoisted (available inside vi.mock factories) ──
const mockState = vi.hoisted(() => {
  interface MockExecResult {
    stdout: string
    stderr: string
    code: number | string
  }

  const callResults: MockExecResult[] = []
  const callLog: { args: string[]; cwd?: string }[] = []
  const capturedHandlers: Record<string, (...args: unknown[]) => unknown> = {}

  return { callResults, callLog, capturedHandlers }
})

// ── Mock child_process — must use importOriginal for ESM compatibility ──
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: vi.fn((...args: unknown[]) => {
      const cb = args[args.length - 1] as (error: any, stdout: string, stderr: string) => void
      const opts = args[2] as { cwd?: string }
      const cmdArgs = args[1] as string[]
      mockState.callLog.push({ args: cmdArgs, cwd: opts?.cwd })

      const result = mockState.callResults.shift() ?? { stdout: '', stderr: '', code: 0 }
      if (result.code === 0) {
        cb(null, result.stdout, result.stderr)
      } else {
        const error: any = new Error(result.stderr || 'mock error')
        error.code = result.code
        cb(error, result.stdout, result.stderr)
      }
    }),
  }
})

// Mock electron
vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: { handle: vi.fn(), handleOnce: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

// Mock logger
vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// Mock @/shared/handlerRegistry — capture handlers instead of registering on ipcMain
vi.mock('@/shared/handlerRegistry', () => ({
  registerHandlers: vi.fn((_ipcMain: unknown, _channels: unknown, _prefix: string, handlers: Record<string, (...args: unknown[]) => unknown>) => {
    Object.assign(mockState.capturedHandlers, handlers)
  }),
}))

// Import child_process to verify the mock is applied
import * as cp from 'child_process'

// Import after all mocks are set up
import { registerGitIPCHandlers } from '../gitService'

// ── Helpers ─────────────────────────────────────────────────────────

interface MockExecResult {
  stdout: string
  stderr: string
  code: number | string
}

function seedCalls(...results: MockExecResult[]) {
  mockState.callResults.push(...results)
}

function resetCaptured() {
  for (const key of Object.keys(mockState.capturedHandlers)) delete mockState.capturedHandlers[key]
  mockState.callResults.length = 0
  mockState.callLog.length = 0
}

// ── Tests ───────────────────────────────────────────────────────────

describe('gitService — getDiff parsing', () => {
  beforeEach(() => {
    resetCaptured()
    registerGitIPCHandlers()
  })

  it('mock is applied to child_process.execFile', () => {
    // Verify the mock is in place
    expect(vi.isMockFunction(cp.execFile)).toBe(true)
  })

  it('gitService module sees the mocked execFile', async () => {
    // The gitService handler isRepo calls gitExec which calls execFile
    seedCalls({ stdout: 'true', stderr: '', code: 0 })
    const result = await mockState.capturedHandlers.isRepo!('/repo') as boolean
    expect(result).toBe(true)
    // If the mock is visible to gitService, callLog should have 1 entry
    expect(mockState.callLog.length).toBe(1)
  })

  it('parses a unified diff with one hunk', async () => {
    seedCalls(
      {
        stdout: [
          'diff --git a/src/a.ts b/src/a.ts',
          'index 1234567..abcdef8 100644',
          '--- a/src/a.ts',
          '+++ b/src/a.ts',
          '@@ -1,3 +1,4 @@',
          ' old line',
          '+new line',
          ' context line',
        ].join('\n'),
        stderr: '',
        code: 0,
      },
    )

    const result = await mockState.capturedHandlers.getDiff!('/repo', 'src/a.ts', false) as any
    // Debug: check what we got
    expect(mockState.callLog.length).toBeGreaterThan(0)
    expect(result).not.toBeNull()
    expect(result.path).toBe('src/a.ts')
    expect(result.additions).toBe(1)
    expect(result.deletions).toBe(0)
    expect(result.isBinary).toBe(false)
    expect(result.hunks).toHaveLength(1)
    expect(result.hunks[0].oldStart).toBe(1)
    expect(result.hunks[0].newStart).toBe(1)
    expect(result.hunks[0].content).toContain('+new line')
  })

  it('parses a diff with multiple hunks and counts +/- correctly', async () => {
    seedCalls(
      {
        stdout: [
          'diff --git a/file.ts b/file.ts',
          '--- a/file.ts',
          '+++ b/file.ts',
          '@@ -1,2 +1,3 @@',
          ' line1',
          '-line2',
          '+line2a',
          '+line2b',
          '@@ -10,2 +11,2 @@',
          ' context',
          '-old',
          '+new',
        ].join('\n'),
        stderr: '',
        code: 0,
      },
    )

    const result = await mockState.capturedHandlers.getDiff!('/repo', 'file.ts', false) as any
    expect(result).not.toBeNull()
    expect(result.additions).toBe(3)
    expect(result.deletions).toBe(2)
    expect(result.hunks).toHaveLength(2)
  })

  it('detects binary diff', async () => {
    seedCalls(
      {
        stdout: 'Binary files differ\n',
        stderr: '',
        code: 0,
      },
    )

    const result = await mockState.capturedHandlers.getDiff!('/repo', 'image.png', false) as any
    expect(result).not.toBeNull()
    expect(result.isBinary).toBe(true)
  })

  it('returns null when git diff fails for tracked file', async () => {
    seedCalls(
      { stdout: '', stderr: 'fatal: not a git repo', code: 128 },
      { stdout: '', stderr: 'did not match', code: 1 },
    )

    const result = await mockState.capturedHandlers.getDiff!('/repo', 'untracked.ts', false)
    expect(result).toBeNull()
  })
})

describe('gitService — getFullDiff numstat aggregation', () => {
  beforeEach(() => {
    resetCaptured()
    registerGitIPCHandlers()
  })

  it('aggregates staged + unstaged numstat lines', async () => {
    seedCalls(
      { stdout: 'true', stderr: '', code: 0 },
      { stdout: '3\t1\tsrc/staged.ts\n', stderr: '', code: 0 },
      { stdout: '5\t2\tsrc/unstaged.ts\n', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.getFullDiff!('/repo') as any
    expect(result).not.toBeNull()
    expect(result.stats.filesCount).toBe(2)
    expect(result.stats.linesAdded).toBe(8)
    expect(result.stats.linesRemoved).toBe(3)

    const paths = result.files.map((f: any) => f.path).sort()
    expect(paths).toEqual(['src/staged.ts', 'src/unstaged.ts'])

    const staged = result.files.find((f: any) => f.path === 'src/staged.ts')
    expect(staged.linesAdded).toBe(3)
    expect(staged.linesRemoved).toBe(1)
    expect(staged.isStaged).toBe(true)

    const unstaged = result.files.find((f: any) => f.path === 'src/unstaged.ts')
    expect(unstaged.linesAdded).toBe(5)
    expect(unstaged.linesRemoved).toBe(2)
    expect(unstaged.isStaged).toBe(false)
  })

  it('handles binary files in numstat (counts as "-")', async () => {
    seedCalls(
      { stdout: 'true', stderr: '', code: 0 },
      { stdout: '-\t-\timg/binary.png\n', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.getFullDiff!('/repo') as any
    expect(result).not.toBeNull()
    const file = result.files.find((f: any) => f.path === 'img/binary.png')
    expect(file).toBeDefined()
    expect(file.isBinary).toBe(true)
    expect(file.linesAdded).toBe(0)
    expect(file.linesRemoved).toBe(0)
  })

  it('returns null when not a git repo', async () => {
    seedCalls({ stdout: 'false', stderr: '', code: 0 })

    const result = await mockState.capturedHandlers.getFullDiff!('/repo')
    expect(result).toBeNull()
  })

  it('handles rename in numstat path (old => new)', async () => {
    seedCalls(
      { stdout: 'true', stderr: '', code: 0 },
      { stdout: '5\t0\told.ts => new.ts\n', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.getFullDiff!('/repo') as any
    expect(result).not.toBeNull()
    const file = result.files.find((f: any) => f.path === 'new.ts')
    expect(file).toBeDefined()
    expect(file.linesAdded).toBe(5)
  })

  it('handles rename with brace form ({old => new}/suffix)', async () => {
    seedCalls(
      { stdout: 'true', stderr: '', code: 0 },
      { stdout: '3\t1\tsrc/{old => new}/a.ts\n', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.getFullDiff!('/repo') as any
    expect(result).not.toBeNull()
    const file = result.files.find((f: any) => f.path === 'src/new/a.ts')
    expect(file).toBeDefined()
    expect(file.linesAdded).toBe(3)
  })

  it('includes untracked files with isUntracked flag', async () => {
    seedCalls(
      { stdout: 'true', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: 'new-file.ts\n', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.getFullDiff!('/repo') as any
    expect(result).not.toBeNull()
    const untracked = result.files.find((f: any) => f.path === 'new-file.ts')
    expect(untracked).toBeDefined()
    expect(untracked.isUntracked).toBe(true)
  })

  it('returns null when numstat fails (staged or unstaged)', async () => {
    seedCalls(
      { stdout: 'true', stderr: '', code: 0 },
      { stdout: '', stderr: 'error', code: 1 },
    )

    const result = await mockState.capturedHandlers.getFullDiff!('/repo')
    expect(result).toBeNull()
  })
})

describe('gitService — commit logic', () => {
  beforeEach(() => {
    resetCaptured()
    registerGitIPCHandlers()
  })

  it('commit creates temp file and returns hash on success', async () => {
    seedCalls(
      { stdout: '[main abc1234] feat: new feature', stderr: '', code: 0 },
      { stdout: 'abcdef1234567890\n', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.commit!('/repo', 'feat: new feature', false) as any
    expect(result.success).toBe(true)
    expect(result.hash).toBe('abcdef1')
  })

  it('commit --amend adds --amend --no-edit flags', async () => {
    seedCalls(
      { stdout: '[main abc1234] amended', stderr: '', code: 0 },
      { stdout: 'amendhash1234567890\n', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.commit!('/repo', 'old message', true) as any
    expect(result.success).toBe(true)

    const commitCall = mockState.callLog.find(c => c.args[0] === 'commit')
    expect(commitCall).toBeDefined()
    expect(commitCall!.args).toContain('--amend')
    expect(commitCall!.args).toContain('--no-edit')
  })

  it('commit returns error on failure', async () => {
    seedCalls(
      { stdout: '', stderr: 'nothing to commit', code: 1 },
    )

    const result = await mockState.capturedHandlers.commit!('/repo', 'msg', false) as any
    expect(result.success).toBe(false)
    expect(result.error).toBe('nothing to commit')
  })
})

describe('gitService — applyHunkPatch (stageHunks/unstageHunks)', () => {
  beforeEach(() => {
    resetCaptured()
    registerGitIPCHandlers()
  })

  it('stageHunks applies patch forward (no --reverse)', async () => {
    seedCalls(
      { stdout: '', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.stageHunks!('/repo', 'a.ts', '@@ -1,2 +1,3 @@\n+added') as any
    expect(result.success).toBe(true)

    const applyCall = mockState.callLog.find(c => c.args[0] === 'apply')
    expect(applyCall).toBeDefined()
    expect(applyCall!.args).toContain('--cached')
    expect(applyCall!.args).not.toContain('--reverse')
  })

  it('unstageHunks applies patch in reverse (--reverse)', async () => {
    seedCalls(
      { stdout: '', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.unstageHunks!('/repo', 'a.ts', '@@ -1,2 +1,3 @@\n+added') as any
    expect(result.success).toBe(true)

    const applyCall = mockState.callLog.find(c => c.args[0] === 'apply')
    expect(applyCall!.args).toContain('--reverse')
  })

  it('returns error on apply failure', async () => {
    seedCalls(
      { stdout: '', stderr: 'patch does not apply', code: 1 },
    )

    const result = await mockState.capturedHandlers.stageHunks!('/repo', 'a.ts', 'bad patch') as any
    expect(result.success).toBe(false)
    expect(result.error).toContain('patch does not apply')
  })
})

describe('gitService — resetTo', () => {
  beforeEach(() => {
    resetCaptured()
    registerGitIPCHandlers()
  })

  it('resets with valid mode', async () => {
    seedCalls({ stdout: '', stderr: '', code: 0 })

    const result = await mockState.capturedHandlers.reset!('/repo', 'abc123', 'hard') as any
    expect(result.success).toBe(true)

    const resetCall = mockState.callLog.find(c => c.args[0] === 'reset')
    expect(resetCall!.args).toContain('--hard')
    expect(resetCall!.args).toContain('abc123')
  })

  it('rejects invalid mode', async () => {
    const result = await mockState.capturedHandlers.reset!('/repo', 'abc123', 'invalid' as any) as any
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid reset mode')
  })

  it('returns error on git reset failure', async () => {
    seedCalls({ stdout: '', stderr: 'unknown revision', code: 1 })

    const result = await mockState.capturedHandlers.reset!('/repo', 'badhash', 'mixed') as any
    expect(result.success).toBe(false)
    expect(result.error).toBe('unknown revision')
  })
})

describe('gitService — getCommitFiles', () => {
  beforeEach(() => {
    resetCaptured()
    registerGitIPCHandlers()
  })

  it('returns file stats for a normal commit (diff-tree --root)', async () => {
    seedCalls(
      { stdout: 'abc123 def456\n', stderr: '', code: 0 },
      { stdout: '3\t1\tsrc/a.ts\n', stderr: '', code: 0 },
      { stdout: 'M\tsrc/a.ts\n', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.getCommitFiles!('/repo', 'abc123') as any[]
    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('src/a.ts')
    expect(result[0].statusCode).toBe('M')
    expect(result[0].additions).toBe(3)
    expect(result[0].deletions).toBe(1)
    expect(result[0].isBinary).toBe(false)
  })

  it('uses first-parent diff for merge commits', async () => {
    seedCalls(
      { stdout: 'mergehash parent1 parent2\n', stderr: '', code: 0 },
      { stdout: '5\t2\tsrc/merged.ts\n', stderr: '', code: 0 },
      { stdout: 'M\tsrc/merged.ts\n', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.getCommitFiles!('/repo', 'mergehash') as any[]
    expect(result).toHaveLength(1)
    expect(result[0].additions).toBe(5)
    expect(result[0].deletions).toBe(2)

    const numstatCall = mockState.callLog.find(c => c.args.includes('--numstat'))
    expect(numstatCall!.args).toContain('parent1')
  })

  it('handles binary files in commit stats', async () => {
    seedCalls(
      { stdout: 'abc123\n', stderr: '', code: 0 },
      { stdout: '-\t-\timg/logo.png\n', stderr: '', code: 0 },
      { stdout: 'A\timg/logo.png\n', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.getCommitFiles!('/repo', 'abc123') as any[]
    const file = result.find(f => f.path === 'img/logo.png')
    expect(file).toBeDefined()
    expect(file.additions).toBeNull()
    expect(file.deletions).toBeNull()
    expect(file.isBinary).toBe(true)
  })

  it('returns empty array when parents cannot be resolved', async () => {
    seedCalls(
      { stdout: '', stderr: 'unknown', code: 1 },
      { stdout: '', stderr: '', code: 0 },
      { stdout: '', stderr: '', code: 0 },
    )

    const result = await mockState.capturedHandlers.getCommitFiles!('/repo', 'abc123') as any[]
    expect(result).toEqual([])
  })
})
