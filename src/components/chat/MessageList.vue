<template>
  <div class="message-list" ref="listRef" :class="{ 'has-messages': messages.length > 0 || loading }">
    <div class="messages-container">
      <div v-if="messages.length === 0 && !loading" class="empty-state">        
        <MessageSquare :size="48" />
        <p>{{ t('chat.startConversation') }}</p>
        <span>{{ t('chat.startConversationDesc') }}</span>
      </div>

      <template v-for="group in messageGroups" :key="group.id">
        <!-- User message bubble -->
        <MessageItem
          v-if="group.type === 'user'"
          :message="group.messages[0]"
          @tool-submit="(mId, tId, ans) => emit('toolSubmit', mId, tId, ans)"
          @tool-skip="(mId, tId) => emit('toolSkip', mId, tId)"
        />
        <!-- Assistant timeline (unified) -->
        <AgentTimeline
          v-else
          :messages="group.messages"
          :loading="loading && group.id === messageGroups[messageGroups.length - 1]?.id"
          @tool-submit="(tId, ans) => emit('toolSubmit', group.id, tId, ans)"
          @tool-skip="(tId) => emit('toolSkip', group.id, tId)"
        />
      </template>

      <div v-if="loading" class="typing-indicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>

      <!-- Turn Change Cards -->
      <CurrentTurnChangeCard
        v-for="(card, index) in chatStore.turnChangeCards"
        :key="card.targetUserMessageId"
        :card-data="card"
        class="turn-change-card-wrapper"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed } from 'vue'
import type { Message } from '@/types'
import MessageItem from './MessageItem.vue'
import AgentTimeline from './AgentTimeline.vue'
import CurrentTurnChangeCard from './CurrentTurnChangeCard.vue'
import { MessageSquare } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { getCompletedTurnTargets } from '@/utils/turnCheckpointUtils'

const { t } = useI18n()
const chatStore = useChatStore()

const emit = defineEmits<{
  toolSubmit: [messageId: string, toolId: string, updatedInput: Record<string, unknown>]
  toolSkip: [messageId: string, toolId: string]
}>()

const { messages, loading } = defineProps<{
  messages: Message[]
  loading: boolean
}>()

interface MessageGroup {
  id: string
  type: 'user' | 'assistant'
  messages: Message[]
}

const messageGroups = computed<MessageGroup[]>(() => {
  const groups: MessageGroup[] = []
  let currentGroup: MessageGroup | null = null

  for (const msg of messages) {
    const groupType = msg.role === 'user' ? 'user' : 'assistant'

    if (!currentGroup || currentGroup.type !== groupType) {
      currentGroup = {
        id: msg.id,
        type: groupType,
        messages: [msg]
      }
      groups.push(currentGroup)
    } else {
      currentGroup.messages.push(msg)
    }
  }

  return groups
})

const listRef = ref<HTMLElement | null>(null)

function scrollToBottom() {
  nextTick(() => {
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight
    }
  })
}

watch(() => [messages, loading], () => {
  scrollToBottom()
}, { deep: true })

const completedTurnTargets = computed(() => getCompletedTurnTargets(messages))
const hasCompletedTurns = computed(() => completedTurnTargets.value.length > 0)

watch(() => chatStore.currentSessionId, async (sessionId) => {
  if (sessionId && !chatStore.isLoading && hasCompletedTurns.value) {
    await chatStore.loadTurnCheckpoints(sessionId)
  }
})

watch(() => messages, async () => {
  const sessionId = chatStore.currentSessionId
  const isIdle = !chatStore.isLoading && !loading
  
  if (sessionId && isIdle && hasCompletedTurns.value) {
    await chatStore.loadTurnCheckpoints(sessionId)
  } else if (sessionId && isIdle && !hasCompletedTurns.value) {
    chatStore.clearTurnCheckpoints()
  }
}, { deep: true })

onMounted(async () => {
  if (messages.length > 0) {
    scrollToBottom()
  }
  
  const sessionId = chatStore.currentSessionId
  if (sessionId && !loading && hasCompletedTurns.value) {
    await chatStore.loadTurnCheckpoints(sessionId)
  }
})
</script>

<style lang="scss" scoped>
.message-list {
  flex: 1;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  @include scrollbar;
  display: flex;
  flex-direction: column;
}

.messages-container {
  flex: 0 0 auto;
  min-height: 100%;
  padding: 16px 20px;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;

  > * {
    flex-shrink: 0;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 12px;
  flex: 1;
  min-height: 0;

  p {
    font-size: 18px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  span {
    font-size: 13px;
    text-align: center;
    max-width: 280px;
  }
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px 16px;

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: bounce 1.4s infinite ease-in-out both;

    &:nth-child(1) { animation-delay: -0.32s; }
    &:nth-child(2) { animation-delay: -0.16s; }
  }
}

.turn-change-card-wrapper {
  margin: 12px 16px;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}
</style>
