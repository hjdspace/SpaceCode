<template>
  <div class="git-graph">
    <svg
      v-for="(row, i) in rows"
      :key="i"
      class="git-graph-row"
      :width="row.laneCount * COL_W"
      :height="ROW_H"
    >
      <!-- Pass-through / branch edges -->
      <path
        v-for="(e, ei) in row.edges"
        :key="ei"
        :d="edgePath(e)"
        :stroke="edgeColor(e.colorIndex)"
        stroke-width="1.5"
        fill="none"
      />
      <!-- Commit node -->
      <circle
        :cx="laneX(row.nodeLane)"
        :cy="ROW_H / 2"
        :r="NODE_R"
        :fill="edgeColor(row.colorIndex)"
        :stroke="isHead(row, i) ? 'var(--accent-primary)' : 'none'"
        :stroke-width="isHead(row, i) ? 1.5 : 0"
      />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { GRAPH_COLOR_COUNT, type GraphEdge, type GraphRow } from '@/composables/useGitGraphLayout'

defineProps<{
  rows: GraphRow<any>[]
}>()

const ROW_H = 26
const COL_W = 13
const NODE_R = 4

const COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f97316', // orange
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#eab308', // yellow
  '#ec4899', // pink
  '#14b8a6', // teal
]

function edgeColor(index: number): string {
  return COLORS[((index % GRAPH_COLOR_COUNT) + GRAPH_COLOR_COUNT) % GRAPH_COLOR_COUNT]!
}

function laneX(lane: number): number {
  return lane * COL_W + COL_W / 2
}

function edgePath(e: GraphEdge): string {
  const x1 = laneX(e.fromLane)
  const x2 = laneX(e.toLane)
  const midY = ROW_H / 2
  if (e.fromLane === e.toLane) {
    return `M ${x1} 0 L ${x1} ${ROW_H}`
  }
  // Smooth cubic bezier between the two lanes
  return `M ${x1} 0 C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${ROW_H}`
}

function isHead(row: GraphRow<any>, index: number): boolean {
  return index === 0 || (row.entry.refs?.includes('HEAD') ?? false)
}
</script>

<style lang="scss" scoped>
.git-graph {
  display: flex;
  flex-direction: column;
}

.git-graph-row {
  display: block;
  flex-shrink: 0;
}
</style>
