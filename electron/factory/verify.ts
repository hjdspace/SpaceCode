/**
 * 验证阶段：只执行运行配置里的简单命令，不经过 shell，不接受任务内容拼接。
 *
 * 失败详情只取尾部关键行（行数 + 字符双上限），完整输出留在日志文件；
 * 超时、中断与非零退出分别落成可读状态，供事件流与后续修复提示词消费。
 */
import { execFile } from 'child_process'
import { tokenizeCommand } from './prompt'

const VERIFY_TIMEOUT = 10 * 60_000
const VERIFY_MAX_BUFFER = 10 * 1024 * 1024
const DEFAULT_MAX_LINES = 40
const DEFAULT_MAX_CHARS = 4000
const SHELL_META = /[|&;<>$`(){}\r\n]/
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const SECRET_KEY = /(?:token|secret|api[_-]?key|password|credential)/i

export function scrubEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_KEY.test(key)) continue
    scrubbed[key] = value
  }
  return scrubbed
}

/** 分词并拒绝 shell 组合符；返回 null 表示配置里的命令无法安全执行。 */
export function parseVerifyCommand(command: string): string[] | null {
  const argv = tokenizeCommand(command)
  if (!argv || argv.length === 0) return null
  if (argv.some((token) => SHELL_META.test(token))) return null
  return argv
}

/** 取尾部 N 行并截断到字符上限；失败摘要与阶段详情都走这里。 */
export function tailOutput(
  stdout: string,
  stderr: string,
  maxLines = DEFAULT_MAX_LINES,
  maxChars = DEFAULT_MAX_CHARS,
): string {
  const lines = [stdout, stderr]
    .filter((text) => text.trim() !== '')
    .join('\n')
    .split(/\r?\n/)
    .filter((line) => line !== '')
  const tail = lines.slice(-Math.max(1, maxLines)).join('\n')
  return tail.length > maxChars ? tail.slice(-maxChars) : tail
}

export interface VerifyExecOptions {
  timeoutMs: number
  signal?: AbortSignal
  env: NodeJS.ProcessEnv
}

export interface VerifyExecResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
}

export type VerifyExecutor = (
  argv: string[],
  cwd: string,
  options: VerifyExecOptions,
) => Promise<VerifyExecResult>

const defaultExec: VerifyExecutor = (argv, cwd, options) =>
  new Promise((resolveResult) => {
    const [command, ...rest] = argv
    // Windows 的包管理器是 .cmd 包装器，直接 execFile('npm') 会 ENOENT。
    const file = process.platform === 'win32' && PACKAGE_MANAGERS.has(command) ? `${command}.cmd` : command
    execFile(
      file,
      rest,
      {
        cwd,
        timeout: options.timeoutMs,
        maxBuffer: VERIFY_MAX_BUFFER,
        env: options.env,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & { killed?: boolean; signal?: string }) | null
        const aborted = Boolean(options.signal?.aborted || failure?.name === 'AbortError')
        const timedOut =
          !aborted && Boolean(failure?.killed && failure?.signal === 'SIGTERM') && failure?.code == null
        resolveResult({
          code: failure ? (typeof failure.code === 'number' ? failure.code : null) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          timedOut,
          aborted,
        })
      },
    )
  })

export interface VerifyInput {
  command: string
  cwd: string
  signal?: AbortSignal
  timeoutMs?: number
}

export interface VerifyResult {
  status: 'pass' | 'fail' | 'timeout' | 'stopped'
  command: string
  at: string
  exitCode?: number
  detail: string
}

export interface VerifyDeps {
  exec?: VerifyExecutor
  now?: () => Date
  maxLines?: number
  maxChars?: number
}

export async function runVerification(input: VerifyInput, deps: VerifyDeps = {}): Promise<VerifyResult> {
  const now = deps.now ?? (() => new Date())
  const at = now().toISOString()
  const maxLines = deps.maxLines ?? DEFAULT_MAX_LINES
  const maxChars = deps.maxChars ?? DEFAULT_MAX_CHARS

  const argv = parseVerifyCommand(input.command)
  if (!argv) {
    return {
      status: 'fail',
      command: input.command,
      at,
      detail: 'Command rejected: only a single command without shell operators is allowed.',
    }
  }
  if (input.signal?.aborted) return { status: 'stopped', command: input.command, at, detail: '' }

  let result: VerifyExecResult
  try {
    result = await (deps.exec ?? defaultExec)(argv, input.cwd, {
      timeoutMs: input.timeoutMs ?? VERIFY_TIMEOUT,
      ...(input.signal ? { signal: input.signal } : {}),
      env: scrubEnv(),
    })
  } catch (error) {
    return {
      status: 'fail',
      command: input.command,
      at,
      detail: tailOutput('', String((error as Error)?.message ?? error), maxLines, maxChars),
    }
  }

  const detail = tailOutput(result.stdout, result.stderr, maxLines, maxChars)
  if (result.aborted) return { status: 'stopped', command: input.command, at, detail }
  if (result.timedOut) return { status: 'timeout', command: input.command, at, detail }
  if (result.code === 0) return { status: 'pass', command: input.command, at, exitCode: 0, detail }
  return {
    status: 'fail',
    command: input.command,
    at,
    ...(result.code !== null ? { exitCode: result.code } : {}),
    detail,
  }
}
