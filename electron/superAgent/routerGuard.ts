/**
 * Router noWait 守卫（#95）。
 *
 * Router 的目标是尽快把新候选路由出去；报告与后台作业结果会自动作为新输入到达，
 * 在 Router 轮次里等待只会拖延所有新候选。判定口径对齐原型 `src/app/sessions.ts`
 * 的 `noWait`：命令位 `sleep`、shell 自带超时 > 30 秒、作业输出阻塞等待 > 5 秒。
 *
 * 这里只做**识别**（纯函数）；拒绝由 routerRunner 在权限请求处执行，并计入健康。
 * 不与引擎工具面裁剪重复：`allowedTools: []` 已经把工具池清空，本守卫是第二道
 * 防线 —— 万一引擎没有按启动参数裁剪（能力边界），Router 也不会静默获得等待能力。
 */

export type SuperAgentRouterNoWaitRule = 'sleep' | 'shellTimeout' | 'jobWait'

export interface SuperAgentRouterNoWaitViolation {
  code: 'routerNoWait'
  rule: SuperAgentRouterNoWaitRule
  /** 拒绝对话里给人看的短说明（不含用户原文之外的隐私内容）。 */
  detail: string
}

/** shell 工具自带超时的上限：超过就是一次 Router 不该做的等待。 */
export const ROUTER_MAX_SHELL_TIMEOUT_MS = 30_000

/** 作业输出阻塞等待的上限。 */
export const ROUTER_MAX_JOB_WAIT_MS = 5_000

const SHELL_TOOLS = new Set(['bash', 'powershell', 'shell'])
const JOB_OUTPUT_TOOLS = new Set(['taskoutput', 'bashoutput', 'job_output', 'joboutput'])

/** 分隔复合命令的 shell 操作符；只按操作符切段，不做完整语法解析。 */
function splitShellSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      current += char
      escaped = true
      continue
    }
    if (quote !== null) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '\n' || char === '\r' || char === ';' || char === '|' || char === '&') {
      // `&&` / `||` 的第二个字符也归到分隔符，避免留下空段。
      if (char === '&' && command[i + 1] === '&') i += 1
      if (char === '|' && command[i + 1] === '|') i += 1
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }
  segments.push(current)
  return segments.map((segment) => segment.trim()).filter((segment) => segment !== '')
}

function firstCommandWord(segment: string): string {
  const tokens = segment.split(/\s+/).filter((token) => token !== '')
  let index = 0
  // 跳过前置的环境变量赋值、sudo/env/command 等包装，再看命令位。
  while (index < tokens.length) {
    const token = tokens[index]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1
      continue
    }
    const lowered = token.toLowerCase()
    if (lowered === 'sudo' || lowered === 'env' || lowered === 'command' || lowered === 'builtin') {
      index += 1
      continue
    }
    break
  }
  const word = tokens[index] ?? ''
  return word.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '')
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function asRecord(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : null
}

/**
 * 判断一次工具调用是否违反 Router noWait 规则。
 *
 * @returns null = 不是阻塞式等待；否则返回稳定 code、命中的规则与短说明。
 */
export function inspectRouterToolCall(
  toolName: string,
  input: unknown,
): SuperAgentRouterNoWaitViolation | null {
  const record = asRecord(input)
  if (!record) return null
  const tool = toolName.toLowerCase()

  if (SHELL_TOOLS.has(tool)) {
    const command = readString(record, 'command')
    for (const segment of splitShellSegments(command)) {
      const word = firstCommandWord(segment)
      if (word === 'sleep' || word.toLowerCase() === 'start-sleep') {
        return { code: 'routerNoWait', rule: 'sleep', detail: segment }
      }
    }
    const timeout = numeric(record.timeout) ?? numeric(record.timeoutMs)
    if (timeout !== null && timeout > ROUTER_MAX_SHELL_TIMEOUT_MS) {
      return {
        code: 'routerNoWait',
        rule: 'shellTimeout',
        detail: `${toolName} timeout=${timeout}ms > ${ROUTER_MAX_SHELL_TIMEOUT_MS}ms`,
      }
    }
    return null
  }

  if (JOB_OUTPUT_TOOLS.has(tool)) {
    const blocking = record.block !== false
    if (!blocking) return null
    // TaskOutput 的默认 timeout 是 30 秒；不写参数本身就是一次长等待。
    const timeout = numeric(record.timeout) ?? numeric(record.waitMs) ?? 30_000
    if (timeout > ROUTER_MAX_JOB_WAIT_MS) {
      return {
        code: 'routerNoWait',
        rule: 'jobWait',
        detail: `${toolName} wait=${timeout}ms > ${ROUTER_MAX_JOB_WAIT_MS}ms`,
      }
    }
  }

  return null
}
