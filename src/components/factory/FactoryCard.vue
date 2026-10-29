<template>
  <article
    class="factory-card"
    :class="{ selected, blocked: task.lane === 'blocked', cancelled: task.cancelled }"
    :data-task-card="task.id"
    role="button"
    tabindex="0"
    :aria-label="task.title"
    @click="emit('select', task.id)"
    @keydown.enter.prevent="emit('select', task.id)"
    @keydown.space.prevent="emit('select', task.id)"
  >
    <div class="card-top">
      <span class="lane-dot" :class="{ pulse: pulsing }" data-card-dot />
      <span v-if="task.issueNumber !== undefined" class="card-num">#{{ task.issueNumber }}</span>
      <span v-else class="card-local">{{ t('factory.cardLocal') }}</span>
      <span v-if="takenOver" class="takeover-badge" data-card-takeover>{{ t('factory.cardTakeover') }}</span>
      <span v-else class="status-chip">{{ chipText }}</span>
    </div>

    <h3 class="card-title">{{ task.title }}</h3>

    <div class="card-branch">
      <GitBranch :size="12" />
      <span>{{ task.branch }}</span>
    </div>

    <div v-if="task.worktree" class="card-branch card-worktree" data-card-worktree>
      <Folder :size="12" />
      <span>{{ task.worktree }}</span>
    </div>

    <a
      v-if="task.pullRequest"
      class="card-branch card-pr"
      :href="task.pullRequest.url"
      target="_blank"
      rel="noopener"
      data-card-pr
      @click.stop
    >
      <GitPullRequest :size="12" />
      <span>#{{ task.pullRequest.number }} · {{ t('factory.pr.open') }}</span>
    </a>

    <div v-if="showsProgress" class="card-progress" data-card-progress>
      <i :style="{ width: `${percent}%` }" />
    </div>

    <div v-if="task.lane === 'blocked' && task.attention" class="card-alert">
      <AlertTriangle :size="13" />
      <span>{{ attentionText }}</span>
    </div>

    <div class="card-foot">
      <span class="diffstat" :class="{ empty: !diffstat }" data-card-diffstat>
        <template v-if="diffstat"><b>+{{ diffstat.additions }}</b><em>−{{ diffstat.deletions }}</em></template>
        <template v-else>—</template>
      </span>
      <div class="card-foot-meta">
        <span v-if="mergeMeta" class="card-merged" data-card-merged>{{ mergedText }}</span>
        <template v-else>
          <span class="card-model">{{ task.model || t('factory.modelUnknown') }}</span>
          <span class="card-elapsed" data-card-elapsed>{{ formatClock(elapsedMs) }}</span>
        </template>
      </div>
    </div>

    <!-- 只读时即使没有可做的动作，也要把原因留在卡片上，而不是只有看板顶部那条横幅。 -->
    <div v-if="actions.length || readonly" class="card-actions" data-card-actions>
      <span v-if="readonly" class="card-lock" data-card-locked>
        <Lock :size="11" />
        {{ t('factory.storage.readonlyBadge') }}
      </span>
      <button
        v-for="action in actions"
        :key="action.kind"
        class="card-action"
        :class="action.variant"
        :data-card-action="action.kind"
        :disabled="readonly || action.kind === busy"
        :title="readonly ? t('factory.storage.readonlyHint') : ''"
        @click.stop="emit('action', task.id, action.kind)"
      >
        {{ t(action.labelKey) }}
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Folder, GitBranch, GitPullRequest, Lock } from 'lucide-vue-next'
import type { FactoryRun, FactoryTask } from '@/shared/factory'
import {
  cardActions,
  cardDiffstat,
  doneTaskMeta,
  formatClock,
  isCardPulsing,
  isTakenOver,
  showsTaskProgress,
  taskElapsedMs,
  taskProgressPercent,
  taskStatus,
  type FactoryCardActionKind,
  type FactoryTaskStatus,
} from '@/stores/factory/board'

const props = withDefaults(
  defineProps<{
    task: FactoryTask
    selected: boolean
    nowMs: number
    run: FactoryRun | null
    /** 运行目录只读（其他窗口持锁）：动作全部禁用并说明原因。 */
    readonly?: boolean
    /** 检查器与卡片共用的在途动作；同一种动作重复点击没有意义。 */
    busy?: FactoryCardActionKind | null
  }>(),
  { readonly: false, busy: null },
)

