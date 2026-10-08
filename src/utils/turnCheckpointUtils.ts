import type { Message, SessionTurnCheckpoint, TurnChangeCardData } from '@/types'

export const findTurnCheckpointForMessage = (
  checkpoints: SessionTurnCheckpoint[],
  messageId: string,
  userMessageIndex: number
): SessionTurnCheckpoint | undefined => {
  const byId = checkpoints.find(cp => cp.target.targetUserMessageId === messageId)
  if (byId) return byId
  if (userMessageIndex >= 0) {
    return checkpoints.find(cp => cp.target.userMessageIndex === userMessageIndex)
  }
  return undefined
}

/** 会话里的一个用户轮次；groupIndex 为用户轮次序号（从 0 起），timestamp 为气泡创建时刻 */
export interface TurnGroupAnchor {
  groupIndex: number
  messageId: string
  timestamp: number
}

// engine 记录用户消息的时刻必然不早于前端按下发送的时刻，但消息在上一轮运行中
// 被排队时会延后记录，所以向前（更早的轮次）的容差给得宽、向后的容差只留几秒。
const ANCHOR_LOOKBEHIND_MS = 5 * 60_000
const ANCHOR_LOOKAHEAD_MS = 5_000

/**
 * 把轮次卡片归位到对应的用户轮次，返回 groupIndex → card。
 *
 * 不能用 userMessageIndex 位置对位：前端 message.id 由渲染进程生成，与 engine 写进
 * JSONL 的 uuid 永不相等，实际全靠序号兜底；而 JSONL 只追加，前端却会因
 * MAX_MESSAGES_PER_SESSION 从头部裁剪消息、因编辑重发 / 回滚截断 session.messages，
 * engine 还会注入 isMeta 用户条目 —— 两套序号一旦错位，第 N 轮的卡片就会挂到
 * 第 N+k 轮下面。改用 engine 记录的用户消息时刻做时间锚点后，这三种错位都不再影响归位。
 */
export function assignTurnCardsToGroups(
  groups: TurnGroupAnchor[],
  cards: TurnChangeCardData[]
): Map<number, TurnChangeCardData> {
  const assigned = new Map<number, TurnChangeCardData>()
  if (groups.length === 0 || cards.length === 0) return assigned

  const anchored = cards
    .filter(c => !!c.checkpoint.target.turnStartedAt)
    .sort(
      (a, b) =>
        (a.checkpoint.target.turnStartedAt ?? 0) - (b.checkpoint.target.turnStartedAt ?? 0)
    )

  // 卡片与轮次都按时间升序，指针只前进：一张卡占一轮，后续卡片不会回退抢同一轮
  let cursor = 0

  for (const card of anchored) {
    const anchor = card.checkpoint.target.turnStartedAt!
    let match = -1

    for (let pos = cursor; pos < groups.length; pos++) {
      const ts = groups[pos].timestamp
      if (ts <= anchor) {
        if (anchor - ts <= ANCHOR_LOOKBEHIND_MS) match = pos
        continue
      }
      if (match < 0 && ts - anchor <= ANCHOR_LOOKAHEAD_MS) match = pos
      break
    }

    if (match < 0) continue
    assigned.set(groups[match].groupIndex, card)
    cursor = match + 1
  }

  // 缺时间锚点的卡片（JSONL 条目没有 timestamp）退回原有的 id / 序号对位
  const unanchored = cards.filter(c => !c.checkpoint.target.turnStartedAt)
  for (const group of groups) {
    if (assigned.has(group.groupIndex)) continue
    const legacy = unanchored.find(
      c =>
        c.targetUserMessageId === group.messageId ||
        c.checkpoint.target.userMessageIndex === group.groupIndex
    )
    if (legacy) assigned.set(group.groupIndex, legacy)
  }

  return assigned
}

export interface RewindTurnTarget {
  messageId: string
  userMessageIndex: number
  content: string
}

export function isTurnResponseMessage(message: Message): boolean {
  if (message.role !== 'assistant') return false

  return !!(
    message.content?.trim() ||
    message.reasoning?.content?.trim() ||
    message.toolCalls?.length ||
    message.timelineEvents?.length ||
    message.metadata
  )
}

export function getCompletedTurnTargets(messages: Message[]): RewindTurnTarget[] {
  let userMessageIndex = -1
  const completedTurns: RewindTurnTarget[] = []
  let currentTarget: RewindTurnTarget | null = null
  let hasResponseForCurrentTarget = false

  for (const message of messages) {
    if (message.role === 'user' && !isPendingMessage(message)) {
      if (currentTarget && hasResponseForCurrentTarget) {
        completedTurns.push(currentTarget)
      }
      
      userMessageIndex += 1
      currentTarget = {
        messageId: message.id,
        userMessageIndex,
        content: message.content || '',
      }
      hasResponseForCurrentTarget = false
      continue
    }

    if (currentTarget && isTurnResponseMessage(message)) {
      hasResponseForCurrentTarget = true
    }
  }

  if (currentTarget && hasResponseForCurrentTarget) {
    completedTurns.push(currentTarget)
  }

  return completedTurns
}

function isPendingMessage(message: Message): boolean {
  return !message.id || message.timestamp === 0
}
