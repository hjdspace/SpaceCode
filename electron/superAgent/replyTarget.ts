/**
 * #103：reply 目标解析（设计 §6.4）。
 *
 * 把领域引用解析为平台会话地址：
 *  - acknowledgement / answer → 人消息所在会话（`payload.inReplyTo`）；
 *  - attention → 提问消息所在会话（`payload.inReplyTo` 指向 askedBy Input）；
 *  - result → 工单发起会话（`ticket.origin.triggerId`）。
 *
 * 平台地址编码：
 *  - 飞书 `feishu:chat:<chatId>:reply:<messageId>`（话题回复）；
 *  - GitHub `github:pr:<owner>/<repo>:<number>[:reply:<commentId>]`；
 *  - 桌面或无平台来源 → `desktop`。
 */
import { DESKTOP_OUTBOX_CHANNEL } from './desktopChannel'
import { FEISHU_OUTBOX_CHANNEL_PREFIX, feishuOutboxChannel, parseFeishuOutboxChannel } from './feishuChannel'
import { GITHUB_OUTBOX_CHANNEL_PREFIX, githubPrOutboxChannel, parseGithubOutboxChannel } from './githubChannel'
import type {
  SuperAgentInput,
  SuperAgentOutboxReplyPayload,
  SuperAgentTicket,
  SuperAgentTrigger,
} from './model'

export interface SuperAgentReplyTargetState {
  triggers: Record<string, SuperAgentTrigger>
  inputs: Record<string, SuperAgentInput>
}

export function resolveSuperAgentReplyChannel(input: {
  ticket: SuperAgentTicket
  payload: SuperAgentOutboxReplyPayload
  state: SuperAgentReplyTargetState
}): string {
  const trigger = replyTrigger(input.ticket, input.payload, input.state)
  const channel = trigger?.channel
  if (!channel) return DESKTOP_OUTBOX_CHANNEL

  if (channel.startsWith(FEISHU_OUTBOX_CHANNEL_PREFIX)) {
    const address = parseFeishuOutboxChannel(channel)
    if (!address) return channel
    return feishuOutboxChannel(address.chatId, feishuMessageIdOf(trigger))
  }

  if (channel.startsWith(GITHUB_OUTBOX_CHANNEL_PREFIX)) {
    const address = parseGithubOutboxChannel(channel)
    if (!address) return channel
    if (input.payload.replyType === 'result') {
      return githubPrOutboxChannel(address.repo, address.number)
    }
    return githubPrOutboxChannel(address.repo, address.number, githubReplyTargetOf(trigger))
  }

  return DESKTOP_OUTBOX_CHANNEL
}

function replyTrigger(
  ticket: SuperAgentTicket,
  payload: SuperAgentOutboxReplyPayload,
  state: SuperAgentReplyTargetState,
): SuperAgentTrigger | null {
  if (payload.replyType === 'result') {
    return state.triggers[ticket.origin.triggerId] ?? null
  }
  const inputId = payload.inReplyTo
  if (inputId) {
    const input = state.inputs[inputId]
    const trigger = input?.triggerId ? state.triggers[input.triggerId] : undefined
    if (trigger) return trigger
  }
  return state.triggers[ticket.origin.triggerId] ?? null
}

/** 飞书 Trigger 的消息 id：优先 meta，其次 `feishu:message:<id>` 幂等键。 */
function feishuMessageIdOf(trigger: SuperAgentTrigger): string | null {
  const metaMessageId = trigger.meta['messageId']
  if (typeof metaMessageId === 'string' && metaMessageId !== '') return metaMessageId
  const prefix = 'feishu:message:'
  if (trigger.key.startsWith(prefix)) {
    return trigger.key.slice(prefix.length) || null
  }
  return null
}

/**
 * GitHub 评审线程的根评论 id：事件 meta 的 `inReplyTo`（回复链根）优先，
 * 否则用评论 Trigger 自身 id。Review（非 comment）事件没有可回复的 review
 * comment，返回 null → 发到 PR 会话评论。
 */
function githubReplyTargetOf(trigger: SuperAgentTrigger): string | null {
  const inReplyTo = trigger.meta['inReplyTo']
  if (typeof inReplyTo === 'string' && inReplyTo !== '') return inReplyTo
  if (typeof inReplyTo === 'number' && Number.isFinite(inReplyTo)) return String(inReplyTo)
  const prefix = 'github-pr:comment:'
  if (trigger.key.startsWith(prefix)) {
    const segments = trigger.key.split(':')
    const id = segments[segments.length - 1]
    return id && /^\d+$/.test(id) ? id : null
  }
  return null
}
