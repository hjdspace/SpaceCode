<template>
  <div
    v-if="repoRoot"
    class="router-badge"
    :class="{ expanded }"
    data-testid="super-agent-work-badge"
  >
    <!-- 挂绳夹：工卡夹在消息区上沿，不新占一条工具栏高度 -->
    <span class="clip" aria-hidden="true" />

    <button
      type="button"
      class="badge-shell"
      :aria-expanded="expanded"
      aria-controls="router-badge-details"
      data-testid="super-agent-badge-toggle"
      @click="toggle"
    >
      <span class="photo">
        <svg class="avatar" viewBox="0 0 48 48" aria-hidden="true">
          <path class="line" d="M9 43c1.5-6.5 7.5-9.5 15-9.5S37.5 36.5 39 43" />
          <rect class="line" x="14" y="12" width="20" height="17" rx="7" />
          <path class="line" d="M24 12V7" />
          <path class="line" d="M19 20.5h10" />
          <circle class="dot" cx="24" cy="5.5" r="2" />
        </svg>
        <span v-if="running" class="on-duty" data-testid="super-agent-badge-on-duty" />
      </span>
      <span class="ident">
        <span class="name">{{ projectName }}</span>
        <span class="cwd" :title="repoRoot">{{ repoRoot }}</span>
      </span>
      <ChevronDown :size="13" class="chevron" :class="{ open: expanded }" />
    </button>

    <div v-show="expanded" id="router-badge-details" class="details">
      <dl class="fields">
        <div class="field">
          <dt>{{ t('superAgent.badge.role') }}</dt>
          <dd>{{ t('superAgent.badge.roleRouter') }}</dd>
        </div>
        <div class="field">
          <dt>{{ t('superAgent.badge.status') }}</dt>
          <dd :class="{ live: running }">{{ statusText }}</dd>
        </div>
        <div class="field">
          <dt>{{ t('superAgent.badge.employeeId') }}</dt>
          <dd class="mono" :title="sessionId || undefined">{{ shortId }}</dd>
        </div>
        <div class="field">
          <dt>{{ t('superAgent.badge.workDir') }}</dt>
          <dd class="mono path">{{ repoRoot }}</dd>
        </div>
        <div class="field">
          <dt>{{ t('superAgent.badge.policy') }}</dt>
          <dd>{{ policyText }}</dd>
        </div>
        <div class="field">
          <dt>{{ t('superAgent.badge.checkpoint') }}</dt>
          <dd>{{ checkpointText }}</dd>
        </div>
        <div class="field">
          <dt>{{ t('superAgent.badge.crew') }}</dt>
          <dd>{{ crewText }}</dd>
        </div>
        <div class="field">
          <dt>{{ t('superAgent.badge.pending') }}</dt>
          <dd>{{ pendingText }}</dd>
        </div>
      </dl>
      <span class="barcode" aria-hidden="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Router 工卡（悬浮工牌）。
 *
 * 存在的理由只有一个：Super Agent 的对话区看不出「这些话在哪个目录里落地」。
 * 折叠态因此只留工作目录，其余全部收进展开态 —— 工牌上多余的字都会变成噪声。
 *
 * 展开时才拉策略与检查点：两者都是主进程的只读投影，没人点开就不必每次进页面都读。
 *
 * 注意「工作目录」这个词在这里有两层：Router 自己恒在项目根，真正会分叉的是
 * 每张工单的执行目录（并行模式强制 per-ticket worktree）。所以展开态把策略单独
 * 列一行，而不是让人以为改了这里就能改 Worker 的落点。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from 'lucide-vue-next'
import { useSuperAgentStore } from '@/stores/superAgent'
import { formatRelativeTime } from '@/utils/chat-list-utils'

const { t } = useI18n()
const superAgentStore = useSuperAgentStore()

const expanded = ref(false)
/** 只在真正去主进程取的那段时间里显示"读取中"；取不到就如实留空，不假装还在转。 */
const detailsLoading = ref(false)
const EMPTY = '—'

/** 只报本页真正绑定的项目根：实时指针可能已经先动，而镜像还没重绑。 */
const repoRoot = computed(() => superAgentStore.boundRepoRoot)
const projectName = computed(() =>
  repoRoot.value ? repoRoot.value.split(/[\\/]/).filter(Boolean).pop() || '' : '',
)
const running = computed(() => superAgentStore.routerRunning)
const sessionId = computed(() => superAgentStore.boundSessionId ?? '')
const shortId = computed(() =>
  sessionId.value ? `${sessionId.value.slice(0, 8)}-${sessionId.value.slice(-4)}` : '—',
)

