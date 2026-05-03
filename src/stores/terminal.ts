import { defineStore } from 'pinia'
import { ref, computed, markRaw } from 'vue'
import { Terminal as TerminalIcon } from 'lucide-vue-next'

export interface TerminalTab {
  id: string
  label: string
  icon: any
  closable: boolean
  createdAt: number
  lastAccessedAt: number
  cwd?: string
  env?: Record<string, string>
  autoCommand?: string
  isReady: boolean
  isActive: boolean
}

export interface TerminalInstance {
  id: string
  tabId: string
  terminalId: string | null
  isAlive: boolean
}

export interface CreateTerminalOptions {
  cwd?: string
  env?: Record<string, string>
  autoCommand?: string
  label?: string
}

export const useTerminalStore = defineStore('terminal', () => {
  const tabs = ref<TerminalTab[]>([])
  const instances = ref<Map<string, TerminalInstance>>(new Map())
  const activeTabId = ref<string | null>(null)
  const counter = ref(1)
  const maxTabs = ref(10)

  const activeTab = computed(() =>
    tabs.value.find(t => t.id === activeTabId.value) || null
  )

  const activeInstance = computed(() => {
    if (!activeTabId.value) return null
    return instances.value.get(activeTabId.value) || null
  })

  const canCreateNewTab = computed(() => tabs.value.length < maxTabs.value)

  const terminalTabsForCenter = computed(() =>
    tabs.value.map(tab => ({
      id: tab.id,
      label: tab.label,
      icon: tab.icon,
      closable: tab.closable
    }))
  )

  function createTab(options?: CreateTerminalOptions): string | null {
    if (!canCreateNewTab.value) {
      console.warn('[TerminalStore] Max tabs reached:', maxTabs.value)
      return null
    }

    const id = `terminal-${counter.value++}`
    const now = Date.now()

    const tab: TerminalTab = {
      id,
      label: options?.label || `Terminal ${tabs.value.length + 1}`,
      icon: markRaw(TerminalIcon),
      closable: true,
      createdAt: now,
      lastAccessedAt: now,
      cwd: options?.cwd,
      env: options?.env,
      autoCommand: options?.autoCommand,
      isReady: false,
      isActive: false
    }

    tabs.value.push(tab)

    const instance: TerminalInstance = {
      id: `${id}-instance`,
      tabId: id,
      terminalId: null,
      isAlive: false
    }
    instances.value.set(id, instance)

    switchToTab(id)

    return id
  }

  function closeTab(tabId: string): void {
    const tabIndex = tabs.value.findIndex(t => t.id === tabId)
    if (tabIndex === -1) return

    const instance = instances.value.get(tabId)
    if (instance) {
      instances.value.delete(tabId)
    }

    tabs.value.splice(tabIndex, 1)

    renumberTabs()

    if (activeTabId.value === tabId) {
      if (tabs.value.length > 0) {
        const newIndex = Math.min(tabIndex, tabs.value.length - 1)
        switchToTab(tabs.value[newIndex].id)
      } else {
        activeTabId.value = null
      }
    }
  }

  function switchToTab(tabId: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return

    if (activeTabId.value) {
      const oldTab = tabs.value.find(t => t.id === activeTabId.value)
      if (oldTab) {
        oldTab.isActive = false
      }
    }

    activeTabId.value = tabId
    tab.isActive = true
    tab.lastAccessedAt = Date.now()
  }

  function renameTab(tabId: string, newLabel: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) {
      tab.label = newLabel
    }
  }

  function duplicateTab(tabId: string): string | null {
    const sourceTab = tabs.value.find(t => t.id === tabId)
    if (!sourceTab) return null

    return createTab({
      cwd: sourceTab.cwd,
      env: sourceTab.env,
      autoCommand: sourceTab.autoCommand
    })
  }

  function setTabReady(tabId: string, ready: boolean): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) {
      tab.isReady = ready
    }
  }

  function setInstanceTerminalId(tabId: string, terminalId: string): void {
    const instance = instances.value.get(tabId)
    if (instance) {
      instance.terminalId = terminalId
      instance.isAlive = true
    }
  }

  function markInstanceDead(tabId: string): void {
    const instance = instances.value.get(tabId)
    if (instance) {
      instance.isAlive = false
    }
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) {
      tab.isReady = false
    }
  }

  function renumberTabs(): void {
    const terminalTabs = tabs.value
    terminalTabs.forEach((tab, index) => {
      if (tab.label.match(/^Terminal \d+$/)) {
        tab.label = `Terminal ${index + 1}`
      }
    })
  }

  function closeAllTabs(): void {
    tabs.value = []
    instances.value.clear()
    activeTabId.value = null
  }

  return {
    tabs,
    instances,
    activeTabId,
    counter,
    maxTabs,
    activeTab,
    activeInstance,
    canCreateNewTab,
    terminalTabsForCenter,
    createTab,
    closeTab,
    switchToTab,
    renameTab,
    duplicateTab,
    setTabReady,
    setInstanceTerminalId,
    markInstanceDead,
    closeAllTabs
  }
})
