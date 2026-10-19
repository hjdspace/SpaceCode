/**
 * Hooks store — 作用域路径来源（issue #41 第 7 项）与开关回写/禁用项持久化（第 21 项）。
 *
 * 两层配置各有各的身份：
 * - 引擎执行配置（settings.json 的 hooks 字段）只包含启用项，是 hooks 列表的投影；
 * - 管理元数据（id / name / disabled）按 (scope, 项目根) 独立持久化。
 * 原实现在第一层里丢掉禁用项、又用磁盘内容整体替换列表，于是"禁用的 Hook 换个
 * scope 再切回来就凭空消失"；开关本身更是连磁盘都不写。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { HookFlatItem } from '@/types/hooks'

const apiMocks = vi.hoisted(() => ({
  loadHooksSettings: vi.fn(),
  saveHooksSettings: vi.fn(),
}))
const toastMocks = vi.hoisted(() => ({ pushToast: vi.fn() }))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))
vi.mock('@/services/errorHandler', () => ({ errorHandler: { pushToast: toastMocks.pushToast } }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))

import { useHooksStore, hooksMetaKey } from '@/stores/hooks'

const ROOT_B = 'D:/projects/B'
const ROOT_C = 'D:/projects/C'

function makeHook(overrides: Partial<Omit<HookFlatItem, 'id'>> = {}): Omit<HookFlatItem, 'id'> {
  return {
    name: 'test hook',
    event: 'PreToolUse',
    matcher: 'Bash',
    type: 'command',
    command: 'echo hi',
    timeout: 30,
    scope: 'project',
    disabled: false,
    ...overrides,
  }
}

/** 磁盘上读到的引擎配置 */
function engineJson(hooks: Record<string, unknown> = {}) {
  return { success: true, data: JSON.stringify(hooks) }
}

function savedPayload(): Record<string, unknown> {
  const calls = apiMocks.saveHooksSettings.mock.calls
  const [json] = calls.length > 0 ? calls[calls.length - 1] : ['{}']
  return JSON.parse(json as string)
}

function metaOf(scope: 'user' | 'project' | 'local' = 'project', root = ROOT_B): HookFlatItem[] {
  const raw = localStorage.getItem(hooksMetaKey(scope, root))
  return raw ? JSON.parse(raw) : []
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  apiMocks.loadHooksSettings.mockResolvedValue(engineJson())
  apiMocks.saveHooksSettings.mockResolvedValue({ success: true })
})

describe('hooks store — 初始状态', () => {
  it('starts empty with project scope', () => {
    const store = useHooksStore()
    expect(store.hooks).toEqual([])
    expect(store.activeScope).toBe('project')
    expect(store.projectRoot).toBe('')
    expect(store.loading).toBe(false)
  })
})

describe('hooks store — 作用域路径来自显式项目根（票 12）', () => {
  it('load 把 setProjectRoot 上报的根交给 IPC', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    await store.loadFromSettingsFile()

    expect(apiMocks.loadHooksSettings).toHaveBeenCalledWith('project', ROOT_B)
  })

  it('user 作用域不需要项目根', async () => {
    const store = useHooksStore()
    store.activeScope = 'user'
    await store.loadFromSettingsFile()

    expect(apiMocks.loadHooksSettings).toHaveBeenCalledWith('user', '')
  })

  it('save 把 scope 与项目根一起交给 IPC', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook({ command: 'echo a' }))

    await store.saveToSettingsFile()

    expect(apiMocks.saveHooksSettings).toHaveBeenCalledTimes(1)
    const [json, scope, root] = apiMocks.saveHooksSettings.mock.calls[0]
    expect(scope).toBe('project')
    expect(root).toBe(ROOT_B)
    expect(JSON.parse(json as string)).toEqual({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] }],
    })
  })

  it('切换项目后读取与元数据都跟随新项目根', async () => {
    const store = useHooksStore()
    // 只有 B 的磁盘上有这条 Hook，C 是空项目
    apiMocks.loadHooksSettings.mockImplementation((_scope: string, root: string) => Promise.resolve(
      root === ROOT_B
        ? engineJson({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo from-B' }] }] })
        : engineJson(),
    ))
    store.setProjectRoot(ROOT_B)
    await store.loadFromSettingsFile()
    expect(store.hooks).toHaveLength(1)

    store.setProjectRoot(ROOT_C)
    await store.loadFromSettingsFile()

    expect(store.hooks).toEqual([])
    expect(apiMocks.loadHooksSettings).toHaveBeenLastCalledWith('project', ROOT_C)
    expect(metaOf('project', ROOT_C)).toEqual([])
    // B 的元数据仍属于 B，没被 C 覆盖
    expect(metaOf('project', ROOT_B).map(h => h.command)).toEqual(['echo from-B'])
  })

  it('IPC 报告保存失败时明确返回 false 并提示，不再假装成功', async () => {
    apiMocks.saveHooksSettings.mockResolvedValue({ success: false, error: 'absolute projectRoot is required' })
    const store = useHooksStore()
    store.addHook(makeHook())

    await expect(store.saveToSettingsFile()).resolves.toBe(false)
    expect(toastMocks.pushToast).toHaveBeenCalledTimes(1)
  })
})

