<template>
  <div
    class="task-node-card"
    :class="[statusClass, { 'empty-draft': isEmptyDraft }]"
    @dblclick="onDblClick"
  >
    <!-- 输入端口（左侧 Handle） -->
    <Handle type="target" :position="Position.Left" />

    <!-- 头部 -->
    <div class="task-node-header">
      <span class="task-node-title">{{ t('orchestration.taskNode') }}</span>
      <!-- 状态徽标 -->
      <span v-if="status" class="task-node-badge" :class="`badge-${status}`">
        {{ t(`orchestration.status_${status}`) }}
      </span>
      <!-- 权限徽标 -->
      <span
        v-if="hasPendingPermission"
        class="task-node-perm-badge"
        :title="t('orchestration.permissionPending')"
        @click.stop="onDblClick"
      >
        <ShieldAlert :size="12" />
      </span>
      <!-- 停止按钮（running 时） -->
      <button
        v-if="status === 'running'"
        class="task-node-stop"
        :title="t('orchestration.stopNode')"
        @click.stop="onStopNode"
      >
        <SquareIcon :size="12" />
      </button>
      <!-- 重试按钮（failed / interrupted 时） -->
      <button
        v-if="status === 'failed' || status === 'interrupted'"
        class="task-node-retry"
        :title="t('orchestration.retryNode')"
        @click.stop="onRetryNode"
      >
        <RotateCcw :size="12" />
      </button>
      <button
        v-if="!isRunning"
        class="task-node-delete"
        :title="t('orchestration.deleteNode')"
        @click.stop="onRemove"
      >
        <X :size="14" />
      </button>
    </div>

    <!-- 草稿输入区（不发送、不触发引擎） -->
    <textarea
      class="task-node-draft-input"
      :value="draft"
      :placeholder="t('orchestration.draftPlaceholder')"
      :readonly="isReadOnly"
      @input="onDraftInput"
      @dblclick.stop
    ></textarea>

    <!-- 追加消息输入区（running 时） -->
    <form
      v-if="status === 'running'"
      class="task-node-add-msg"
      @click.stop
      @dblclick.stop
      @submit.prevent="onAddMessage"
    >
      <input
        v-model="addMsgInput"
        class="add-msg-input"
        :placeholder="t('orchestration.addMessagePlaceholder')"
        type="text"
      />
      <button
        class="add-msg-btn"
        type="submit"
        :disabled="!addMsgInput.trim()"
        :title="t('orchestration.addMessage')"
      >
        <Send :size="12" />
      </button>
    </form>

    <!-- 输出端口（右侧 Handle） -->
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, Square as SquareIcon, RotateCcw, ShieldAlert, Send } from 'lucide-vue-next'
import { Handle, Position } from '@vue-flow/core'
import type { NodeStatus } from '@/stores/orchestration/types'

const props = defineProps<{
  id: string
  data: {
    sessionId: string
    draft: string
    label?: string
  }
  status?: NodeStatus
  /** 运行中锁结构 — 为 true 时禁止删除节点 */
  isRunning?: boolean
  /** 空草稿标红 */
  isEmptyDraft?: boolean
  /** 节点有待处理权限请求 */
  hasPendingPermission?: boolean
}>()

const emit = defineEmits<{
  remove: [nodeId: string]
  openDrawer: [nodeId: string]
  updateDraft: [nodeId: string, draft: string]
  stopNode: [nodeId: string]
  retryNode: [nodeId: string]
  addMessage: [nodeId: string, content: string]
}>()

const { t } = useI18n()

const draft = computed(() => props.data?.draft ?? '')

/** 运行中或已终态时草稿只读；pending 状态可编辑 */
const isReadOnly = computed(() => {
  if (!props.status) return false
  return props.status === 'running' || props.status === 'settled' || props.status === 'failed' || props.status === 'interrupted'
})

const statusClass = computed(() => {
  if (!props.status) return ''
  return `status-${props.status}`
})

const addMsgInput = ref('')

function onRemove() {
  emit('remove', props.id)
}

function onDblClick() {
  emit('openDrawer', props.id)
}

function onDraftInput(e: Event) {
  const value = (e.target as HTMLTextAreaElement).value
  emit('updateDraft', props.id, value)
}

