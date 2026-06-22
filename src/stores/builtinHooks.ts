import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { HookScope, HookFlatItem } from '@/types/hooks'
import {
  BUILTIN_HOOKS,
  getBuiltinHook,
  getBuiltinProvider,
  buildBuiltinHookName,
  buildProviderCommand,
  type BuiltinHookDefinition,
  type BuiltinHookProvider,
} from '@/types/builtinHooks'
import { useHooksStore } from './hooks'

const BUILTIN_HOOKS_STATE_KEY = 'builtin_hooks_state'

/**
 * 单个内置 Hook 的持久化状态
 */
export interface BuiltinHookState {
  enabled: boolean
  providerId: string
  config: Record<string, string>
  installedHookId: string | null
  scope: HookScope
}

export type BuiltinHooksStateMap = Record<string, BuiltinHookState>

function loadState(): BuiltinHooksStateMap {
  try {
    const saved = localStorage.getItem(BUILTIN_HOOKS_STATE_KEY)
    if (saved) return JSON.parse(saved)
  } catch (e) {
    console.error('[BuiltinHooksStore] Failed to load state:', e)
  }
  return {}
}

function persistState(state: BuiltinHooksStateMap) {
  try {
    localStorage.setItem(BUILTIN_HOOKS_STATE_KEY, JSON.stringify(state))
  } catch (e) {
    console.error('[BuiltinHooksStore] Failed to save state:', e)
  }
}

function defaultState(): BuiltinHookState {
  return {
    enabled: false,
    providerId: '',
    config: {},
    installedHookId: null,
    scope: 'user',
  }
}

