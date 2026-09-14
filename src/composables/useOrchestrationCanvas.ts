// src/composables/useOrchestrationCanvas.ts
// 编排画布 composable — 管理画布 UI 状态（小地图开关等）。
// 术语遵循 CONTEXT.md 的 Session Orchestration 词汇表。

import { ref } from 'vue'

/** 单例状态 — 多个画布组件实例共享同一小地图开关 */
const _showMinimap = ref(true)

export function useOrchestrationCanvas() {
  const showMinimap = _showMinimap

  function toggleMinimap() {
    _showMinimap.value = !_showMinimap.value
  }

  return {
    showMinimap,
    toggleMinimap,
  }
}
