/**
 * Super Agent 的引擎会话 id（设计 §5.3）。
 *
 * `superagent-worker-<ticketId>` 这类可读标签不能直接交给引擎：claude-code CLI
 * 的 `--session-id` / `--resume` 只接受 UUID，否则以 `Invalid session ID` 退出。
 * 这里用 UUIDv5（固定命名空间 + SHA-1）把可读标签映射成稳定 UUID —— 与流水线
 * 同一做法（electron/factory/sessionId.ts）：
 *   - Worker：默认按 ticketId 派生，跨 Assignment、重试与主进程重启都稳定；
 *     人明确续聊已结束工单时可持久化继承其 session，SessionProcess 按已有
 *     transcript 自动切 `--resume`；
 *   - Router：按项目根派生，重启后仍是同一条会话，IM 历史不会每次从零开始。
 *
 * 可读标签本身仍是领域身份（ticketId / assignmentId），UUID 只是引擎会话载体，
 * 两者不得混用（设计 §5.3）。
 */
import { createHash } from 'crypto'

/** 固定命名空间，与流水线及任何外部 UUID 命名空间都不重叠。 */
const NAMESPACE = Buffer.from('7a5f1c3e9b2d4a68f0e1c7b3d9a5f2e4', 'hex')

function deriveUuid(label: string): string {
  const digest = createHash('sha1').update(NAMESPACE).update(Buffer.from(label, 'utf8')).digest()
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const hex = digest.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 项目根归一化：Windows 的反斜杠与结尾分隔符不参与派生。 */
function normalizeRoot(repoRoot: string): string {
  return repoRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function superAgentRouterEngineSessionId(repoRoot: string): string {
  return deriveUuid(`sa-router:${normalizeRoot(repoRoot)}`)
}

export function superAgentWorkerEngineSessionId(ticketId: string): string {
  return deriveUuid(`sa-worker:${ticketId}`)
}

export function superAgentTicketWorkerSessionId(ticket: {
  ticketId: string
  execution?: { sessionId?: string }
}): string {
  const inherited = ticket.execution?.sessionId
  return typeof inherited === 'string' && inherited !== ''
    ? inherited
    : superAgentWorkerEngineSessionId(ticket.ticketId)
}
