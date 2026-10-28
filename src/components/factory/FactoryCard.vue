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
      <span class="lane-dot" />
      <span v-if="task.issueNumber !== undefined" class="card-num">#{{ task.issueNumber }}</span>
      <span v-else class="card-local">{{ t('factory.cardLocal') }}</span>
      <span class="status-chip">{{ status.params ? t(status.key, status.params) : t(status.key) }}</span>
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

    <div class="card-progress" data-card-progress>
      <i :style="{ width: `${percent}%` }" />
    </div>

    <div v-if="task.lane === 'blocked' && task.attention" class="card-alert">
      <AlertTriangle :size="13" />
      <span>{{ attentionText }}</span>
    </div>

    <div class="card-foot">
      <span class="card-model">{{ task.model || t('factory.modelUnknown') }}</span>
      <button
        v-if="canReturn"
        class="card-return"
        data-card-return
        @click.stop="emit('return', task.id)"
      >
        {{ t('factory.actions.return') }}
      </button>
      <span class="card-elapsed" data-card-elapsed>{{ formatClock(elapsedMs) }}</span>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Folder, GitBranch } from 'lucide-vue-next'
import type { FactoryTask } from '@/shared/factory'
import {
  canReturnTask,
  formatClock,
  taskElapsedMs,
  taskStagePercent,
  taskStatus,
} from '@/stores/factory/board'

const props = defineProps<{
  task: FactoryTask
  selected: boolean
  nowMs: number
}>()

const emit = defineEmits<{ select: [id: string]; return: [id: string] }>()

const { t } = useI18n()

const status = computed(() => taskStatus(props.task))
const percent = computed(() => taskStagePercent(props.task))
const elapsedMs = computed(() => taskElapsedMs(props.task, props.nowMs))
const canReturn = computed(() => canReturnTask(props.task))
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
  justify-content: space-between;
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);
}

.card-elapsed {
  font-family: var(--font-mono);
}

.card-return {
  margin-left: auto;
  padding: 1px 7px;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--accent-primary);
  font-size: var(--text-2xs, 11px);

  &:hover {
    background: var(--accent-primary);
    color: var(--bg-elevated);
  }
}
</style>
