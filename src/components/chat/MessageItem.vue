<template>
  <div class="message-item" :class="[message.role]">
    <div class="message-avatar">
      <User v-if="message.role === 'user'" :size="16" />
      <Bot v-else :size="16" />
    </div>
    
    <div class="message-body">
      <div class="message-header">
        <span class="role-label">{{ message.role === 'user' ? t('chat.you') : t('chat.claude') }}</span>
        <span class="timestamp">{{ formatTime(message.timestamp) }}</span>
      </div>
      
      <!-- 图片附件 -->
      <div v-if="message.imageAttachments?.length" class="image-attachments">
        <div 
          v-for="img in message.imageAttachments" 
          :key="img.id"
          class="image-attachment"
        >
          <img :src="img.previewUrl" :alt="img.name" @click="showImagePreview(img)" />
          <span class="image-name">{{ img.name }}</span>
        </div>
      </div>
      
      <!-- 思考过程 -->
      <ReasoningCard v-if="message.reasoning" :reasoning="message.reasoning" />
      
      <!-- 工具调用 -->
      <ToolCallList 
        v-if="message.toolCalls?.length" 
        :tool-calls="message.toolCalls"
        @tool-submit="handleToolSubmit"
        @tool-skip="handleToolSkip"
      />
      
      <!-- 消息内容 -->
      <div class="message-content" v-if="message.content">
        <MarkdownRenderer 
          v-if="message.role === 'assistant'" 
          :content="message.content" 
        />
        <p v-else class="user-text" v-html="renderedUserContent"></p>
      </div>
      
      <!-- 元数据 -->
      <MessageMetadata v-if="message.role === 'assistant' && message.metadata" :metadata="message.metadata" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Message, ImageAttachment } from '@/types'
import { User, Bot } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import ReasoningCard from './ReasoningCard.vue'
import ToolCallList from './ToolCallList.vue'
import MessageMetadata from './MessageMetadata.vue'
import { renderMentionChipsToHtml } from '@/utils/mention-chips'

const { t } = useI18n()

const props = defineProps<{
  message: Message
}>()

const emit = defineEmits<{
  toolSubmit: [messageId: string, toolId: string, answers: Record<string, string>]
  toolSkip: [messageId: string, toolId: string]
}>()

const renderedUserContent = computed(() =>
  renderMentionChipsToHtml(props.message.content || '')
)

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })    
}

function showImagePreview(img: ImageAttachment) {
  window.open(img.previewUrl, '_blank')
}

function handleToolSubmit(toolId: string, answers: Record<string, string>) {
  emit('toolSubmit', props.message.id, toolId, answers)
}

function handleToolSkip(toolId: string) {
  emit('toolSkip', props.message.id, toolId)
}
</script>

<style lang="scss" scoped>
.message-item {
  display: flex;
  gap: 12px;
  padding: 16px 0;

  & + .message-item {
    border-top: 1px solid var(--surface-border);
  }

  &.user {
    flex-direction: row-reverse;
    
    .message-avatar {
      background: var(--accent-primary);
      color: white;
    }
    
    .message-body {
      align-items: flex-end;
    }
    
    .message-header {
      flex-direction: row-reverse;
    }
    
    .message-content {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border-radius: var(--radius-lg);
      padding: 12px 16px;
      border: 1px solid var(--surface-border);
      
      p {
        color: var(--text-primary);
      }
    }
  }

  &.assistant {
    .message-avatar {
      background: var(--surface-glass);
      color: var(--accent-primary);
      border: 1px solid var(--surface-border);
    }
  }
}

.message-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  @include flex-center;
  flex-shrink: 0;
}

.message-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  .role-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .timestamp {
    font-size: 11px;
    color: var(--text-muted);
  }
}

.image-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.image-attachment {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 4px;
  cursor: pointer;
  transition: border-color 0.2s ease;

  &:hover {
    border-color: var(--accent-primary);
  }

  img {
    max-width: 120px;
    max-height: 120px;
    border-radius: 4px;
    object-fit: cover;
  }

  .image-name {
    font-size: 11px;
    color: var(--text-muted);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.message-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  user-select: text;

  p {
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    user-select: text;
  }

  // Inline mention chips inside user-authored messages.
  :deep(.mention-chip) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    margin: 0 2px;
    background: var(--bg-secondary);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.4;
    vertical-align: baseline;
    white-space: nowrap;

    .chip-icon {
      font-size: 12px;
      line-height: 1;
      flex-shrink: 0;
    }

    .chip-name {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &.is-folder {
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
      border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.3);
      color: var(--accent-primary);
    }
  }
}

// 响应式布局
@media (max-width: 768px) {
  .message-item {
    gap: 8px;
    padding: 12px 0;
  }

  .message-avatar {
    width: 24px;
    height: 24px;
  }

  .message-content {
    font-size: 14px;
  }

  .message-header {
    margin-bottom: 4px;

    .role-label {
      font-size: 12px;
    }

    .timestamp {
      font-size: 10px;
    }
  }
}
</style>
