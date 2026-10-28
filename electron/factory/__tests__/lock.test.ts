// @vitest-environment node
/**
 * 运行目录单写者锁：同一目录同一时刻只允许一个进程推进。
 * 另一个进程只能只读；持锁进程已退出时允许接管陈旧锁。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { acquireRunLock, releaseRunLock, runLockPath } from '../lock'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-lock-'))
  mkdirSync(join(dir, '.spacecode', 'factory', 'runs'), { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('run lock', () => {
  it('grants the first writer and rejects a second live process', () => {
    const first = acquireRunLock(dir, { pid: 100, isAlive: () => true })
    expect(first).toEqual({ ok: true })

    const second = acquireRunLock(dir, { pid: 200, isAlive: () => true })
    expect(second).toEqual({ ok: false, reason: 'locked', pid: 100 })
  })

  it('treats the same pid as the same writer', () => {
    expect(acquireRunLock(dir, { pid: 100, isAlive: () => true }).ok).toBe(true)
    expect(acquireRunLock(dir, { pid: 100, isAlive: () => true }).ok).toBe(true)
  })

  it('steals a stale lock left by a dead process', () => {
    writeFileSync(
      runLockPath(dir),
      JSON.stringify({ pid: 999, at: '2026-10-29T00:00:00Z' }),
      'utf-8',
    )
    const result = acquireRunLock(dir, { pid: 200, isAlive: () => false })
    expect(result).toEqual({ ok: true })
  })

  it('releases the lock for the next writer', () => {
    acquireRunLock(dir, { pid: 100, isAlive: () => true })
    releaseRunLock(dir, { pid: 100 })
    expect(acquireRunLock(dir, { pid: 200, isAlive: () => true })).toEqual({ ok: true })
  })
})
