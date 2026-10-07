import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import NewCronTaskModal from '@/components/cron/NewCronTaskModal.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import CalendarField from '@/components/common/CalendarField.vue'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn(),
  llmState: { provider: ref(''), isConfigured: ref(false) },
}))

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS } })

function mountModal() {
  return mount(NewCronTaskModal, {
    props: { visible: true },
    // Teleport 的内容不在 wrapper.element 子树里，DOM 查询会落空
    global: { plugins: [i18n], stubs: { Teleport: true } },
    attachTo: document.body,
  })
}

/** 排期字段现在收在摘要行的弹出面板里，要先展开才拿得到 */
async function openSchedulePanel(wrapper: ReturnType<typeof mountModal>, which: 'frequency' | 'validity') {
  const index = which === 'frequency' ? 0 : 1
  await wrapper.findAll('.summary-trigger')[index].trigger('click')
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useAppStore().projectRoot = '/project'
  vi.spyOn(api.cron, 'validate').mockResolvedValue({ valid: true })
  vi.spyOn(api.cron, 'describe').mockResolvedValue('Every day at 09:00')
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('NewCronTaskModal', () => {
  it('提示词用聊天输入框，任务描述字段已移除', () => {
    const wrapper = mountModal()
    expect(wrapper.findComponent(ChatInput).exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Description')
  })

  it('提示词框不渲染发送与优化提示词按钮，提交只走底部按钮', () => {
    const wrapper = mountModal()
    const chatInput = wrapper.findComponent(ChatInput)
    expect(chatInput.props('showActions')).toBe(false)
    expect(chatInput.props('enterSubmits')).toBe(false)
    expect(wrapper.find('.send-btn').exists()).toBe(false)
    expect(wrapper.find('.optimize-btn').exists()).toBe(false)
  })

  it('摘要行显示当前排期，点它才展开编辑面板', async () => {
    const wrapper = mountModal()
    await flushPromises()

    expect(wrapper.findAll('.summary-value')[0].text()).toBe('Daily 09:00')
    expect(wrapper.find('.mode-btn').exists()).toBe(false)

    await openSchedulePanel(wrapper, 'frequency')
    expect(wrapper.find('[data-value="repeat"]').attributes('aria-checked')).toBe('true')
  })

  it('嵌套浮层：滚轮面板内的点击不会被排期面板误判成点击外部', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await openSchedulePanel(wrapper, 'frequency')
    await wrapper.find('.panel-field .field-trigger').trigger('click')
    await flushPromises()
    expect(wrapper.find('.wheel').exists()).toBe(true)

    await wrapper.findAll('.wheel-col')[0].findAll('.wheel-item')[18].trigger('pointerdown')
    await flushPromises()

    expect(wrapper.find('.wheel').exists()).toBe(true)
    expect(wrapper.findAll('.editor-panel')).toHaveLength(1)
  })

  it('提交时把编辑器内容·工作空间·权限模式写进任务', async () => {
    const create = vi.spyOn(api.cron, 'create').mockResolvedValue({ id: 't1' } as never)
    const wrapper = mountModal()
    await flushPromises()

    wrapper.findComponent(ChatInput).vm.setContent('每天检查依赖安全更新')
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledTimes(1)
    const [projectRoot, task] = create.mock.calls[0]
    expect(projectRoot).toBe('/project')
    expect(task.prompt).toBe('每天检查依赖安全更新')
    expect(task.name).toBe('每天检查依赖安全更新')
    expect(task.workspace).toBe('/project')
    expect(task.permissionMode).toBe('default')
    expect(task.cron).toBe('0 9 * * *')
  })

  it('cron 非法时不创建任务', async () => {
    vi.mocked(api.cron.validate).mockResolvedValue({ valid: false, error: 'bad' })
    const create = vi.spyOn(api.cron, 'create')
    const wrapper = mountModal()
    await flushPromises()

    wrapper.findComponent(ChatInput).vm.setContent('随便写点什么')
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(create).not.toHaveBeenCalled()
  })

  it('间隔模式写出 step cron，且不落无意义的 frequency/scheduledTime', async () => {
    const create = vi.spyOn(api.cron, 'create').mockResolvedValue({ id: 't1' } as never)
    const wrapper = mountModal()
    await flushPromises()

    await openSchedulePanel(wrapper, 'frequency')
    await wrapper.find('[data-value="interval"]').trigger('click')
    wrapper.findComponent(ChatInput).vm.setContent('每 15 分钟检查依赖')
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    const [, task] = create.mock.calls[0]
    expect(task.cron).toBe('*/15 * * * *')
    expect(task.scheduleMode).toBe('interval')
    expect(task.recurring).toBe(true)
    expect(task.frequency).toBeUndefined()
    expect(task.scheduledTime).toBeUndefined()
  })

  it('单次模式把日期与时刻合成绝对时刻写进 startsAt', async () => {
    const create = vi.spyOn(api.cron, 'create').mockResolvedValue({ id: 't1' } as never)
    const wrapper = mountModal()
    await flushPromises()

    await openSchedulePanel(wrapper, 'frequency')
    await wrapper.find('[data-value="once"]').trigger('click')
    await wrapper.findComponent(CalendarField).vm.$emit('update:modelValue', '2030-01-02')
    wrapper.findComponent(ChatInput).vm.setContent('部署前检查')
    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    const [, task] = create.mock.calls[0]
    expect(task.cron).toBe('0 9 2 1 *')
    expect(task.scheduleMode).toBe('once')
    expect(task.recurring).toBe(false)
    expect(task.startsAt).toBe(new Date(2030, 0, 2, 9, 0, 0).getTime())
    expect(task.endsAt).toBeUndefined()
  })

  it('单次模式不再显示有效期，切到周期后恢复', async () => {
    const wrapper = mountModal()
    await flushPromises()
    expect(wrapper.findAll('.summary-trigger')).toHaveLength(2)

    await openSchedulePanel(wrapper, 'frequency')
    await wrapper.find('[data-value="once"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.summary-trigger')).toHaveLength(1)

    await wrapper.find('[data-value="repeat"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.summary-trigger')).toHaveLength(2)
  })

  it('单次时间已过：内联报错并禁用提交', async () => {
    const create = vi.spyOn(api.cron, 'create').mockResolvedValue({ id: 't1' } as never)
    const wrapper = mountModal()
    await flushPromises()

    await openSchedulePanel(wrapper, 'frequency')
    await wrapper.find('[data-value="once"]').trigger('click')
    await wrapper.findComponent(CalendarField).vm.$emit('update:modelValue', '2000-01-01')
    wrapper.findComponent(ChatInput).vm.setContent('随便写点什么')
    await flushPromises()

    expect(wrapper.find('.field-error').text()).toContain('future')
    expect(wrapper.find('.btn-primary').attributes('disabled')).toBeDefined()

    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
  })

  it('结束日期不晚于开始日期时内联报错', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await openSchedulePanel(wrapper, 'validity')
    // Teleport 被 stub 后宿主每次重渲染都会重建面板内容，所以每填一个字段都要重新取组件
    wrapper.findAllComponents(CalendarField)[0].vm.$emit('update:modelValue', '2030-06-10')
    await flushPromises()
    wrapper.findAllComponents(CalendarField)[1].vm.$emit('update:modelValue', '2030-06-01')
    await flushPromises()

    expect(wrapper.find('.field-error').text()).not.toBe('')
    expect(wrapper.find('.btn-primary').attributes('disabled')).toBeDefined()
  })

  it('方向键在排期模式间移动选中项', async () => {
    const wrapper = mountModal()
    await flushPromises()

    await openSchedulePanel(wrapper, 'frequency')
    const once = wrapper.find('[data-value="once"]')
    await once.trigger('click')
    await flushPromises()
    ;(once.element as HTMLElement).focus()
    await once.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()

    expect(wrapper.find('[data-value="repeat"]').attributes('aria-checked')).toBe('true')
  })
})
