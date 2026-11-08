<template>
  <section v-if="mirror" class="worker-live-panel" data-testid="worker-live">
    <header class="worker-head">
      <HardHat :size="16" class="worker-icon" />
      <span class="worker-title">{{ mirror.title }}</span>
      <span
        data-testid="worker-state"
        class="worker-state"
        :class="{ running: mirror.running }"
      >{{ statusLabel }}</span>
      <span v-if="!isTakenOver" class="readonly-hint" data-testid="worker-readonly-hint">{{ t('superAgent.worker.readonlyHint') }}</span>
    </header>

    <!-- 接管横幅：只切面板态，自动推进语义不变，提示人此刻由人接管 -->
    <div v-if="isTakenOver" class="takeover-banner" data-testid="worker-takeover-banner">
      {{ t('superAgent.worker.takeoverBanner') }}
    </div>

    <div class="worker-timeline" :class="{ 'with-dock': canTakeOver }">
      <div class="worker-timeline-scroll">
        <!-- 代次分段：时间线上方薄层区块（复用不新分段、重试新分段） -->
        <ul v-if="mirror.segments.length" class="worker-segments">
          <li
            v-for="segment in mirror.segments"
            :key="segment.assignmentId"
            :data-testid="`worker-segment-${segment.generation}`"
            class="segment"
            :class="[`state-${segment === latestSegment && !mirror.running ? 'idle' : segment.state}`, { current: segment === latestSegment }]"
          >
            <span class="generation">{{ t('superAgent.worker.generation', { n: segment.generation }) }}</span>
            <span class="segment-state">{{ segment === latestSegment && segment.state === 'running' && !mirror.running ? statusLabel : t(`superAgent.worker.states.${segment.state}`) }}</span>
            <span v-if="segment.reportSummary" class="report" :title="segment.reportSummary">{{ segment.reportSummary }}</span>
          </li>
        </ul>

        <!-- Worker 稳定会话的时间线：默认只读；接管后交互可用，
             授权确认结果作为领域输入经 sendWorkerMessage 投递，不直连引擎 -->
        <AgentTimeline
          :messages="messages"
          :session-id="mirror.sessionId"
          :loading="mirror.running"
          :readonly="!isTakenOver"
          @tool-submit="handleToolSubmit"
          @tool-skip="handleToolSkip"
        />
      </div>

      <!-- 接管/交还悬浮在时间线底部：读长转录时不必滚回顶部 -->
      <div v-if="canTakeOver" class="worker-dock" data-testid="worker-takeover-dock">
        <button
          type="button"
          class="dock-action"
          :class="{ active: isTakenOver }"
          :aria-pressed="isTakenOver"
          data-testid="worker-takeover-button"
          @click="toggleTakeover"
        >
          <component :is="isTakenOver ? Undo2 : Hand" :size="14" class="dock-icon" />
          <span>{{ isTakenOver ? t('superAgent.worker.giveback') : t('superAgent.worker.takeover') }}</span>
        </button>
      </div>
    </div>

    <!-- 接管输入（T09 #79）：复用主聊天输入组件，绑定 Worker 会话；
         草稿域按 sessionId 隔离（Worker 稳定会话 id ≠ 普通会话 id） -->
    <ChatInput
      v-if="isTakenOver"
      class="worker-composer"
      compact
      :session-id="mirror.sessionId"
      :placeholder="t('superAgent.worker.composerPlaceholder')"
      :show-work-gallery-action="false"
      :show-open-project-action="false"
      @send="handleWorkerSend"
    />
  </section>

  <section v-else class="worker-live-empty">
    <p>{{ t('superAgent.worker.emptyHint') }}</p>
  </section>
</template>

