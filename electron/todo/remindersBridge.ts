/**
 * osascript 传输层 — 唯一真正起子进程的地方。
 *
 * 脚本写进临时文件后按 `osascript -l JavaScript <file> <json>` 调用：
 * programfile + argument 的语义是文档明确规定的（run(argv) 收到 argv[0]），
 * 不像 `-e` 那样在不同系统版本上对「多余参数」处理不一致。
 *
 * 平台闸门在这里：非 darwin 直接 unsupported-platform，绝不尝试执行。
 */
import { execFile } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { TodoSyncErrorCode } from '@/shared/channels/todo'
import {
  FETCH_SCRIPT,
  LISTS_SCRIPT,
  PUSH_SCRIPT,
  buildFetchPayload,
  buildPushPayload,
  parseScriptResult,
  type FetchPayload,
  type ListsPayload,
  type NativeList,
  type PushOps,
  type PushPayload,
  type ScriptResult,
} from './remindersScript'
import type { NativeReminder } from './remindersMapping'

export const REMINDERS_SCRIPT_TIMEOUT_MS = 20_000

export interface RemindersExecRequest {
  script: string
  payload: string | null
  timeoutMs: number
}

export interface RemindersExecResult {
  stdout: string
  stderr: string
  code: number | null
  timedOut?: boolean
}

export type RemindersExecutor = (request: RemindersExecRequest) => Promise<RemindersExecResult>

export class RemindersBridgeError extends Error {
  constructor(readonly code: TodoSyncErrorCode, message: string) {
    super(message)
    this.name = 'RemindersBridgeError'
  }
}

export interface RemindersBridge {
  readonly supported: boolean
  listLists(): Promise<NativeList[]>
  fetch(listId: string): Promise<NativeReminder[]>
  push(ops: PushOps): Promise<PushPayload>
}

const PERMISSION_PATTERN = /not authoriz|not permitted|not allowed|-1743|-1744/i

function isPermissionFailure(message: string, number?: number): boolean {
  return number === -1743 || number === -1744 || PERMISSION_PATTERN.test(message)
}

const defaultExecutor: RemindersExecutor = ({ script, payload, timeoutMs }) =>
  new Promise<RemindersExecResult>((resolve, reject) => {
    let dir: string
    try {
      dir = mkdtempSync(join(tmpdir(), 'spacecode-reminders-'))
    } catch (err) {
      reject(err)
      return
    }
    const scriptPath = join(dir, 'script.js')
    try {
      writeFileSync(scriptPath, script, 'utf-8')
    } catch (err) {
      rmSync(dir, { recursive: true, force: true })
      reject(err)
      return
    }
    const args = ['-l', 'JavaScript', scriptPath]
    if (payload !== null) args.push(payload)
    execFile(
      'osascript',
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf-8' },
      (err, stdout, stderr) => {
        rmSync(dir, { recursive: true, force: true })
        const killed = Boolean(err && (err as NodeJS.ErrnoException & { killed?: boolean }).killed)
        if (err && !killed && typeof (err as NodeJS.ErrnoException).code === 'string') {
          // ENOENT / EACCES：连解释器都没起来，stdout 不可信。
          reject(err)
          return
        }
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          timedOut: killed,
        })
      },
    )
  })

export function createRemindersBridge(options: {
  exec?: RemindersExecutor
  platform?: NodeJS.Platform
  timeoutMs?: number
} = {}): RemindersBridge {
  const platform = options.platform ?? process.platform
  const exec = options.exec ?? defaultExecutor
  const timeoutMs = options.timeoutMs ?? REMINDERS_SCRIPT_TIMEOUT_MS
  const supported = platform === 'darwin'

  async function run<T>(script: string, payload: string | null): Promise<T> {
    if (!supported) {
      throw new RemindersBridgeError('unsupported-platform', 'macOS Reminders sync requires macOS')
    }
    let result: RemindersExecResult
    try {
      result = await exec({ script, payload, timeoutMs })
    } catch (err) {
      throw new RemindersBridgeError('script-failed', `osascript could not run: ${String(err)}`)
    }
    if (result.timedOut) {
      throw new RemindersBridgeError('timeout', `osascript timed out after ${timeoutMs}ms`)
    }
    const parsed: ScriptResult<T> = parseScriptResult<T>(result.stdout)
    if (!parsed.ok) {
      const message = parsed.error.message
      if (isPermissionFailure(message, parsed.error.number) || isPermissionFailure(result.stderr)) {
        throw new RemindersBridgeError('permission-denied', message)
      }
      throw new RemindersBridgeError('script-failed', message)
    }
    if (result.code !== 0 && result.stderr && isPermissionFailure(result.stderr)) {
      throw new RemindersBridgeError('permission-denied', result.stderr)
    }
    // ok 是传输层的信封字段，不属于载荷类型。
    const body: Record<string, unknown> = { ...parsed }
    delete body.ok
    return body as T
  }

  return {
    supported,
    async listLists() {
      const payload = await run<ListsPayload>(LISTS_SCRIPT, null)
      return payload.lists
    },
    async fetch(listId) {
      const payload = await run<FetchPayload>(FETCH_SCRIPT, buildFetchPayload(listId))
      return payload.reminders
    },
    async push(ops) {
      return run<PushPayload>(PUSH_SCRIPT, buildPushPayload(ops))
    },
  }
}