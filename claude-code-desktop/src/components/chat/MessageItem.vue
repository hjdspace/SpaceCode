<template>
  <div class="message-item" :class="[message.role]">
    <div class="message-avatar">
      <User v-if="message.role === 'user'" :size="16" />
      <Bot v-else :size="16" />
    </div>
    
    <div class="message-body">
      <div class="message-header">
        <span class="role-label">{{ message.role === 'user' ? 'You' : 'Claude' }}</span>
        <span class="timestamp">{{ formatTime(message.timestamp) }}</span>
      </div>
      
      <!-- 思考过程 -->
      <ReasoningCard v-if="message.reasoning" :reasoning="message.reasoning" />
      
      <!-- 工具调用 -->
      <ToolCallList v-if="message.toolCalls?.length" :tool-calls="message.toolCalls" />
      
      <!-- 消息内容 -->
      <div class="message-content">
        <MarkdownRenderer 
          v-if="message.role === 'assistant'" 
          :content="message.content" 
        />
        <p v-else>{{ message.content }}</p>
      </div>
      
      <!-- 元数据 -->
      <MessageMetadata v-if="message.role === 'assistant'" :metadata="message.metadata" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Message } from '@/types'
import { User, Bot } from 'lucide-vue-next'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import ReasoningCard from './ReasoningCard.vue'
import ToolCallList from './ToolCallList.vue'
import MessageMetadata from './MessageMetadata.vue'

defineProps<{
  message: Message
}>()

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })    
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
      background: var(--accent-primary);
      color: white;
      border-radius: var(--radius-lg);
      padding: 12px 16px;
      
      p {
        color: white;
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

.message-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);

  p {
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
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