<script setup lang="ts">
/**
 * Worker 只读镜像面板（T07 #77，设计 §10.3 / §11.2；T09 #79 接管与交还）。
 *
 * - 只读观察：复用 AgentTimeline 渲染 Worker 稳定会话（sessionId 跨代次稳定），
 *   默认 readonly，授权确认、错误重试等交互控件全部 inert。
 * - 接管与交还（T09 #79）：接管只切面板态、不改调度 —— AgentTimeline 变为可交互，
 *   出现「自动推进已暂停」横幅与紧凑输入框；输入经 store.sendWorkerMessage
 *   走主进程先落库再投递（requestId 对账），不直连引擎；授权确认结果同样
 *   作为领域输入投递。交还后回到只读，草稿域按 Worker 会话 id 隔离。
 * - 代次分段：workerBind 快照里的 segments 按 generation 升序，作为时间线上方
 *   薄层区块叠加；最新代次高亮。
 * - 生命周期：标签打开时若快照缺失则幂等 bindWorker；关闭标签由 app store
 *   负责停镜像（unbindWorker），本面板不监听关闭事件，切标签不解绑。
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { HardHat, Hand, Undo2 } from 'lucide-vue-next'
import AgentTimeline from '@/components/chat/AgentTimeline.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import { useAppStore, workerTabData } from '@/stores/app'
import { useSuperAgentStore } from '@/stores/superAgent'
import { useChatSessionStore } from '@/stores/chatSession'
import { createUuid } from '@/utils/uuid'

const { t } = useI18n()
const appStore = useAppStore()
const superAgentStore = useSuperAgentStore()
const chatStore = useChatSessionStore()

/** 当前激活的 worker 标签对应的 ticketId；非 worker 标签为 null。 */
const tabData = computed(() => workerTabData(appStore.activeInfoTab))
const ticketId = computed<string | null>(() => tabData.value?.ticketId ?? null)

/**
 * 标签自带的项目根，而不是实时项目指针：这张工单在哪个项目里打开就一直在那里寻址。
 * 中置页切到别的项目后，旧项目的 Worker 标签若跟着新根去 bind，等于拿不存在的
 * ticketId 敲另一个项目的门。
 */
const repoRoot = computed<string | null>(() => tabData.value?.repoRoot ?? null)

const mirror = computed(() => {
  const id = ticketId.value
  return id ? superAgentStore.workerMirrors[id] : undefined
})

/** 运行真值优先；ready 仍保留 running Assignment，但界面应显示待验收。 */
const statusLabel = computed(() => {
  if (mirror.value?.running) return t('superAgent.worker.running')
  const state = mirror.value?.ticketState
  if (state === 'review') return t('superAgent.worker.pendingAcceptance')
  if (!state || state === 'working' || state === 'idle') return t('superAgent.worker.idle')
  return t(`superAgent.ticket.states.${state}`)
})

const messages = computed(() =>
  mirror.value ? chatStore.getDisplayMessages(mirror.value.sessionId) : [],
)

/** T09 #79：当前标签的工单是否被接管（多面板共享同一接管态）。 */
const isTakenOver = computed(
  () => ticketId.value !== null && superAgentStore.takeoverTicketId === ticketId.value,
)

/** 接管入口只在标签自带 ticketId + repoRoot 时出现（寻址不全会打到别的项目）。 */
const canTakeOver = computed(() => Boolean(ticketId.value && repoRoot.value))

/** 最新一代 Assignment：分段薄层中高亮当前执行代次。 */
const latestSegment = computed(() =>
  mirror.value?.segments[mirror.value.segments.length - 1] ?? null,
)

// 幂等挂镜像：快照缺失（首次打开或重开标签）时补 workerBind，已有则跳过。
// 失败不抛穿：面板保持空态（emptyHint），只留控制台痕迹。
watch(
  ticketId,
  (id) => {
    if (!id || mirror.value) return
    const root = repoRoot.value
    if (!root) return
    superAgentStore.bindWorker(root, id).catch((error: unknown) => {
      console.warn('[superAgent] workerBind failed', error)
    })
  },
  { immediate: true },
)

/** 接管/交还：失败（如 takeoverConflict）只留控制台痕迹，面板不炸。 */
function toggleTakeover(): void {
  const id = ticketId.value
  const root = repoRoot.value
  if (!id || !root) return
  const action = isTakenOver.value
    ? superAgentStore.releaseWorker(root, id)
    : superAgentStore.takeoverWorker(root, id)
  action.catch((error: unknown) => {
    console.warn('[superAgent] worker takeover toggle failed', error)
  })
}

/**
 * 接管输入：主进程先落 Domain Input 再按调度投递（requestId 对账），
 * 渲染端不直连引擎；失败只留控制台痕迹，输入框交由用户重试。
 */
