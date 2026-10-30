/**
 * 项目内 JSON 文件的原子写：临时文件 + rename。
 * 崩溃或并发读取时只会看到旧文件或新文件，不会读到半截内容。
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/**
 * Windows 上 rename 覆盖已有文件时，若目标或临时文件正被杀软/索引器持有，
 * 会瞬时返回 EPERM/EBUSY/EACCES。退避重试足以跨过这个窗口。
 */
const RENAME_RETRY_DELAYS_MS = [10, 20, 50, 100, 200]
const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

export interface AtomicWriteDeps {
  rename?: (from: string, to: string) => void
  sleep?: (ms: number) => void
}

function defaultSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && RETRYABLE_CODES.has(code)
}

export function writeJsonAtomic(path: string, value: unknown, deps: AtomicWriteDeps = {}): void {
  mkdirSync(dirname(path), { recursive: true })
  const rename = deps.rename ?? renameSync
  const sleep = deps.sleep ?? defaultSleep
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
    for (let attempt = 0; ; attempt += 1) {
      try {
        rename(tmpPath, path)
        return
      } catch (err) {
        const delay = RENAME_RETRY_DELAYS_MS[attempt]
        if (delay === undefined || !isRetryable(err)) throw err
        sleep(delay)
      }
    }
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw err
  }
}
