  <template>
  <div v-if="messages.length > 0" class="pending-messages-bar">
    <div
      v-for="msg in messages"
      :key="msg.id"
      class="pending-message-item"
      :class="{ 'pending-later': msg.priority === 'later' }"
    >
      <Clock :size="14" class="pending-icon" />
      <span class="pending-text">{{ msg.displayLabel || msg.content }}</span>
      <span class="pending-priority-tag">{{ msg.priority === 'later' ? t('chatInput.priorityLater') : t('chatInput.priorityNow') }}</span>
      <button class="pending-action-btn" @click="emit('send-now', msg.id)" :title="t('chatInput.sendPendingNow')">
        <ArrowUp :size="14" />
      </button>
      <button class="pending-action-btn" @click="emit('recall', msg.id)" :title="t('chatInput.recallPending')">
        <ArrowDown :size="14" />
      </button>
      <button class="pending-action-btn" @click="emit('remove', msg.id)" :title="t('chatInput.removePending')">
        <X :size="14" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 待发送队列条：AI 回复期间排好的消息，可立即插话、召回到输入框或直接丢弃。
 *
 * 只做展示与三个动作事件 —— 队列的归属会话、召回后如何写回编辑器都由宿主决定，
 * 因为分屏与侧边任务会同时存在多个输入框，寻址规则属于宿主而不是这条列表。
 */
import { ArrowDown, ArrowUp, Clock, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { PendingMessage } from '@/stores/turn/types'

defineProps<{ messages: PendingMessage[] }>()

const emit = defineEmits<{
  'send-now': [id: string]
  recall: [id: string]
  remove: [id: string]
}>()

const { t } = useI18n()
</script>

<style lang="scss" scoped>
// Pending Messages Bar
.pending-messages-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 20px 8px;
}

.pending-message-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-secondary);
  border: 1px dashed var(--accent-primary);
  border-radius: var(--radius-md);
  font-size: var(--text-md);
  color: var(--text-secondary);
  opacity: 0.85;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 1;
  }

  .pending-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .pending-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pending-priority-tag {
    font-size: var(--text-2xs);
    font-weight: 600;
    padding: 2px 6px;
    border-radius: var(--radius-xs);
    white-space: nowrap;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  &.pending-later .pending-priority-tag {
    color: #6366f1;
    background: color-mix(in srgb, var(--accent-secondary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-secondary) 20%, transparent);
  }

  &:not(.pending-later) .pending-priority-tag {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.2);
  }

  .pending-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--transition-fast);

    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  }
}
</style>
