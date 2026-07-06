<template>
  <div class="retry-indicator" :class="severityClass">
    <Loader2 :size="12" class="spin-icon" />
    <span class="retry-text">
      {{ t('errors.apiErrorPrefix') }}：{{ displayErrorCode }}...
      <span class="retry-badge">{{ t('errors.reconnecting', { attempt: attempt, max: maxRetries }) }}</span>
    </span>
    <button
      class="retry-cancel"
      @click="$emit('cancel')"
      :title="t('errors.cancelRetry')"
      :aria-label="t('errors.cancelRetry')"
    >
      <X :size="12" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ErrorCategory } from '@/types'
import { Loader2, X } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps<{
  attempt: number
  maxRetries: number
  delayMs: number
  errorCategory: ErrorCategory
  errorTitle: string
  errorCode?: string
}>()

defineEmits<{
  cancel: []
}>()

const severityClass = computed(() => {
  if (props.errorCategory === ErrorCategory.RATE_LIMIT) return 'severity-warning'
  return 'severity-error'
})

const displayErrorCode = computed(() => {
  if (!props.errorCode) return t('errors.unknownError')
  // HTTP status codes (e.g. "429", "500") are displayed as-is
  if (/^\d{3}$/.test(props.errorCode)) return props.errorCode
  // Otherwise treat as i18n key suffix under errors namespace
  return t(`errors.${props.errorCode}`)
})
</script>

<style lang="scss" scoped>
.retry-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin: 6px 0;
  border-radius: var(--radius-md, 8px);
  border: 1px solid;
  font-size: 12px;
  line-height: 1.4;
}

.severity-error {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.06);
}

.severity-warning {
  border-color: rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.06);
}

.spin-icon {
  flex-shrink: 0;
  color: var(--text-muted);
  animation: spin 1s linear infinite;
}

.retry-text {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.retry-badge {
  color: var(--text-muted);
  margin-left: 2px;
}

.retry-cancel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--text-muted);
  transition: all 0.15s ease;
  flex-shrink: 0;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
