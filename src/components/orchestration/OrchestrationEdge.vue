<template>
  <!--
    编排连线（自定义 Edge）— 在 vue-flow 默认贝塞尔连线上叠加"流动"高亮层，
    并按上游节点状态切换配色，让依赖方向、进度和断裂一眼可读。
  -->
  <g class="orch-edge" :class="`is-${state}`" :style="{ color }">
    <!-- 基础线：状态底色 + 上游失败/跳过时转为虚线 -->
    <path
      class="orch-edge__base"
      :d="path"
      fill="none"
      stroke="currentColor"
      :style="baseStyle"
      :marker-end="markerEnd"
      :marker-start="markerStart"
    />

    <!-- 交互热区（保持 vue-flow 默认的连线点击手感） -->
    <path
      class="orch-edge__interaction"
      :d="path"
      fill="none"
      :stroke-width="interactionWidth ?? 20"
      stroke-opacity="0"
    />

    <!-- 流动高亮层：短划线沿路径推进，表达"依赖正在被消费 / 待触发" -->
    <path
      v-if="hasFlowOverlay(state)"
      class="orch-edge__flow"
      :d="path"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linecap="round"
    />

    <!-- 流动光点：仅上游运行中，一颗光点从上游跑到下游 -->
    <circle v-if="state === 'active'" class="orch-edge__packet" r="3.2" fill="currentColor">
      <animateMotion :dur="`${PACKET_DURATION_SECONDS}s`" repeatCount="indefinite" :path="path" />
    </circle>
  </g>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getBezierPath, Position } from '@vue-flow/core'
import {
  EDGE_STATE_BASE_OPACITY,
  EDGE_STATE_COLORS,
  hasFlowOverlay,
  type EdgeVisualState,
} from './edgeVisuals'

// vue-flow 会把 edge 的全部字段、坐标、marker、事件等作为 props 传入；
// 未声明的一律丢弃，避免 fragment 根节点上的 attrs 继承告警。
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id?: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition?: Position
  targetPosition?: Position
  markerEnd?: string
  markerStart?: string
  interactionWidth?: number
  data?: { state?: EdgeVisualState }
}>()

/** 光点跑完全程的时长（秒） */
const PACKET_DURATION_SECONDS = 1.8

/** 视觉状态 — 由画布层按上游节点状态推导后写入 edge.data */
const state = computed<EdgeVisualState>(() => props.data?.state ?? 'idle')

const color = computed(() => EDGE_STATE_COLORS[state.value])

const path = computed(() => {
  const [pathDefinition] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition ?? Position.Left,
    targetPosition: props.targetPosition ?? Position.Right,
  })
  return pathDefinition
})

const baseStyle = computed(() => ({
  strokeOpacity: EDGE_STATE_BASE_OPACITY[state.value],
  strokeWidth: state.value === 'active' ? 2.6 : 2,
}))
</script>

<style lang="scss" scoped>
.orch-edge__base {
  // 状态切换时颜色/粗细/透明度平滑过渡
  transition:
    stroke-opacity 0.35s ease,
    stroke-width 0.35s ease;
}

.orch-edge.is-blocked .orch-edge__base {
  stroke-dasharray: 4 6;
}

.orch-edge__interaction {
  cursor: pointer;
}

.orch-edge__flow {
  pointer-events: none;
  stroke-dasharray: 8 14;
  opacity: 0.95;
  // 一周期 = 8 + 14
  animation: orch-edge-flow-slow 2.4s linear infinite;
}

.orch-edge.is-active .orch-edge__flow {
  animation: orch-edge-flow-active 0.9s linear infinite;
}

.orch-edge.is-active .orch-edge__base {
  filter: drop-shadow(0 0 3px currentColor);
}

.orch-edge__packet {
  pointer-events: none;
  filter: drop-shadow(0 0 4px currentColor);
}

// 虚线沿路径正方向推进（负 offset 即向下游流动）
@keyframes orch-edge-flow-active {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: -22;
  }
}

@keyframes orch-edge-flow-slow {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: -22;
  }
}

// 尊重系统的"减弱动效"设置：保留配色与虚线区分，仅去掉位移动画
@media (prefers-reduced-motion: reduce) {
  .orch-edge__flow,
  .orch-edge.is-active .orch-edge__flow {
    animation: none;
  }

  .orch-edge__packet {
    display: none;
  }
}
</style>
