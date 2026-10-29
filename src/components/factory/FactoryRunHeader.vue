<template>
  <header class="run-header">
    <div class="rh-row">
      <div class="rh-title">
        <h2>{{ t('factory.boardTitle') }}</h2>
        <span v-if="repoLabel" class="repo" data-run-repo>{{ repoLabel }}</span>
        <span class="pill" :class="statusClass" data-run-status>{{ t(statusKey) }}</span>
        <span class="pill run-id">{{ t('factory.run.id', { id: run.id }) }}</span>
      </div>

      <div class="rh-stats">
        <span class="stat">
          <span class="stat-label">{{ t('factory.run.concurrencyLabel') }}</span>
          <b data-run-concurrency>{{ t('factory.run.concurrency', { running, max: run.maxConcurrency }) }}</b>
        </span>
        <span class="stat">
          <span class="stat-label">{{ t('factory.run.tokens') }}</span>
          <b data-run-tokens>{{ t('factory.run.tokenCount', { count: usage.totalTokens }) }}</b>
        </span>
        <span v-if="showsSpend" class="stat">
          <span class="stat-label">{{ t('factory.run.spend') }}</span>
          <b data-run-spend>${{ spend.toFixed(2) }}</b>
        </span>
        <span class="stat">
          <span class="stat-label">{{ t('factory.run.elapsed') }}</span>
          <b data-run-elapsed>{{ formatClock(run.elapsedMs) }}</b>
        </span>
      </div>

      <div class="rh-actions">
        <button
          class="control-btn"
          data-run-config
          :title="t('factory.run.config')"
          @click="emit('config')"
        >
          <Settings2 :size="13" />
          {{ t('factory.run.config') }}
        </button>
        <button
          class="control-btn"
          :data-run-pause="isPaused ? undefined : 'true'"
          :data-run-resume="isPaused ? 'true' : undefined"
          :disabled="!canControl || pausing"
          :title="canControl ? pauseLabelKey : t('factory.run.disabledHint')"
          @click="togglePause"
        >
          <component :is="isPaused ? Play : Pause" :size="13" />
          {{ t(pauseLabelKey) }}
        </button>
        <button
          class="control-btn danger"
          data-run-stop
          :disabled="!canControl"
          :title="canControl ? t('factory.run.stop') : t('factory.run.disabledHint')"
          @click="requestStop"
        >
          <Square :size="13" />
          {{ t('factory.run.stop') }}
        </button>
        <button class="control-btn primary" data-run-new-run @click="emit('new-run')">
          <Plus :size="13" />
          {{ t('factory.run.newRun') }}
        </button>
      </div>
    </div>

    <div class="pipeline">
      <button
        v-for="segment in FACTORY_SEGMENTS"
        :key="segment.key"
        type="button"
        class="pseg"
        :class="{ flash: flashingLane === segment.key }"
        :data-segment="segment.key"
        @click="focusSegment(segment.key)"
      >
        <i :style="{ background: segment.color }" />
        <span>{{ t(segment.labelKey) }}</span>
        <b data-segment-count>{{ counts[segment.key] }}</b>
      </button>
    </div>

    <p v-if="!canControl" class="disabled-hint" data-run-disabled-hint>
      {{ t('factory.run.disabledHint') }}
    </p>

    <div v-if="attention.length" class="attention">
      <span class="a-label">
        <AlertTriangle :size="13" />
        {{ t('factory.run.attention', { count: attention.length }) }}
      </span>
      <div class="a-items">
        <button
          v-for="task in attention"
          :key="task.id"
          class="a-chip"
          :data-attention-chip="attentionStatus(task).kind"
          @click="emit('select', task.id)"
        >
          <span class="mono">{{ task.id }}</span>
          <span>{{ t(attentionStatus(task).labelKey) }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="stopConfirmOpen"
      class="stop-overlay"
      role="dialog"
      aria-modal="true"
      data-stop-confirm
      @click.self="stopConfirmOpen = false"
    >
      <div class="stop-modal">
        <h3>{{ t('factory.run.stopConfirm.title') }}</h3>
        <p>{{ t('factory.run.stopConfirm.message') }}</p>
        <div class="stop-actions">
          <button type="button" data-stop-cancel @click="stopConfirmOpen = false">
            {{ t('factory.run.stopConfirm.cancel') }}
          </button>
          <button type="button" class="danger" data-stop-confirm-button @click="confirmStop">
            {{ t('factory.run.stopConfirm.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Pause, Play, Plus, Settings2, Square } from 'lucide-vue-next'
import type { FactoryLane, FactoryRun, FactoryTask } from '@/shared/factory'
import {
  FACTORY_SEGMENTS,
  attentionStatus,
  attentionTasks,
  formatClock,
  laneCounts,
  runUsage,
} from '@/stores/factory/board'

const props = defineProps<{
  run: FactoryRun
  tasks: FactoryTask[]
  pausing?: boolean
  /** 运行头部展示的仓库标识；为空时不占位。 */
  repoLabel?: string
}>()

const emit = defineEmits<{
  pause: []
  resume: []
  stop: []
  config: []
  'new-run': []
  select: [id: string]
  'focus-lane': [lane: FactoryLane]
}>()

const { t } = useI18n()

const counts = computed(() => laneCounts(props.tasks))
const running = computed(() => counts.value.implementing + counts.value.reviewing)
const canControl = computed(() => props.run.status === 'running' || props.run.status === 'paused')
const isPaused = computed(() => props.run.paused || props.run.status === 'paused')
const pauseLabelKey = computed(() => (isPaused.value ? 'factory.run.resume' : 'factory.run.pause'))

const usage = computed(() => runUsage(props.tasks))
const spend = computed(() => (usage.value.hasCost ? usage.value.costUsd : props.run.spendUsd))
/** 没有单价信息时不显示花费，只保留 token。 */
const showsSpend = computed(() => usage.value.hasCost || props.run.spendUsd > 0)

function togglePause(): void {
  if (!canControl.value) return
  if (isPaused.value) emit('resume')
  else emit('pause')
}

const attention = computed(() => attentionTasks(props.tasks))

const flashingLane = ref<FactoryLane | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined

function focusSegment(lane: FactoryLane): void {
  emit('focus-lane', lane)
  if (flashTimer) clearTimeout(flashTimer)
  // 先摘掉再挂回，连点同一分段时动画才会重新播放。
  flashingLane.value = null
  void nextTick(() => {
    flashingLane.value = lane
  })
  flashTimer = setTimeout(() => {
    flashingLane.value = null
  }, 700)
}

const stopConfirmOpen = ref(false)

function requestStop(): void {
  if (!canControl.value) return
  stopConfirmOpen.value = true
}

function confirmStop(): void {
  stopConfirmOpen.value = false
  emit('stop')
}

onBeforeUnmount(() => {
  if (flashTimer) clearTimeout(flashTimer)
})

const statusKey = computed(() => {
  if (props.run.status === 'running' && props.run.paused) return 'factory.run.status.paused'
  return `factory.run.status.${props.run.status}`
})

const statusClass = computed(() => {
  if (props.run.status === 'running' && props.run.paused) return 'paused'
  return props.run.status
})
</script>

<style lang="scss" scoped>
.run-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-elevated);
}

.rh-row {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
}

.rh-title {
  display: flex;
  align-items: center;
  gap: 8px;

  h2 {
    margin: 0;
    font-size: var(--text-base, 14px);
    font-weight: 600;
    color: var(--text-primary);
  }

  .repo {
    font-family: var(--font-mono);
    font-size: var(--text-2xs, 11px);
    color: var(--text-muted);
  }
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--surface-glass);
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  &.running {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }

  &.paused {
    background: var(--warning-glow);
    color: var(--warning);
  }

  &.stopped {
    background: var(--surface-glass);
    color: var(--text-disabled);
  }

  &.run-id {
    font-family: var(--font-mono);
  }
}

.rh-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-left: auto;
}

