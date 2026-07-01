import type { Message } from '@/types'
import { useChatSessionStore } from '@/stores/chatSession'
import { teammateIdForParentToolUse, normalizeTeammateId } from '@/services/teamTranscriptService'
import { computed } from 'vue'

export function useSubagentTranscript(toolUseId: string) {
  const sessionStore = useChatSessionStore()

  const teammateId = computed(() => {
    const session = sessionStore.currentSession
    if (!session || !toolUseId) return null
    return teammateIdForParentToolUse(session.id, toolUseId) || normalizeTeammateId(toolUseId)
  })

  const messages = computed<Message[]>(() => {
    const session = sessionStore.currentSession
    if (!session || !teammateId.value) return []
    return session.teammateTranscripts?.[teammateId.value] || []
  })

  return { teammateId, messages }
}
