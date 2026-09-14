// tests/composables/useOrchestrationCanvas.test.ts
// 编排画布 composable 测试 — 小地图开关状态。
// Seam: useOrchestrationCanvas 公共接口

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useOrchestrationCanvas } from '@/composables/useOrchestrationCanvas'

describe('useOrchestrationCanvas — minimap toggle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('minimap is visible by default', () => {
    const { showMinimap } = useOrchestrationCanvas()
    expect(showMinimap.value).toBe(true)
  })

  it('toggleMinimap flips the state', () => {
    const { showMinimap, toggleMinimap } = useOrchestrationCanvas()

    expect(showMinimap.value).toBe(true)

    toggleMinimap()
    expect(showMinimap.value).toBe(false)

    toggleMinimap()
    expect(showMinimap.value).toBe(true)
  })
})
