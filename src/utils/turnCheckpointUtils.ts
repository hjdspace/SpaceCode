import type { Message } from '@/types'

export interface RewindTurnTarget {
  messageId: string
  userMessageIndex: number
  content: string
}

export function isTurnResponseMessage(message: Message): boolean {
  return message.role === 'assistant' && !!message.content?.trim()
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
