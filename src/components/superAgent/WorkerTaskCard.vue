<script setup lang="ts">
/**
 * 单行工单卡片（T06 #76，设计 §10.3；T10 #80 验收出口）。
 *
 * 卡片身份是 ticketId：Report 只原位更新本卡片（由 store 保证 key 唯一），
 * 不重复发气泡。状态表达双通道：状态点颜色 + 短状态词，另加状态图标，
 * 不能只靠颜色区分。进度后缀只在有轻量进度时显示（currentTool/用时）。
 *
 * T10 #80：review 卡片必须带三个显式出口（接受验收 / 继续追问 / 停止）；
 * delivery/blocked/failed 卡片带重试入口（canRetry 由投影下发，与阶段派生
 * 同源）；review 超时提醒过的卡片显示「验收超时」徽标。继续追问展开内联
 * 输入，提交经 ticketMessage 走主进程先落库再投递；离开 review 后输入自动收起。
 * 停止对任何 open 工单都开放（canStop 由投影下发）—— 排队与在跑同样要有出口，
 * 否则执行失败/卡住的工单只能等它自己跑完。
 * 整行点击 = 打开 worker:&lt;ticketId&gt; 右侧标签（§10.3）；行内按钮各自 stop 冒泡。
 * 可见文案全部走 i18n（superAgent.ticket.*）。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlarmClockCheck,
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

const emit = defineEmits<{
  /** 设计 §10.3：点击卡片只打开 worker:<ticketId> 右侧标签，不自动接管。 */
  open: [ticketId: string]
  /** T10 #80：接受验收。 */
  accept: [ticketId: string]
  /** T10 #80：停止出口。 */
  stop: [ticketId: string]
  /** T10 #80：人工重试（generation+1）。 */
  retry: [ticketId: string]
  /** T10 #80：继续追问 —— review 的人消息复用原 Assignment 回到 working。 */
  message: [payload: { ticketId: string; text: string }]
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

/** 继续追问的内联输入态；离开 review 自动收起。 */
const followupOpen = ref(false)
const followupText = ref('')

watch(
  () => props.card.state,
  (state) => {
    if (state !== 'review') {
      followupOpen.value = false
      followupText.value = ''
    }
  },
)

function submitFollowup(): void {
  const text = followupText.value.trim()
  if (!text) return
  emit('message', { ticketId: props.card.ticketId, text })
  followupOpen.value = false
  followupText.value = ''
}

function closeFollowup(): void {
  followupOpen.value = false
  followupText.value = ''
}
</script>

<template>
  <div
    class="worker-task-card"
    :data-state="card.state"
    data-testid="worker-task-card"
    role="button"
    tabindex="0"
    :aria-label="card.title"
    @click="emit('open', card.ticketId)"
    @keydown.enter.prevent="emit('open', card.ticketId)"
  >
    <div class="row">
      <component :is="icon" class="state-icon" :size="14" />
      <span class="title" data-testid="worker-task-card-title">{{ card.title }}</span>
      <span class="meta" data-testid="worker-task-card-meta">
        {{ ticketLabel }} · {{ generationLabel }} · {{ scopeLabel }}
      </span>
      <span v-if="progressLabel" class="progress" data-testid="worker-task-card-progress">
        {{ progressLabel }}
      </span>
      <span
        v-if="card.reviewRemindedAt"
        class="reminded-badge"
        data-testid="worker-task-card-reminded"
      >
        <AlarmClockCheck :size="12" />
        {{ t('superAgent.ticket.remindedMark') }}
      </span>
      <span class="state" data-testid="worker-task-card-state">
        <span class="dot" />
        {{ stateLabel }}
      </span>
      <span v-if="card.state === 'review'" class="actions" data-testid="worker-task-card-review-actions">
        <button
          class="action accept"
          data-testid="worker-task-card-accept"
          @click.stop="emit('accept', card.ticketId)"
        >
          {{ t('superAgent.ticket.accept') }}
        </button>
        <button
          class="action follow"
          data-testid="worker-task-card-continue"
          @click.stop="followupOpen = !followupOpen"
        >
          {{ t('superAgent.ticket.continue') }}
        </button>
        <button
          class="action stop"
          data-testid="worker-task-card-stop"
          @click.stop="emit('stop', card.ticketId)"
        >
          {{ t('superAgent.ticket.stop') }}
        </button>
      </span>
      <!-- 排队/在跑的工单也要有终止出口：ticketStop 对任何 open 工单都成立
           （撤 Mandate、收尾在跑 Assignment），不能只在待验收时才给按钮。 -->
      <button
        v-else-if="card.canStop"
        class="action stop"
        data-testid="worker-task-card-stop"
        @click.stop="emit('stop', card.ticketId)"
      >
        {{ t('superAgent.ticket.stop') }}
      </button>
      <button
        v-if="card.canRetry"
        class="action retry"
        data-testid="worker-task-card-retry"
        @click.stop="emit('retry', card.ticketId)"
      >
        {{ t('superAgent.ticket.retry') }}
      </button>
    </div>
    <div
      v-if="followupOpen"
      class="followup"
      :data-testid="`worker-task-card-followup-${card.ticketId}`"
      @click.stop
    >
      <input
        v-model="followupText"
        class="followup-input"
        :placeholder="t('superAgent.ticket.followupPlaceholder')"
        data-testid="worker-task-card-followup-input"
        @keydown.enter="submitFollowup"
      />
      <button class="action" data-testid="worker-task-card-followup-send" @click="submitFollowup">
        {{ t('superAgent.ticket.followupSend') }}
      </button>
      <button class="action ghost" data-testid="worker-task-card-followup-cancel" @click="closeFollowup">
        {{ t('superAgent.ticket.followupCancel') }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.worker-task-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: var(--bg-elevated);
  font-size: 12px;
  color: var(--text-primary);
  // 整行是"打开这张工单的右侧工作态"的入口（§10.3），不是只读文本
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;

  &:hover {
    border-color: var(--accent-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
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

.reminded-badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border: 1px solid var(--status-warning, #c99a2e);
  border-radius: 10px;
  color: var(--status-warning, #c99a2e);
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

.actions {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
}

.action {
  flex: none;
  padding: 2px 8px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: var(--surface-hover, rgba(127, 127, 127, 0.12));
  }

  &.accept {
    border-color: var(--status-success, #3f9e6b);
    color: var(--status-success, #3f9e6b);
  }

  &.stop {
    border-color: var(--status-error, #d4564d);
    color: var(--status-error, #d4564d);
  }

  &.ghost {
    border-color: transparent;
  }
}

.followup {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 22px;
}

.followup-input {
  flex: 1;
  min-width: 0;
  padding: 3px 8px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;

  &::placeholder {
    color: var(--text-muted);
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
