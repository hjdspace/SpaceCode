<template>
  <div
    class="task-node-card"
    @dblclick="onDblClick"
  >
    <!-- 输入端口（左侧 Handle） -->
    <Handle type="target" :position="Position.Left" />

    <!-- 头部 -->
    <div class="task-node-header">
      <span class="task-node-title">{{ t('orchestration.taskNode') }}</span>
      <button
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
      @input="onDraftInput"
      @dblclick.stop
    ></textarea>

    <!-- 输出端口（右侧 Handle） -->
    <Handle type="source" :position="Position.Right" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
  id: string
  data: {
    sessionId: string
    draft: string
    label?: string
  }
}>()

const emit = defineEmits<{
  remove: [nodeId: string]
  openDrawer: [nodeId: string]
  updateDraft: [nodeId: string, draft: string]
}>()

const { t } = useI18n()

const draft = computed(() => props.data?.draft ?? '')

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
}

.task-node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
}
</style>
