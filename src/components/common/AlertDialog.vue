<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="visible"
        class="alert-overlay"
        @click.self="handleClose"
        role="dialog"
        aria-modal="true"
        @keydown.escape="handleClose"
      >
        <div class="alert-content">
          <div v-if="title" class="alert-header">
            <h3 class="alert-title">{{ title }}</h3>
          </div>
          <p class="alert-message">{{ message }}</p>
          <div class="alert-actions">
            <button class="alert-btn" @click="handleClose">
              {{ t('common.close') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  visible: boolean
  message: string
  title?: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()

function handleClose() {
  emit('close')
}
</script>

<style lang="scss" scoped>
.alert-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.alert-content {
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  padding: 24px;
  max-width: 420px;
  width: 90%;
  box-shadow: var(--shadow-xl);
}

.alert-header {
  margin-bottom: 12px;
}

.alert-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.alert-message {
  font-size: var(--font-size-base);
  color: var(--text-secondary);
  margin: 0 0 20px 0;
  line-height: 1.6;
}

.alert-actions {
  display: flex;
  justify-content: flex-end;
}

.alert-btn {
  padding: 8px 20px;
  border-radius: var(--radius-md);
  background: var(--accent-primary);
  color: #fff;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--transition-fast);

  &:hover {
    background: var(--accent-primary-hover);
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
