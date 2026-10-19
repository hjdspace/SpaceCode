/**
 * BuiltinHooks store — 内置 Hook 的配置持久化、启用注入与启动校验。
 *
 * 与 hooks.test.ts 共用同一套 mock 约定（electronAPI / errorHandler / i18n），
 * 但这里使用真实的 hooks store：builtinHooks 的 enable/disable/reconcile/
 * repair 全部以 hooks store 为落点，两者一起测才是完整链路。
 *
 * 内置注册表用真实的 @/types/builtinHooks：
 * - wechat-task-complete + pushplus provider 走同步 buildCommand（无 IPC 依赖）
 * - ECC 类 hook 的 buildCommandAsync 依赖 api.getBuiltinHooksRoot，按用例 mock
 *
 * 期望命令一律用 buildProviderCommand 实时计算，不硬编码命令格式。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  loadHooksSettings: vi.fn(),
  saveHooksSettings: vi.fn(),
  getBuiltinHooksRoot: vi.fn(),
}))
const toastMocks = vi.hoisted(() => ({ pushToast: vi.fn() }))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))
vi.mock('@/services/errorHandler', () => ({ errorHandler: { pushToast: toastMocks.pushToast } }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))

import { useBuiltinHooksStore } from '@/stores/builtinHooks'
import type { BuiltinHookState, BuiltinHooksStateMap } from '@/stores/builtinHooks'
import { useHooksStore } from '@/stores/hooks'
import {
  getBuiltinHook,
  getBuiltinProvider,
  buildProviderCommand,
  buildBuiltinHookName,
} from '@/types/builtinHooks'

const STATE_KEY = 'builtin_hooks_state'
const BUILTIN_ID = 'wechat-task-complete'
const PROVIDER_ID = 'pushplus'
const CONFIG = { token: 'T123', title: 'Hi', content: 'Done' }
const ECC_ID = 'ecc-pre-bash-dispatcher'
const ECC_PROVIDER = 'ecc-builtin'

function engineJson(hooks: Record<string, unknown> = {}) {
  return { success: true, data: JSON.stringify(hooks) }
}

function builtinStateRaw(): BuiltinHooksStateMap {
  const raw = localStorage.getItem(STATE_KEY)
  return raw ? JSON.parse(raw) : {}
}

function seedState(entries: Record<string, Partial<BuiltinHookState>>) {
  localStorage.setItem(STATE_KEY, JSON.stringify(entries))
}

async function pushplusCommand(config = CONFIG): Promise<string> {
  return buildProviderCommand(getBuiltinProvider(BUILTIN_ID, PROVIDER_ID)!, config)
}

async function eccCommand(): Promise<string> {
  return buildProviderCommand(getBuiltinProvider(ECC_ID, ECC_PROVIDER)!, {})
}

function builtinName(builtinId = BUILTIN_ID, providerId = PROVIDER_ID): string {
  return buildBuiltinHookName(getBuiltinHook(builtinId)!, getBuiltinProvider(builtinId, providerId)!)
}

/** 引擎收到的最后一次保存 payload */
function savedPayload(): Record<string, unknown> {
  const calls = apiMocks.saveHooksSettings.mock.calls
  const [json] = calls[calls.length - 1]
  return JSON.parse(json as string)
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  apiMocks.loadHooksSettings.mockResolvedValue(engineJson())
  apiMocks.saveHooksSettings.mockResolvedValue({ success: true })
  apiMocks.getBuiltinHooksRoot.mockResolvedValue({ success: true, path: 'D:\\builtin\\root' })
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

// ────────────────────────────────────────────────────────────────────────
// 初始状态与 isConfigured
// ────────────────────────────────────────────────────────────────────────

describe('builtinHooks store — 初始状态', () => {
  it('空存储时 getState 返回默认值，enabledCount 为 0', () => {
    const store = useBuiltinHooksStore()

    expect(store.getState(BUILTIN_ID)).toEqual({
      enabled: false,
      providerId: '',
      config: {},
      installedHookId: null,
      scope: 'user',
    })
    expect(store.enabledCount).toBe(0)
    expect(store.definitions).toHaveLength(getBuiltinHook(BUILTIN_ID) ? store.definitions.length : 0)
  })

  it('从 localStorage 恢复持久化状态', () => {
    seedState({
      [BUILTIN_ID]: { enabled: true, providerId: PROVIDER_ID, config: CONFIG, installedHookId: 'h1', scope: 'project' },
    })

    const store = useBuiltinHooksStore()

    expect(store.getState(BUILTIN_ID)).toMatchObject({
      enabled: true,
      providerId: PROVIDER_ID,
      installedHookId: 'h1',
      scope: 'project',
    })
    expect(store.enabledCount).toBe(1)
  })

  it('持久化 JSON 损坏时退回空状态而不是抛错', () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.setItem(STATE_KEY, '{ not valid json')

    const store = useBuiltinHooksStore()

    expect(store.getState(BUILTIN_ID)).toMatchObject({ enabled: false, providerId: '' })
    expect(consoleSpy).toHaveBeenCalled()
  })
})

