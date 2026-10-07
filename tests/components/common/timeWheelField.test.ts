/**
 * TimeWheelField 组件测试 — 两列滚轮的取值范围与回写时机。
 * Seam: 组件对外的 modelValue 契约（HH:MM 字符串）—— 面板内是草稿，确定才外发。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
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

/** 面板开着时的列：Teleport stub 下宿主每次重渲染都会重建内容，必须重新取 */
function col(wrapper: ReturnType<typeof mountField>, kind: 'hour' | 'minute') {
  return wrapper.findAll('.wheel-col')[kind === 'hour' ? 0 : 1]
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
    expect(col(wrapper, 'hour').findAll('.wheel-item')).toHaveLength(24)
    expect(col(wrapper, 'minute').findAll('.wheel-item')).toHaveLength(60)
    expect(col(wrapper, 'hour').findAll('.wheel-item')[0].text()).toBe('00')
  })

  it('点选只改草稿，确定才按 HH:MM 回写且另一列保持不变', async () => {
    const wrapper = await openPanel(mountField('09:00'))
    await col(wrapper, 'hour').find('[data-value="18"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await wrapper.find('.wheel-confirm').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['18:00'])
    expect(wrapper.find('.wheel-cols').exists()).toBe(false)
  })

  it('滚动过程中不取吸附位，停下（scrollend）才取一次', async () => {
    vi.useFakeTimers()
    const wrapper = await openPanel(mountField('09:00'))
    // 20 分钟 × 行高 34px
    Object.defineProperty(col(wrapper, 'minute').element, 'scrollTop', { value: 680, configurable: true })

    await wrapper.findAll('.wheel-col')[1].trigger('scroll')
    expect(col(wrapper, 'minute').find('.is-selected').text()).toBe('00')

    await wrapper.findAll('.wheel-col')[1].trigger('scrollend')
    await flushPromises()
    vi.useRealTimers()
    expect(col(wrapper, 'minute').find('.is-selected').text()).toBe('20')
  })

  it('刚滚完就按确定时，先把未落定的吸附位读进来', async () => {
    vi.useFakeTimers()
    const wrapper = await openPanel(mountField('09:00'))
    Object.defineProperty(col(wrapper, 'minute').element, 'scrollTop', { value: 680, configurable: true })
    await wrapper.findAll('.wheel-col')[1].trigger('scroll')

    await wrapper.find('.wheel-confirm').trigger('click')
    vi.useRealTimers()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['09:20'])
  })

  it('方向键步进草稿并钳在取值域内', async () => {
    const wrapper = await openPanel(mountField('23:59'))

    await col(wrapper, 'hour').trigger('keydown', { key: 'ArrowUp' })
    expect(col(wrapper, 'hour').find('.is-selected').text()).toBe('22')

    await col(wrapper, 'hour').trigger('keydown', { key: 'ArrowDown' })
    await col(wrapper, 'hour').trigger('keydown', { key: 'ArrowDown' })
    expect(col(wrapper, 'hour').find('.is-selected').text()).toBe('23')
  })

  it('没点确定就关闭时不回写', async () => {
    const wrapper = await openPanel(mountField('09:00'))
    await col(wrapper, 'minute').find('[data-value="37"]').trigger('click')

    // 触发器再点一次即收起，等价于点面板外部 / Escape
    await wrapper.find('.field-trigger').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('.wheel-cols').exists()).toBe(false)
  })

  it('重新打开时草稿回到已提交值', async () => {
    const wrapper = await openPanel(mountField('09:00'))
    await col(wrapper, 'minute').find('[data-value="37"]').trigger('click')
    await wrapper.find('.field-trigger').trigger('click')
    await flushPromises()

    await wrapper.find('.field-trigger').trigger('click')
    await flushPromises()
    expect(col(wrapper, 'minute').find('.is-selected').text()).toBe('00')
  })
})
