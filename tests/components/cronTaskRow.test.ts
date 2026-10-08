/**
 * CronTaskRow 组件测试 — 编辑按钮要把整条任务交出去。
 * Seam: 组件对外的 edit 事件（CronManager 靠它决定弹窗是编辑还是新建）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import CronTaskRow from '@/components/cron/CronTaskRow.vue'
import type { CronTask } from '@/stores/cron'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn(),
  llmState: { provider: ref(''), isConfigured: ref(false) },
}))

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS } })

const task: CronTask = {
  id: 't1',
  cron: '0 9 * * *',
  prompt: '每天检查依赖',
  createdAt: 0,
  name: '依赖巡检',
  enabled: true,
  recurring: true,
} as CronTask

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function mountRow() {
  return mount(CronTaskRow, {
    props: { task, expanded: false },
    global: { plugins: [i18n], stubs: { Teleport: true } },
    attachTo: document.body,
  })
}

describe('CronTaskRow', () => {
  it('点编辑按钮带出整条任务', async () => {
    const wrapper = mountRow()
    await wrapper.find('button[title="Edit"]').trigger('click')

    const emitted = wrapper.emitted('edit')
    expect(emitted).toHaveLength(1)
    expect(emitted?.[0][0]).toMatchObject({ id: 't1', cron: '0 9 * * *' })
  })
})
