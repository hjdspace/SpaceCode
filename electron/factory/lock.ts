/**
 * 运行目录单写者锁（spec §10）。`runs/.lock` 记录持锁进程，第二个窗口/进程
 * 拿不到锁时只能只读查看。持锁进程已经退出时，允许接管这份陈旧锁。
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'fs'
import { join } from 'path'
import { FACTORY_RUNS_PATH } from '@/shared/factory'

export interface RunLockDeps {
  pid?: number
  /** 判断进程是否还活着；测试注入，生产用 process.kill(pid, 0)。 */
  isAlive?: (pid: number) => boolean
  now?: () => Date
}

export type RunLockResult = { ok: true } | { ok: false; reason: 'locked'; pid: number }

interface LockFile {
  pid: number
  at: string
}

export function runLockPath(repoRoot: string): string {
  return join(repoRoot, FACTORY_RUNS_PATH, '.lock')
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLock(path: string): LockFile | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (typeof raw !== 'object' || raw === null) return null
    const record = raw as Record<string, unknown>
    if (typeof record.pid !== 'number' || !Number.isFinite(record.pid)) return null
    return { pid: record.pid, at: typeof record.at === 'string' ? record.at : '' }
  } catch {
    return null
  }
}

function createLock(path: string, pid: number, now: () => Date): boolean {
  try {
    const fd = openSync(path, 'wx')
    writeSync(fd, JSON.stringify({ pid, at: now().toISOString() } satisfies LockFile))
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

/** 获取写锁；同一 pid 重复获取视为已持有。 */
export function acquireRunLock(repoRoot: string, deps: RunLockDeps = {}): RunLockResult {
  const pid = deps.pid ?? process.pid
  const alive = deps.isAlive ?? defaultIsAlive
  const now = deps.now ?? (() => new Date())
  const path = runLockPath(repoRoot)
  mkdirSync(join(repoRoot, FACTORY_RUNS_PATH), { recursive: true })

  if (createLock(path, pid, now)) return { ok: true }

  const existing = readLock(path)
  if (!existing) {
    // 锁文件内容损坏：按陈旧锁处理，允许接管。
    try {
      unlinkSync(path)
    } catch {
      return { ok: false, reason: 'locked', pid: 0 }
    }
    return createLock(path, pid, now) ? { ok: true } : { ok: false, reason: 'locked', pid: 0 }
  }
  if (existing.pid === pid) return { ok: true }
  if (alive(existing.pid)) return { ok: false, reason: 'locked', pid: existing.pid }

  try {
    unlinkSync(path)
  } catch {
    return { ok: false, reason: 'locked', pid: existing.pid }
  }
  return createLock(path, pid, now) ? { ok: true } : { ok: false, reason: 'locked', pid: existing.pid }
}

/** 只释放自己持有的锁，避免误删后来者的锁。 */
export function releaseRunLock(repoRoot: string, deps: Pick<RunLockDeps, 'pid'> = {}): void {
  const pid = deps.pid ?? process.pid
  const path = runLockPath(repoRoot)
  if (!existsSync(path)) return
  const existing = readLock(path)
  if (existing && existing.pid !== pid) return
  try {
    unlinkSync(path)
  } catch {
    // 释放失败不影响退出流程，下次启动会按陈旧锁处理。
  }
}
