<template>
  <div class="message-list" ref="listRef" :class="{ 'has-messages': messages.length > 0 || loading }">
    <div class="messages-container">
      <div v-if="messages.length === 0 && !loading" class="empty-state">        
        <MessageSquare :size="48" />
        <p>Start a conversation</p>
        <span>Type a message to begin working with Claude Code</span>
      </div>

      <MessageItem
        v-for="message in messages"
        :key="message.id"
        :message="message"
      />

      <div v-if="loading" class="typing-indicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { Message } from '@/types'
import MessageItem from './MessageItem.vue'
import { MessageSquare } from 'lucide-vue-next'

const { messages, loading } = defineProps<{
  messages: Message[]
  loading: boolean
}>()

const listRef = ref<HTMLElement | null>(null)

watch(() => [messages, loading], () => {
  nextTick(() => {
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight
    }
  })
}, { deep: true })
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
  min-height: 300px;

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
