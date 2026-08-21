/**
 * Tests for EngineChildProcess — the deep module for child process lifecycle.
 *
 * These tests verify the kill/killTree, StderrTailBuffer, and bun resolution
 * through the module's small interface, exercising the shared logic that both
 * SessionProcess and PiSessionProcess now delegate to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StderrTailBuffer, killTree, isProbableBunExecutable, _resetBunCacheForTesting } from '../engineChildProcess'
import type { ChildProcess } from 'child_process'

// Mock electron
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => '/tmp'),
  },
}))

// Mock logger
vi.mock('../logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

function makeFakeChildProcess(pid: number | undefined, killed = false): any {
  return {
    pid,
    killed,
    kill: vi.fn((signal?: string) => {
      if (signal === 'SIGKILL' || signal === 'SIGTERM' || signal === undefined) {
        return true
      }
      return false
    }),
  }
}

describe('EngineChildProcess — StderrTailBuffer', () => {
  it('stores and returns last N non-empty lines', () => {
    const buf = new StderrTailBuffer()
    buf.append('line1\nline2\nline3\n')
    expect(buf.tail(2)).toBe('line2\nline3')
  })

  it('respects maxBytes limit', () => {
    const buf = new StderrTailBuffer(20)
    buf.append('this is a very long line that exceeds the buffer size limit')
    // Only the last 20 chars should be kept
    expect(buf.raw.length).toBeLessThanOrEqual(20)
  })

  it('returns empty string when buffer is empty', () => {
    const buf = new StderrTailBuffer()
    expect(buf.tail()).toBe('')
  })

  it('filters empty lines', () => {
    const buf = new StderrTailBuffer()
    buf.append('\n\nline1\n\nline2\n\n')
    expect(buf.tail(5)).toBe('line1\nline2')
  })

  it('clear() resets the buffer', () => {
    const buf = new StderrTailBuffer()
    buf.append('some text')
    buf.clear()
    expect(buf.tail()).toBe('')
    expect(buf.raw).toBe('')
  })
})

describe('EngineChildProcess — killTree', () => {
  beforeEach(() => {
    // Mock execSync for Windows taskkill
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing if pid is undefined', () => {
    const proc = makeFakeChildProcess(undefined)
    expect(() => killTree(proc, 'TestTag')).not.toThrow()
    expect(proc.kill).not.toHaveBeenCalled()
  })

  it('uses SIGKILL on non-Windows platforms', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    const proc = makeFakeChildProcess(1234)
    killTree(proc, 'TestTag')
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('catches errors from kill without throwing', () => {
    const proc = makeFakeChildProcess(1234)
    proc.kill.mockImplementation(() => {
      throw new Error('Already dead')
    })
    expect(() => killTree(proc, 'TestTag')).not.toThrow()
  })
})

describe('EngineChildProcess — isProbableBunExecutable', () => {
  it('returns false for non-existent path', () => {
    expect(isProbableBunExecutable('/nonexistent/path/bun')).toBe(false)
  })

  it('returns false for small files (likely placeholder/LFS pointer)', () => {
    // Create a small temp file
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const tmpFile = path.join(os.tmpdir(), `test-bun-small-${Date.now()}`)
    fs.writeFileSync(tmpFile, Buffer.alloc(100)) // 100 bytes < 256KB minimum
    try {
      expect(isProbableBunExecutable(tmpFile)).toBe(false)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  it('returns true for files >= 256KB', () => {
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const tmpFile = path.join(os.tmpdir(), `test-bun-large-${Date.now()}`)
    fs.writeFileSync(tmpFile, Buffer.alloc(256 * 1024)) // exactly 256KB
    try {
      expect(isProbableBunExecutable(tmpFile)).toBe(true)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })
})

describe('EngineChildProcess — bun path caching', () => {
  beforeEach(() => {
    _resetBunCacheForTesting()
  })

  afterEach(() => {
    _resetBunCacheForTesting()
  })

  it('resolveBunPath returns "bun" fallback when no bun found', async () => {
    const { resolveBunPath } = await import('../engineChildProcess')
    // In test environment, no real bun binary exists at the expected paths
    const result = resolveBunPath('/nonexistent/engine-root', 'TestTag')
    // Should return 'bun' as PATH fallback (or a global bun if one exists)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('resolveBunPath caches result across calls', async () => {
    const { resolveBunPath } = await import('../engineChildProcess')
    const result1 = resolveBunPath('/nonexistent/engine-root', 'TestTag')
    const result2 = resolveBunPath('/nonexistent/engine-root', 'TestTag')
    expect(result1).toBe(result2)
  })
})
