<template>
  <div class="ticket-entry" :data-testid="`super-agent-ticket-entry-${card.ticketId}`">
    <WorkerTaskCard
      :card="card"
      compact
      :progress="progress"
      @open="emit('open', $event)"
      @accept="emit('accept', $event)"
      @stop="emit('stop', $event)"
      @retry="emit('retry', $event)"
      @message="emit('message', $event)"
    />
    <AttentionBubble
      v-for="bubble in attentions ?? []"
      :key="bubble.attentionId"
      :attention="bubble"
    />
    <!-- 待验收超时提醒（T10 #80）：跟着本工单卡片出现在时间线里，点击只打开只读标签 -->
    <div
      v-if="reviewReminder"
      class="review-reminder-bubble"
      role="button"
      tabindex="0"
      :data-testid="`super-agent-review-reminder-${card.ticketId}`"
      @click="emit('open', card.ticketId)"
      @keydown.enter.prevent="emit('open', card.ticketId)"
    >
      <AlarmClockCheck class="reminder-icon" :size="14" />
      <span>{{ t('superAgent.review.reminderHint', { title: reviewReminder.title }) }}</span>
      <span class="reminder-open">{{ t('superAgent.review.openTicket') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 时间线里的一个工单位（设计 §10.3）：卡片 + 该工单的 Worker 提问 + 待验收超时提醒。
 *
 * 三者都以 ticketId 为身份，随卡片一起挂在派工那条助手回复下方，不再堆在页面顶部；
 * 计数由侧边栏入口徽章承担。动作事件原样透传给 SuperAgentView，由它委托 store 落库。
 */
import { useI18n } from 'vue-i18n'
import { AlarmClockCheck } from 'lucide-vue-next'
import type {
  SuperAgentAttentionView,
  SuperAgentTicketCard,
  SuperAgentTicketProgress,
} from '@/shared/channels/superAgent'
import type { SuperAgentReviewReminderItem } from '@/stores/superAgent'
import WorkerTaskCard from './WorkerTaskCard.vue'
import AttentionBubble from './AttentionBubble.vue'

defineProps<{
  card: SuperAgentTicketCard
  progress?: SuperAgentTicketProgress | null
  attentions?: SuperAgentAttentionView[]
  reviewReminder?: SuperAgentReviewReminderItem | null
}>()

const emit = defineEmits<{
  open: [ticketId: string]
  accept: [ticketId: string]
  stop: [ticketId: string]
  retry: [ticketId: string]
  message: [payload: { ticketId: string; text: string }]
}>()

const { t } = useI18n()
</script>

<style scoped lang="scss">
.ticket-entry {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.review-reminder-bubble {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--status-warning, #c99a2e);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;

  .reminder-icon {
    flex: none;
    color: var(--status-warning, #c99a2e);
  }

  .reminder-open {
    margin-left: auto;
    flex: none;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  &:hover,
  &:focus-visible {
    background: var(--surface-hover);
  }
}
</style>