.stat {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  b {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--text-primary);
  }
}

.rh-actions {
  display: flex;
  gap: 6px;
}

.control-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-2xs, 11px);
  cursor: pointer;

  &:disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
    opacity: 0.6;
  }

  &.danger:not(:disabled) {
    color: var(--error);
    border-color: var(--error);
  }

  &.primary:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: #fff;
  }
}

.pipeline {
  display: flex;
  gap: 4px;
}

.pseg {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--surface-glass);
  font-family: inherit;
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: var(--surface-glass-hover, var(--bg-tertiary));
    color: var(--text-secondary);
  }

  &.flash {
    animation: segflash 0.7s ease;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  b {
    margin-left: auto;
    font-weight: 600;
    color: var(--text-secondary);
  }
}

.disabled-hint {
  margin: 0;
  font-size: var(--text-2xs, 11px);
  color: var(--text-disabled);
}

.attention {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.a-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-2xs, 11px);
  color: var(--warning);
}

.a-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.a-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--warning-glow);
  border-radius: var(--radius-full);
  background: var(--warning-glow);
  color: var(--warning);
  font-size: var(--text-2xs, 11px);
  cursor: pointer;

  .mono {
    font-family: var(--font-mono);
  }
}

@keyframes segflash {
  0% {
    background: var(--accent-primary-glow);
  }
  100% {
    background: var(--surface-glass);
  }
}

.stop-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.stop-modal {
  width: 90%;
  max-width: 440px;
  padding: 20px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-xl);

  h3 {
    margin: 0 0 10px;
    font-size: var(--text-base, 14px);
    font-weight: 600;
    color: var(--text-primary);
  }

  p {
    margin: 0 0 18px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-secondary);
  }
}

.stop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;

  button {
    padding: 6px 14px;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md, 8px);
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;

    &.danger {
      border-color: var(--error);
      background: var(--error);
      color: #fff;
    }
  }
}
</style>