describe('hooks store — 开关立即回写引擎配置（票 13）', () => {
  it('toggleHook 写回磁盘且禁用项不进引擎配置', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook({ command: 'echo a' }))
    apiMocks.saveHooksSettings.mockClear()

    await store.toggleHook(store.hooks[0].id)

    expect(store.hooks[0].disabled).toBe(true)
    expect(apiMocks.saveHooksSettings).toHaveBeenCalledTimes(1)
    expect(savedPayload()).toEqual({})
  })

  it('重新启用同样立即回写', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook({ command: 'echo a', disabled: true }))

    await store.toggleHook(store.hooks[0].id)

    expect(store.hooks[0].disabled).toBe(false)
    expect(savedPayload()).toEqual({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] }],
    })
  })

  it('toggleHook 对未知 id 不做无谓的写盘', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook())

    await store.toggleHook('missing')

    expect(apiMocks.saveHooksSettings).not.toHaveBeenCalled()
  })
})

describe('hooks store — 禁用项在重载后仍在（票 13）', () => {
  it('禁用 → 切 scope → 切回来，条目保留且仍为禁用', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook({ command: 'echo a', name: '我的钩子' }))
    await store.toggleHook(store.hooks[0].id)
    const disabledId = store.hooks[0].id

    // 磁盘上确实没有它（引擎只拿到启用项）
    expect(savedPayload()).toEqual({})
    apiMocks.loadHooksSettings.mockResolvedValue(engineJson({
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'exit' }] }],
    }))
    store.activeScope = 'user'
    await store.loadFromSettingsFile()
    expect(store.hooks.map(h => h.command)).toEqual(['exit'])

    apiMocks.loadHooksSettings.mockResolvedValue(engineJson())
    store.activeScope = 'project'
    await store.loadFromSettingsFile()

    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0].command).toBe('echo a')
    expect(store.hooks[0].disabled).toBe(true)
    expect(store.hooks[0].name).toBe('我的钩子')
    expect(store.hooks[0].id).toBe(disabledId)
    expect(store.enabledCount).toBe(0)
    expect(store.totalCount).toBe(1)
  })

  it('磁盘条目认领元数据后保留 name 与 id', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook({ command: 'echo a', name: '命名过的钩子' }))
    const createdId = store.hooks[0].id
    apiMocks.loadHooksSettings.mockResolvedValue(engineJson({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] }],
    }))

    await store.loadFromSettingsFile()

    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0].id).toBe(createdId)
    expect(store.hooks[0].name).toBe('命名过的钩子')
  })

  it('内容完全相同的两条不会互相串位', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook({ command: 'echo twin' }))
    store.addHook(makeHook({ command: 'echo twin' }))
    const [first, second] = store.hooks.map(h => h.id)
    await store.toggleHook(second)

    apiMocks.loadHooksSettings.mockResolvedValue(engineJson({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo twin' }, { type: 'command', command: 'echo twin' }] }],
    }))
    await store.loadFromSettingsFile()

    expect(store.hooks).toHaveLength(2)
    expect(store.hooks.map(h => h.disabled)).toEqual([false, true])
    expect(new Set(store.hooks.map(h => h.id)).size).toBe(2)
    expect(store.hooks.map(h => h.id).sort()).toEqual([first, second].sort())
  })

  it('磁盘侧被删除的启用项不会靠元数据复活', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook({ command: 'echo gone' }))
    expect(store.hooks).toHaveLength(1)

    await store.loadFromSettingsFile()

    expect(store.hooks).toEqual([])
    expect(metaOf()).toEqual([])
  })

  it('外部新增的条目照常出现，name 空、未禁用', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    apiMocks.loadHooksSettings.mockResolvedValue(engineJson({
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'external', timeout: 12 }] }],
    }))

    await store.loadFromSettingsFile()

    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0]).toMatchObject({
      command: 'external', name: '', disabled: false, timeout: 12, scope: 'project',
    })
  })

  it('元数据按 scope 分域，一个 scope 的禁用不影响另一个 scope 的列表', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook({ command: 'echo a' }))
    await store.toggleHook(store.hooks[0].id)

    apiMocks.loadHooksSettings.mockResolvedValue(engineJson({
      Notification: [{ matcher: '', hooks: [{ type: 'command', command: 'echo user' }] }],
    }))
    store.activeScope = 'user'
    await store.loadFromSettingsFile()

    expect(store.hooks.map(h => h.command)).toEqual(['echo user'])
    // 用户级作用域跨项目共享，元数据键不带项目根
    expect(hooksMetaKey('user', ROOT_B)).toBe(hooksMetaKey('user', ROOT_C))
    expect(metaOf('user', ROOT_B).map(h => h.command)).toEqual(['echo user'])
    // 项目级的禁用条目留在自己的域里
    expect(metaOf('project', ROOT_B).map(h => h.disabled)).toEqual([true])
  })
})