function onStopNode() {
  emit('stopNode', props.id)
}

function onRetryNode() {
  emit('retryNode', props.id)
}

function onAddMessage() {
  const content = addMsgInput.value.trim()
  if (!content) return
  emit('addMessage', props.id, content)
  addMsgInput.value = ''
}
</script>

<style lang="scss" scoped>
.task-node-card {
  width: 280px;
  background: var(--surface-glass, rgba(30, 30, 46, 0.95));
  border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.08));
  border-radius: 8px;
  overflow: hidden;
  font-family: inherit;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }

  // 状态样式
  &.status-running {
    border-color: var(--accent-primary, #6366f1);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary, #6366f1) 30%, transparent);
  }

  &.status-settled {
    border-color: color-mix(in srgb, #22c55e 60%, transparent);
  }

  &.status-failed {
    border-color: var(--danger, #ef4444);
    box-shadow: 0 0 8px color-mix(in srgb, var(--danger, #ef4444) 20%, transparent);
  }

  &.status-skipped {
    opacity: 0.5;
  }

  &.status-interrupted {
    border-color: #f59e0b;
    box-shadow: 0 0 8px color-mix(in srgb, #f59e0b 20%, transparent);
  }

  // 空草稿标红
  &.empty-draft {
    border-color: var(--danger, #ef4444);
    box-shadow: 0 0 6px color-mix(in srgb, var(--danger, #ef4444) 20%, transparent);
  }
}

.task-node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
  background: var(--surface-glass-hover, rgba(255, 255, 255, 0.04));
  border-bottom: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));
}

.task-node-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #888);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.task-node-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;

  &.badge-pending {
    color: var(--text-muted, #888);
    background: rgba(128, 128, 128, 0.15);
  }

  &.badge-running {
    color: #fff;
    background: var(--accent-primary, #6366f1);
    animation: pulse 1.5s ease-in-out infinite;
  }

  &.badge-settled {
    color: #fff;
    background: #22c55e;
  }

  &.badge-failed {
    color: #fff;
    background: var(--danger, #ef4444);
  }

  &.badge-skipped {
    color: var(--text-muted, #888);
    background: rgba(128, 128, 128, 0.2);
    text-decoration: line-through;
  }

  &.badge-interrupted {
    color: #fff;
    background: #f59e0b;
  }

  &.badge-queued {
    color: #fff;
    background: #f59e0b;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.task-node-perm-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 5px;
  border-radius: 4px;
  color: #f59e0b;
  background: color-mix(in srgb, #f59e0b 15%, transparent);
  cursor: pointer;
  animation: pulse 1.5s ease-in-out infinite;
}

.task-node-stop {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--danger, #ef4444);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
  }
}

.task-node-retry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--accent-primary, #6366f1);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: color-mix(in srgb, var(--accent-primary, #6366f1) 12%, transparent);
  }
}

.task-node-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-muted, #888);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--danger, #ef4444);
    background: color-mix(in srgb, var(--danger, #ef4444) 12%, transparent);
  }
}

.task-node-draft-input {
  width: 100%;
  height: 80px;
  padding: 8px 10px;
  border: none;
  outline: none;
  resize: none;
  font-size: 12px;
  font-family: inherit;
  color: var(--text-primary, #e0e0e0);
  background: transparent;
  line-height: 1.5;

  &::placeholder {
    color: var(--text-muted, #555);
  }

  &:read-only {
    cursor: default;
  }
}

.task-node-add-msg {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 6px;
  border-top: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));

  .add-msg-input {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.1));
    border-radius: 4px;
    font-size: 11px;
    font-family: inherit;
    color: var(--text-primary, #e0e0e0);
    background: var(--surface-glass, rgba(30, 30, 46, 0.6));
    outline: none;

    &::placeholder {
      color: var(--text-muted, #555);
    }

    &:focus {
      border-color: var(--accent-primary, #6366f1);
    }
  }

  .add-msg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 4px;
    color: var(--accent-primary, #6366f1);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover:not(:disabled) {
      background: color-mix(in srgb, var(--accent-primary, #6366f1) 12%, transparent);
    }

    &:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
  }
}
</style>
