// @vitest-environment node
/**
 * Tests for the GitService file-watcher lifecycle (watchProject / stopWatch).
 *
 * These tests exercise the real fs.watch-based watcher end-to-end through the
 * registered IPC handlers: a temp worktree is watched, real file writes are
 * performed, and the 'git:statusChanged' notification reaching the renderer
 * is asserted (ADR 0011: tests must cross the module seam).
 *
 * Platform note: on Linux the recursive worktree watch runs in a worker
 * thread (its setup walk would otherwise block the main thread — see
 * startWorktreeWorkerWatcher); on Windows/macOS it is the in-process
 * kernel-backed watch. Both paths are covered by these tests depending on
 * the platform they run on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockState = vi.hoisted(() => {
  const sentMessages: { channel: string; args: unknown[] }[] = []
  const capturedHandlers: Record<string, (...args: unknown[]) => unknown> = {}
  return { sentMessages, capturedHandlers }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), handleOnce: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, ...args: unknown[]) => {
            mockState.sentMessages.push({ channel, args })
          },
        },
      },
    ]),
  },
}))

vi.mock('../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/shared/handlerRegistry', () => ({
  registerHandlers: vi.fn(
    (
      _ipcMain: unknown,
      _channels: unknown,
      _prefix: string,
      handlers: Record<string, (...args: unknown[]) => unknown>,
    ) => {
      Object.assign(mockState.capturedHandlers, handlers)
    },
  ),
}))

import { registerGitIPCHandlers } from '../git/gitService'

let tmpRoot: string

const statusChangedCount = () =>
  mockState.sentMessages.filter(m => m.channel === 'git:statusChanged').length

/**
 * Rewrite the file, then allow the watcher's debounce window (300ms) of
 * silence to elapse, until a statusChanged notification arrives. Rewriting is
 * what makes this deterministic when the watcher arms asynchronously (Linux
 * worker thread): writes performed before the watcher is armed are swallowed
 * by the initial scan, and the next cycle fires the change event. The silence
 * between writes is what lets the debounced notification actually fire —
 * writing faster than the debounce would keep resetting the timer forever.
 */
async function waitForStatusChange(target: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    writeFileSync(target, `t-${Date.now()}-${Math.random()}`)
    try {
      await vi.waitFor(
        () => expect(statusChangedCount()).toBeGreaterThan(0),
        { timeout: 700, interval: 50 },
      )
      return
    } catch {
      // Not armed yet (or the write raced the watcher) — write again
    }
  }
  throw new Error(`statusChanged not observed for ${target} within ${timeoutMs}ms`)
}

beforeEach(() => {
  mockState.sentMessages.length = 0
  for (const key of Object.keys(mockState.capturedHandlers)) delete mockState.capturedHandlers[key]
  registerGitIPCHandlers()
  tmpRoot = mkdtempSync(join(tmpdir(), 'git-watcher-test-'))
  // Production only starts the watcher for git repos, so mirror that shape
  // (also avoids the .git watch ENOENT warning path)
  mkdirSync(join(tmpRoot, '.git'))
})

afterEach(() => {
  mockState.capturedHandlers.stopWatch?.()
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('gitService — worktree file watcher', () => {
  it(
    'watchProject notifies the renderer when a root file changes',
    async () => {
      await expect(mockState.capturedHandlers.watchProject!(tmpRoot)).resolves.toBe(true)
      await waitForStatusChange(join(tmpRoot, 'plain.txt'))
      expect(statusChangedCount()).toBeGreaterThan(0)
    },
    15_000,
  )

  it(
    'notifies the renderer for changes in subdirectories (recursive coverage)',
    async () => {
      const sub = join(tmpRoot, 'src')
      mkdirSync(sub)
      await expect(mockState.capturedHandlers.watchProject!(tmpRoot)).resolves.toBe(true)
      await waitForStatusChange(join(sub, 'nested.txt'))
    },
    15_000,
  )

  it(
    'ignores changes under node_modules',
    async () => {
      const nm = join(tmpRoot, 'node_modules', 'pkg')
      mkdirSync(nm, { recursive: true })
      await expect(mockState.capturedHandlers.watchProject!(tmpRoot)).resolves.toBe(true)

      // Arm the watcher with a real notification first so we know it is active
      await waitForStatusChange(join(tmpRoot, 'root.txt'))
      // Let the debounced notification from the writes above settle
      await new Promise(resolve => setTimeout(resolve, 500))
      const baseline = statusChangedCount()

      // Writes only inside node_modules must not trigger notifications
      await vi.waitFor(
        () => {
          writeFileSync(join(nm, 'dep.txt'), `x-${Date.now()}`)
          expect(statusChangedCount()).toBe(baseline)
        },
        { timeout: 2000, interval: 100 },
      )
    },
    15_000,
  )

  it(
    'stopWatch stops renderer notifications',
    async () => {
      await expect(mockState.capturedHandlers.watchProject!(tmpRoot)).resolves.toBe(true)
      await waitForStatusChange(join(tmpRoot, 'before-stop.txt'))
      await expect(mockState.capturedHandlers.stopWatch!()).resolves.toBe(true)

      // Drain any pending debounced notification from the write above
      await new Promise(resolve => setTimeout(resolve, 600))
      const baseline = statusChangedCount()

      await vi.waitFor(
        () => {
          writeFileSync(join(tmpRoot, 'after-stop.txt'), `x-${Date.now()}`)
          expect(statusChangedCount()).toBe(baseline)
        },
        { timeout: 2000, interval: 100 },
      )
    },
    15_000,
  )
})
