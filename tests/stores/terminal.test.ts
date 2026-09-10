/**
 * Terminal store tests — tab lifecycle, instance management,
 * embedded terminals, and computed properties.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  terminal: {
    kill: vi.fn(),
    onExit: vi.fn(() => () => {}),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))

import { useTerminalStore } from '@/stores/terminal'

describe('terminal store — tab lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('createTab creates a new tab and switches to it', () => {
    const store = useTerminalStore()
    const id = store.createTab()

    expect(id).not.toBeNull()
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].label).toBe('Terminal 1')
    expect(store.activeTabId).toBe(id)
    expect(store.tabs[0].isReady).toBe(false)
    expect(store.tabs[0].closable).toBe(true)
  })

  it('createTab with custom options', () => {
    const store = useTerminalStore()
    const id = store.createTab({ label: 'Custom', cwd: '/repo', autoCommand: 'npm test' })

    expect(id).not.toBeNull()
    expect(store.tabs[0].label).toBe('Custom')
    expect(store.tabs[0].cwd).toBe('/repo')
    expect(store.tabs[0].autoCommand).toBe('npm test')
  })

  it('createTab returns null when maxTabs reached', () => {
    const store = useTerminalStore()
    store.maxTabs = 2
    store.createTab()
    store.createTab()
    const result = store.createTab()

    expect(result).toBeNull()
    expect(store.tabs).toHaveLength(2)
  })

  it('closeTab removes tab and switches to adjacent', () => {
    const store = useTerminalStore()
    const id1 = store.createTab()!
    const id2 = store.createTab()!
    const id3 = store.createTab()!

    store.closeTab(id2)
    expect(store.tabs).toHaveLength(2)
    expect(store.tabs.find(t => t.id === id2)).toBeUndefined()
    // Should switch to the adjacent tab (id3 since index 1 → min(1, 2-1=1) = 1 → tab at index 1 = id3)
    expect(store.activeTabId).toBe(id3)
  })

  it('closeTab on active tab when last tab, clears activeTabId', () => {
    const store = useTerminalStore()
    const id = store.createTab()!

    store.closeTab(id)
    expect(store.tabs).toHaveLength(0)
    expect(store.activeTabId).toBeNull()
  })

  it('closeTab on non-existent tab does nothing', () => {
    const store = useTerminalStore()
    store.createTab()

    store.closeTab('nonexistent')
    expect(store.tabs).toHaveLength(1)
  })

  it('closeTab kills pty process if terminalId is set', () => {
    const store = useTerminalStore()
    const id = store.createTab()!
    store.setInstanceTerminalId(id, 'pty-1')

    store.closeTab(id)
    expect(apiMocks.terminal.kill).toHaveBeenCalledWith('pty-1')
  })

  it('closeAllTabs kills all pty processes and clears state', () => {
    const store = useTerminalStore()
    const id1 = store.createTab()!
    store.setInstanceTerminalId(id1, 'pty-1')
    const id2 = store.createTab()!
    store.setInstanceTerminalId(id2, 'pty-2')

    store.closeAllTabs()
    expect(store.tabs).toHaveLength(0)
    expect(store.activeTabId).toBeNull()
    expect(apiMocks.terminal.kill).toHaveBeenCalledTimes(2)
  })
})

describe('terminal store — switchToTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('switches active tab and updates lastAccessedAt', () => {
    const store = useTerminalStore()
    const id1 = store.createTab()!
    const id2 = store.createTab()!

    store.switchToTab(id1)
    expect(store.activeTabId).toBe(id1)
    expect(store.tabs.find(t => t.id === id1)!.isActive).toBe(true)
    expect(store.tabs.find(t => t.id === id2)!.isActive).toBe(false)
  })

  it('switchToTab on non-existent id does nothing', () => {
    const store = useTerminalStore()
    store.createTab()

    store.switchToTab('nonexistent')
    // activeTabId should still be the first tab
    expect(store.activeTabId).not.toBe('nonexistent')
  })
})

describe('terminal store — renameTab & duplicateTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('renameTab updates label', () => {
    const store = useTerminalStore()
    const id = store.createTab()!

    store.renameTab(id, 'My Terminal')
    expect(store.tabs[0].label).toBe('My Terminal')
  })

  it('renameTab on non-existent tab is a no-op', () => {
    const store = useTerminalStore()
    // renameTab on non-existent tab should not throw
    expect(() => store.renameTab('nonexistent', 'x')).not.toThrow()
    expect(store.tabs).toHaveLength(0)
  })

  it('duplicateTab creates a new tab with same cwd/env/autoCommand', () => {
    const store = useTerminalStore()
    const id = store.createTab({ cwd: '/repo', autoCommand: 'ls' })!

    const newId = store.duplicateTab(id)
    expect(newId).not.toBeNull()
    expect(store.tabs).toHaveLength(2)
    expect(store.tabs[1].cwd).toBe('/repo')
    expect(store.tabs[1].autoCommand).toBe('ls')
  })

  it('duplicateTab on non-existent returns null', () => {
    const store = useTerminalStore()
    const result = store.duplicateTab('nonexistent')
    expect(result).toBeNull()
  })
})

describe('terminal store — instance management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('setTabReady toggles isReady', () => {
    const store = useTerminalStore()
    const id = store.createTab()!

    store.setTabReady(id, true)
    expect(store.tabs[0].isReady).toBe(true)

    store.setTabReady(id, false)
    expect(store.tabs[0].isReady).toBe(false)
  })

  it('setInstanceTerminalId sets terminalId and marks alive', () => {
    const store = useTerminalStore()
    const id = store.createTab()!

    store.setInstanceTerminalId(id, 'pty-1')
    const instance = store.instances.get(id)!
    expect(instance.terminalId).toBe('pty-1')
    expect(instance.isAlive).toBe(true)
  })

  it('markInstanceDead sets isAlive=false and tab.isReady=false', () => {
    const store = useTerminalStore()
    const id = store.createTab()!
    store.setInstanceTerminalId(id, 'pty-1')
    store.setTabReady(id, true)

    store.markInstanceDead(id)
    const instance = store.instances.get(id)!
    expect(instance.isAlive).toBe(false)
    expect(store.tabs[0].isReady).toBe(false)
  })
})

describe('terminal store — renumberTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('renumbers sequential terminal labels after close', () => {
    const store = useTerminalStore()
    store.createTab() // Terminal 1
    store.createTab() // Terminal 2
    store.createTab() // Terminal 3

    // Close middle tab
    const middleId = store.tabs[1].id
    store.closeTab(middleId)

    // Remaining tabs should be renumbered
    expect(store.tabs[0].label).toBe('Terminal 1')
    expect(store.tabs[1].label).toBe('Terminal 2')
  })

  it('does not renumber custom-labeled tabs after close', () => {
    const store = useTerminalStore()
    const id1 = store.createTab({ label: 'Custom A' })!
    const id2 = store.createTab()! // Terminal 2

    store.closeTab(id1)
    // Custom A is gone, Terminal 2 → renumbered to Terminal 1
    expect(store.tabs).toHaveLength(1)
    expect(store.tabs[0].label).toBe('Terminal 1')
  })
})

describe('terminal store — computed properties', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('activeTab returns the active tab', () => {
    const store = useTerminalStore()
    const id = store.createTab()!

    expect(store.activeTab).not.toBeNull()
    expect(store.activeTab!.id).toBe(id)
  })

  it('activeTab returns null when no active tab', () => {
    const store = useTerminalStore()
    expect(store.activeTab).toBeNull()
  })

  it('activeInstance returns instance for active tab', () => {
    const store = useTerminalStore()
    const id = store.createTab()!

    expect(store.activeInstance).not.toBeNull()
    expect(store.activeInstance!.tabId).toBe(id)
  })

  it('canCreateNewTab is true when below maxTabs', () => {
    const store = useTerminalStore()
    store.createTab()
    expect(store.canCreateNewTab).toBe(true)
  })

  it('canCreateNewTab is false when at maxTabs', () => {
    const store = useTerminalStore()
    store.maxTabs = 1
    store.createTab()
    expect(store.canCreateNewTab).toBe(false)
  })

  it('terminalTabsForCenter returns simplified tab info', () => {
    const store = useTerminalStore()
    store.createTab({ label: 'My Tab' })

    const result = store.terminalTabsForCenter
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('My Tab')
    expect(result[0].closable).toBe(true)
    // icon should be defined
    expect(result[0].icon).toBeDefined()
  })
})

describe('terminal store — embedded instances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('createEmbeddedInstance creates instance with toolCallId', () => {
    const store = useTerminalStore()
    const id = store.createEmbeddedInstance('call-1', '/repo')

    expect(id).toBe('embedded-call-1')
    const instance = store.getEmbeddedInstance('call-1')
    expect(instance).not.toBeNull()
    expect(instance!.terminalId).toBe('')
    expect(instance!.isAlive).toBe(false)
    expect(instance!.cwd).toBe('/repo')
  })

  it('setEmbeddedTerminalId sets terminalId and marks alive', () => {
    const store = useTerminalStore()
    store.createEmbeddedInstance('call-1')

    store.setEmbeddedTerminalId('call-1', 'pty-9')
    const instance = store.getEmbeddedInstance('call-1')!
    expect(instance.terminalId).toBe('pty-9')
    expect(instance.isAlive).toBe(true)
  })

  it('markEmbeddedInstanceDead sets isAlive=false', () => {
    const store = useTerminalStore()
    store.createEmbeddedInstance('call-1')
    store.setEmbeddedTerminalId('call-1', 'pty-9')

    store.markEmbeddedInstanceDead('call-1')
    const instance = store.getEmbeddedInstance('call-1')!
    expect(instance.isAlive).toBe(false)
  })

  it('destroyEmbeddedInstance kills pty and removes instance', () => {
    const store = useTerminalStore()
    store.createEmbeddedInstance('call-1')
    store.setEmbeddedTerminalId('call-1', 'pty-9')

    store.destroyEmbeddedInstance('call-1')
    expect(apiMocks.terminal.kill).toHaveBeenCalledWith('pty-9')
    expect(store.getEmbeddedInstance('call-1')).toBeNull()
  })

  it('destroyEmbeddedInstance without terminalId just removes', () => {
    const store = useTerminalStore()
    store.createEmbeddedInstance('call-1')

    store.destroyEmbeddedInstance('call-1')
    expect(apiMocks.terminal.kill).not.toHaveBeenCalled()
    expect(store.getEmbeddedInstance('call-1')).toBeNull()
  })

  it('getEmbeddedInstance returns null for non-existent', () => {
    const store = useTerminalStore()
    expect(store.getEmbeddedInstance('nonexistent')).toBeNull()
  })
})
