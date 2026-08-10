<script setup lang="ts">
/**
 * Skill Manager V2 — Preview Dialog
 *
 * Generic confirmation/preview dialog with title, content slot, confirm/cancel.
 * Supports busy state and destructive styling.
 * Reference: AgentBro `src/components/skills-v2/PreviewDialog.tsx`
 */

import { useI18n } from 'vue-i18n'

defineProps<{
  title: string
  visible: boolean
  busy?: boolean
  destructive?: boolean
  confirmLabel?: string
  cancelLabel?: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()

function handleConfirm(): void {
  emit('confirm')
}

function handleCancel(): void {
  emit('cancel')
}
</script>

<template>
  <div v-if="visible" class="preview-dialog-overlay" @click.self="handleCancel">
    <div class="preview-dialog">
      <header class="pd-header">
        <h2 class="pd-title">{{ title }}</h2>
        <button class="pd-close" :disabled="busy" @click="handleCancel">×</button>
      </header>

      <main class="pd-body">
        <slot />
      </main>

      <footer class="pd-footer">
        <button
          class="pd-btn pd-btn-cancel"
          :disabled="busy"
          @click="handleCancel"
        >
          {{ cancelLabel ?? t('skillManagerV2.actions.cancel') }}
        </button>
        <button
          class="pd-btn pd-btn-confirm"
          :class="{ destructive }"
          :disabled="busy"
          @click="handleConfirm"
        >
          {{ busy ? t('skillManagerV2.loading') : (confirmLabel ?? t('skillManagerV2.actions.confirm')) }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped lang="scss">
.preview-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.preview-dialog {
  background: var(--bg-primary, #1e1e1e);
  border: 1px solid var(--border-color, #333);
  border-radius: 8px;
  min-width: 400px;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.pd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #333);
}

.pd-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.pd-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.pd-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.pd-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color, #333);
}

.pd-btn {
  padding: 8px 20px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 13px;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:hover:not(:disabled) {
    background: var(--bg-hover, #2a2a2a);
  }
}

.pd-btn-confirm {
  background: var(--accent-color, #007acc);
  border-color: var(--accent-color, #007acc);
  color: #fff;

  &.destructive {
    background: var(--error-color, #f48771);
    border-color: var(--error-color, #f48771);
  }

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
}
</style>