const statusText = computed(() =>
  running.value ? t('superAgent.badge.onDuty') : t('superAgent.badge.idle'),
)

const policyText = computed(() => {
  const policy = superAgentStore.executionPolicy?.policy
  if (!policy) return detailsLoading.value ? t('superAgent.badge.loading') : EMPTY
  const mode = policy.mode === 'parallel'
    ? t('superAgent.policy.parallel')
    : t('superAgent.policy.serial')
  if (policy.mode === 'parallel') {
    return t('superAgent.badge.parallelValue', {
      mode,
      max: policy.maxWorkers,
      worktree: t('superAgent.badge.perTicketWorktree'),
    })
  }
  return t('superAgent.badge.serialValue', {
    mode,
    worktree: t('superAgent.badge.sharedRoot'),
  })
})

const checkpointText = computed(() => {
  const info = superAgentStore.checkpointInfo
  if (!info) return detailsLoading.value ? t('superAgent.badge.loading') : EMPTY
  if (!info.checkpoint) return t('superAgent.policy.checkpointNone')
  return t('superAgent.badge.checkpointValue', {
    time: formatRelativeTime(info.checkpoint.savedAt),
    count: info.changedFiles.length,
  })
})

const crewText = computed(() => {
  const queue = superAgentStore.queue
  if (!queue) return EMPTY
  return t('superAgent.badge.crewValue', {
    running: queue.running.length,
    queued: queue.queued.length,
    max: queue.maxWorkers,
  })
})

const pendingText = computed(() =>
  t('superAgent.badge.pendingValue', {
    attention: superAgentStore.attentionCount,
    review: superAgentStore.reviewRemindedCount,
    health: superAgentStore.healthProblemCount,
  }),
)

function toggle(): void {
  expanded.value = !expanded.value
  if (!expanded.value) return
  const root = repoRoot.value
  if (!root) return
  // 每次点开都重新读一遍：工卡报的是"此刻在哪个目录、怎么执行"，读数过期比多读一次贵。
  // 拉取失败不影响其余字段 —— 留控制台痕迹，目录那一行照样可见。
  detailsLoading.value = true
  const settled = [
    superAgentStore.loadPolicy(root).catch((error: unknown) => {
      console.warn('[superAgent] badge policy load failed', error)
    }),
    superAgentStore.loadCheckpoint(root).catch((error: unknown) => {
      console.warn('[superAgent] badge checkpoint load failed', error)
    }),
  ]
  void Promise.allSettled(settled).then(() => {
    detailsLoading.value = false
  })
}
</script>

<style scoped lang="scss">
.router-badge {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(280px, calc(100% - 24px));
  pointer-events: auto;
}

.clip {
  width: 30px;
  height: 7px;
  border: 1px solid var(--border-light);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  background: var(--bg-secondary);
}

.badge-shell {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;

  &:hover {
    border-color: var(--accent-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }
}

.photo {
  position: relative;
  flex: none;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: linear-gradient(160deg, var(--bg-secondary), var(--bg-elevated));
  color: var(--text-secondary);
  overflow: hidden;
}

.avatar {
  display: block;
  width: 100%;
  height: 100%;
}

.avatar .line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.avatar .dot {
  fill: var(--accent-primary);
}

.on-duty {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 1.5px var(--bg-elevated);
}

.ident {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.name {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cwd {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.25;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron {
  flex: none;
  color: var(--text-muted);
  transition: transform 0.16s ease;

  &.open {
    transform: rotate(180deg);
  }
}

.details {
  width: 100%;
  padding: 8px 10px 6px;
  border: 1px solid var(--border-light);
  border-top: none;
  border-radius: 0 0 8px 8px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
}

.field {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.field dt {
  flex: 0 0 62px;
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}

.field dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 11px;
  color: var(--text-primary);

  &.live {
    color: var(--success);
  }

  &.mono {
    font-family: var(--font-mono);
    font-size: 10px;
  }

  &.path {
    word-break: break-all;
  }
}

.barcode {
  display: block;
  height: 14px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--border-light);
  background-image: repeating-linear-gradient(
    90deg,
    var(--text-secondary) 0 1px,
    transparent 1px 3px,
    var(--text-secondary) 3px 5px,
    transparent 5px 8px,
    var(--text-secondary) 8px 9px,
    transparent 9px 12px
  );
  background-size: 100% 10px;
  background-repeat: no-repeat;
  background-position: center bottom;
  opacity: 0.5;
}
</style>
