import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

describe('split layout startup', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
    setActivePinia(createPinia())
  })

  it('does not restore a persisted session pane during desktop startup', async () => {
    localStorage.setItem('app_split_layout', JSON.stringify({
      type: 'leaf',
      id: 'pane-1',
      content: { kind: 'session', tabId: 'session-history-1' },
    }))

    const { useSplitLayoutStore } = await import('../splitLayout')
    const store = useSplitLayoutStore()

    expect(store.activePane?.content).toEqual({ kind: 'main', tabId: null })
  })
})
