<template>
  <div class="error-card" :class="severityClass">
    <div class="error-header">
      <component :is="headerIcon" :size="16" class="error-icon" />
      <span class="error-title">{{ error.title }}</span>
    </div>
    <p class="error-message">{{ error.message }}</p>
    <button
      v-if="error.technicalDetail"
      class="detail-toggle"
      @click="showDetail = !showDetail"
    >
      <ChevronDown :size="12" class="toggle-chevron" :class="{ expanded: showDetail }" />
      <span>{{ t('errors.technicalDetail') }}</span>
    </button>
    <div v-if="showDetail" class="error-detail">
      <pre>{{ error.technicalDetail }}</pre>
    </div>
    <div class="error-actions">
      <button v-if="error.retryable" class="action-btn retry-btn" @click="$emit('retry')">
        <RefreshCw :size="12" />
        <span>{{ t('errors.retry') }}</span>
      </button>
      <button class="action-btn dismiss-btn" @click="$emit('dismiss')">
        <X :size="12" />
        <span>{{ t('errors.dismiss') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ClassifiedError } from '@/types'
import { ErrorCategory } from '@/types'
import { AlertTriangle, AlertCircle, X, RefreshCw, ChevronDown } from 'lucide-vue-next'

const { t } = useI18n()

const props = defineProps<{
  error: ClassifiedError
}>()

defineEmits<{
  retry: []
  dismiss: []
}>()

const showDetail = ref(false)

const severityClass = computed(() => {
  if (props.error.category === ErrorCategory.RATE_LIMIT) return 'severity-warning'
  if (
    props.error.category === ErrorCategory.AUTH_ERROR ||
    props.error.category === ErrorCategory.CONFIG_ERROR ||
    props.error.category === ErrorCategory.BASE_URL_ERROR
  ) return 'severity-caution'
  return 'severity-error'
})

const headerIcon = computed(() => {
  if (props.error.category === ErrorCategory.RATE_LIMIT) return AlertTriangle
  return AlertCircle
})
</script>

<style lang="scss" scoped>
.error-card {
  margin: 8px 0;
  padding: 12px 14px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid;
}

.severity-error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.06);
  .error-icon { color: #ef4444; }
}

.severity-warning {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.06);
  .error-icon { color: #f59e0b; }
}

.severity-caution {
  border-color: rgba(249, 115, 22, 0.4);
  background: rgba(249, 115, 22, 0.06);
  .error-icon { color: #f97316; }
}

.error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.error-icon {
  flex-shrink: 0;
}

.error-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.error-message {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin: 0 0 8px;
}

.detail-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
  margin-bottom: 6px;

  &:hover { color: var(--text-secondary); }
}

.toggle-chevron {
  transition: transform 0.15s ease;
  &.expanded { transform: rotate(180deg); }
}

.error-detail {
  margin-bottom: 8px;
  pre {
    margin: 0;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-family: var(--font-mono);
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--bg-secondary);
    color: var(--text-muted);
    border: 1px solid var(--surface-border);
    max-height: 150px;
    overflow-y: auto;
  }
}

.error-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
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

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.retry-btn {
  border-color: color-mix(in srgb, var(--accent-secondary) 30%, transparent);
  color: var(--accent-primary);

  &:hover {
    background: color-mix(in srgb, var(--accent-secondary) 10%, transparent);
  }
}
</style>
