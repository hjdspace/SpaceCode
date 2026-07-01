import type { Message } from '@/types'
import { useChatSessionStore } from '@/stores/chatSession'
import { teammateIdForParentToolUse, normalizeTeammateId } from '@/services/teamTranscriptService'
import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

export function useSubagentTranscript(toolUseId: MaybeRefOrGetter<string>) {
  const sessionStore = useChatSessionStore()

  const id = computed(() => toValue(toolUseId))

  const teammateId = computed(() => {
    const session = sessionStore.currentSession
    if (!session || !id.value) return null
    return teammateIdForParentToolUse(session.id, id.value) || normalizeTeammateId(id.value)
  })

  const messages = computed<Message[]>(() => {
    const session = sessionStore.currentSession
    if (!session || !teammateId.value) return []
    return session.teammateTranscripts?.[teammateId.value] || []
  })

  return { teammateId, messages }
}
