<template>
  <div
    v-if="repoRoot"
    class="router-badge"
    :class="{ expanded }"
    data-testid="super-agent-work-badge"
  >
    <!-- 挂绳：织带 + 金属夹，夹口插进卡顶的打孔槽 -->
    <span class="lanyard" aria-hidden="true">
      <span class="strap" />
      <span class="clip" />
    </span>

    <div class="card">
      <span class="slot" aria-hidden="true" />

      <!-- 左栏只放照片：栏宽恒定，展开时卡往下长，内容不横移 -->
      <div class="rail">
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
      </div>

      <button
        type="button"
        class="head"
        :aria-expanded="expanded"
        aria-controls="router-badge-details"
        data-testid="super-agent-badge-toggle"
        @click="toggle"
      >
        <span class="ident">
          <span class="name">{{ projectName }}</span>
          <span class="cwd" :title="repoRoot">{{ repoRoot }}</span>
        </span>
        <ChevronDown :size="13" class="chevron" :class="{ open: expanded }" />
      </button>

      <div v-show="expanded" id="router-badge-details" class="body">
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
      </div>

      <!-- 卡号印在条码下，跟真工卡一致：编号不再单独占一行 -->
      <div v-show="expanded" class="foot">
        <span class="barcode" :style="barcodeStyle" aria-hidden="true" />
        <span class="card-no">{{ t('superAgent.badge.employeeId') }} {{ shortId }}</span>
      </div>
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

/**
 * 条码的条宽序列由工号散列出，而不是固定节奏循环 —— 固定循环一眼能数出周期，
 * 就退回成装饰纹样；绑住工号才像同一张卡的机器可读编号。
 */
const BAR_COUNT = 44
function barcodeImage(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const stops: string[] = []
  let pos = 0
  for (let i = 0; i < BAR_COUNT; i++) {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    const bar = 1 + (Math.abs(h) % 3)
    const gap = 1 + (Math.abs(h >>> 8) % 2)
    stops.push(`var(--text-secondary) ${pos}px ${pos + bar}px`)
    stops.push(`transparent ${pos + bar}px ${pos + bar + gap}px`)
    pos += bar + gap
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

const barcodeStyle = computed(() => ({ backgroundImage: barcodeImage(sessionId.value || 'badge') }))

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
  width: min(330px, calc(100% - 24px));
  pointer-events: auto;
}

/* ── 挂绳：织带 + 金属夹 ─────────────────────────────── */

.lanyard {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  // 夹口压进卡顶，视觉上是夹住而不是摆在卡上方
  margin-bottom: -5px;
  pointer-events: none;
}

.strap {
  width: 13px;
  height: 11px;
  border-radius: var(--radius-xs) var(--radius-xs) 0 0;
  background: repeating-linear-gradient(
    45deg,
    color-mix(in srgb, var(--accent-primary) 28%, transparent) 0 2px,
    color-mix(in srgb, var(--accent-primary) 10%, transparent) 2px 4px
  );
  box-shadow: inset 0 0 0 1px var(--surface-border);
}

.clip {
  width: 26px;
  height: 12px;
  border: 1px solid var(--surface-border-strong);
  border-radius: var(--radius-xs);
  background: linear-gradient(
    180deg,
    var(--bg-elevated) 0%,
    var(--surface-strong) 48%,
    var(--bg-elevated) 100%
  );
  box-shadow: inset 0 1px 0 var(--glass-highlight), var(--shadow-sm);
}

/* ── 卡体：一张完整卡，一套边框与阴影 ────────────────── */

.card {
  position: relative;
  z-index: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--surface-border-strong);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  // 斜纹织物 + 斜向受光渐变：纯平底色读起来是设置面板，不是卡
  background: repeating-linear-gradient(135deg, var(--surface-glass) 0 1px, transparent 1px 4px),
    linear-gradient(158deg, var(--bg-elevated) 0%, var(--bg-elevated) 44%, var(--surface-soft) 100%);
  // 投射阴影定高度；顶边内高光 + 底边内暗给出 PVC 的厚度
  box-shadow: var(--shadow-xl), inset 0 1px 0 var(--glass-highlight),
    inset 0 -1px 0 color-mix(in srgb, var(--text-primary) 6%, transparent);
  transition: transform 0.16s ease;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 2;
    opacity: 0;
    pointer-events: none;
    background: linear-gradient(
      105deg,
      transparent 44%,
      color-mix(in srgb, var(--accent-primary) 12%, transparent) 50%,
      transparent 56%
    );
    transform: translateX(-110%);
    transition: opacity 0.2s ease, transform 0.5s ease;
  }
}

