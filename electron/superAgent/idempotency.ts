/**
 * 外部命令幂等键（T03 #73）。
 *
 * 四类事实各有稳定键：Source 事件键、UI requestId、Report 的
 * `assignmentId+reportId`、Outbox 的 messageId。重复键必须返回原结果，
 * 不允许重复执行副作用；空键会让不同事实撞在一起，直接拒绝。
 */

export type SuperAgentIdempotencyKind = 'event' | 'request' | 'report' | 'message'

export function idempotencyKey(kind: SuperAgentIdempotencyKind, ...parts: string[]): string {
  if (parts.length === 0) {
    throw new Error(`idempotency key for "${kind}" requires at least one part`)
  }
  for (const part of parts) {
    if (!part.trim()) {
      throw new Error(`idempotency key for "${kind}" cannot contain blank parts`)
    }
  }
  return [kind, ...parts].join(':')
}
