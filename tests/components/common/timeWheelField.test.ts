/**
 * TimeWheelField 组件测试 — 两列滚轮的取值范围与回写格式。
 * Seam: 组件对外的 modelValue 契约（HH:MM 字符串）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TimeWheelField from '@/components/common/TimeWheelField.vue'
import zhCN from '@/i18n/locales/zh-CN'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

function mountField(modelValue = '09:00') {
  return mount(TimeWheelField, {
    props: { modelValue, label: '执行时间' },
    global: { plugins: [i18n], stubs: { Teleport: true } },
    attachTo: document.body,
  })
}

async function openPanel(wrapper: ReturnType<typeof mountField>) {
  await wrapper.find('.field-trigger').trigger('click')
  await flushPromises()
  return wrapper
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TimeWheelField', () => {
  it('触发器显示当前时刻', () => {
    const wrapper = mountField('18:57')
    expect(wrapper.find('.field-value').text()).toBe('18:57')
  })

  it('小时列 0-23、分钟列 0-59', async () => {
    const wrapper = await openPanel(mountField())
    const [hourCol, minuteCol] = wrapper.findAll('.wheel-col')
    expect(hourCol.findAll('.wheel-item')).toHaveLength(24)
    expect(minuteCol.findAll('.wheel-item')).toHaveLength(60)
    expect(hourCol.findAll('.wheel-item')[0].text()).toBe('00')
  })

  it('点选小时即时按 HH:MM 回写，分钟保持不变', async () => {
    const wrapper = await openPanel(mountField('09:00'))
    const hourCol = wrapper.findAll('.wheel-col')[0]
    await hourCol.find('[data-value="18"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['18:00'])
  })

  it('方向键步进并钳在取值域内', async () => {
    const wrapper = await openPanel(mountField('23:59'))
    const hourCol = wrapper.findAll('.wheel-col')[0]

    await hourCol.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['22:59'])

    await hourCol.trigger('keydown', { key: 'ArrowDown' })
    await hourCol.trigger('keydown', { key: 'ArrowDown' })
    const emitted = wrapper.emitted('update:modelValue') ?? []
    expect(emitted[emitted.length - 1]).toEqual(['23:59'])
    // 23 已是上界，再按一次不产生新的回写
    expect(emitted).toHaveLength(2)
  })

  it('确定按钮只收起面板，不改值', async () => {
    const wrapper = await openPanel(mountField('09:00'))
    await wrapper.find('.wheel-confirm').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('.wheel-cols').exists()).toBe(false)
  })
})
