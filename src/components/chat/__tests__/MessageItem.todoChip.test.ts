/**
 * 历史气泡里的待办引用：渲染成 chip、点回任务现场、复制回输入框仍是标记。
 * 只替掉子组件与 IPC，走真实 store 与真实 DOM 事件。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent } from 'vue'
import MessageItem from '@/components/chat/MessageItem.vue'
import { useAppStore } from '@/stores/app'
import { useTodoStore } from '@/stores/todo'
import { useTodoActions } from '@/composables/useTodoActions'
import { api } from '@/services/electronAPI'
import { buildTodoMarker } from '@/shared/todoReference'
import type { Message } from '@/types'
import type { Todo } from '@/shared/channels/todo'
import zhCN from '@/i18n/locales/zh-CN'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

function userMessage(content: string): Message {
  return { id: 'm1', role: 'user', content, timestamp: Date.now() }
}

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: '收尾登录改造',
    status: 'open',
    priority: 'high',
    tags: [],
    reminders: [],
    sessionLinks: [],
    orderIndex: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function mountMessage(content: string) {
  return mount(MessageItem, {
    props: { message: userMessage(content) },
    global: {
      plugins: [i18n],
      stubs: ['MarkdownRenderer', 'ReasoningCard', 'ToolCallList', 'MessageMetadata'],
    },
    attachTo: document.body,
  })
}

let appStore: ReturnType<typeof useAppStore>
let todoStore: ReturnType<typeof useTodoStore>
/** useTodoActions 里的 useI18n 只能在 setup 内调用，用探针组件拿到共享的 notice。 */
let notice: ReturnType<typeof mountProbe>['vm']

const NoticeProbe = defineComponent({
  setup() {
    const { notice, dismissNotice } = useTodoActions()
    return { notice, dismissNotice }
  },
  render: () => null,
})

function mountProbe() {
  return mount(NoticeProbe, { global: { plugins: [i18n] } })
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.spyOn(api, 'httpFetch').mockResolvedValue(null)
  appStore = useAppStore()
  todoStore = useTodoStore()
  notice = mountProbe().vm
  notice.dismissNotice()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

describe('MessageItem · 待办引用渲染', () => {
  it('用户正文里的 marker 渲染成 chip（标题解码后显示）', async () => {
    const wrapper = mountMessage(`继续 ${buildTodoMarker('t1', '收尾登录改造')} 吧`)
    await flushPromises()

    const chip = wrapper.find('.user-text .todo-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.attributes('data-todo-id')).toBe('t1')
    expect(chip.find('.chip-name').text()).toBe('收尾登录改造')
    expect(wrapper.find('.user-text').text()).not.toContain('@todo:')
  })

  it('待办已被删除也照样显示名字（标题随标记走）', async () => {
    const wrapper = mountMessage(buildTodoMarker('gone', '被删掉的事'))
    await flushPromises()

    expect(wrapper.find('.todo-chip .chip-name').text()).toBe('被删掉的事')
  })
})

describe('MessageItem · 点待办引用回到任务现场', () => {
  it('点 chip 打开待办面板并定位到那条', async () => {
    todoStore.todos = [todo()]
    const wrapper = mountMessage(buildTodoMarker('t1', '收尾登录改造'))
    await flushPromises()

    await wrapper.find('.todo-chip').trigger('click')

    expect(appStore.showTodoManager).toBe(true)
    expect(todoStore.detailId).toBe('t1')
    expect(notice.notice).toBeNull()
  })

  it('点 chip 内层图标也能命中（closest 向上找）', async () => {
    todoStore.todos = [todo()]
    const wrapper = mountMessage(buildTodoMarker('t1', '收尾登录改造'))
    await flushPromises()

    await wrapper.find('.todo-chip .chip-name').trigger('click')

    expect(todoStore.detailId).toBe('t1')
  })

  it('待办已不存在时仍打开面板，并给出提示', async () => {
    const wrapper = mountMessage(buildTodoMarker('gone', '被删掉的事'))
    await flushPromises()

    await wrapper.find('.todo-chip').trigger('click')

    expect(appStore.showTodoManager).toBe(true)
    expect(todoStore.detailId).toBe('gone')
    expect(notice.notice).toBe(zhCN.todo.error['not-found'])
  })

  it('点正文空白处不动待办面板', async () => {
    const wrapper = mountMessage(`继续 ${buildTodoMarker('t1', '收尾登录改造')}`)
    await flushPromises()

    await wrapper.find('.user-text').trigger('click')

    expect(appStore.showTodoManager).toBe(false)
    expect(todoStore.detailId).toBeNull()
  })
})

describe('MessageItem · 复制待办引用', () => {
  function copySelection(el: HTMLElement): { text?: string; prevented: boolean } {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const event = new Event('copy', { bubbles: true, cancelable: true })
    let text: string | undefined
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (_type: string, value: string) => { text = value } },
    })
    el.dispatchEvent(event)
    return { text, prevented: event.defaultPrevented }
  }

  it('复制整段用户正文时 chip 还原成 marker，粘回输入框还是 chip', async () => {
    const wrapper = mountMessage(`继续 ${buildTodoMarker('t1', '收尾登录改造')} 吧`)
    await flushPromises()

    const result = copySelection(wrapper.find('.user-text').element as HTMLElement)

    expect(result.prevented).toBe(true)
    expect(result.text).toBe(`继续 ${buildTodoMarker('t1', '收尾登录改造')} 吧`)
  })

  it('todo chip 与 file chip 混排时各自还原成自己的标记', async () => {
    const wrapper = mountMessage(`${buildTodoMarker('t1', '收尾登录改造')} @file:"src/a.ts"`)
    await flushPromises()

    const result = copySelection(wrapper.find('.user-text').element as HTMLElement)

    expect(result.text).toBe(`${buildTodoMarker('t1', '收尾登录改造')} @file:"src/a.ts"`)
  })

  it('光标折叠（没有选区内容）时不拦复制', async () => {
    const wrapper = mountMessage(buildTodoMarker('t1', '收尾登录改造'))
    await flushPromises()

    const el = wrapper.find('.user-text').element as HTMLElement
    const range = document.createRange()
    range.setStart(el, 0)
    range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const event = new Event('copy', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
  })
})