/**
 * 授权策略设置面板契约（T25 #96）。
 *
 *  - 展示当前 Policy version 与三档 acceptMode（off/observe/auto），文案走 i18n；
 *  - 规则表（name/instruction）与每 Source 准入表（channels/allowlist/bots）可增删改；
 *  - 保存只上抛命令（emit），不自己发 IPC；保存栏带未保存/非法提示；
 *  - 列表输入按逗号分隔解析为字符串数组（空项丢弃）；
 *  - 保存成功后父级回填 policy：草稿状态跟随重置。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { SuperAgentAuthorizationPolicy } from '@/shared/channels/superAgent'
import AuthorizationPolicyPanel from '../AuthorizationPolicyPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

function policy(
  overrides: Partial<SuperAgentAuthorizationPolicy> = {},
): SuperAgentAuthorizationPolicy {
  return { version: 3, acceptMode: 'off', rules: [], admissions: [], ...overrides }
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(AuthorizationPolicyPanel, {
    props: { policy: policy(), ...props },
  })
}

function find(wrapper: ReturnType<typeof mount>, testid: string) {
  return wrapper.find(`[data-testid="${testid}"]`)
}

describe('AuthorizationPolicyPanel（T25 #96）', () => {
  it('shows the current version, accept mode and mode hint', () => {
    const wrapper = mountPanel()

    expect(find(wrapper, 'authorization-version').text()).toContain('superAgent.authorization.version')
    expect((find(wrapper, 'authorization-accept-mode').element as HTMLSelectElement).value).toBe('off')
    expect(find(wrapper, 'authorization-accept-mode-hint').text()).toContain(
      'superAgent.authorization.modeHints.off',
    )
    expect(find(wrapper, 'authorization-rules-empty').exists()).toBe(true)
    expect(find(wrapper, 'authorization-admissions-empty').exists()).toBe(true)
  })

  it('emits one save command with parsed rules and admissions', async () => {
    const wrapper = mountPanel()

    await find(wrapper, 'authorization-accept-mode').setValue('auto')
    expect(find(wrapper, 'authorization-accept-mode-hint').text()).toContain(
      'superAgent.authorization.modeHints.auto',
    )

    await find(wrapper, 'authorization-rule-add').trigger('click')
    await find(wrapper, 'authorization-rule-name-0').setValue(' Guard ')
    await find(wrapper, 'authorization-rule-instruction-0').setValue('Only touch src/')

    await find(wrapper, 'authorization-admission-add').trigger('click')
    await find(wrapper, 'authorization-admission-source-0').setValue('feishu:ops')
    await find(wrapper, 'authorization-admission-channels-0').setValue('c1, c2')
    await find(wrapper, 'authorization-admission-allowlist-0').setValue('alice, bob')
    await find(wrapper, 'authorization-admission-bots-0').setValue('bot-1')

    expect(find(wrapper, 'authorization-dirty').exists()).toBe(true)
    await find(wrapper, 'authorization-save').trigger('click')

    expect(wrapper.emitted('save')).toEqual([
      [
        {
          acceptMode: 'auto',
          rules: [{ name: 'Guard', instruction: 'Only touch src/' }],
          admissions: [
            {
              source: 'feishu:ops',
              channels: ['c1', 'c2'],
              allowlist: ['alice', 'bob'],
              bots: ['bot-1'],
            },
          ],
        },
      ],
    ])
  })

  it('adds and removes rule / admission rows', async () => {
    const wrapper = mountPanel()

    await find(wrapper, 'authorization-rule-add').trigger('click')
    await find(wrapper, 'authorization-rule-add').trigger('click')
    expect(find(wrapper, 'authorization-rule-1').exists()).toBe(true)
    await find(wrapper, 'authorization-rule-remove-0').trigger('click')
    expect(find(wrapper, 'authorization-rule-1').exists()).toBe(false)

    await find(wrapper, 'authorization-admission-add').trigger('click')
    await find(wrapper, 'authorization-admission-add').trigger('click')
    await find(wrapper, 'authorization-admission-remove-0').trigger('click')
    expect(find(wrapper, 'authorization-admission-1').exists()).toBe(false)
  })

  it('disables save while a required field is empty', async () => {
    const wrapper = mountPanel()

    await find(wrapper, 'authorization-rule-add').trigger('click')
    expect(find(wrapper, 'authorization-invalid').exists()).toBe(true)
    expect(find(wrapper, 'authorization-save').attributes('disabled')).toBeDefined()

    await find(wrapper, 'authorization-rule-name-0').setValue('Guard')
    // 规则内容仍为空：继续保持禁止保存
    expect(find(wrapper, 'authorization-invalid').exists()).toBe(true)
    expect(find(wrapper, 'authorization-save').attributes('disabled')).toBeDefined()

    await find(wrapper, 'authorization-rule-instruction-0').setValue('Only src/')
    expect(find(wrapper, 'authorization-invalid').exists()).toBe(false)
    expect(find(wrapper, 'authorization-save').attributes('disabled')).toBeUndefined()

    await find(wrapper, 'authorization-admission-add').trigger('click')
    expect(find(wrapper, 'authorization-save').attributes('disabled')).toBeDefined()
  })

  it('reset discards local edits back to the saved policy', async () => {
    const wrapper = mountPanel({ policy: policy({ acceptMode: 'observe' }) })

    await find(wrapper, 'authorization-accept-mode').setValue('auto')
    expect(find(wrapper, 'authorization-dirty').exists()).toBe(true)

    await find(wrapper, 'authorization-reset').trigger('click')
    expect((find(wrapper, 'authorization-accept-mode').element as HTMLSelectElement).value).toBe(
      'observe',
    )
    expect(find(wrapper, 'authorization-dirty').exists()).toBe(false)
  })

  it('follows the saved policy after the parent writes back the new snapshot', async () => {
    const wrapper = mountPanel()

    await find(wrapper, 'authorization-accept-mode').setValue('auto')
    expect(find(wrapper, 'authorization-dirty').exists()).toBe(true)

    await wrapper.setProps({
      policy: policy({
        version: 4,
        acceptMode: 'auto',
        rules: [{ name: 'Guard', instruction: 'Only src/' }],
        admissions: [{ source: 'feishu:ops', channels: [], allowlist: [], bots: [] }],
      }),
    })

    expect(find(wrapper, 'authorization-dirty').exists()).toBe(false)
    expect((find(wrapper, 'authorization-rule-name-0').element as HTMLInputElement).value).toBe(
      'Guard',
    )
  })

  it('renders the save hint and marks failures', () => {
    const wrapper = mountPanel({ hint: 'saved', hintFailed: false })
    expect(find(wrapper, 'authorization-hint').text()).toBe('saved')
    expect(find(wrapper, 'authorization-hint').classes()).not.toContain('failed')

    const failed = mountPanel({ hint: 'boom', hintFailed: true })
    expect(find(failed, 'authorization-hint').classes()).toContain('failed')
  })
})