.router-badge:hover .card {
  transform: translateY(-1px);

  &::after {
    opacity: 1;
    transform: translateX(110%);
  }
}

.slot {
  position: absolute;
  top: 4px;
  left: 50%;
  z-index: 1;
  width: 22px;
  height: 5px;
  transform: translateX(-50%);
  border-radius: var(--radius-full);
  background: var(--bg-secondary);
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--text-primary) 24%, transparent);
  pointer-events: none;
}

/* ── 左栏：照片 ───────────────────────────────────────── */

.rail {
  grid-column: 1;
  grid-row: 1 / span 2;
  display: flex;
  align-items: flex-start;
  padding: 12px 8px 9px;
  border-right: 1px solid var(--surface-border);
}

/* ── 抬头带：卡上唯一的可点区 ─────────────────────────── */

.head {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  // 上内衬留出打孔槽的位置，印刷内容不从槽底下穿出来
  padding: 12px 9px 8px 10px;
  border: none;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-primary) 7%, transparent),
    transparent
  );
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.router-badge.expanded .head {
  border-bottom: 1px solid var(--surface-border);
}

.head:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: -2px;
}

.photo {
  position: relative;
  flex: none;
  width: 36px;
  height: 36px;
  border: 1px solid var(--surface-border-strong);
  border-radius: var(--radius-sm);
  // 照片区凹进卡面一档：内高光 + 比卡面深一档的底
  background: linear-gradient(160deg, var(--surface-soft), var(--bg-tertiary));
  box-shadow: inset 0 1px 0 var(--glass-highlight);
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
  right: 3px;
  bottom: 3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 1.5px var(--bg-elevated);
  // 呼吸环与分隔圈叠在同一个 box-shadow 里动画：照片区是 overflow hidden，
  // 用伪元素外扩会被裁掉，只会看见半个环。
  animation: duty-breathe 2.4s ease-in-out infinite;
}

.ident {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.name {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cwd {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  line-height: var(--leading-tight);
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

/* ── 字段区：印刷式微标签 + 值 ────────────────────────── */

.body {
  grid-column: 2;
  grid-row: 2;
  padding: 7px 10px 8px;
  animation: card-unfold 180ms ease-out both;
}

.fields {
  display: grid;
  gap: 4px;
  margin: 0;
}

.field {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.field dt {
  flex: 0 0 5em;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.08em;
  color: var(--text-secondary);
}

.field dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-xs-plus);
  font-weight: var(--font-weight-medium);
  line-height: var(--leading-compact);
  color: var(--text-primary);

  &.live {
    color: var(--success);
  }

  &.mono {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }

  &.path {
    word-break: break-all;
  }
}

/* ── 卡底：条码 + 卡号 ───────────────────────────────── */

.foot {
  grid-column: 1 / -1;
  grid-row: 3;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 6px 10px 7px;
  border-top: 1px solid var(--surface-border);
  animation: card-unfold 200ms ease-out both;
}

.barcode {
  flex: 1;
  min-width: 0;
  height: 15px;
  background-repeat: no-repeat;
  background-size: 100% 100%;
  opacity: 0.8;
}

.card-no {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  letter-spacing: 0.02em;
  color: var(--text-secondary);
}

@keyframes duty-breathe {
  0%,
  100% {
    box-shadow: 0 0 0 1.5px var(--bg-elevated), 0 0 0 2px var(--success-glow);
  }
  50% {
    box-shadow: 0 0 0 1.5px var(--bg-elevated), 0 0 0 3.5px transparent;
  }
}

@keyframes card-unfold {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .chevron {
    transition: none;
  }

  .body,
  .foot,
  .on-duty {
    animation: none;
  }

  .card::after {
    display: none;
  }
}
</style>
