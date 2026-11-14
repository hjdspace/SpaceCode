/**
 * ChatInput 的待办引用面：
 * 面板注入 → 编辑器 chip → 提交时的引用快照（含会话回链、已删除待办、排队重放）。
 * 走真实键盘路径与真实 store，只替掉 IPC。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, ref } from 'vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import { useAppStore } from '@/stores/app'
import { useTodoStore } from '@/stores/todo'
import { useTurnStore } from '@/stores/turn'
import { api } from '@/services/electronAPI'
import { buildTodoMarker } from '@/shared/todoReference'
import type { Todo } from '@/shared/channels/todo'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn(),
  llmState: { provider: ref(''), isConfigured: ref(false) },
}))

const Stub = defineComponent({ render: () => '' })

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS } })
const SESSION = 'session-1'

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: '收尾登录改造',
    notes: '表单校验已改完，剩下接口联调',
    status: 'open',
    priority: 'high',
    tags: ['login'],
    reminders: [],
    sessionLinks: [],
    orderIndex: 0,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function mountInput(props: Record<string, unknown> = {}) {
  return mount(ChatInput, {
    props: { sessionId: SESSION, ...props },
    global: {
      plugins: [i18n],
      stubs: { Teleport: true, ChatContextToolbar: Stub, ComposerStatusBar: Stub },
    },
    attachTo: document.body,
  })
}

type Wrapper = ReturnType<typeof mountInput>

function editorEl(wrapper: Wrapper): HTMLElement {
  return wrapper.find('.inline-editor').element as HTMLElement
}

async function pressEnter(wrapper: Wrapper, modifiers: { ctrl?: boolean } = {}) {
  await wrapper.find('.inline-editor').trigger('keydown', {
    key: 'Enter',
    ctrlKey: !!modifiers.ctrl,
  })
  await flushPromises()
}

/** 注入 chip 后补一次 input：hasContent 是 computed，只改 DOM 不会让它失效。 */
async function insertChipViaMenu(wrapper: Wrapper, id: string, title: string) {
  useAppStore().pushToInput({ todo: { id, title } })
  await flushPromises()
  await wrapper.find('.inline-editor').trigger('input')
  await flushPromises()
}

function emitOf(wrapper: Wrapper, event: string): unknown[][] {
  return (wrapper.emitted() as Record<string, unknown[][]>)[event] ?? []
}

let todoStore: ReturnType<typeof useTodoStore>
let turnStore: ReturnType<typeof useTurnStore>
let touchSession: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useAppStore().projectRoot = '/proj'
  vi.spyOn(api, 'httpFetch').mockResolvedValue(null)
  touchSession = vi.spyOn(api.todo, 'touchSession').mockResolvedValue(null)
  todoStore = useTodoStore()
  turnStore = useTurnStore()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('ChatInput · 待办引用注入', () => {
  it('面板推来的 todo 变成编辑器里的 chip，正文带 marker', async () => {
    todoStore.todos = [todo()]
    const wrapper = mountInput()
    await flushPromises()

    await insertChipViaMenu(wrapper, 't1', '收尾登录改造')

    const chip = editorEl(wrapper).querySelector('.todo-chip')!
    expect(chip.getAttribute('data-todo-id')).toBe('t1')
    expect(wrapper.vm.getContent().text).toContain(buildTodoMarker('t1', '收尾登录改造'))
  })

  it('「让 Agent 处理」同时注入 chip 与提示词正文', async () => {
    todoStore.todos = [todo()]
    const wrapper = mountInput()
    await flushPromises()

    useAppStore().pushToInput({ todo: { id: 't1', title: '收尾登录改造' }, text: '请处理这条 Todo' })
    await flushPromises()

    expect(editorEl(wrapper).querySelector('.todo-chip')).toBeTruthy()
    expect(wrapper.vm.getContent().text).toContain('请处理这条 Todo')
  })

  it('注入不写任何数据：只有真正发送才回链会话', async () => {
    todoStore.todos = [todo()]
    const wrapper = mountInput()
    await flushPromises()

    await insertChipViaMenu(wrapper, 't1', '收尾登录改造')

    expect(touchSession).not.toHaveBeenCalled()
  })
})

