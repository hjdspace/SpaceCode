<template>
  <!-- Leaf：渲染单个 pane -->
  <PaneLeafView v-if="isLeaf" :node="(node as PaneLeaf)" />

  <!-- Split：递归渲染两个孩子 + 中间分隔条 -->
  <div
    v-else
    ref="splitElRef"
    class="pane-split"
    :class="splitNode.direction"
    :style="splitStyle"
  >
    <PaneNodeView :node="splitNode.children[0]" />
    <PaneDivider
      :split-id="splitNode.id"
      :direction="splitNode.direction"
      :container-ref="splitElRef"
    />
    <PaneNodeView :node="splitNode.children[1]" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PaneNode, PaneLeaf, PaneSplit } from '@/stores/splitLayout'
import PaneLeafView from './PaneLeafView.vue'
import PaneDivider from './PaneDivider.vue'

const props = defineProps<{
  node: PaneNode
}>()

const isLeaf = computed(() => props.node.type === 'leaf')
const splitNode = computed(() => props.node as PaneSplit)
const splitElRef = ref<HTMLElement | null>(null)

const splitStyle = computed(() => {
  if (props.node.type !== 'split') return {}
  const r = props.node.ratio
  const first = (r * 100).toFixed(2) + '%'
  const second = ((1 - r) * 100).toFixed(2) + '%'
  return {
    '--pane-ratio-1': first,
    '--pane-ratio-2': second,
  } as Record<string, string>
})
</script>

<style lang="scss" scoped>
.pane-split {
  flex: 1;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  gap: 0;
  width: 100%;
  height: 100%;

  &.row {
    grid-template-columns: var(--pane-ratio-1) 4px var(--pane-ratio-2);
    grid-template-rows: 100%;
  }

  &.column {
    grid-template-rows: var(--pane-ratio-1) 4px var(--pane-ratio-2);
    grid-template-columns: 100%;
  }
}
</style>
