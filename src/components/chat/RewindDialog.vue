<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="show"
        class="rewind-dialog-overlay"
        @click.self="handleOverlayClick"
        role="dialog"
        :aria-label="t('chat.rewindTitle')"
      >
        <div class="rewind-dialog-content">
          <!-- 标题栏 -->
          <div class="rewind-dialog-header">
            <div class="rewind-dialog-title-row">
              <RotateCcw :size="18" class="rewind-icon" />
              <h3 class="rewind-dialog-title">{{ t('chat.rewindTitle') }}</h3>
            </div>
            <p class="rewind-dialog-subtitle">{{ t('chat.rewindSubtitle') }}</p>
          </div>

          <!-- 目标消息预览 -->
          <div v-if="selectedMessageId" class="message-preview">
            <span class="message-preview-label">{{ t('chat.rewindSelectMessage') }}</span>
            <span class="message-preview-content" :title="messageContent">
              {{ messageContent.length > 100 ? messageContent.slice(0, 100) + '...' : messageContent }}
            </span>
          </div>

          <!-- 变更预览 -->
          <div v-if="diffStats" class="diff-stats">
            <div class="diff-stats-header">
              <span class="diff-stats-title">{{ t('chat.rewindDiffStats') }}</span>
            </div>
            <div class="diff-stats-grid">
              <div class="diff-stat-item">
                <span class="diff-stat-value">{{ diffStats.filesChanged }}</span>
                <span class="diff-stat-label">{{ t('chat.rewindFilesChanged') }}</span>
              </div>
              <div class="diff-stat-item insertions">
                <span class="diff-stat-value">+{{ diffStats.insertions }}</span>
                <span class="diff-stat-label">{{ t('chat.rewindInsertions') }}</span>
              </div>
              <div class="diff-stat-item deletions">
                <span class="diff-stat-value">-{{ diffStats.deletions }}</span>
                <span class="diff-stat-label">{{ t('chat.rewindDeletions') }}</span>
              </div>
            </div>
          </div>

          <!-- 选项列表 -->
          <div class="rewind-options">
            <label
              v-for="option in options"
              :key="option.value"
              class="rewind-option"
              :class="{ active: selectedOption === option.value }"
              :for="`rewind-option-${option.value}`"
            >
              <input
                :id="`rewind-option-${option.value}`"
                type="radio"
                name="rewind-option"
                :value="option.value"
                :checked="selectedOption === option.value"
                @change="handleOptionChange(option.value)"
                :aria-label="option.label"
              />
              <div class="rewind-option-info">
                <span class="rewind-option-name">{{ option.label }}</span>
                <span v-if="option.description" class="rewind-option-desc">{{ option.description }}</span>
              </div>
            </label>
          </div>

          <!-- Summarize 输入框 -->
          <div v-if="selectedOption === 'summarize'" class="summarize-section">
            <label class="summarize-label" for="rewind-summarize-feedback">
              {{ t('chat.rewindSummarizeLabel') }}
            </label>
            <textarea
              id="rewind-summarize-feedback"
              class="summarize-textarea"
              :value="summarizeFeedback"
              @input="handleFeedbackInput"
              :placeholder="t('chat.rewindSummarizePlaceholder')"
              rows="3"
              :aria-label="t('chat.rewindSummarizeLabel')"
            />
          </div>

          <!-- 错误消息 -->
          <div v-if="error" class="rewind-error" role="alert">
            <span class="rewind-error-text">{{ error }}</span>
          </div>

          <!-- 加载状态 -->
          <div v-if="isRewinding" class="rewind-loading">
            <Loader2 :size="16" class="rewind-loading-icon" />
            <span class="rewind-loading-text">{{ t('chat.rewindInProgress') }}</span>
          </div>

          <!-- 底部按钮 -->
          <div class="rewind-dialog-footer">
            <button
              class="btn btn-secondary"
              @click="handleCancel"
              :disabled="isRewinding"
              :aria-label="t('chat.rewindCancel')"
            >
              {{ t('chat.rewindCancel') }}
            </button>
            <button
              v-if="selectedOption !== 'cancel'"
              class="btn btn-primary"
              @click="handleConfirm"
              :disabled="isRewinding || isConfirmDisabled"
              :aria-label="t('chat.rewindConfirm')"
            >
              <Loader2 v-if="isRewinding" :size="14" class="btn-loading-icon" />
              <span v-else>{{ t('chat.rewindConfirm') }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCcw, Loader2 } from 'lucide-vue-next'
import type { RewindOption, RewindDiffStats } from '@/types/rewind'

const { t } = useI18n()