describe('ChatInput · 待办引用提交', () => {
  it('发送时带上引用快照，并把当前会话记到待办上', async () => {
    todoStore.todos = [todo({ groupId: 'g1' })]
    todoStore.groups = [{ id: 'g1', name: 'Work', color: 'blue', orderIndex: 0, createdAt: 1 }]
    const wrapper = mountInput()
    await flushPromises()

    await insertChipViaMenu(wrapper, 't1', '收尾登录改造')
    await pressEnter(wrapper)

    const sent = emitOf(wrapper, 'send')
    expect(sent).toHaveLength(1)
    const [content, , options] = sent[0] as [string, unknown, { todoReferences: unknown[] }]
    expect(content).toContain(buildTodoMarker('t1', '收尾登录改造'))
    expect(options.todoReferences).toEqual([{
      id: 't1',
      title: '收尾登录改造',
      status: 'open',
      priority: 'high',
      dueAt: undefined,
      notes: '表单校验已改完，剩下接口联调',
      groupName: 'Work',
      tags: ['login'],
    }])
    expect(touchSession).toHaveBeenCalledWith('t1', SESSION)
    expect(editorEl(wrapper).querySelector('.todo-chip')).toBeNull()
  })

  it('同一条待办引用两次只展开一次快照', async () => {
    todoStore.todos = [todo()]
    const wrapper = mountInput()
    await flushPromises()

    await insertChipViaMenu(wrapper, 't1', '收尾登录改造')
    await insertChipViaMenu(wrapper, 't1', '收尾登录改造')
    await pressEnter(wrapper)

    const [, , options] = emitOf(wrapper, 'send')[0] as [string, unknown, { todoReferences: unknown[] }]
    expect(options.todoReferences).toHaveLength(1)
    expect(touchSession).toHaveBeenCalledTimes(1)
  })

  it('待办已被删除：只带标题并标 missing，不再回链会话', async () => {
    const wrapper = mountInput()
    await flushPromises()

    await insertChipViaMenu(wrapper, 'gone', '被删掉的事')
    await pressEnter(wrapper)

    const [, , options] = emitOf(wrapper, 'send')[0] as [string, unknown, { todoReferences: unknown[] }]
    expect(options.todoReferences).toEqual([
      { id: 'gone', title: '被删掉的事', status: 'open', priority: 'medium', missing: true },
    ])
    expect(touchSession).not.toHaveBeenCalled()
  })

  it('没有待办引用时不多塞 options（emit 元数不变）', async () => {
    const wrapper = mountInput()
    await flushPromises()

    wrapper.vm.setContent('plain')
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'send')).toEqual([['plain', { files: [], images: [] }]])
  })

  it('AI 回复期间入队：快照随队列走，出队重放才不丢引用', async () => {
    todoStore.todos = [todo()]
    const wrapper = mountInput({ isSending: true })
    await flushPromises()

    await insertChipViaMenu(wrapper, 't1', '收尾登录改造')
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'send')).toHaveLength(0)
    const queued = turnStore.getPendingMessages(SESSION)
    expect(queued).toHaveLength(1)
    expect(queued[0].todoReferences).toMatchObject([{ id: 't1', title: '收尾登录改造' }])
  })

  it('Ctrl+Enter 插话也带引用快照', async () => {
    todoStore.todos = [todo()]
    const wrapper = mountInput({ isSending: true })
    await flushPromises()

    await insertChipViaMenu(wrapper, 't1', '收尾登录改造')
    await pressEnter(wrapper, { ctrl: true })

    const [, , options] = emitOf(wrapper, 'send')[0] as [string, unknown, { todoReferences: unknown[] }]
    expect(options.todoReferences).toMatchObject([{ id: 't1' }])
    expect(turnStore.getPendingMessages(SESSION)).toHaveLength(0)
  })

  it('斜杠命令的 args 里 marker 换成可读标题，气泡标签保留 marker', async () => {
    todoStore.todos = [todo()]
    const wrapper = mountInput()
    await flushPromises()

    await insertChipViaMenu(wrapper, 't1', '收尾登录改造')
    const el = editorEl(wrapper)
    el.insertBefore(document.createTextNode('/goal '), el.firstChild)
    await wrapper.find('.inline-editor').trigger('input')
    await flushPromises()
    await pressEnter(wrapper)

    const slash = emitOf(wrapper, 'slash-command')
    expect(slash).toHaveLength(1)
    expect(slash[0][0]).toBe('goal')
    expect(slash[0][1]).toBe('「收尾登录改造」')
  })
})