describe('builtinHooks store — isConfigured', () => {
  it('无状态 / 无 providerId / provider 不存在 都返回 false', () => {
    const store = useBuiltinHooksStore()

    expect(store.isConfigured(BUILTIN_ID)).toBe(false)

    store.setProviderConfig(BUILTIN_ID, '', CONFIG, 'user')
    expect(store.isConfigured(BUILTIN_ID)).toBe(false)

    store.setProviderConfig(BUILTIN_ID, 'no-such-provider', CONFIG, 'user')
    expect(store.isConfigured(BUILTIN_ID)).toBe(false)
  })

  it('required 字段留白返回 false，填齐后返回 true', () => {
    const store = useBuiltinHooksStore()

    store.setProviderConfig(BUILTIN_ID, PROVIDER_ID, { token: '   ' }, 'user')
    expect(store.isConfigured(BUILTIN_ID)).toBe(false)

    store.setProviderConfig(BUILTIN_ID, PROVIDER_ID, CONFIG, 'user')
    expect(store.isConfigured(BUILTIN_ID)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────
// setProviderConfig
// ────────────────────────────────────────────────────────────────────────

describe('builtinHooks store — setProviderConfig', () => {
  it('写入 providerId/config/scope，保留既有字段并持久化', () => {
    seedState({ [BUILTIN_ID]: { enabled: true, installedHookId: 'h1', providerId: 'old', config: {}, scope: 'user' } })
    const store = useBuiltinHooksStore()

    store.setProviderConfig(BUILTIN_ID, PROVIDER_ID, CONFIG, 'project')

    expect(store.getState(BUILTIN_ID)).toEqual({
      enabled: true,
      providerId: PROVIDER_ID,
      config: { ...CONFIG },
      installedHookId: 'h1',
      scope: 'project',
    })
    expect(builtinStateRaw()[BUILTIN_ID]).toMatchObject({ providerId: PROVIDER_ID, scope: 'project' })
  })
})

// ────────────────────────────────────────────────────────────────────────
// enable
// ────────────────────────────────────────────────────────────────────────

describe('builtinHooks store — enable', () => {
  it('definition 不存在 / 未配置 / provider 不存在 / 配置不完整 各自报错', async () => {
    const store = useBuiltinHooksStore()

    expect(await store.enable('no-such-builtin')).toEqual({ ok: false, error: 'definition not found' })
    expect(await store.enable(BUILTIN_ID)).toEqual({ ok: false, error: 'not configured' })

    store.setProviderConfig(BUILTIN_ID, 'no-such-provider', CONFIG, 'user')
    expect(await store.enable(BUILTIN_ID)).toEqual({ ok: false, error: 'provider not found' })

    store.setProviderConfig(BUILTIN_ID, PROVIDER_ID, { token: '' }, 'user')
    expect(await store.enable(BUILTIN_ID)).toEqual({ ok: false, error: 'config incomplete' })

    const hooksStore = useHooksStore()
    expect(hooksStore.hooks).toHaveLength(0)
    expect(apiMocks.saveHooksSettings).not.toHaveBeenCalled()
  })

  it('成功启用：注入 hooks store、更新状态并双路持久化', async () => {
    const store = useBuiltinHooksStore()
    const cmd = await pushplusCommand()

    store.setProviderConfig(BUILTIN_ID, PROVIDER_ID, CONFIG, 'user')
    const res = await store.enable(BUILTIN_ID)

    expect(res).toEqual({ ok: true })
    const hooksStore = useHooksStore()
    expect(hooksStore.hooks).toHaveLength(1)
    expect(hooksStore.hooks[0]).toMatchObject({
      name: builtinName(),
      event: 'Stop',
      matcher: '',
      type: 'command',
      command: cmd,
      timeout: 10,
      scope: 'user',
      disabled: false,
    })
    expect(store.getState(BUILTIN_ID)).toMatchObject({
      enabled: true,
      installedHookId: hooksStore.hooks[0].id,
    })
    expect(builtinStateRaw()[BUILTIN_ID]).toMatchObject({ enabled: true, installedHookId: hooksStore.hooks[0].id })
    // scope 不同时先切换 hooks 作用域并从磁盘加载
    expect(hooksStore.activeScope).toBe('user')
    expect(apiMocks.loadHooksSettings).toHaveBeenCalledWith('user', '')
    // 引擎配置收到启用项（timeout 10 ≠ 默认 30，会被写入）
    expect(savedPayload()).toEqual({
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: cmd, timeout: 10 }] }],
    })
  })

  it('重新启用前先移除旧 installedHookId 对应的条目', async () => {
    const store = useBuiltinHooksStore()
    store.setProviderConfig(BUILTIN_ID, PROVIDER_ID, CONFIG, 'user')
    await store.enable(BUILTIN_ID)
    const firstId = useHooksStore().hooks[0].id

    store.setProviderConfig(BUILTIN_ID, PROVIDER_ID, { ...CONFIG, token: 'T456' }, 'user')
    await store.enable(BUILTIN_ID)

    const hooksStore = useHooksStore()
    expect(hooksStore.hooks).toHaveLength(1)
    expect(hooksStore.hooks[0].id).not.toBe(firstId)
    expect(store.getState(BUILTIN_ID).installedHookId).toBe(hooksStore.hooks[0].id)
  })

  it('同名同 event 的残留条目被清理，避免重复', async () => {
    const store = useBuiltinHooksStore()
    const hooksStore = useHooksStore()
    hooksStore.activeScope = 'user'
    hooksStore.addHook({
      name: builtinName(),
      event: 'Stop',
      matcher: '',
      type: 'command',
      command: 'echo leftover',
      timeout: 30,
      scope: 'user',
      disabled: false,
    })

    store.setProviderConfig(BUILTIN_ID, PROVIDER_ID, CONFIG, 'user')
    await store.enable(BUILTIN_ID)

    expect(hooksStore.hooks).toHaveLength(1)
    expect(hooksStore.hooks[0].command).toBe(await pushplusCommand())
  })

  it('buildCommand 失败时报错且不注入、不写状态', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    apiMocks.getBuiltinHooksRoot.mockResolvedValue({ success: false, error: 'no root' })
    const store = useBuiltinHooksStore()

    store.setProviderConfig(ECC_ID, ECC_PROVIDER, {}, 'user')
    const res = await store.enable(ECC_ID)

    expect(res).toEqual({ ok: false, error: 'build command failed' })
    expect(useHooksStore().hooks).toHaveLength(0)
    expect(store.getState(ECC_ID)).toMatchObject({ enabled: false, installedHookId: null })
    // setProviderConfig 的配置持久化先于启用失败发生，配置条目保留
    expect(builtinStateRaw()[ECC_ID]).toMatchObject({ enabled: false, installedHookId: null })
  })
})

