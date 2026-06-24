<template>
  <main class="split-container">
    <PaneNodeView :node="splitLayout.root" />
  </main>
</template>

<script setup lang="ts">
/**
 * SplitContainer — 中央区分屏根容器
 *
 * 阶段 2 职责：以单 leaf 默认布局接管原 `<ChatPanel/>` 的渲染位置。leaf 内容为
 * 'main' 时直接渲染 ChatPanel（不传 sessionId），ChatPanel 内部回退到全局
 * currentSessionId，所以肉眼可见的行为与改造前完全一致。
 *
 * 阶段 3 会在这里新增「拖拽 Tab 到 pane 分屏」的 dropzone overlay；阶段 4 会
 * 把 TerminalContainer 用 Teleport 挂到 leaf 上，并新增 PaneHeader。
 */
import { useSplitLayoutStore } from '@/stores/splitLayout'
import PaneNodeView from './PaneNodeView.vue'

const splitLayout = useSplitLayoutStore()
</script>

<style lang="scss" scoped>
.split-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  position: relative;
}
</style>
