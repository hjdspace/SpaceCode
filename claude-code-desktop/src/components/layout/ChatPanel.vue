<template>
  <main class="chat-panel">
    <div class="chat-header">
      <div class="header-left">
        <h2>{{ currentSession?.title || 'New Conversation' }}</h2>
      </div>
      <div class="header-actions">
        <span class="provider-badge" v-if="provider">
          <span class="badge-dot"></span>
          {{ provider.toUpperCase() }}
        </span>
        <span class="status-indicator" :class="{ configured: isConfigured }">
          <span class="status-dot"></span>
          <span class="status-text">{{ isConfigured ? 'Ready' : 'Not Configured' }}</span>
        </span>
      </div>
    </div>
    
    <MessageList 
      :messages="chatStore.currentMessages" 
      :loading="chatStore.isLoading"
    />
    
    <ChatInput 
      @send="handleSend" 
      :disabled="chatStore.isLoading"
      :is-sending="chatStore.isLoading"
      placeholder="Ask anything, @ to add files, / for commands"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useChatStore } from '@/stores/chat'
import MessageList from '../chat/MessageList.vue'
import ChatInput, { type Attachment } from '../chat/ChatInput.vue'
import { initLLMService, llmState } from '@/services/llm'

const chatStore = useChatStore()

const currentSession = computed(() => chatStore.currentSession)
const provider = computed(() => llmState.provider.value)
const isConfigured = computed(() => llmState.isConfigured.value)

onMounted(async () => {
  await initLLMService()
})

async function handleSend(content: string, attachments: Attachment[]) {
  if (!content.trim() && attachments.length === 0) return

  // 构建包含附件信息的消息内容
  let messageContent = content.trim()

  if (attachments.length > 0) {
    const attachmentInfo = attachments.map(att =>
      att.isFolder ? `[Folder: ${att.name}]` : `[File: ${att.name}]`
    ).join(', ')

    if (messageContent) {
      messageContent += `\n\nAttachments: ${attachmentInfo}`
    } else {
      messageContent = `Attachments: ${attachmentInfo}`
    }
  }

  await chatStore.sendMessage(messageContent)
}
</script>

<style lang="scss" scoped>
.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: transparent;
  position: relative;
  height: 100%;
}

.chat-header {
  height: 52px;
  flex-shrink: 0;
  padding: 0 24px;
  background: var(--surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--surface-border);
  @include flex-between;
  position: relative;
  
  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--surface-border);
  }
  
  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  h2 {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    @include truncate;
    max-width: 300px;
  }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.provider-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: var(--accent-primary);
  color: white;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  
  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: white;
    animation: pulse 2s ease-in-out infinite;
  }
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--error);
    box-shadow: 0 0 8px var(--error-glow);
    transition: all var(--transition-fast);
  }
  
  .status-text {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
  }
  
  &.configured {
    .status-dot {
      background: var(--success);
      box-shadow: 0 0 8px var(--success-glow);
    }
    
    .status-text {
      color: var(--success);
    }
  }
}
</style>