const props = defineProps<{
  show: boolean
  selectedMessageId: string | null
  messageContent: string
  selectedOption: RewindOption
  summarizeFeedback: string
  isRewinding: boolean
  error: string | null
  diffStats: RewindDiffStats | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  'update:selectedOption': [value: RewindOption]
  'update:summarizeFeedback': [value: string]
  confirm: []
  cancel: []
}>()

const options = computed(() => [
  {
    value: 'both' as RewindOption,
    label: t('chat.rewindOptionBoth'),
    description: t('chat.rewindOptionBothDesc'),
  },
  {
    value: 'conversation' as RewindOption,
    label: t('chat.rewindOptionConversation'),
    description: t('chat.rewindOptionConversationDesc'),
  },
  {
    value: 'code' as RewindOption,
    label: t('chat.rewindOptionCode'),
    description: t('chat.rewindOptionCodeDesc'),
  },
  {
    value: 'summarize' as RewindOption,
    label: t('chat.rewindOptionSummarize'),
    description: t('chat.rewindOptionSummarizeDesc'),
  },
  {
    value: 'cancel' as RewindOption,
    label: t('chat.rewindOptionCancel'),
    description: '',
  },
])

const isConfirmDisabled = computed(() => {
  if (props.selectedOption === 'summarize') {
    return props.summarizeFeedback.trim().length === 0
  }
  return false
})

function handleOptionChange(option: RewindOption) {
  emit('update:selectedOption', option)
}

function handleFeedbackInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  emit('update:summarizeFeedback', target.value)
}

function handleConfirm() {
  if (isConfirmDisabled.value || props.isRewinding) return
  emit('confirm')
}

function handleCancel() {
  emit('cancel')
  emit('update:show', false)
}

function handleOverlayClick() {
  if (!props.isRewinding) {
    handleCancel()
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.show && !props.isRewinding) {
    handleCancel()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

// 当对话框打开时，确保默认选中 'both'
watch(() => props.show, (isShow) => {
  if (isShow) {
    emit('update:selectedOption', 'both')
    emit('update:summarizeFeedback', '')
  }
})
</script>

<style lang="scss" scoped>
.rewind-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.rewind-dialog-content {
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

.rewind-dialog-header {
  padding: 20px 20px 0;
}

.rewind-dialog-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rewind-icon {
  color: var(--accent-primary);
  flex-shrink: 0;
}

.rewind-dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.rewind-dialog-subtitle {
  font-size: 13px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.message-preview {
  margin: 16px 20px 0;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 4px;

  .message-preview-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .message-preview-id {
    font-size: 13px;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    word-break: break-all;
  }
}

.diff-stats {
  margin: 16px 20px 0;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);

  .diff-stats-header {
    margin-bottom: 8px;
  }

  .diff-stats-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .diff-stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .diff-stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px;
    background: var(--bg-primary);
    border-radius: var(--radius-sm);

    &.insertions .diff-stat-value {
      color: #22c55e;
    }

    &.deletions .diff-stat-value {
      color: #ef4444;
    }
  }

  .diff-stat-value {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .diff-stat-label {
    font-size: 11px;
    color: var(--text-muted);
  }
}

.rewind-options {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rewind-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
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

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.06);
  }

  input[type="radio"] {
    margin-top: 2px;
    flex-shrink: 0;
    accent-color: var(--accent-primary);
    cursor: pointer;
  }
}

.rewind-option-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.rewind-option-name {
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--text-primary);
}

.rewind-option-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.summarize-section {
  padding: 0 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summarize-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.summarize-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
  transition: border-color 0.15s ease;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  &::placeholder {
    color: var(--text-disabled);
  }
}

.rewind-error {
  margin: 0 20px 16px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-md);

  .rewind-error-text {
    font-size: 13px;
    color: #ef4444;
  }
}

.rewind-loading {
  margin: 0 20px 16px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);

  .rewind-loading-icon {
    color: var(--accent-primary);
    animation: spin 1s linear infinite;
  }

  .rewind-loading-text {
    font-size: 13px;
    color: var(--text-secondary);
  }
}

.rewind-dialog-footer {
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

.btn-primary {
  background: var(--accent-primary);
  color: white;

  &:hover:not(:disabled) {
    background: var(--accent-primary-hover);
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

.btn-loading-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

// 响应式布局
@media (max-width: 640px) {
  .rewind-dialog-overlay {
    padding: 12px;
  }

  .rewind-dialog-content {
    max-width: 90%;
  }

  .diff-stats-grid {
    grid-template-columns: 1fr !important;
  }

  .rewind-dialog-footer {
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
