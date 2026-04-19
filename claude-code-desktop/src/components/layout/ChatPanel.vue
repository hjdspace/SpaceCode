<template>
  <main class="chat-panel">
    <div class="chat-header">
      <div class="header-left">
        <h2>{{ currentSession?.title || 'New Conversation' }}</h2>
      </div>
      <div class="header-actions">
        <span class="model-badge" v-if="currentModel" :title="currentModel">
          <span class="badge-dot"></span>
          {{ formatModelName(currentModel) }}
        </span>
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
      @update:model="handleModelChange"
      :disabled="chatStore.isLoading"
      :is-sending="chatStore.isLoading"
      :model-value="currentModel"
      placeholder="Ask anything, @ to add files, / for commands"
    />
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import MessageList from '../chat/MessageList.vue'
import ChatInput, { type Attachment } from '../chat/ChatInput.vue'
import { initLLMService, llmState, updateConfig } from '@/services/llm'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()

const currentSession = computed(() => chatStore.currentSession)
const provider = computed(() => llmState.provider.value)
const isConfigured = computed(() => llmState.isConfigured.value)

// 当前选中的模型
const currentModel = ref('')

// 初始化时从 settings 加载模型
onMounted(async () => {
  await initLLMService()
  currentModel.value = settingsStore.config.model || ''
})

// 监听 settings 变化同步模型
watch(() => settingsStore.config.model, (newModel) => {
  if (newModel && newModel !== currentModel.value) {
    currentModel.value = newModel
  }
})

// 处理模型变更 - 同步到 Agent 系统
function handleModelChange(model: string) {
  currentModel.value = model
  
  // 同步到 settings store
  const config = settingsStore.config
  switch (settingsStore.authMethod) {
    case 'anthropic_compatible':
      settingsStore.anthropicConfig.sonnetModel = model
      break
    case 'openai_compatible':
      settingsStore.openaiConfig.sonnetModel = model
      break
    case 'gemini_api':
      settingsStore.geminiConfig.sonnetModel = model
      break
  }
  settingsStore.saveSettings()
  
  // 同步到 LLM 服务
  updateConfig({
    provider: config.provider as any,
    apiKey: config.apiKey || '',
    baseUrl: config.apiUrl,
    model: model
  })
  
  console.log('[ChatPanel] Model changed to:', model)
}

// 格式化模型名称显示
function formatModelName(model: string): string {
  if (!model) return ''
  // 如果名称太长，截断显示
  if (model.length > 25) {
    return model.slice(0, 22) + '...'
  }
  return model
}

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
  gap: 8px;
}

.model-badge,
.provider-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.model-badge {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--surface-border);
  max-width: 150px;
  
  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
  }
}

.provider-badge {
  background: var(--accent-primary);
  color: white;
  
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

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
