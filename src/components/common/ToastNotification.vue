<template>
  <TransitionGroup name="toast" tag="div" class="toast-container">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="toast-item"
      :class="severityClass(toast.category)"
    >
      <AlertTriangle v-if="toast.category === 'rate_limit'" :size="14" class="toast-icon" />
      <AlertCircle v-else :size="14" class="toast-icon" />
      <div class="toast-body">
        <span class="toast-title">{{ toast.title }}</span>
        <span class="toast-message">{{ toast.message }}</span>
      </div>
      <button class="toast-close" @click="dismiss(toast.id)">
        <X :size="12" />
      </button>
    </div>
  </TransitionGroup>
</template>

<script setup lang="ts">
import { AlertTriangle, AlertCircle, X } from 'lucide-vue-next'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'

const toasts = errorHandler.toasts

function dismiss(id: string) {
  errorHandler.dismissToast(id)
}

function severityClass(category: ErrorCategory): string {
  if (category === ErrorCategory.RATE_LIMIT) return 'toast-warning'
  if (
    category === ErrorCategory.AUTH_ERROR ||
    category === ErrorCategory.CONFIG_ERROR ||
    category === ErrorCategory.BASE_URL_ERROR
  ) return 'toast-caution'
  return 'toast-error'
}
</script>

<style lang="scss" scoped>
.toast-container {
  position: absolute;
  top: 60px;
  right: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
  max-width: 340px;
}

.toast-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  pointer-events: auto;
  cursor: default;
}

.toast-error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.1);
  .toast-icon { color: #ef4444; }
}

.toast-warning {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.1);
  .toast-icon { color: #f59e0b; }
}

.toast-caution {
  border-color: rgba(249, 115, 22, 0.4);
  background: rgba(249, 115, 22, 0.1);
  .toast-icon { color: #f97316; }
}

.toast-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.toast-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toast-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.toast-message {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.toast-close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }
}

.toast-enter-active {
  transition: all 0.25s ease-out;
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
.toast-move {
  transition: transform 0.25s ease;
}
</style>
