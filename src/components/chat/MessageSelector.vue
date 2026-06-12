<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="show"
        class="message-selector-overlay"
        @click.self="handleOverlayClick"
        role="dialog"
        :aria-label="t('chat.rewindSelectMessage')"
      >
        <div class="message-selector-content">
          <!-- 标题栏 -->
          <div class="message-selector-header">
            <h3 class="message-selector-title">{{ t('chat.rewindSelectMessage') }}</h3>
          </div>

          <!-- 消息列表 -->
          <div class="message-list" role="listbox" :aria-label="t('chat.rewindSelectMessage')">
            <template v-if="userMessages.length > 0">
              <div
                v-for="message in userMessages"
                :key="message.id"
                class="message-item"
                :class="{ selected: selectedMessageId === message.id }"
                role="option"
                :aria-selected="selectedMessageId === message.id"
                @click="handleSelect(message.id)"
              >
                <span class="message-preview">{{ formatMessagePreview(message.content) }}</span>
                <span class="message-time">{{ formatRelativeTime(message.timestamp) }}</span>
              </div>
            </template>

            <!-- 空状态 -->
            <div v-else class="message-empty">
              <span class="message-empty-text">{{ t('chat.rewindNoMessages') }}</span>
            </div>
          </div>

          <!-- 底部按钮 -->
          <div class="message-selector-footer">
            <button
              class="btn btn-secondary"
              @click="handleCancel"
              :aria-label="t('common.cancel')"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  show: boolean
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }>
  selectedMessageId: string | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  select: [messageId: string]
  cancel: []
}>()

const MAX_PREVIEW_LENGTH = 80

const userMessages = computed(() => {
  return props.messages.filter((m) => m.role === 'user')
})

function formatMessagePreview(content: string): string {
  if (content.length <= MAX_PREVIEW_LENGTH) {
    return content
  }
  return content.slice(0, MAX_PREVIEW_LENGTH) + '...'
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) {
    return t('time.justNow')
  }
  if (diffMin < 60) {
    return t('time.minutesAgo', { count: diffMin })
  }
  if (diffHour < 24) {
    return t('time.hoursAgo', { count: diffHour })
  }
  if (diffDay < 30) {
    return t('time.daysAgo', { count: diffDay })
  }
  return t('time.longAgo')
}

function handleSelect(messageId: string) {
  emit('select', messageId)
}

function handleCancel() {
  emit('cancel')
  emit('update:show', false)
}

function handleOverlayClick() {
  handleCancel()
}
</script>

<style lang="scss" scoped>
.message-selector-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.message-selector-content {
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  @include scrollbar-thin;
}

.message-selector-header {
  padding: 20px 20px 0;
}

.message-selector-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.message-list {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  max-height: 60vh;
}

.message-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;

  &:hover {
    border-color: var(--accent-primary);
    background: var(--surface-hover);
  }

  &.selected {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.06);
  }
}

.message-preview {
  font-size: 14px;
  color: var(--text-primary);
  line-height: 1.4;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-time {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.message-empty {
  padding: 32px 20px;
  text-align: center;
}

.message-empty-text {
  font-size: var(--font-size-base);
  color: var(--text-muted);
}

.message-selector-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 20px 20px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-secondary {
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  color: var(--text-primary);

  &:hover:not(:disabled) {
    background: var(--surface-hover);
  }
}

// 响应式布局
@media (max-width: 640px) {
  .message-selector-overlay {
    padding: 12px;
  }

  .message-selector-content {
    max-width: 90%;
  }

  .message-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .message-selector-footer {
    flex-direction: column;

    .btn {
      width: 100%;
      justify-content: center;
    }
  }
}

// 对话框过渡动画
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
