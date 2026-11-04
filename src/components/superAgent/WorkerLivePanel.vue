<template>
  <section v-if="mirror" class="worker-live-panel" data-testid="worker-live">
    <header class="worker-head">
      <HardHat :size="16" class="worker-icon" />
      <span class="worker-title">{{ mirror.title }}</span>
      <span
        data-testid="worker-state"
        class="worker-state"
        :class="{ running: mirror.running }"
      >{{ mirror.running ? t('superAgent.worker.running') : t('superAgent.worker.idle') }}</span>
      <span class="readonly-hint" data-testid="worker-readonly-hint">{{ t('superAgent.worker.readonlyHint') }}</span>
    </header>

    <!-- 代次分段：时间线上方薄层区块（复用不新分段、重试新分段） -->
    <ul v-if="mirror.segments.length" class="worker-segments">
      <li
        v-for="segment in mirror.segments"
        :key="segment.assignmentId"
        :data-testid="`worker-segment-${segment.generation}`"
        class="segment"
        :class="[`state-${segment.state}`, { current: segment === latestSegment }]"
      >
        <span class="generation">{{ t('superAgent.worker.generation', { n: segment.generation }) }}</span>
        <span class="segment-state">{{ t(`superAgent.worker.states.${segment.state}`) }}</span>
        <span v-if="segment.reportSummary" class="report" :title="segment.reportSummary">{{ segment.reportSummary }}</span>
      </li>
    </ul>

    <!-- Worker 稳定会话的只读时间线：复用主聊天组件，交互入口全部 inert -->
    <AgentTimeline
      :messages="messages"
      :session-id="mirror.sessionId"
      :loading="mirror.running"
      readonly
    />
  </section>

  <section v-else class="worker-live-empty">
    <p>{{ t('superAgent.worker.emptyHint') }}</p>
  </section>
</template>

<script setup lang="ts">
/**
 * Worker 只读镜像面板（T07 #77，设计 §10.3 / §11.2）。
 *
 * - 只读观察：复用 AgentTimeline 渲染 Worker 稳定会话（sessionId 跨代次稳定），
 *   readonly 下授权确认、错误重试等交互控件全部 inert，不提供接管入口（T09）。
 * - 代次分段：workerBind 快照里的 segments 按 generation 升序，作为时间线上方
 *   薄层区块叠加；最新代次高亮。
 * - 生命周期：标签打开时若快照缺失则幂等 bindWorker；关闭标签由 app store
 *   负责停镜像（unbindWorker），本面板不监听关闭事件，切标签不解绑。
 */
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { HardHat } from 'lucide-vue-next'
import AgentTimeline from '@/components/chat/AgentTimeline.vue'
import { useAppStore, workerTicketId } from '@/stores/app'
import { useSuperAgentStore } from '@/stores/superAgent'
import { useChatSessionStore } from '@/stores/chatSession'

const { t } = useI18n()
const appStore = useAppStore()
const superAgentStore = useSuperAgentStore()
const chatStore = useChatSessionStore()

/** 当前激活的 worker 标签对应的 ticketId；非 worker 标签为 null。 */
const ticketId = computed<string | null>(() => workerTicketId(appStore.activeInfoTab))

const mirror = computed(() => {
  const id = ticketId.value
  return id ? superAgentStore.workerMirrors[id] : undefined
})

const messages = computed(() =>
  mirror.value ? chatStore.getDisplayMessages(mirror.value.sessionId) : [],
)

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
    const repoRoot = appStore.projectRoot
    if (!repoRoot) return
    superAgentStore.bindWorker(repoRoot, id).catch((error: unknown) => {
      console.warn('[superAgent] workerBind failed', error)
    })
  },
  { immediate: true },
)
</script>

<style scoped lang="scss">
.worker-live-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.worker-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
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
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 10px;
    color: var(--text-muted);
    background: var(--surface-hover);

    &.running {
      color: var(--success-color, #16a34a);
    }
  }

  .readonly-hint {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-muted);
  }
}

.worker-segments {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-elevated, var(--bg-primary));

  .segment {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 12px;
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
        color: var(--success-color, #16a34a);
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
