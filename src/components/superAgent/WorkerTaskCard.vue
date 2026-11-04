<script setup lang="ts">
/**
 * 单行工单卡片（T06 #76，设计 §10.3）。
 *
 * 卡片身份是 ticketId：Report 只原位更新本卡片（由 store 保证 key 唯一），
 * 不重复发气泡。状态表达双通道：状态点颜色 + 短状态词，另加状态图标，
 * 不能只靠颜色区分。进度后缀只在有轻量进度时显示（currentTool/用时）。
 * 可见文案全部走 i18n（superAgent.ticket.*）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Ban,
  CheckCircle2,
  Clock,
  Cog,
  Eye,
  LoaderCircle,
  MessageCircleQuestion,
  OctagonAlert,
  PauseCircle,
  Send,
  Trash2,
  XCircle,
  type LucideIcon,
} from 'lucide-vue-next'
import type {
  SuperAgentTicketCard,
  SuperAgentTicketCardState,
  SuperAgentTicketProgress,
} from '@/shared/channels/superAgent'

const props = defineProps<{
  card: SuperAgentTicketCard
  /** 该工单最新轻量进度（节流后增量）；无进度时为 null。 */
  progress?: SuperAgentTicketProgress | null
}>()

const { t } = useI18n()

const STATE_ICONS: Record<SuperAgentTicketCardState, LucideIcon> = {
  queued: Clock,
  preparing: LoaderCircle,
  working: Cog,
  idle: PauseCircle,
  delivery: Send,
  review: Eye,
  answer: MessageCircleQuestion,
  blocked: OctagonAlert,
  failed: XCircle,
  completed: CheckCircle2,
  stopped: Ban,
  dropped: Trash2,
}

const icon = computed(() => STATE_ICONS[props.card.state])
const stateLabel = computed(() => t(`superAgent.ticket.states.${props.card.state}`))
const ticketLabel = computed(() => `#${props.card.ticketId.slice(0, 8)}`)
const generationLabel = computed(() => t('superAgent.ticket.generation', { count: props.card.generation }))
const scopeLabel = computed(() => {
  const paths = props.card.scopePaths
  if (paths.length === 0) return t('superAgent.ticket.scopeAll')
  return paths.join(', ')
})
/** 执行中的工单在行尾显示轻量进度（当前工具）；其余状态不占空间。 */
const progressLabel = computed(() => {
  const progress = props.progress
  if (!progress || progress.ticketId !== props.card.ticketId) return ''
  if (!progress.currentTool) return ''
  return progress.currentTool
})
</script>

<template>
  <div class="worker-task-card" :data-state="card.state" data-testid="worker-task-card">
    <component :is="icon" class="state-icon" :size="14" />
    <span class="title" data-testid="worker-task-card-title">{{ card.title }}</span>
    <span class="meta" data-testid="worker-task-card-meta">
      {{ ticketLabel }} · {{ generationLabel }} · {{ scopeLabel }}
    </span>
    <span v-if="progressLabel" class="progress" data-testid="worker-task-card-progress">
      {{ progressLabel }}
    </span>
    <span class="state" data-testid="worker-task-card-state">
      <span class="dot" />
      {{ stateLabel }}
    </span>
  </div>
</template>

<style scoped lang="scss">
.worker-task-card {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: var(--bg-elevated);
  font-size: 12px;
  color: var(--text-primary);
}

.state-icon {
  flex: none;
  color: var(--text-muted);
}

.worker-task-card[data-state='working'] .state-icon,
.worker-task-card[data-state='preparing'] .state-icon {
  color: var(--accent-primary, #4c7cf5);
}

.worker-task-card[data-state='failed'] .state-icon,
.worker-task-card[data-state='blocked'] .state-icon,
.worker-task-card[data-state='delivery'] .state-icon {
  color: var(--status-error, #d4564d);
}

.worker-task-card[data-state='completed'] .state-icon,
.worker-task-card[data-state='review'] .state-icon {
  color: var(--status-success, #3f9e6b);
}

.title {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  flex: none;
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress {
  flex: 1;
  overflow: hidden;
  color: var(--text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--text-secondary);
  white-space: nowrap;

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
  }
}

.worker-task-card[data-state='working'] .dot,
.worker-task-card[data-state='preparing'] .dot {
  background: var(--accent-primary, #4c7cf5);
}

.worker-task-card[data-state='idle'] .dot,
.worker-task-card[data-state='queued'] .dot {
  background: var(--text-muted);
}

.worker-task-card[data-state='delivery'] .dot,
.worker-task-card[data-state='blocked'] .dot,
.worker-task-card[data-state='failed'] .dot,
.worker-task-card[data-state='dropped'] .dot {
  background: var(--status-error, #d4564d);
}

.worker-task-card[data-state='completed'] .dot,
.worker-task-card[data-state='review'] .dot {
  background: var(--status-success, #3f9e6b);
}

.worker-task-card[data-state='answer'] .dot,
.worker-task-card[data-state='stopped'] .dot {
  background: var(--status-warning, #c99a2e);
}
</style>