describe('hooks store — CRUD 与元数据持久化', () => {
  it('addHook / updateHook / removeHook 落元数据键', () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)

    store.addHook(makeHook({ command: 'echo a' }))
    expect(store.hooks[0].id).toHaveLength(36)
    expect(metaOf()[0].command).toBe('echo a')

    store.updateHook(store.hooks[0].id, { name: '改名', disabled: true })
    expect(metaOf()[0]).toMatchObject({ name: '改名', disabled: true })

    store.removeHook(store.hooks[0].id)
    expect(store.hooks).toEqual([])
    expect(metaOf()).toEqual([])
  })

  it('元数据损坏时退回空列表而不是抛错', () => {
    localStorage.setItem(hooksMetaKey('project', ROOT_B), '{ not valid json')
    const store = useHooksStore()

    expect(() => store.setProjectRoot(ROOT_B)).not.toThrow()
    expect(store.hooks).toEqual([])
  })

  it('从元数据键恢复当前作用域的条目', () => {
    localStorage.setItem(
      hooksMetaKey('project', ROOT_B),
      JSON.stringify([{ id: 'h1', ...makeHook({ command: 'echo saved' }) }]),
    )
    const store = useHooksStore()

    store.setProjectRoot(ROOT_B)

    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0].command).toBe('echo saved')
  })

  it('hooksByEvent 分组与计数', () => {
    const store = useHooksStore()
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Bash' }))
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Read' }))
    store.addHook(makeHook({ event: 'Stop', disabled: true }))

    expect(store.totalCount).toBe(3)
    expect(store.enabledCount).toBe(2)
    expect(store.hooksByEvent.get('PreToolUse')).toHaveLength(2)
    expect(store.getHooksForEvent('PostToolUse')).toEqual([])
    expect(store.getHooksForEvent('PreToolUse')).toHaveLength(2)
  })

  it('updateHook 忽略未知 id', () => {
    const store = useHooksStore()
    store.addHook(makeHook())
    store.updateHook('nope', { command: 'changed' })
    expect(store.hooks[0].command).toBe('echo hi')
  })

  it('toRawConfig 按 event+matcher 分组、跳过禁用项、省略默认 timeout', () => {
    const store = useHooksStore()
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Bash', command: 'echo a', timeout: 30 }))
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Bash', command: 'echo b', timeout: 15 }))
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Read', type: 'prompt', command: 'prompt-text' }))
    store.addHook(makeHook({ event: 'Stop', matcher: '*', command: 'exit', timeout: 45 }))
    store.addHook(makeHook({ event: 'Stop', matcher: '*', command: 'skipped', disabled: true }))

    expect(store.toRawConfig()).toEqual({
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }, { type: 'command', command: 'echo b', timeout: 15 }] },
        { matcher: 'Read', hooks: [{ type: 'prompt', prompt: 'prompt-text' }] },
      ],
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'exit', timeout: 45 }] }],
    })
  })

  it('fromRawConfig 摊平并补默认值', () => {
    const store = useHooksStore()
    const items = store.fromRawConfig(
      {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a', timeout: 7 }] },
          { matcher: 'Read', hooks: [{ type: 'command', command: 'echo b' }] },
        ],
        Stop: [{ matcher: '*', hooks: [{ type: 'prompt', prompt: 'bye' }] }],
      },
      'local',
    )

    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      event: 'PreToolUse', matcher: 'Bash', type: 'command', command: 'echo a',
      timeout: 7, scope: 'local', disabled: false, name: '',
    })
    expect(items[0].id).toHaveLength(36)
    expect(items[1].timeout).toBe(30)
    expect(items[2].command).toBe('bye')
  })

  it('toRawConfig / fromRawConfig 往返', () => {
    const store = useHooksStore()
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Bash', command: 'echo a', timeout: 5 }))
    store.addHook(makeHook({ event: 'PostToolUse', matcher: '*', type: 'prompt', command: 'note' }))

    const flattened = store.fromRawConfig(store.toRawConfig(), 'project')

    expect(flattened.map(h => ({ ...h, id: '' }))).toEqual([
      { id: '', name: '', event: 'PreToolUse', matcher: 'Bash', type: 'command', command: 'echo a', timeout: 5, scope: 'project', disabled: false },
      { id: '', name: '', event: 'PostToolUse', matcher: '*', type: 'prompt', command: 'note', timeout: 30, scope: 'project', disabled: false },
    ])
  })
})

