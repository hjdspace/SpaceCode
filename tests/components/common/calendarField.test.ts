/**
 * CalendarField 组件测试 — 弹出月历、选中回写、min/max 边界、翻月。
 * Seam: 组件对外的 modelValue 契约（YYYY-MM-DD 字符串）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import CalendarField from '@/components/common/CalendarField.vue'
import zhCN from '@/i18n/locales/zh-CN'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

function mountField(props: Record<string, string> = {}) {
  return mount(CalendarField, {
    props: { modelValue: '', label: '执行日期', ...props },
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

describe('CalendarField', () => {
  it('未选值时显示占位符，选中某天后按 YYYY-MM-DD 回写并收起面板', async () => {
    const wrapper = mountField({ modelValue: '2026-03-15' })
    expect(wrapper.find('.field-value').text()).toBe('2026-03-15')

    await openPanel(wrapper)
    await wrapper.find('[data-date="2026-03-20"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['2026-03-20'])
    expect(wrapper.find('.calendar-grid').exists()).toBe(false)
  })

  it('空值时显示占位符', () => {
    const wrapper = mountField({ placeholder: '选择日期' })
    expect(wrapper.find('.field-value').text()).toBe('选择日期')
  })

  it('min/max 之外的天禁用，边界当天可选', async () => {
    const wrapper = mountField({
      modelValue: '2026-03-15',
      min: '2026-03-10',
      max: '2026-03-20',
    })
    await openPanel(wrapper)

    expect(wrapper.find('[data-date="2026-03-05"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-date="2026-03-09"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-date="2026-03-21"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-date="2026-03-10"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-date="2026-03-20"]').attributes('disabled')).toBeUndefined()
  })

  it('翻月后面板跟随，跨年正常', async () => {
    const wrapper = mountField({ modelValue: '2026-12-15' })
    await openPanel(wrapper)
    expect(wrapper.find('.calendar-title').text()).toContain('12')

    await wrapper.find('[aria-label="下个月"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-date="2027-01-01"]').exists()).toBe(true)

    await wrapper.find('[aria-label="上个月"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-date="2026-12-15"]').classes()).toContain('is-selected')
  })

  it('周一起始，表头 7 项', async () => {
    const wrapper = mountField({ modelValue: '2026-03-15' })
    await openPanel(wrapper)
    const labels = wrapper.findAll('.calendar-weekdays span').map((n) => n.text())
    expect(labels).toHaveLength(7)
    expect(labels[0]).toContain('一')
    expect(labels[6]).toContain('日')
  })
})