function handleWorkerSend(content: string): void {
  const id = ticketId.value
  const root = repoRoot.value
  if (!id || !root || content.trim() === '') return
  superAgentStore
    .sendWorkerMessage(root, { requestId: createUuid(), ticketId: id, text: content })
    .catch((error: unknown) => {
      console.warn('[superAgent] workerMessage failed', error)
    })
}

/** 接管态授权确认：结果作为领域输入投递（与主聊天一致的确认，不直连引擎）。 */
function handleToolSubmit(toolId: string, updatedInput: Record<string, unknown>): void {
  sendPermissionAnswer(
    JSON.stringify({ type: 'permission-answer', toolId, decision: 'allow', input: updatedInput }),
  )
}

/** 接管态授权跳过：同样落为领域输入。 */
function handleToolSkip(toolId: string): void {
  sendPermissionAnswer(JSON.stringify({ type: 'permission-answer', toolId, decision: 'deny' }))
}

function sendPermissionAnswer(text: string): void {
  const id = ticketId.value
  const root = repoRoot.value
  if (!id || !root) return
  superAgentStore
    .sendWorkerMessage(root, { requestId: createUuid(), ticketId: id, text, note: 'permission-answer' })
    .catch((error: unknown) => {
      console.warn('[superAgent] workerMessage failed', error)
    })
}
</script>

<style scoped lang="scss">
.worker-live-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.worker-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-primary);

  .worker-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .worker-title {
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .worker-state {
    flex-shrink: 0;
    font-size: var(--text-sm);
    padding: 2px 8px;
    border-radius: 10px;
    color: var(--text-muted);
    background: var(--surface-hover);

    &.running {
      color: var(--success);
    }
  }

  .readonly-hint {
    margin-left: auto;
    flex-shrink: 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
}

// 时间线自身滚动，接管按钮悬浮在滚动区底部；滚动由面板持有，头部因此不会滚走
.worker-timeline {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;

  &.with-dock .worker-timeline-scroll {
    // 给悬浮胶囊让位，最后一条消息不会被压住
    padding-bottom: 52px;
  }
}

.worker-timeline-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  @include scrollbar-overlay;
}

.worker-dock {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  justify-content: center;
  padding: 0 12px 12px;
  pointer-events: none;
}

// 悬浮接管胶囊：主色渐变取「人接手」的分量，交还态转警示色描边
.dock-action {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  color: var(--text-on-accent, #fff);
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  box-shadow:
    var(--shadow-md),
    0 8px 20px var(--accent-primary-glow);
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    filter var(--transition-fast),
    background var(--transition-fast),
    color var(--transition-fast),
    border-color var(--transition-fast);

  .dock-icon {
    flex-shrink: 0;
  }

  &:hover {
    transform: translateY(-1px);
    filter: brightness(1.06);
    box-shadow:
      var(--shadow-lg),
      0 10px 26px var(--accent-primary-glow);
  }

  &:active {
    transform: translateY(0);
    filter: brightness(0.98);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  &.active {
    color: var(--warning);
    background: var(--bg-elevated);
    border-color: color-mix(in srgb, var(--warning) 45%, transparent);
    box-shadow: var(--shadow-md);

    &:hover {
      filter: none;
      background: var(--surface-hover);
      box-shadow: var(--shadow-lg);
    }
  }
}

// 接管横幅（T09 #79）：提示自动推进已暂停、此刻由人接管
.takeover-banner {
  padding: 6px 12px;
  font-size: var(--text-sm);
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  border-bottom: 1px solid var(--surface-border);
}

// 紧凑接管输入框：跟随面板宽度，草稿域由 sessionId 隔离
.worker-composer {
  border-top: 1px solid var(--surface-border);
  background: var(--bg-primary);
}

.worker-segments {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 6px 12px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-elevated, var(--bg-primary));

  .segment {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: var(--text-sm);
    color: var(--text-secondary);

    &.current {
      background: var(--surface-hover);
    }

    .generation {
      font-weight: 600;
      color: var(--text-primary);
      flex-shrink: 0;
    }

    .segment-state {
      flex-shrink: 0;
      color: var(--text-muted);

      .state-running & {
        color: var(--success);
      }
    }

    .report {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-muted);
    }
  }
}

.worker-live-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: var(--text-muted);
}
</style>
