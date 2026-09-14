// tests/stores/orchestrationTab.test.ts
// 编排 tab 生命周期测试 — 验证 openOrchestrationTab / closeCenterTab 对编排 tab 的管理。
// Seam: appStore 公共接口

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppStore } from '@/stores/app'

describe('orchestration tab lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('openOrchestrationTab adds a closable orchestration tab and activates it', () => {
    const store = useAppStore()
    const initialCount = store.centerTabs.length

    store.openOrchestrationTab()

    // A new tab was added
    expect(store.centerTabs.length).toBe(initialCount + 1)

    // The new tab has the orchestration- prefix and is closable
    const orchTab = store.centerTabs.find(
      t => t.id.startsWith('orchestration-') && t.id !== 'orchestration'
    )
    expect(orchTab).toBeDefined()
    expect(orchTab!.closable).toBe(true)

    // The new tab is active
    expect(store.activeCenterTab).toBe(orchTab!.id)
  })

  it('closeCenterTab removes an orchestration tab', () => {
    const store = useAppStore()
    store.openOrchestrationTab()
    const orchTab = store.centerTabs.find(t => t.id.startsWith('orchestration-'))!
    const tabId = orchTab.id

    expect(store.centerTabs.find(t => t.id === tabId)).toBeDefined()

    store.closeCenterTab(tabId)

    expect(store.centerTabs.find(t => t.id === tabId)).toBeUndefined()
  })

  it('closing the active orchestration tab falls back to chat', () => {
    const store = useAppStore()
    store.openOrchestrationTab()
    const orchTab = store.centerTabs.find(t => t.id.startsWith('orchestration-'))!

    expect(store.activeCenterTab).toBe(orchTab.id)

    store.closeCenterTab(orchTab.id)

    expect(store.activeCenterTab).toBe('chat')
  })

  it('opening orchestration tab does not duplicate when already open', () => {
    const store = useAppStore()
    store.openOrchestrationTab()
    const firstTab = store.centerTabs.find(t => t.id.startsWith('orchestration-'))!
    const countAfterFirst = store.centerTabs.length

    // Open again — should activate existing tab, not create a new one
    store.openOrchestrationTab()

    expect(store.centerTabs.length).toBe(countAfterFirst)
    expect(store.activeCenterTab).toBe(firstTab.id)
  })
})
