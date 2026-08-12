import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppStore } from '../app'

describe('right info panel persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('restores the active terminal instead of the launcher after collapsing', () => {
    const store = useAppStore()
    store.openInfoTab({
      id: 'terminal-panel',
      type: 'terminal',
      title: 'Terminal',
      icon: null,
      data: null,
      closeable: true,
    })

    store.toggleInfoPanel()
    expect(store.infoPanelVisible).toBe(false)

    store.toggleInfoPanel()
    expect(store.infoPanelVisible).toBe(true)
    expect(store.panelHome).toBe(false)
    expect(store.activeInfoTabId).toBe('terminal-panel')
  })
})
