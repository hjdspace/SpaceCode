import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'
import { i18n } from '@/i18n'
import type { HookEventType, HookType, HookScope, HookFlatItem } from '@/types/hooks'

const META_PREFIX = 'hooks_meta:v1'

/**
 * 管理元数据的存储域。用户级 Hook 跨项目共享，项目级/本地级跟着项目根走 ——
 * 否则换一个项目打开，上一个项目的条目会被当成当前项目的列出来。
 */
export function hooksMetaKey(scope: HookScope, projectRoot: string): string {
  return `${META_PREFIX}:${scope}:${scope === 'user' ? '-' : projectRoot}`
}

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

/** 引擎配置不落 id/name/disabled，重载后靠内容把条目认领回原来的元数据 */
function contentKey(item: Pick<HookFlatItem, 'event' | 'matcher' | 'type' | 'command' | 'timeout'>): string {
  return [item.event, item.matcher, item.type, item.command, item.timeout ?? 30].join('\u0000')
}

/**
 * 磁盘条目（只有执行字段）×元数据（带 id/name/disabled）合并成管理列表。
 *
 * 一条元数据最多认领一个磁盘条目；优先认领启用项，否则内容完全相同的两条会串位
 * （禁用那条会把启用条目"染"成禁用，下一次保存就连同启用项一起从引擎配置里消失）。
 * 元数据里的禁用项在磁盘上本来就不存在（引擎只收启用项），要请回列表；
 * 启用项若在磁盘上没了，就是被外部删掉了，不复活。
 */
function mergeWithMetadata(diskItems: HookFlatItem[], metaItems: HookFlatItem[]): HookFlatItem[] {
  const pool = [...metaItems]
  const claim = (key: string, enabledOnly: boolean): HookFlatItem | undefined => {
    const index = pool.findIndex(m => contentKey(m) === key && (!enabledOnly || !m.disabled))
    return index === -1 ? undefined : pool.splice(index, 1)[0]
  }
  const merged = diskItems.map(item => {
    const key = contentKey(item)
    const meta = claim(key, true) ?? claim(key, false)
    return meta ? { ...item, id: meta.id, name: meta.name, disabled: meta.disabled } : item
  })
  return [...merged, ...pool.filter(m => m.disabled)]
}

function readMetadata(scope: HookScope, projectRoot: string): HookFlatItem[] {
  try {
    const saved = localStorage.getItem(hooksMetaKey(scope, projectRoot))
    if (!saved) return []
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    console.error(`[HooksStore] Failed to load metadata for ${scope}:`, e)
    return []
  }
}