const emit = defineEmits<{
  select: [id: string]
  action: [id: string, kind: FactoryCardActionKind]
}>()

const { t } = useI18n()

const status = computed(() => taskStatus(props.task))
const takenOver = computed(() => isTakenOver(props.task))
const pulsing = computed(() => isCardPulsing(props.task, props.run))
const showsProgress = computed(() => showsTaskProgress(props.task))
const percent = computed(() => taskProgressPercent(props.task))
const diffstat = computed(() => cardDiffstat(props.task))
const mergeMeta = computed(() => doneTaskMeta(props.task))
const elapsedMs = computed(() => taskElapsedMs(props.task, props.nowMs))
const actions = computed(() => cardActions(props.task))
const chipText = computed(() => label(status.value))
const mergedText = computed(() => (mergeMeta.value ? label(mergeMeta.value) : ''))

/** 投影只给 i18n key + 参数，文案在这里落地。 */
function label(meta: FactoryTaskStatus): string {
  return meta.params ? t(meta.key, meta.params) : t(meta.key)
}
/** 目前只有崩溃恢复的 app.restarted 需要翻译，其余保持原始原因码。 */
const attentionText = computed(() => {
  const reason = props.task.attention?.reason ?? ''
  return reason === 'app.restarted' ? t('factory.attention.appRestarted') : reason
})
</script>

<style lang="scss" scoped>
.factory-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--surface-border);
  border-left: 2px solid var(--lane-color, var(--text-muted));
  border-radius: var(--radius-md, 8px);
  background: var(--bg-elevated);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }

  &.selected {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 1px var(--accent-primary-glow);
  }

  &.blocked {
    border-left-color: var(--warning);
    background: color-mix(in srgb, var(--warning) 6%, var(--bg-elevated));
  }

  &.cancelled {
    opacity: 0.6;
  }
}

.card-top {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-2xs, 11px);
}

.lane-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--lane-color, var(--text-muted));

  &.pulse {
    animation: card-pulse 1.9s ease-out infinite;
  }
}

@keyframes card-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--lane-color, var(--accent-primary)) 45%, transparent);
  }

  70% {
    box-shadow: 0 0 0 6px transparent;
  }

  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

.card-num,
.card-local {
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.status-chip {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--surface-glass);
  color: var(--text-secondary);
}

.takeover-badge {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--text-primary);
  color: var(--bg-elevated);
}

.card-title {
  margin: 0;
  font-size: var(--text-sm, 12px);
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-primary);
}

.card-branch {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.card-pr {
  color: var(--accent-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.card-progress {
  height: 3px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--surface-glass);

  i {
    display: block;
    height: 100%;
    background: var(--lane-color, var(--accent-primary));
    transition: width var(--transition-normal);
  }
}

.card-alert {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  padding: 5px 7px;
  border-radius: var(--radius-sm);
  background: var(--warning-glow);
  color: var(--warning);
  font-size: var(--text-2xs, 11px);
}

.card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);
}

.card-foot-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  min-width: 0;
}

/* 变更量占住左侧后，模型名是脚区唯一可挤压的一项，长 ID 省略而不是顶穿卡片。 */
.card-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diffstat {
  display: inline-flex;
  gap: 4px;
  flex: 0 0 auto;
  font-family: var(--font-mono);

  b {
    color: var(--success);
    font-weight: 500;
  }

  em {
    color: var(--error);
    font-style: normal;
  }

  &.empty {
    color: var(--text-disabled);
  }
}

.card-elapsed {
  font-family: var(--font-mono);
}

/* 动作行按泳道给出下一步；窄列里靠换行容纳两个短标签，而不是截断成看不懂的缩写。 */
.card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.card-lock {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--warning);
  font-size: var(--text-2xs, 11px);
}

.card-action {
  padding: 3px 9px;
  border: 1px solid var(--surface-border-strong);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-2xs, 11px);

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &:not(:disabled):hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }

  &.primary {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
  }

  &.danger {
    border-color: color-mix(in srgb, var(--error) 55%, var(--surface-border-strong));
    color: var(--error);
  }
}

@media (prefers-reduced-motion: reduce) {
  .lane-dot.pulse {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