// ────────────────────────────────────────────────────────────────────────
// disable
// ────────────────────────────────────────────────────────────────────────

describe('builtinHooks store — disable', () => {
  it('未配置时是 no-op，不写盘', async () => {
    const store = useBuiltinHooksStore()

    await store.disable(BUILTIN_ID)

    expect(apiMocks.saveHooksSettings).not.toHaveBeenCalled()
    expect(builtinStateRaw()[BUILTIN_ID]).toBeUndefined()
  })

  it('已启用：移除注入条目、重置启用状态但保留配置', async () => {
    const store = useBuiltinHooksStore()
    store.setProviderConfig(BUILTIN_ID, PROVIDER_ID, CONFIG, 'user')
    await store.enable(BUILTIN_ID)
    const hookId = useHooksStore().hooks[0].id
    apiMocks.saveHooksSettings.mockClear()

    await store.disable(BUILTIN_ID)

    const hooksStore = useHooksStore()
    expect(hooksStore.hooks).toHaveLength(0)
    expect(store.getState(BUILTIN_ID)).toEqual({
      enabled: false,
      providerId: PROVIDER_ID,
      config: { ...CONFIG },
      installedHookId: null,
      scope: 'user',
    })
    expect(builtinStateRaw()[BUILTIN_ID]).toMatchObject({ enabled: false, installedHookId: null })
    expect(apiMocks.saveHooksSettings).toHaveBeenCalledTimes(1)
    expect(savedPayload()).toEqual({})
    expect(hookId).toBeTruthy()
  })

  it('scope 不同时先切换 hooks 作用域再移除', async () => {
    seedState({
      [BUILTIN_ID]: { enabled: true, providerId: PROVIDER_ID, config: CONFIG, installedHookId: 'h1', scope: 'user' },
    })
    const store = useBuiltinHooksStore()
    const hooksStore = useHooksStore()
    expect(hooksStore.activeScope).toBe('project')

    await store.disable(BUILTIN_ID)

    expect(hooksStore.activeScope).toBe('user')
    expect(apiMocks.loadHooksSettings).toHaveBeenCalledWith('user', '')
  })
})

