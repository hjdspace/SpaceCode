import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import NewCronTaskModal from '@/components/cron/NewCronTaskModal.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
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
})
