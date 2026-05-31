import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import type { HookEventType, HookType, HookScope, HookFlatItem, HookMatcher } from '@/types/hooks'
import { eventHasMatcher } from '@/types/hooks'

const HOOKS_STORAGE_KEY = 'hooks_config'

interface RawHookEntry {
  type: HookType
  command?: string
  prompt?: string
  timeout?: number
  disabled?: boolean
}

interface RawHookMatcher {
  matcher: string
  hooks: RawHookEntry[]
}

type RawHooksConfig = Partial<Record<HookEventType, RawHookMatcher[]>>

function generateId(): string {
  return crypto.randomUUID()
}

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const saved = localStorage.getItem(key)
    if (saved) return JSON.parse(saved)
  } catch (e) {
    console.error(`[HooksStore] Failed to load ${key}:`, e)
  }
  return defaultValue
}

function saveToStorage<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error(`[HooksStore] Failed to save ${key}:`, e)
  }
}

export const useHooksStore = defineStore('hooks', () => {
  const hooks = ref<HookFlatItem[]>(loadFromStorage(HOOKS_STORAGE_KEY, []))
  const activeScope = ref<HookScope>('project')
  const loading = ref(false)

  const hooksByEvent = computed(() => {
    const map = new Map<HookEventType, HookFlatItem[]>()
    for (const hook of hooks.value) {
      const list = map.get(hook.event) ?? []
      list.push(hook)
      map.set(hook.event, list)
    }
    return map
  })

  const enabledCount = computed(() => hooks.value.filter(h => !h.disabled).length)
  const totalCount = computed(() => hooks.value.length)

  function getHooksForEvent(event: HookEventType): HookFlatItem[] {
    return hooksByEvent.value.get(event) ?? []
  }

  function addHook(data: Omit<HookFlatItem, 'id'>) {
    const hook: HookFlatItem = { ...data, id: generateId() }
    hooks.value = [...hooks.value, hook]
    saveToStorage(HOOKS_STORAGE_KEY, hooks.value)
  }

  function updateHook(id: string, updates: Partial<HookFlatItem>) {
    hooks.value = hooks.value.map(h =>
      h.id === id ? { ...h, ...updates } : h
    )
    saveToStorage(HOOKS_STORAGE_KEY, hooks.value)
  }

  function removeHook(id: string) {
    hooks.value = hooks.value.filter(h => h.id !== id)
    saveToStorage(HOOKS_STORAGE_KEY, hooks.value)
  }

  function toggleHook(id: string) {
    const hook = hooks.value.find(h => h.id === id)
    if (hook) {
      updateHook(id, { disabled: !hook.disabled })
    }
  }

  function toRawConfig(): RawHooksConfig {
    const config: RawHooksConfig = {}
    for (const hook of hooks.value) {
      if (hook.disabled) continue
      if (!config[hook.event]) {
        config[hook.event] = []
      }
      const matchers = config[hook.event]!
      let matcherGroup = matchers.find(m => m.matcher === hook.matcher)
      if (!matcherGroup) {
        matcherGroup = { matcher: hook.matcher, hooks: [] }
        matchers.push(matcherGroup)
      }
      const entry: RawHookEntry = { type: hook.type }
      if (hook.type === 'command') entry.command = hook.command
      if (hook.type === 'prompt') entry.prompt = hook.command
      if (hook.timeout && hook.timeout !== 30) entry.timeout = hook.timeout
      matcherGroup.hooks.push(entry)
    }
    return config
  }

  function fromRawConfig(config: RawHooksConfig, scope: HookScope) {
    const items: HookFlatItem[] = []
    for (const [event, matchers] of Object.entries(config)) {
      for (const matcher of matchers as RawHookMatcher[]) {
        for (const hook of matcher.hooks) {
          items.push({
            id: generateId(),
            name: '',
            event: event as HookEventType,
            matcher: matcher.matcher,
            type: hook.type,
            command: hook.type === 'command' ? (hook.command ?? '') : (hook.prompt ?? ''),
            timeout: hook.timeout ?? 30,
            scope,
            disabled: hook.disabled ?? false,
          })
        }
      }
    }
    return items
  }

  async function loadFromSettingsFile() {
    loading.value = true
    try {
      const result = await api.loadHooksSettings()
      if (result.success && result.data) {
        const parsed = JSON.parse(result.data)
        const items = fromRawConfig(parsed, activeScope.value)
        hooks.value = items
        saveToStorage(HOOKS_STORAGE_KEY, hooks.value)
      }
    } catch (e) {
      console.error('[HooksStore] Failed to load from settings file:', e)
    } finally {
      loading.value = false
    }
  }

  async function saveToSettingsFile() {
    try {
      const config = toRawConfig()
      const jsonStr = JSON.stringify({ hooks: config }, null, 2)
      await api.saveHooksSettings(jsonStr, activeScope.value)
    } catch (e) {
      console.error('[HooksStore] Failed to save to settings file:', e)
    }
  }

  return {
    hooks,
    activeScope,
    loading,
    hooksByEvent,
    enabledCount,
    totalCount,
    getHooksForEvent,
    addHook,
    updateHook,
    removeHook,
    toggleHook,
    toRawConfig,
    fromRawConfig,
    loadFromSettingsFile,
    saveToSettingsFile,
  }
})