// ────────────────────────────────────────────────────────────────────────
// applyAndEnable / reconfigure
// ────────────────────────────────────────────────────────────────────────

describe('builtinHooks store — applyAndEnable / reconfigure', () => {
  it('applyAndEnable 一步完成配置与启用', async () => {
    const store = useBuiltinHooksStore()

    const res = await store.applyAndEnable(BUILTIN_ID, PROVIDER_ID, CONFIG, 'user')

    expect(res).toEqual({ ok: true })
    expect(store.getState(BUILTIN_ID)).toMatchObject({ enabled: true, providerId: PROVIDER_ID })
    expect(useHooksStore().hooks).toHaveLength(1)
    expect(builtinStateRaw()[BUILTIN_ID]).toMatchObject({ providerId: PROVIDER_ID })
  })

  it('reconfigure 对未启用的条目只更新配置，不注入', async () => {
    const store = useBuiltinHooksStore()

    const res = await store.reconfigure(BUILTIN_ID, PROVIDER_ID, CONFIG, 'user')

    expect(res).toEqual({ ok: true })
    expect(useHooksStore().hooks).toHaveLength(0)
    expect(store.getState(BUILTIN_ID)).toMatchObject({ enabled: false, providerId: PROVIDER_ID })
    expect(apiMocks.saveHooksSettings).not.toHaveBeenCalled()
  })

  it('reconfigure 已启用条目：旧 command 被移除、新 command 注入', async () => {
    const store = useBuiltinHooksStore()
    await store.applyAndEnable(BUILTIN_ID, PROVIDER_ID, CONFIG, 'user')
    apiMocks.saveHooksSettings.mockClear()

    const res = await store.reconfigure(BUILTIN_ID, PROVIDER_ID, { ...CONFIG, token: 'T999' }, 'user')

    expect(res).toEqual({ ok: true })
    const hooksStore = useHooksStore()
    expect(hooksStore.hooks).toHaveLength(1)
    expect(hooksStore.hooks[0].command).toBe(await pushplusCommand({ ...CONFIG, token: 'T999' }))
    // 移除旧条目写一次、enable 内保存一次
    expect(apiMocks.saveHooksSettings).toHaveBeenCalledTimes(2)
  })

  it('reconfigure 改 scope 时先回旧 scope 移除旧条目，再在新 scope 启用', async () => {
    const store = useBuiltinHooksStore()
    await store.applyAndEnable(BUILTIN_ID, PROVIDER_ID, CONFIG, 'user')
    apiMocks.loadHooksSettings.mockClear()

    const res = await store.reconfigure(BUILTIN_ID, PROVIDER_ID, CONFIG, 'project')

    expect(res).toEqual({ ok: true })
    const hooksStore = useHooksStore()
    expect(hooksStore.activeScope).toBe('project')
    // enable 时 activeScope 已切到旧 scope（user），reconfigure 无需再 load；
    // 新 scope（project）启用时才加载
    expect(apiMocks.loadHooksSettings).toHaveBeenLastCalledWith('project', '')
    expect(hooksStore.hooks).toHaveLength(1)
    expect(hooksStore.hooks[0].scope).toBe('project')
  })
})

// ────────────────────────────────────────────────────────────────────────
// reconcile
// ────────────────────────────────────────────────────────────────────────

