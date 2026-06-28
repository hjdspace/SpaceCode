<template>
  <div class="retry-indicator" :class="severityClass">
    <div class="retry-icon">
      <component :is="headerIcon" :size="14" />
    </div>
    <div class="retry-body">
      <div class="retry-header">
        <span class="retry-title">{{ errorTitle }}</span>
        <span class="retry-badge">{{ t('errors.autoRetrying', { attempt: attempt, max: maxRetries }) }}</span>
      </div>
      <span class="retry-message">{{ errorMessage }}</span>
      <span class="retry-delay">{{ t('errors.retryingIn', { seconds: Math.ceil(delayMs / 1000) }) }}</span>
    </div>
    <button class="retry-cancel" @click="$emit('cancel')">
      <X :size="12" />
      <span>{{ t('errors.cancelRetry') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ErrorCategory } from '@/types'
import { AlertTriangle, AlertCircle, X } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps<{
  attempt: number
  maxRetries: number
  delayMs: number
  errorCategory: ErrorCategory
  errorTitle: string
  errorMessage: string
}>()

defineEmits<{
  cancel: []
}>()

const severityClass = computed(() => {
  if (props.errorCategory === ErrorCategory.RATE_LIMIT) return 'severity-warning'
  return 'severity-error'
})

const headerIcon = computed(() => {
  if (props.errorCategory === ErrorCategory.RATE_LIMIT) return AlertTriangle
  return AlertCircle
})
</script>

<style lang="scss" scoped>
.retry-indicator {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  margin: 4px 0;
  border-radius: var(--radius-md, 8px);
  border: 1px solid;
}

.severity-error {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.06);
  .retry-icon { color: #ef4444; }
}

.severity-warning {
  border-color: rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.06);
  .retry-icon { color: #f59e0b; }
}

.retry-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-top: 1px;
}

.retry-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.retry-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.retry-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.retry-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  color: var(--accent-primary);
  white-space: nowrap;
}

.retry-message {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);
}

.retry-delay {
  font-size: 11px;
  color: var(--text-muted);
}

.retry-cancel {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-sm, 4px);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--surface-border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  transition: all 0.15s ease;
  flex-shrink: 0;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}
</style>
