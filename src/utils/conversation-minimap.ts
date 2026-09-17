import type { Message } from '@/types'

export type ConversationMinimapMarker = {
  id: string
  role: 'user' | 'assistant'
  preview: string
}

export const CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS = 280

/**
 * Determine whether the minimap should render.
 * Only show when there are at least 2 markers and the content overflows,
 * or when there is earlier history to reveal.
 */
export function shouldRenderConversationMinimap({
  markerCount,
  overflows,
  hasEarlier,
}: {
  markerCount: number
  overflows: boolean
  hasEarlier: boolean
}): boolean {
  return hasEarlier || (markerCount >= 2 && overflows)
}

function appendPreview(current: string, next: string): string {
  if (!next || current.length >= CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS) {
    return current
  }
  return `${current}${current ? '\n\n' : ''}${next}`.slice(
    0,
    CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS,
  )
}

/**
 * Build one user marker and one assistant marker per conversational turn.
 * Consecutive assistant messages are merged into a single marker.
 */
export function buildConversationMinimapMarkers(
  messages: Message[],
): ConversationMinimapMarker[] {
  const markers: ConversationMinimapMarker[] = []
  let assistantMarkerIndex: number | null = null

  for (const message of messages) {
    if (message.role === 'user') {
      markers.push({
        id: message.id,
        role: 'user',
        preview: (message.content || '')
          .trim()
          .slice(0, CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS),
      })
      assistantMarkerIndex = null
      continue
    }
    if (message.role !== 'assistant') continue

    const content = (message.content || '').trim()
    if (!content) continue
    if (assistantMarkerIndex === null) {
      markers.push({
        id: message.id,
        role: 'assistant',
        preview: content.slice(0, CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS),
      })
      assistantMarkerIndex = markers.length - 1
      continue
    }

    const marker = markers[assistantMarkerIndex]
    marker.preview = appendPreview(marker.preview, content)
  }

  return markers
}