describe('builtinHooks store — reconcile 启动校验', () => {
  it('未启用条目被跳过，不写状态', async () => {
    seedState({ [BUILTIN_ID]: { enabled: false, providerId: PROVIDER_ID, config: CONFIG, installedHookId: null, scope: 'user' } })
    const store = useBuiltinHooksStore()
    const before = localStorage.getItem(STATE_KEY)

    await store.reconcile()

    expect(localStorage.getItem(STATE_KEY)).toBe(before)
  })

  it('匹配项存在且 name/id 均正确时不写盘', async () => {
    seedState({
      [BUILTIN_ID]: { enabled: true, providerId: PROVIDER_ID, config: CONFIG, installedHookId: null, scope: 'user' },
    })
    const store = useBuiltinHooksStore()
    const hooksStore = useHooksStore()
    hooksStore.activeScope = 'user'
    hooksStore.addHook({
      name: builtinName(),
      event: 'Stop',
      matcher: '',
      type: 'command',
      command: await pushplusCommand(),
      timeout: 10,
      scope: 'user',
      disabled: false,
    })
    const before = localStorage.getItem(STATE_KEY)

    await store.reconcile()

    expect(store.getState(BUILTIN_ID).installedHookId).toBe(hooksStore.hooks[0].id)
    expect(localStorage.getItem(STATE_KEY)).not.toBe(before) // installedHookId 回填
    expect(apiMocks.saveHooksSettings).not.toHaveBeenCalled()
  })

  it('匹配项存在但 name 过期时改名为内置标准名', async () => {
    seedState({
      [BUILTIN_ID]: { enabled: true, providerId: PROVIDER_ID, config: CONFIG, installedHookId: null, scope: 'user' },
    })
    const store = useBuiltinHooksStore()
    const hooksStore = useHooksStore()
    hooksStore.activeScope = 'user'
    hooksStore.addHook({
      name: '',
      event: 'Stop',
      matcher: '',
      type: 'command',
      command: await pushplusCommand(),
      timeout: 10,
      scope: 'user',
      disabled: false,
    })

    await store.reconcile()

    expect(hooksStore.hooks[0].name).toBe(builtinName())
    expect(store.getState(BUILTIN_ID).installedHookId).toBe(hooksStore.hooks[0].id)
  })

  it('无匹配且 activeScope 一致时回置为未启用', async () => {
    seedState({
      [BUILTIN_ID]: { enabled: true, providerId: PROVIDER_ID, config: CONFIG, installedHookId: 'ghost', scope: 'user' },
    })
    const store = useBuiltinHooksStore()
    useHooksStore().activeScope = 'user'

    await store.reconcile()

    expect(store.getState(BUILTIN_ID)).toMatchObject({ enabled: false, installedHookId: null })
    expect(builtinStateRaw()[BUILTIN_ID]).toMatchObject({ enabled: false })
  })

  it('无匹配但 activeScope 不同时不回置（避免误判其它 scope）', async () => {
    seedState({
      [BUILTIN_ID]: { enabled: true, providerId: PROVIDER_ID, config: CONFIG, installedHookId: 'ghost', scope: 'user' },
    })
    const store = useBuiltinHooksStore()
    const hooksStore = useHooksStore()
    hooksStore.setProjectRoot('D:/proj')
    expect(hooksStore.activeScope).toBe('project')

    await store.reconcile()

    expect(store.getState(BUILTIN_ID)).toMatchObject({ enabled: true, installedHookId: 'ghost' })
    expect(builtinStateRaw()[BUILTIN_ID]).toMatchObject({ enabled: true })
  })

  it('builtinId 不在注册表或 provider 缺失时跳过', async () => {
    seedState({
      'no-such-builtin': { enabled: true, providerId: 'x', config: {}, installedHookId: null, scope: 'user' },
      [BUILTIN_ID]: { enabled: true, providerId: 'no-such-provider', config: CONFIG, installedHookId: null, scope: 'user' },
    })
    const store = useBuiltinHooksStore()

    await store.reconcile()

    expect(store.getState('no-such-builtin')).toMatchObject({ enabled: true })
    expect(store.getState(BUILTIN_ID)).toMatchObject({ enabled: true, providerId: 'no-such-provider' })
  })

  it('buildCommand 失败时跳过该条目不回置', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    apiMocks.getBuiltinHooksRoot.mockResolvedValue({ success: false, error: 'no root' })
    seedState({ [ECC_ID]: { enabled: true, providerId: ECC_PROVIDER, config: {}, installedHookId: null, scope: 'user' } })
    const store = useBuiltinHooksStore()
    useHooksStore().activeScope = 'user'

    await store.reconcile()

    expect(store.getState(ECC_ID)).toMatchObject({ enabled: true, installedHookId: null })
    expect(consoleSpy).toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────
// repairAllInstalledHooks
// ────────────────────────────────────────────────────────────────────────

describe('builtinHooks store — repairAllInstalledHooks 路径修复', () => {
  async function seedProjectScopedEccHook(installedHookId: string | null) {
    seedState({
      [ECC_ID]: { enabled: true, providerId: ECC_PROVIDER, config: {}, installedHookId, scope: 'project' },
    })
  }

  it('脚本根变化时按 installedHookId 找到条目并重写命令', async () => {
    await seedProjectScopedEccHook(null)
    apiMocks.getBuiltinHooksRoot.mockResolvedValue({ success: true, path: 'D:\\root\\v1' })
    const oldCmd = await eccCommand()
    const newCmdRoot = { success: true, path: 'D:\\root\\v2' }
    apiMocks.getBuiltinHooksRoot.mockResolvedValue(newCmdRoot)
    const newCmd = await eccCommand()
    expect(oldCmd).not.toBe(newCmd)

    const store = useBuiltinHooksStore()
    const hooksStore = useHooksStore()
    hooksStore.addHook({
      name: builtinName(ECC_ID, ECC_PROVIDER),
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      command: oldCmd,
      timeout: 30,
      scope: 'project',
      disabled: false,
    })
    store.state = {
      ...store.state,
      [ECC_ID]: { ...store.state[ECC_ID], installedHookId: hooksStore.hooks[0].id },
    }

    const res = await store.repairAllInstalledHooks()

    expect(res).toEqual({ updated: 1 })
    expect(hooksStore.hooks[0].command).toBe(newCmd)
    expect(savedPayload()).toEqual({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: newCmd }] }],
    })
  })

  it('installedHookId 失效时按 name+event 兜底找回并回填 id', async () => {
    await seedProjectScopedEccHook('ghost-id')
    apiMocks.getBuiltinHooksRoot.mockResolvedValue({ success: true, path: 'D:\\root\\v1' })
    const oldCmd = await eccCommand()
    apiMocks.getBuiltinHooksRoot.mockResolvedValue({ success: true, path: 'D:\\root\\v2' })
    const newCmd = await eccCommand()

    const store = useBuiltinHooksStore()
    const hooksStore = useHooksStore()
    hooksStore.addHook({
      name: builtinName(ECC_ID, ECC_PROVIDER),
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      command: oldCmd,
      timeout: 30,
      scope: 'project',
      disabled: false,
    })

    const res = await store.repairAllInstalledHooks()

    expect(res).toEqual({ updated: 1 })
    expect(hooksStore.hooks[0].command).toBe(newCmd)
    expect(store.getState(ECC_ID).installedHookId).toBe(hooksStore.hooks[0].id)
  })

  it('命令未变化时不更新', async () => {
    await seedProjectScopedEccHook(null)
    const cmd = await eccCommand()

    const store = useBuiltinHooksStore()
    const hooksStore = useHooksStore()
    hooksStore.addHook({
      name: builtinName(ECC_ID, ECC_PROVIDER),
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      command: cmd,
      timeout: 30,
      scope: 'project',
      disabled: false,
    })
    store.state = {
      ...store.state,
      [ECC_ID]: { ...store.state[ECC_ID], installedHookId: hooksStore.hooks[0].id },
    }

    const res = await store.repairAllInstalledHooks()

    expect(res).toEqual({ updated: 0 })
    expect(hooksStore.hooks[0].command).toBe(cmd)
  })

  it('hooks 列表为空时找不到 target，updated 为 0', async () => {
    await seedProjectScopedEccHook('ghost-id')
    const store = useBuiltinHooksStore()

    const res = await store.repairAllInstalledHooks()

    expect(res).toEqual({ updated: 0 })
  })

  it('buildCommand 失败时跳过该条目（跨 scope 时先切换再加载）', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    apiMocks.getBuiltinHooksRoot.mockResolvedValue({ success: false, error: 'no root' })
    seedState({
      [ECC_ID]: { enabled: true, providerId: ECC_PROVIDER, config: {}, installedHookId: 'h1', scope: 'user' },
    })
    const store = useBuiltinHooksStore()

    const res = await store.repairAllInstalledHooks()

    expect(res).toEqual({ updated: 0 })
    const hooksStore = useHooksStore()
    expect(hooksStore.activeScope).toBe('user')
    expect(apiMocks.loadHooksSettings).toHaveBeenCalledWith('user', '')
    expect(consoleSpy).toHaveBeenCalled()
  })
})
