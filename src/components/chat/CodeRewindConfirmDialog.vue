<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div
        v-if="show"
        class="code-rewind-confirm-overlay"
        @click.self="handleCancel"
        role="dialog"
        :aria-label="'代码回滚确认'"
        @keydown.escape="handleCancel"
      >
        <div class="code-rewind-confirm-content">
          <!-- 标题栏 -->
          <div class="confirm-header">
            <AlertTriangle :size="20" class="warning-icon" />
            <h3 class="confirm-title">代码回滚确认</h3>
          </div>

          <!-- 提示信息 -->
          <p class="confirm-message">
            以下文件将被恢复到之前的状态：
          </p>

          <!-- 文件列表 -->
          <div class="file-list">
            <div
              v-for="(file, index) in files"
              :key="index"
              class="file-item"
            >
              <FileText :size="16" class="file-icon" />
              <span class="file-path">{{ file }}</span>
            </div>
          </div>

          <!-- 警告提示 -->
          <div v-if="files.length > 0" class="warning-text">
            ⚠️ 此操作不可撤销，请确认要继续吗？
          </div>

          <!-- 按钮组 -->
          <div class="confirm-actions">
            <button
              class="cancel-button"
              @click="handleCancel"
              :disabled="isLoading"
            >
              取消
            </button>
            <button
              class="confirm-button primary"
              @click="handleConfirm"
              :disabled="isLoading || files.length === 0"
            >
              {{ isLoading ? '处理中...' : '确认回滚' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { AlertTriangle, FileText } from 'lucide-vue-next'

interface Props {
  show: boolean
  files: string[]
  isLoading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isLoading: false
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function handleConfirm() {
  emit('confirm')
}

function handleCancel() {
  emit('cancel')
}
</script>

<style scoped>
.code-rewind-confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.code-rewind-confirm-content {
  background: var(--bg-primary, #ffffff);
  border-radius: 12px;
  padding: 24px;
  max-width: 480px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  border: 1px solid var(--border-color, #e5e7eb);
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.warning-icon {
  color: #f59e0b;
  flex-shrink: 0;
}

.confirm-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #111827);
  margin: 0;
}

.confirm-message {
  font-size: 14px;
  color: var(--text-secondary, #6b7280);
  margin: 0 0 16px 0;
  line-height: 1.5;
}

.file-list {
  background: var(--bg-secondary, #f9fafb);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--border-color, #e5e7eb);
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-primary, #111827);
  font-family: 'Consolas', 'Monaco', monospace;
}

.file-item:not(:last-child) {
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.file-icon {
  color: var(--text-tertiary, #9ca3af);
  flex-shrink: 0;
}

.file-path {
  word-break: break-all;
}

.warning-text {
  font-size: 13px;
  color: #f59e0b;
  margin-bottom: 20px;
  text-align: center;
  font-weight: 500;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.cancel-button,
.confirm-button {
  padding: 10px 24px;
  border-radius: 8px;
  font-size: var(--font-size-base);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  outline: none;
}

.cancel-button {
  background: var(--bg-secondary, #f9fafb);
  color: var(--text-primary, #111827);
  border: 1px solid var(--border-color, #e5e7eb);
}

.cancel-button:hover:not(:disabled) {
  background: var(--bg-tertiary, #f3f4f6);
}

.confirm-button.primary {
  background: #ef4444;
  color: white;
}

.confirm-button.primary:hover:not(:disabled) {
  background: #dc2626;
}

.confirm-button:disabled,
.cancel-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Transition */
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