export const useHooksStore = defineStore('hooks', () => {
  const hooks = ref<HookFlatItem[]>([])
  const activeScope = ref<HookScope>('project')
  /** project/local 作用域的落点，由渲染端在项目切换时上报；主进程没有这个概念 */
  const projectRoot = ref('')
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

  function writeMetadata(items: HookFlatItem[]) {
    try {
      localStorage.setItem(hooksMetaKey(activeScope.value, projectRoot.value), JSON.stringify(items))
    } catch (e) {
      console.error('[HooksStore] Failed to save metadata:', e)
    }
  }

  function getHooksForEvent(event: HookEventType): HookFlatItem[] {
    return hooksByEvent.value.get(event) ?? []
  }

  /**
   * 上报当前打开的项目根。切项目时管理列表跟着换域，
   * 磁盘内容随后由 loadFromSettingsFile 校正。
   */
  function setProjectRoot(root: string) {
    if (root === projectRoot.value) return
    projectRoot.value = root
    hooks.value = readMetadata(activeScope.value, root).map(h => ({ ...h, scope: activeScope.value }))
  }

  function addHook(data: Omit<HookFlatItem, 'id'>) {
    const hook: HookFlatItem = { ...data, id: generateId() }
    hooks.value = [...hooks.value, hook]
    writeMetadata(hooks.value)
  }

  function updateHook(id: string, updates: Partial<HookFlatItem>) {
    hooks.value = hooks.value.map(h =>
      h.id === id ? { ...h, ...updates } : h
    )
    writeMetadata(hooks.value)
  }

  function removeHook(id: string) {
    hooks.value = hooks.value.filter(h => h.id !== id)
    writeMetadata(hooks.value)
  }

  /** 开关必须当场生效：引擎只读磁盘，不回写的话"禁用"的 Hook 会继续被执行 */
  async function toggleHook(id: string) {
    const hook = hooks.value.find(h => h.id === id)
    if (!hook) return
    updateHook(id, { disabled: !hook.disabled })
    await saveToSettingsFile()
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

  /** 面向用户的文案保持本地化；技术性原因（errno / 主进程提示）留给日志 */
  function notifyPersistFailure(reason?: string) {
    if (reason) console.error('[HooksStore] Persistence failed:', reason)
    const noProject = activeScope.value !== 'user' && !projectRoot.value
    errorHandler.pushToast({
      id: generateId(),
      category: ErrorCategory.CONFIG_ERROR,
      title: i18n.global.t('hookSettings.title'),
      message: i18n.global.t(
        noProject ? 'hookSettings.noProjectRoot' : 'hookSettings.persistFailed',
      ),
      autoDismiss: true,
      dismissAfter: 5000,
      createdAt: Date.now(),
    })
  }

  async function loadFromSettingsFile() {
    loading.value = true
    try {
      const result = await api.loadHooksSettings(activeScope.value, projectRoot.value)
      if (!result.success) {
        notifyPersistFailure(result.error)
        return
      }
      const parsed = JSON.parse(result.data || '{}')
      // 兼容历史数据：旧版本前端会把整个 { hooks: ... } 一并写入 settings.json，
      // 导致磁盘上出现 { hooks: { hooks: {...} } } 的双重包装，后端再读出
      // parsed.hooks 后仍然多一层。这里检测到嵌套就向下解一层。
      const wasWrapped =
        parsed && typeof parsed === 'object' && 'hooks' in parsed && Object.keys(parsed).length === 1
      const rawConfig = (wasWrapped
        ? (parsed as Record<string, unknown>).hooks
        : parsed) as RawHooksConfig
      hooks.value = mergeWithMetadata(
        fromRawConfig(rawConfig, activeScope.value),
        readMetadata(activeScope.value, projectRoot.value),
      )
      writeMetadata(hooks.value)
      // 检测到双重包装时自动把正确格式回写磁盘，避免引擎读取到非法结构
      if (wasWrapped) {
        try {
          await api.saveHooksSettings(JSON.stringify(rawConfig, null, 2), activeScope.value, projectRoot.value)
          console.info('[HooksStore] Migrated legacy double-wrapped hooks config')
        } catch (mergeErr) {
          console.error('[HooksStore] Failed to migrate legacy hooks config:', mergeErr)
        }
      }
    } catch (e) {
      console.error('[HooksStore] Failed to load from settings file:', e)
    } finally {
      loading.value = false
    }
  }

  /** 引擎执行配置只包含启用项；失败要让用户看见，不再假装保存成功 */
  async function saveToSettingsFile(): Promise<boolean> {
    try {
      const config = toRawConfig()
      // 后端会自行把内容写入 settings.json 的 hooks 字段，因此这里直接传裸 config，
      // 避免出现 { hooks: { hooks: ... } } 的双重包装（旧实现的 bug）。
      const jsonStr = JSON.stringify(config, null, 2)
      const result = await api.saveHooksSettings(jsonStr, activeScope.value, projectRoot.value)
      if (!result.success) {
        notifyPersistFailure(result.error)
        return false
      }
      return true
    } catch (e) {
      console.error('[HooksStore] Failed to save to settings file:', e)
      notifyPersistFailure(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  return {
    hooks,
    activeScope,
    projectRoot,
    loading,
    hooksByEvent,
    enabledCount,
    totalCount,
    getHooksForEvent,
    setProjectRoot,
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
