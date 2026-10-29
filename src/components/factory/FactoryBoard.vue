<template>
  <div ref="boardEl" class="factory-board">
    <section
      v-for="lane in FACTORY_LANES"
      :key="lane.key"
      class="board-lane"
      :data-lane="lane.key"
      :style="{ '--lane-color': lane.color }"
    >
      <header class="lane-head">
        <i />
        <span>{{ t(lane.labelKey) }}</span>
        <b data-lane-count>{{ grouped[lane.key].length }}</b>
      </header>

      <div class="lane-cards">
        <FactoryCard
          v-for="task in grouped[lane.key]"
          :key="task.id"
          :task="task"
          :selected="task.id === selectedId"
          :now-ms="nowMs"
          :run="run"
          @select="emit('select', $event)"
          @return="emit('return', $event)"
        />
        <div v-if="!grouped[lane.key].length" class="lane-empty" data-lane-empty>
          {{ t('factory.laneEmpty') }}
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FactoryLane, FactoryRun, FactoryTask } from '@/shared/factory'
import { FACTORY_LANES, tasksByLane } from '@/stores/factory/board'
import FactoryCard from './FactoryCard.vue'

const props = withDefaults(
  defineProps<{
    tasks: FactoryTask[]
    selectedId: string | null
    /** 卡片的脉冲跟着运行走：泳道只负责分组，运行态由整块看板共享。 */
    run: FactoryRun | null
    nowMs?: number
  }>(),
  { nowMs: () => Date.now() },
)

const emit = defineEmits<{ select: [id: string]; return: [id: string] }>()

const { t } = useI18n()

const boardEl = ref<HTMLElement | null>(null)

const grouped = computed<Record<FactoryLane, FactoryTask[]>>(() => {
  const lanes = {} as Record<FactoryLane, FactoryTask[]>
  for (const lane of FACTORY_LANES) lanes[lane.key] = tasksByLane(props.tasks, lane.key)
  return lanes
})

/**
 * 运行头部点分段时把对应泳道横向滚进视野。
 * 只滚看板自己的容器：用 scrollIntoView 会连带滚动外层 overflow 容器，挤走左右两栏。
 */
function focusLane(lane: FactoryLane): void {
  const board = boardEl.value
  const laneEl = board?.querySelector<HTMLElement>(`[data-lane="${lane}"]`)
  if (!board || !laneEl) return
  const left =
    board.scrollLeft +
    laneEl.getBoundingClientRect().left -
    board.getBoundingClientRect().left
  board.scrollTo({ left, behavior: 'smooth' })
}

defineExpose({ focusLane })
</script>

<style lang="scss" scoped>
/* 窄窗口下泳道守住最小列宽，整块看板横向滚动；纵向滚动留给每条泳道自己的卡片区。 */
.factory-board {
  display: flex;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 8px;
  @include scrollbar-overlay;
}

.board-lane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 0;
  min-width: 200px;
  min-height: 0;

  &::before {
    content: '';
    height: 2px;
    border-radius: 2px;
    background: var(--lane-color);
    opacity: 0.7;
  }
}

.lane-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px;
  font-size: var(--text-2xs, 11px);
  color: var(--text-muted);

  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--lane-color);
  }

  b {
    margin-left: auto;
    font-weight: 600;
    color: var(--text-secondary);
  }
}

.lane-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--surface-glass);
  @include scrollbar-overlay;
}

.lane-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  color: var(--text-disabled);
  font-size: var(--text-2xs, 11px);
}
</style>