describe('hooks store — loadFromSettingsFile 的容错与旧数据迁移', () => {
  it('识别旧的 { hooks: { hooks: ... } } 双重包装并回写修正', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    apiMocks.loadHooksSettings.mockResolvedValue({
      success: true,
      data: JSON.stringify({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'exit' }] }] } }),
    })

    await store.loadFromSettingsFile()

    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0].event).toBe('Stop')
    expect(apiMocks.saveHooksSettings).toHaveBeenCalledTimes(1)
    expect(apiMocks.saveHooksSettings).toHaveBeenCalledWith(
      expect.stringContaining('"Stop"'), 'project', ROOT_B,
    )
  })

  it('success:false 时不动列表、不写盘', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook())
    const before = store.hooks.length
    apiMocks.loadHooksSettings.mockResolvedValue({ success: false, data: null, error: 'boom' })

    await store.loadFromSettingsFile()

    expect(store.hooks).toHaveLength(before)
    expect(apiMocks.saveHooksSettings).not.toHaveBeenCalled()
  })

  // DEFECT: 载入失败时保留的是"上一个作用域"的列表，于是下一次保存把别的作用域的
  // 条目写进当前作用域的文件。先于本次改动存在（旧代码同样在失败时不动列表），
  // 本用例只钉现状，等拍板后再修 —— 修法是失败时清空或锁存列表。
  it('DEFECT: 切作用域但读取失败后，保存会把另一个作用域的条目写进当前文件', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.activeScope = 'user'
    apiMocks.loadHooksSettings.mockResolvedValue(engineJson({
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo user' }] }],
    }))
    await store.loadFromSettingsFile()
    expect(store.hooks.map(h => h.scope)).toEqual(['user'])

    store.activeScope = 'project'
    apiMocks.loadHooksSettings.mockResolvedValue({ success: false, data: null, error: 'disk boom' })
    await store.loadFromSettingsFile()

    await store.saveToSettingsFile()

    // 用户级那条 Hook 被写进了项目文件
    expect(apiMocks.saveHooksSettings).toHaveBeenCalledWith(
      expect.stringContaining('"Stop"'), 'project', ROOT_B,
    )
    // 泄漏就此固化：项目文件里真有它了，重读时它变成一条项目级 Hook
    apiMocks.loadHooksSettings.mockResolvedValue(engineJson({
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo user' }] }],
    }))
    await store.loadFromSettingsFile()
    expect(store.hooks.map(h => h.scope)).toEqual(['project'])
    expect(metaOf('project', ROOT_B).map(h => h.command)).toEqual(['echo user'])
  })

  it('JSON 非法时保持原列表并结束 loading', async () => {
    const store = useHooksStore()
    store.setProjectRoot(ROOT_B)
    store.addHook(makeHook({ command: 'echo keep' }))
    apiMocks.loadHooksSettings.mockResolvedValue({ success: true, data: '{ not json' })

    await store.loadFromSettingsFile()

    expect(store.hooks.map(h => h.command)).toEqual(['echo keep'])
    expect(store.loading).toBe(false)
  })

  it('吞掉 IPC 异常', async () => {
    const store = useHooksStore()
    apiMocks.loadHooksSettings.mockRejectedValue(new Error('ipc down'))

    await expect(store.loadFromSettingsFile()).resolves.toBeUndefined()
    expect(store.loading).toBe(false)
  })
})
