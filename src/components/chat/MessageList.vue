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
        />
        <!-- Assistant timeline (unified) -->
        <AgentTimeline
          v-else
          :messages="group.messages"
          :loading="loading && group.id === messageGroups[messageGroups.length - 1]?.id"
        />
      </template>

      <div v-if="loading" class="typing-indicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed } from 'vue'
import type { Message } from '@/types'
import MessageItem from './MessageItem.vue'
import AgentTimeline from './AgentTimeline.vue'
import { MessageSquare } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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

onMounted(() => {
  if (messages.length > 0) {
    scrollToBottom()
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
  flex: 1;
  min-height: 0;
  padding: 16px 20px;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;
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

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}
</style>
