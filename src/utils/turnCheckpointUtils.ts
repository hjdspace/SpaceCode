import type { Message, SessionTurnCheckpoint } from '@/types'

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