export const useBuiltinHooksStore = defineStore('builtinHooks', () => {
  const state = ref<BuiltinHooksStateMap>(loadState())

  const definitions = BUILTIN_HOOKS

  const enabledCount = computed(() =>
    Object.values(state.value).filter(s => s.enabled).length,
  )

  function getState(builtinId: string): BuiltinHookState {
    return state.value[builtinId] ?? defaultState()
  }

  function isConfigured(builtinId: string): boolean {
    const s = state.value[builtinId]
    if (!s || !s.providerId) return false
    const provider = getBuiltinProvider(builtinId, s.providerId)
    if (!provider) return false
    for (const field of provider.configFields) {
      if (field.required && !(s.config[field.key] || '').trim()) {
        return false
      }
    }
    return true
  }

  function saveState() {
    persistState(state.value)
  }

  function setProviderConfig(
    builtinId: string,
    providerId: string,
    config: Record<string, string>,
    scope: HookScope,
  ) {
    const prev = state.value[builtinId] ?? defaultState()
    state.value = {
      ...state.value,
      [builtinId]: {
        ...prev,
        providerId,
        config: { ...config },
        scope,
      },
    }
    saveState()
  }

  /**
   * 启用内置 hook：将其作为 HookFlatItem 注入 hooks store，并持久化关联
   */
  async function enable(builtinId: string): Promise<{ ok: boolean; error?: string }> {
    const def = getBuiltinHook(builtinId)
    if (!def) return { ok: false, error: 'definition not found' }
    const cur = state.value[builtinId]
    if (!cur || !cur.providerId) {
      return { ok: false, error: 'not configured' }
    }
    const provider = getBuiltinProvider(builtinId, cur.providerId)
    if (!provider) return { ok: false, error: 'provider not found' }
    if (!isConfigured(builtinId)) {
      return { ok: false, error: 'config incomplete' }
    }

    const hooksStore = useHooksStore()
    // 切换到目标 scope 并加载，避免覆盖其它 scope 的 hook
    if (hooksStore.activeScope !== cur.scope) {
      hooksStore.activeScope = cur.scope
      await hooksStore.loadFromSettingsFile()
    }

    let command: string
    try {
      command = await buildProviderCommand(provider, cur.config)
    } catch (err) {
      console.error('[BuiltinHooksStore] buildProviderCommand failed:', err)
      return { ok: false, error: 'build command failed' }
    }
    const name = buildBuiltinHookName(def, provider)

    // 若旧的 installedHookId 仍存在则先移除（处理重新启用 / 重新配置）
    if (cur.installedHookId) {
      const existing = hooksStore.hooks.find((h: HookFlatItem) => h.id === cur.installedHookId)
      if (existing) hooksStore.removeHook(cur.installedHookId)
    }

    // 同名残留也清掉，避免重复
    const dupes = hooksStore.hooks.filter(
      (h: HookFlatItem) => h.name === name && h.event === def.event,
    )
    for (const d of dupes) hooksStore.removeHook(d.id)

    hooksStore.addHook({
      name,
      event: def.event,
      matcher: def.matcher ?? '',
      type: 'command',
      command,
      timeout: def.timeout ?? 30,
      scope: cur.scope,
      disabled: false,
    })

    const created = hooksStore.hooks[hooksStore.hooks.length - 1]
    state.value = {
      ...state.value,
      [builtinId]: {
        ...cur,
        enabled: true,
        installedHookId: created?.id ?? null,
      },
    }
    saveState()
    await hooksStore.saveToSettingsFile()
    return { ok: true }
  }

  /**
   * 关闭内置 hook：从 hooks store 中移除关联的 HookFlatItem，但保留配置
   */
  async function disable(builtinId: string): Promise<void> {
    const cur = state.value[builtinId]
    if (!cur) return
    const hooksStore = useHooksStore()
    if (cur.scope && hooksStore.activeScope !== cur.scope) {
      hooksStore.activeScope = cur.scope
      await hooksStore.loadFromSettingsFile()
    }
    if (cur.installedHookId) {
      const existing = hooksStore.hooks.find((h: HookFlatItem) => h.id === cur.installedHookId)
      if (existing) hooksStore.removeHook(cur.installedHookId)
    }
    state.value = {
      ...state.value,
      [builtinId]: {
        ...cur,
        enabled: false,
        installedHookId: null,
      },
    }
    saveState()
    await hooksStore.saveToSettingsFile()
  }

  /**
   * 配置 + 启用一站式入口（用户填完表单点确认时调用）
   */
  async function applyAndEnable(
    builtinId: string,
    providerId: string,
    config: Record<string, string>,
    scope: HookScope,
  ): Promise<{ ok: boolean; error?: string }> {
    setProviderConfig(builtinId, providerId, config, scope)
    return await enable(builtinId)
  }

  /**
   * 已启用时修改配置：重建 command 并更新已注册 hook
   */
  async function reconfigure(
    builtinId: string,
    providerId: string,
    config: Record<string, string>,
    scope: HookScope,
  ): Promise<{ ok: boolean; error?: string }> {
    const prev = state.value[builtinId]
    setProviderConfig(builtinId, providerId, config, scope)
    if (prev?.enabled) {
      // 先 disable 旧的（可能 scope 也改了），再重新启用
      if (prev.installedHookId && prev.scope) {
        const hooksStore = useHooksStore()
        if (hooksStore.activeScope !== prev.scope) {
          hooksStore.activeScope = prev.scope
          await hooksStore.loadFromSettingsFile()
        }
        const existing = hooksStore.hooks.find((h: HookFlatItem) => h.id === prev.installedHookId)
        if (existing) {
          hooksStore.removeHook(prev.installedHookId)
          await hooksStore.saveToSettingsFile()
        }
      }
      return await enable(builtinId)
    }
    return { ok: true }
  }

  /**
   * 启动校验：若已启用的内置 hook 在 hooks store 中找不到对应项，重置为未启用。
   *
   * 注意：HookFlatItem.id 与 name 都不会持久化到 settings.json，
   * 重新 loadFromSettingsFile 后 id 会重生、name 会变成空串。
   * 因此这里通过 (event + scope + command) 来匹配——command 中嵌入了用户
   * 的 token/url 等配置，或 ECC hook 的脚本绝对路径，足以保证唯一性。
   */
  async function reconcile() {
    const hooksStore = useHooksStore()
    let changed = false
    for (const [id, s] of Object.entries(state.value)) {
      if (!s.enabled) continue
      const def = getBuiltinHook(id)
      const provider = def ? getBuiltinProvider(id, s.providerId) : undefined
      if (!def || !provider) continue
      let expectedCommand: string
      try {
        expectedCommand = await buildProviderCommand(provider, s.config)
      } catch (err) {
        console.error('[BuiltinHooksStore] reconcile buildCommand failed:', err)
        continue
      }
      const matched = hooksStore.hooks.find(
        (h: HookFlatItem) =>
          h.event === def.event &&
          h.scope === s.scope &&
          h.type === 'command' &&
          h.command === expectedCommand,
      )
      if (matched) {
        const expectedName = buildBuiltinHookName(def, provider)
        if (matched.name !== expectedName) {
          hooksStore.updateHook(matched.id, { name: expectedName })
        }
        if (s.installedHookId !== matched.id) {
          state.value[id] = { ...s, installedHookId: matched.id }
          changed = true
        }
      } else if (hooksStore.activeScope === s.scope) {
        // 仅当当前 scope 与该 builtin hook 的 scope 一致时才回置（避免误判其它 scope）
        state.value[id] = { ...s, enabled: false, installedHookId: null }
        changed = true
      }
    }
    if (changed) saveState()
  }

  /**
   * 路径修复：遍历所有已启用的内置 hook，按当前内置脚本根重新构建命令，
   * 并写回 settings.json。处理用户重装到不同盘符的场景。
   */
  async function repairAllInstalledHooks(): Promise<{ updated: number }> {
    const hooksStore = useHooksStore()
    let updated = 0
    const scopes = new Set<HookScope>()
    for (const s of Object.values(state.value)) {
      if (s.enabled && s.scope) scopes.add(s.scope)
    }
    for (const scope of scopes) {
      if (hooksStore.activeScope !== scope) {
        hooksStore.activeScope = scope
        await hooksStore.loadFromSettingsFile()
      }
      for (const [id, s] of Object.entries(state.value)) {
        if (!s.enabled || s.scope !== scope) continue
        const def = getBuiltinHook(id)
        const provider = def ? getBuiltinProvider(id, s.providerId) : undefined
        if (!def || !provider) continue
        let newCommand: string
        try {
          newCommand = await buildProviderCommand(provider, s.config)
        } catch (err) {
          console.error('[BuiltinHooksStore] repair buildCommand failed:', err)
          continue
        }
        const expectedName = buildBuiltinHookName(def, provider)
        // 先按 installedHookId 找，找不到再按名字+event 兜底
        let target = s.installedHookId
          ? hooksStore.hooks.find((h: HookFlatItem) => h.id === s.installedHookId)
          : undefined
        if (!target) {
          target = hooksStore.hooks.find(
            (h: HookFlatItem) =>
              h.event === def.event &&
              h.scope === scope &&
              h.type === 'command' &&
              h.name === expectedName,
          )
        }
        if (target && target.command !== newCommand) {
          hooksStore.updateHook(target.id, { command: newCommand })
          updated++
        }
        if (target && s.installedHookId !== target.id) {
          state.value[id] = { ...s, installedHookId: target.id }
        }
      }
      await hooksStore.saveToSettingsFile()
    }
    saveState()
    return { updated }
  }

  return {
    state,
    definitions,
    enabledCount,
    getState,
    isConfigured,
    setProviderConfig,
    enable,
    disable,
    applyAndEnable,
    reconfigure,
    reconcile,
    repairAllInstalledHooks,
  }
})

export type { BuiltinHookDefinition, BuiltinHookProvider }
