/**
 * 内置 Hook 卡片的「已启用」必须等于「引擎会执行」。
 *
 * 禁用项现在会留在管理列表里（引擎配置里才没有它，见 issue #41 第 21 项），
 * 所以 reconcile 不能只看"列表里有这条 command"就认定还在运行 —— 那样卡片会
 * 显示已启用，而引擎根本不跑它，正是票里那个症状的反向版本。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  loadHooksSettings: vi.fn(),
  saveHooksSettings: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))
vi.mock('@/services/errorHandler', () => ({ errorHandler: { pushToast: vi.fn() } }))
vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }))

import { useHooksStore } from '@/stores/hooks'
import { useBuiltinHooksStore } from '@/stores/builtinHooks'
import { getBuiltinHook, getBuiltinProvider, buildProviderCommand } from '@/types/builtinHooks'

const BUILTIN_ID = 'wechat-task-complete'
const PROVIDER_ID = 'pushplus'
const ROOT = 'D:/projects/B'

/** 让引擎配置里出现一条与该内置 Hook 完全同 command 的条目 */
async function installIntoScope(disabled: boolean) {
  const def = getBuiltinHook(BUILTIN_ID)
  const provider = getBuiltinProvider(BUILTIN_ID, PROVIDER_ID)
  if (!def || !provider) throw new Error('builtin fixture missing')
  const command = await buildProviderCommand(provider, { token: 'TK' })

  const hooksStore = useHooksStore()
  hooksStore.activeScope = 'project'
  hooksStore.setProjectRoot(ROOT)
  apiMocks.loadHooksSettings.mockResolvedValue({
    success: true,
    data: JSON.stringify({
      [def.event]: [{ matcher: def.matcher ?? '', hooks: [{ type: 'command', command, timeout: def.timeout ?? 30 }] }],
    }),
  })
  await hooksStore.loadFromSettingsFile()
  if (disabled) hooksStore.updateHook(hooksStore.hooks[0].id, { disabled: true })

  const builtin = useBuiltinHooksStore()
  builtin.state = {
    [BUILTIN_ID]: {
      enabled: true,
      providerId: PROVIDER_ID,
      config: { token: 'TK' },
      installedHookId: null,
      scope: 'project',
    },
  }
  return { hooksStore, builtin, command }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  apiMocks.saveHooksSettings.mockResolvedValue({ success: true })
})

describe('builtinHooks reconcile 与列表禁用状态', () => {
  it('未禁用的内置 Hook 保持已启用，并回链到列表条目', async () => {
    const { hooksStore, builtin } = await installIntoScope(false)

    await builtin.reconcile()

    expect(builtin.state[BUILTIN_ID].enabled).toBe(true)
    expect(builtin.state[BUILTIN_ID].installedHookId).toBe(hooksStore.hooks[0].id)
  })

  it('在列表里被禁用的内置 Hook 不再是已启用（引擎确实不跑它）', async () => {
    const { builtin } = await installIntoScope(true)

    await builtin.reconcile()

    expect(builtin.state[BUILTIN_ID].enabled).toBe(false)
    expect(builtin.state[BUILTIN_ID].installedHookId).toBeNull()
  })
})
