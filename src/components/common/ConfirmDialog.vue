<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="confirm-overlay"
        @click.self="handleCancel"
        role="dialog"
        aria-modal="true"
        @keydown.escape="handleCancel"
      >
        <div class="confirm-content">
          <div v-if="title" class="confirm-header">
            <h3 class="confirm-title">{{ title }}</h3>
          </div>
          <p class="confirm-message">{{ message }}</p>
          <div class="confirm-actions">
            <button class="confirm-btn cancel" @click="handleCancel">
              {{ cancelText || t('common.cancel') }}
            </button>
            <button
              class="confirm-btn"
              :class="variantClass"
              @click="handleConfirm"
            >
              {{ confirmText || t('common.confirm') }}
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

const props = withDefaults(defineProps<{
  visible: boolean
  message: string
  title?: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'default'
}>(), {
  variant: 'default',
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()

const variantClass = computed(() => {
  if (props.variant === 'danger') return 'danger'
  if (props.variant === 'warning') return 'warning'
  return 'primary'
})

function handleConfirm() {
  emit('confirm')
}

function handleCancel() {
  emit('cancel')
}
</script>

<style lang="scss" scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.confirm-content {
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  padding: 24px;
  max-width: 420px;
  width: 90%;
  box-shadow: var(--shadow-xl);
}

.confirm-header {
  margin-bottom: 12px;
}

.confirm-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.confirm-message {
  font-size: var(--font-size-base);
  color: var(--text-secondary);
  margin: 0 0 20px 0;
  line-height: 1.6;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.confirm-btn {
  padding: 8px 20px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
  border: none;

  &.cancel {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border-default);

    &:hover {
      background: var(--bg-tertiary);
    }
  }

  &.primary {
    background: var(--accent-primary);
    color: #fff;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }

  &.danger {
    background: var(--error);
    color: #fff;

    &:hover {
      opacity: 0.9;
    }
  }

  &.warning {
    background: var(--warning);
    color: #fff;

    &:hover {
      opacity: 0.9;
    }
  }
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
