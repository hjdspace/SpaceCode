/**
 * TodoDueField 组件测试 — 日期 + 时刻两个字段合成一个 Unix ms 往外发。
 * 真的 CalendarField / TimeWheelField / PopoverPanel 都挂着（浮层 teleport 到 body），
 * 只有「日历给不出的输入」（清空日期、非法时刻）才从子组件的 emit 契约打进去。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TodoDueField from '@/components/todo/TodoDueField.vue'
import CalendarField from '@/components/common/CalendarField.vue'
import TimeWheelField from '@/components/common/TimeWheelField.vue'
import zhCN from '@/i18n/locales/zh-CN'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

/** 本地 2026-11-14 10:00，日历打开时默认落在这个月。 */
const NOW = new Date(2026, 10, 14, 10, 0, 0, 0).getTime()
const NOV_20_0900 = new Date(2026, 10, 20, 9, 0, 0, 0).getTime()
const NOV_20_1430 = new Date(2026, 10, 20, 14, 30, 0, 0).getTime()

const mounted: { unmount: () => void }[] = []

function mountField(props: { modelValue: number | null; dateLabel?: string; timeLabel?: string; disabled?: boolean }) {
  const wrapper = mount(TodoDueField, {
    props,
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

type FieldWrapper = ReturnType<typeof mountField>

/** 浮层不在 wrapper 的 DOM 子树里，只能从 body 上捞。 */
function inPopover(selector: string): DOMWrapper<Element> {
  const el = document.body.querySelector(selector)
  if (!el) throw new Error(`浮层里找不到 ${selector}`)
  return new DOMWrapper(el)
}

function calendarTrigger(wrapper: FieldWrapper): DOMWrapper<Element> {
  return wrapper.find('.calendar-field .field-trigger')
}

function timeTrigger(wrapper: FieldWrapper): DOMWrapper<Element> {
  return wrapper.find('.time-wheel-field .field-trigger')
}

/** 打开日历并点某一天（真实的 data-date 单元格）。 */
async function pickDate(wrapper: FieldWrapper, date: string): Promise<void> {
  await calendarTrigger(wrapper).trigger('click')
  await flushPromises()
  await inPopover(`.calendar-day[data-date="${date}"]`).trigger('click')
  await flushPromises()
}

/** 打开时间滚轮，点小时/分钟，再按确认（滚轮内部是草稿，确认才外发）。 */
async function pickTime(wrapper: FieldWrapper, hour: number, minute: number): Promise<void> {
  await timeTrigger(wrapper).trigger('click')
  await flushPromises()
  const cols = document.body.querySelectorAll('.wheel-col')
  expect(cols).toHaveLength(2)
  await new DOMWrapper(cols[0]).find(`.wheel-item[data-value="${hour}"]`).trigger('click')
  await new DOMWrapper(cols[1]).find(`.wheel-item[data-value="${minute}"]`).trigger('click')
  await inPopover('.wheel-confirm').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TodoDueField · 空值与标签', () => {
  it('未设置时只渲染日期字段，显示占位文案且没有清除按钮', () => {
    const wrapper = mountField({ modelValue: null })

    expect(wrapper.find('.calendar-field .field-value').text()).toBe(zhCN.todo.detail.noDue)
    expect(wrapper.find('.time-wheel-field').exists()).toBe(false)
    expect(wrapper.find('.due-clear').exists()).toBe(false)
  })

  it('已设置时日期与时刻各自回显，并给出清除按钮', () => {
    const wrapper = mountField({ modelValue: NOV_20_1430 })

    expect(wrapper.find('.calendar-field .field-value').text()).toBe('2026-11-20')
    expect(wrapper.find('.time-wheel-field .field-value').text()).toBe('14:30')
    expect(wrapper.find('.due-clear').attributes('aria-label')).toBe(zhCN.todo.detail.clearDue)
  })

  it('props 传的日期/时间标签落到两个字段的 aria-label 上', () => {
    const wrapper = mountField({ modelValue: NOV_20_1430, dateLabel: '计划完成时间', timeLabel: '几点' })

    expect(calendarTrigger(wrapper).attributes('aria-label')).toBe('计划完成时间')
    expect(timeTrigger(wrapper).attributes('aria-label')).toBe('几点')
  })

  it('不传标签时回落到详情里的默认文案', () => {
    const wrapper = mountField({ modelValue: NOV_20_1430 })

    expect(calendarTrigger(wrapper).attributes('aria-label')).toBe(zhCN.todo.detail.date)
    expect(timeTrigger(wrapper).attributes('aria-label')).toBe(zhCN.todo.detail.time)
  })
})

describe('TodoDueField · 合成时间戳', () => {
  it('只选日期时按当天 09:00 落地（不落成 00:00 立刻逾期）', async () => {
    const wrapper = mountField({ modelValue: null })

    await pickDate(wrapper, '2026-11-20')

    expect(wrapper.emitted('update:modelValue')).toEqual([[NOV_20_0900]])
  })

  it('改日期保留原来的时刻', async () => {
    const wrapper = mountField({ modelValue: NOV_20_1430 })

    await pickDate(wrapper, '2026-11-25')

    expect(wrapper.emitted('update:modelValue')).toEqual([[new Date(2026, 10, 25, 14, 30, 0, 0).getTime()]])
  })

  it('滚轮改时刻后按确认，发出同一天的新时间戳', async () => {
    const wrapper = mountField({ modelValue: NOV_20_1430 })

    await pickTime(wrapper, 18, 45)

    expect(wrapper.emitted('update:modelValue')).toEqual([[new Date(2026, 10, 20, 18, 45, 0, 0).getTime()]])
  })

  it('滚轮里选了又改成原值时不外发（确认前是草稿）', async () => {
    const wrapper = mountField({ modelValue: NOV_20_1430 })

    await pickTime(wrapper, 14, 30)

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('日期被清空时整个值清成 null', async () => {
    const wrapper = mountField({ modelValue: NOV_20_1430 })

    wrapper.findComponent(CalendarField).vm.$emit('update:modelValue', '')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
  })

  it('空时刻按 09:00 兜底，日期不变', async () => {
    const wrapper = mountField({ modelValue: NOV_20_1430 })

    wrapper.findComponent(TimeWheelField).vm.$emit('update:modelValue', '')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toEqual([[NOV_20_0900]])
  })

  it('越界时刻（25:00）合成结果为 null，不会发出 NaN', async () => {
    const wrapper = mountField({ modelValue: NOV_20_1430 })

    wrapper.findComponent(TimeWheelField).vm.$emit('update:modelValue', '25:00')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
  })

  it('点清除按钮发出 null', async () => {
    const wrapper = mountField({ modelValue: NOV_20_1430 })

    await wrapper.find('.due-clear').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[null]])
  })
})

describe('TodoDueField · 只读来源', () => {
  it('disabled 时只给静态文本，不给任何编辑入口', () => {
    const wrapper = mountField({ modelValue: new Date(2026, 10, 14, 14, 30, 0, 0).getTime(), disabled: true })

    expect(wrapper.find('.due-static').text()).toBe('14:30')
    expect(wrapper.find('.calendar-field').exists()).toBe(false)
    expect(wrapper.find('.time-wheel-field').exists()).toBe(false)
    expect(wrapper.find('.due-clear').exists()).toBe(false)
  })

  it('disabled 且没有计划时间时显示未设置', () => {
    const wrapper = mountField({ modelValue: null, disabled: true })

    expect(wrapper.find('.due-static').text()).toBe(zhCN.todo.detail.noDue)
  })
})