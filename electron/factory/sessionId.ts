/**
 * 工厂会话 id：引擎的 `--session-id` / `--resume` 只接受 UUID。
 *
 * 直接把 `fac-<run>-<task>-<stage>` 交给 claude-code CLI 会被拒绝并以
 * `Error: Invalid session ID. Must be a valid UUID.` (code=1) 退出，任务随即
 * 落到 blocked/agent.error。这里沿用 UUIDv5 的做法（固定命名空间 + SHA-1），
 * 把可读标识映射成稳定 UUID：同一 run/task/stage 重跑时仍得到同一个 id，
 * SessionProcess 会按已有 transcript 自动切到 --resume。
 */
import { createHash } from 'crypto'

/** 固定命名空间，与任何外部 UUID 命名空间都不重叠。 */
const NAMESPACE = Buffer.from('5f4dcc3b5aa765d61d8327deb882cf99', 'hex')

export function factorySessionId(label: string): string {
  const digest = createHash('sha1').update(NAMESPACE).update(Buffer.from(label, 'utf8')).digest()
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const hex = digest.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
