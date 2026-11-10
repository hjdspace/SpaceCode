/**
 * #101：desktop 的 Outbox 通道适配器。
 *
 * 人可见的受控 reply 落到 Router 会话（IM 气泡）：主进程用稳定的 messageId 推
 * 一次气泡，渲染端按 id 去重，因此崩溃在「已推送、回执未写回」窗口重投时不会
 * 出现第二个气泡。内部 Effect（launch/delivery/relay/reviewReminder）不走这条
 * 人可见通道，直接 gone，避免误发到对话里。
 */
import type { SuperAgentOutboxMessage } from './model'
import type { SuperAgentOutboxChannel, SuperAgentOutboxSendOutcome } from './outbox'

export const DESKTOP_OUTBOX_CHANNEL = 'desktop'

export interface SuperAgentDesktopOutboxChannelOptions {
  /** 把一条 reply 作为气泡推到 Router 会话；同步抛错视为瞬时失败。 */
  push: (message: SuperAgentOutboxMessage) => void
}

export function createSuperAgentDesktopOutboxChannel(
  options: SuperAgentDesktopOutboxChannelOptions,
): SuperAgentOutboxChannel {
  /** messageId → 平台回执。同进程内的幂等；跨进程由稳定派生回执兜底。 */
  const receipts = new Map<string, string>()

  return async (message: SuperAgentOutboxMessage): Promise<SuperAgentOutboxSendOutcome> => {
    if (message.payload.kind !== 'reply') {
      return { outcome: 'gone', error: 'desktopChannelReplyOnly' }
    }
    const delivered = receipts.get(message.messageId)
    if (delivered !== undefined) return { outcome: 'sent', receipt: delivered }
    try {
      options.push(message)
    } catch (err) {
      return {
        outcome: 'waiting',
        error: err instanceof Error ? err.message : 'desktopPushFailed',
      }
    }
    const receipt = `desktop:${message.messageId}`
    receipts.set(message.messageId, receipt)
    return { outcome: 'sent', receipt }
  }
}
