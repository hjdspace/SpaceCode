/**
 * 完全信任切换确认门
 *
 * 切到 bypassPermissions 会把之后每一次工具调用静默放行，所以选择器必须先弹确认框：
 * 未确认不得改模式（受控与非受控两条路径都算），取消即回到原模式。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import PermissionModeSelector from '../PermissionModeSelector.vue'
import BypassPermissionsDialog from '../BypassPermissionsDialog.vue'
import enUS from '@/i18n/locales/en-US'
import type { PermissionMode } from '@/shared/channels/claudeCode'

const { setPermissionMode, intentMode } = vi.hoisted(() => ({
  setPermissionMode: vi.fn(),
  intentMode: { value: 'default' as PermissionMode },
}))

vi.mock('@/stores/permissionPolicy', () => ({
  usePermissionPolicyStore: () => ({
    getPermissionMode: () => intentMode.value,
    setPermissionMode,
  }),
}))

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS } })

function mountSelector(props: Record<string, unknown> = {}) {
  return mount(PermissionModeSelector, {
    props: { sessionId: 'session-1', ...props },
    global: { plugins: [i18n], stubs: { Teleport: true } },
  })
}

type Wrapper = ReturnType<typeof mountSelector>

async function pickBypass(wrapper: Wrapper) {
  await wrapper.find('.mode-trigger').trigger('click')
  await wrapper.find('.mode-bypassPermissions').trigger('click')
  await flushPromises()
}

function dialog(wrapper: Wrapper) {
  return wrapper.findComponent(BypassPermissionsDialog)
}

beforeEach(() => {
  setPermissionMode.mockReset()
  intentMode.value = 'default'
})

describe('PermissionModeSelector · 完全信任确认门', () => {
  it('点「完全信任」只弹确认框，模式当场不落', async () => {
    const wrapper = mountSelector()
    await pickBypass(wrapper)

    expect(dialog(wrapper).props('show')).toBe(true)
    expect(dialog(wrapper).text()).toContain('Full Trust')
    expect(setPermissionMode).not.toHaveBeenCalled()
  })

  it('弹确认框时下拉已收起，不与弹窗叠层', async () => {
    const wrapper = mountSelector()
    await pickBypass(wrapper)

    expect(wrapper.find('.mode-dropdown').exists()).toBe(false)
  })

  it('确认后才写入 bypass 并收起弹窗', async () => {
    const wrapper = mountSelector()
    await pickBypass(wrapper)
    await dialog(wrapper).find('.bypass-btn.confirm').trigger('click')
    await flushPromises()

    expect(setPermissionMode).toHaveBeenCalledWith('session-1', 'bypassPermissions')
    expect(dialog(wrapper).props('show')).toBe(false)
  })

  it('取消则保持原模式并收起弹窗', async () => {
    const wrapper = mountSelector()
    await pickBypass(wrapper)
    await dialog(wrapper).find('.bypass-btn.cancel').trigger('click')
    await flushPromises()

    expect(setPermissionMode).not.toHaveBeenCalled()
    expect(dialog(wrapper).props('show')).toBe(false)
  })

  it('取消后重新选别的模式不受阻', async () => {
    const wrapper = mountSelector()
    await pickBypass(wrapper)
    await dialog(wrapper).find('.bypass-btn.cancel').trigger('click')
    await flushPromises()

    await wrapper.find('.mode-trigger').trigger('click')
    await wrapper.find('.mode-plan').trigger('click')
    await flushPromises()

    expect(setPermissionMode).toHaveBeenCalledWith('session-1', 'plan')
  })

  it('受控用法（定时任务表单）同样先确认，确认后只 emit', async () => {
    const wrapper = mountSelector({ sessionId: null, modelValue: 'default' })
    await pickBypass(wrapper)
    expect(setPermissionMode).not.toHaveBeenCalled()

    await dialog(wrapper).find('.bypass-btn.confirm').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toEqual([['bypassPermissions']])
    expect(setPermissionMode).not.toHaveBeenCalled()
  })

  it('已经是完全信任时再点它，不弹确认', async () => {
    const wrapper = mountSelector({ sessionId: null, modelValue: 'bypassPermissions' })
    await pickBypass(wrapper)

    expect(dialog(wrapper).props('show')).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
