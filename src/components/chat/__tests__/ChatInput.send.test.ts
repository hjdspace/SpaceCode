/**
 * ChatInput 提交面特征化测试（重构安全网）
 *
 * 只钉"当前行为"，不主张它是理想设计：Enter/Ctrl+Enter 的派发、AI 回复期间的
 * 排队与 steering、command-chip 与直接输入斜杠的分支、待发送队列的三个按钮、
 * 以及 defineExpose 的 getContent/setContent。T1–T6 的每一次搬动都必须让这些
 * 断言继续原样通过 —— 挂了就是行为被改到了，而不是测试写错了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, ref } from 'vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import { api } from '@/services/electronAPI'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn(),
  llmState: { provider: ref(''), isConfigured: ref(false) },
}))

const Stub = defineComponent({ render: () => '' })

/**
 * jsdom 不实现 innerText —— 召回待发送消息时产品代码用
 * `editorRef.value.innerText = content` 写回编辑器，测试里必须补上这个 DOM API，
 * 否则测的是环境缺陷而不是行为。（getter 只在本套件用到的纯文本场景下等价。）
 */
Object.defineProperty(HTMLElement.prototype, 'innerText', {
  configurable: true,
  get(this: HTMLElement) { return this.textContent ?? '' },
  set(this: HTMLElement, value: string) { this.textContent = value },
})

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS } })
const SESSION = 'session-1'

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

/** 走真实键盘路径：handleEditorKeydown 决定 Enter 是发送、排队还是 steering */
async function pressEnter(wrapper: Wrapper, modifiers: { ctrl?: boolean; meta?: boolean } = {}) {
  await wrapper.find('.inline-editor').trigger('keydown', {
    key: 'Enter',
    ctrlKey: !!modifiers.ctrl || !!modifiers.meta,
    metaKey: !!modifiers.meta,
  })
  await flushPromises()
}

/**
 * 直接注入 chip DOM —— 与 useContentEditor 造出的节点同构：
 * 文本序列化靠 data-command / data-kind / data-source 三个属性。
 * 末尾必须补一次 input 事件：hasContent 是 computed，只对 inputText 之类的
 * 响应式状态敏感，光改 DOM 它不会失效（真人打字总会触发 input）。
 */
async function setChips(wrapper: Wrapper, chips: Array<{ command: string; kind: string; source?: string }>, tailText: string) {
  const el = editorEl(wrapper)
  el.innerHTML = ''
  for (const chip of chips) {
    const node = document.createElement('span')
    node.className = 'command-chip'
    node.setAttribute('contenteditable', 'false')
    node.setAttribute('data-command', chip.command)
    node.setAttribute('data-kind', chip.kind)
    node.setAttribute('data-source', chip.source ?? 'builtin')
    el.appendChild(node)
  }
  el.appendChild(document.createTextNode(tailText))
  await wrapper.find('.inline-editor').trigger('input')
  await flushPromises()
}

function emitOf(wrapper: Wrapper, event: string): unknown[][] {
  return (wrapper.emitted() as Record<string, unknown[][]>)[event] ?? []
}

let turnStore: ReturnType<typeof useTurnStore>

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useAppStore().projectRoot = '/proj'
  vi.spyOn(api, 'httpFetch').mockResolvedValue(null)
  turnStore = useTurnStore()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('ChatInput · 普通提交', () => {
  it('Enter 发送纯文本，随后清空输入区', async () => {
    const wrapper = mountInput()
    await flushPromises()

    wrapper.vm.setContent('hello')
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'send')).toEqual([['hello', { files: [], images: [] }]])
    expect(editorEl(wrapper).textContent).toBe('')
  })

  it('引用的 blockquote 前缀在发送文本里', async () => {
    const wrapper = mountInput()
    await flushPromises()

    useAppStore().pushToInput({ quote: { id: 'q1', text: 'line1\nline2' } })
    await flushPromises()
    wrapper.vm.setContent('note')
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'send')[0][0]).toBe('> line1\n> line2\n\nnote')
    // 引用条随发送一起清空，下一次发送不再带前缀
    wrapper.vm.setContent('again')
    await pressEnter(wrapper)
    expect(emitOf(wrapper, 'send')[1][0]).toBe('again')
  })

  it('只有引用没有正文时，发送的就是引用块', async () => {
    const wrapper = mountInput()
    await flushPromises()

    useAppStore().pushToInput({ quote: { id: 'q1', text: 'only quote' } })
    await flushPromises()
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'send')).toEqual([['> only quote', { files: [], images: [] }]])
  })

  it('空输入 / disabled 时 Enter 不发送', async () => {
    const empty = mountInput()
    await flushPromises()
    await pressEnter(empty)
    expect(emitOf(empty, 'send')).toHaveLength(0)

    const disabled = mountInput({ disabled: true })
    await flushPromises()
    disabled.vm.setContent('typed anyway')
    await pressEnter(disabled)
    expect(emitOf(disabled, 'send')).toHaveLength(0)
  })

  it('点右下角按钮走同一条发送路径', async () => {
    const wrapper = mountInput()
    await flushPromises()

    wrapper.vm.setContent('clicked')
    await wrapper.find('.send-btn').trigger('click')
    await flushPromises()

    expect(emitOf(wrapper, 'send')).toEqual([['clicked', { files: [], images: [] }]])
  })

  it('showActions=false 时不渲染发送按钮，Enter 仍可发送', async () => {
    const wrapper = mountInput({ showActions: false })
    await flushPromises()

    expect(wrapper.find('.send-btn').exists()).toBe(false)
    wrapper.vm.setContent('enter only')
    await pressEnter(wrapper)
    expect(emitOf(wrapper, 'send')).toHaveLength(1)
  })

  it('enterSubmits=false 时 Enter 不发送，Ctrl+Enter 也不发送', async () => {
    const wrapper = mountInput({ enterSubmits: false })
    await flushPromises()

    wrapper.vm.setContent('no submit')
    await pressEnter(wrapper)
    await pressEnter(wrapper, { ctrl: true })

    expect(emitOf(wrapper, 'send')).toHaveLength(0)
  })
})

describe('ChatInput · AI 回复期间（排队 vs steering）', () => {
  it('Enter 进待发送队列，不发 send', async () => {
    const wrapper = mountInput({ isSending: true })
    await flushPromises()

    wrapper.vm.setContent('queued')
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'send')).toHaveLength(0)
    expect(turnStore.getPendingMessages(SESSION)).toMatchObject([
      { content: 'queued', priority: 'later', displayLabel: 'queued' },
    ])
    expect(editorEl(wrapper).textContent).toBe('')
  })

  it('Ctrl+Enter 立即插话：发 send 且不入队', async () => {
    const wrapper = mountInput({ isSending: true })
    await flushPromises()

    wrapper.vm.setContent('steer now')
    await pressEnter(wrapper, { ctrl: true })

    expect(emitOf(wrapper, 'send')).toEqual([['steer now', { files: [], images: [] }]])
    expect(turnStore.getPendingMessages(SESSION)).toHaveLength(0)
  })

  it('停止按钮在 isSending 时发 stop 而非 send', async () => {
    const wrapper = mountInput({ isSending: true })
    await flushPromises()

    await wrapper.find('.send-btn').trigger('click')
    await flushPromises()

    expect(emitOf(wrapper, 'stop')).toHaveLength(1)
    expect(emitOf(wrapper, 'send')).toHaveLength(0)
  })

  it('待发送队列三个按钮：立即发送 / 召回到输入框 / 丢弃', async () => {
    const wrapper = mountInput({ isSending: true })
    await flushPromises()

    wrapper.vm.setContent('first in queue')
    await pressEnter(wrapper)
    expect(wrapper.findAll('.pending-message-item')).toHaveLength(1)

    const buttons = wrapper.findAll('.pending-action-btn')
    await buttons[0].trigger('click')
    await flushPromises()
    expect(emitOf(wrapper, 'send')).toEqual([['first in queue', { files: [], images: [] }]])

    wrapper.vm.setContent('second in queue')
    await pressEnter(wrapper)
    await wrapper.findAll('.pending-action-btn')[1].trigger('click')
    await flushPromises()
    expect(editorEl(wrapper).textContent).toBe('second in queue')
    expect(turnStore.getPendingMessages(SESSION)).toHaveLength(0)

    wrapper.vm.setContent('third in queue')
    await pressEnter(wrapper)
    await wrapper.findAll('.pending-action-btn')[2].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.pending-message-item')).toHaveLength(0)
    expect(emitOf(wrapper, 'send')).toHaveLength(1)
  })

  it('输入框为空时 ArrowUp 召回最近一条待发送', async () => {
    const wrapper = mountInput({ isSending: true })
    await flushPromises()

    wrapper.vm.setContent('recall me')
    await pressEnter(wrapper)

    await wrapper.find('.inline-editor').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()

    expect(editorEl(wrapper).textContent).toBe('recall me')
    expect(turnStore.getPendingMessages(SESSION)).toHaveLength(0)
  })

  it('输入框有内容时 ArrowUp 不拦截（交回浏览器）', async () => {
    const wrapper = mountInput({ isSending: true })
    await flushPromises()

    wrapper.vm.setContent('recall me')
    await pressEnter(wrapper)
    wrapper.vm.setContent('typing here')
    await wrapper.find('.inline-editor').trigger('keydown', { key: 'ArrowUp' })
    await flushPromises()

    expect(editorEl(wrapper).textContent).toBe('typing here')
    expect(turnStore.getPendingMessages(SESSION)).toHaveLength(1)
  })
})

describe('ChatInput · 斜杠命令派发', () => {
  it('单枚 sdk_command chip → slash-command 事件，参数与 displayLabel 分离', async () => {
    const wrapper = mountInput()
    await flushPromises()

    await setChips(wrapper, [{ command: '/review', kind: 'sdk_command' }], 'fix tests')
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'send')).toHaveLength(0)
    expect(emitOf(wrapper, 'slash-command')).toEqual([
      [
        'review',
        'fix tests',
        { files: [], images: [] },
        '/cmd:"review":sdk_command:builtin fix tests',
      ],
    ])
    expect(editorEl(wrapper).textContent).toBe('')
  })

  it('单枚 immediate chip → 同样派发 slash-command，不发送文本', async () => {
    const wrapper = mountInput()
    await flushPromises()

    await setChips(wrapper, [{ command: '/help', kind: 'immediate' }], '')
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'slash-command')).toEqual([
      ['help', '', { files: [], images: [] }, '/cmd:"help":immediate:builtin'],
    ])
    expect(emitOf(wrapper, 'send')).toHaveLength(0)
  })

  it('多枚 chip → 展开成提示词后按 send 发送（带 displayLabel）', async () => {
    const wrapper = mountInput()
    await flushPromises()

    await setChips(
      wrapper,
      [{ command: '/init', kind: 'codepilot_command' }, { command: '/memory', kind: 'codepilot_command' }],
      'extra ask',
    )
    await pressEnter(wrapper)

    const sends = emitOf(wrapper, 'send')
    expect(sends).toHaveLength(1)
    expect(sends[0][2]).toHaveProperty('displayLabel')
    expect(emitOf(wrapper, 'slash-command')).toHaveLength(0)
  })

  it('直接输入 /review args（无 chip）→ sdk_command 仍走 slash-command', async () => {
    const wrapper = mountInput()
    await flushPromises()

    wrapper.vm.setContent('/review fix tests')
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'slash-command')).toEqual([['review', 'fix tests', { files: [], images: [] }]])
    expect(emitOf(wrapper, 'send')).toHaveLength(0)
  })

  it('直接输入 immediate 命令 → slash-command 带空参数', async () => {
    const wrapper = mountInput()
    await flushPromises()

    wrapper.vm.setContent('/help')
    await pressEnter(wrapper)

    expect(emitOf(wrapper, 'slash-command')).toEqual([['help', '', { files: [], images: [] }]])
  })

  it('未知 /skill args → 按普通 chip 展开后 send', async () => {
    const wrapper = mountInput()
    await flushPromises()

    wrapper.vm.setContent('/not-a-command do it')
    await pressEnter(wrapper)

    const sends = emitOf(wrapper, 'send')
    expect(sends).toHaveLength(1)
    expect(sends[0][2]).toMatchObject({ displayLabel: '/cmd:"not-a-command":slash_command:builtin do it' })
    expect(editorEl(wrapper).textContent).toBe('')
  })
})

describe('ChatInput · 宿主直读直写', () => {
  it('getContent 带引用前缀，setContent 覆盖编辑器', async () => {
    const wrapper = mountInput()
    await flushPromises()

    wrapper.vm.setContent('部署前检查')
    expect(wrapper.vm.getContent()).toEqual({
      text: '部署前检查',
      attachments: { files: [], images: [] },
    })

    useAppStore().pushToInput({ quote: { id: 'q1', text: 'ctx' } })
    await flushPromises()
    expect(wrapper.vm.getContent().text).toBe('> ctx\n\n部署前检查')

    wrapper.vm.setContent('替换后的内容')
    expect(wrapper.vm.getContent().text).toBe('> ctx\n\n替换后的内容')
  })

  it('injectFromWorkbench：text 追加、replace 覆盖', async () => {
    const wrapper = mountInput()
    await flushPromises()

    wrapper.vm.setContent('base')
    useAppStore().pushToInput({ text: 'more' })
    await flushPromises()
    expect(wrapper.vm.getContent().text).toBe('base\nmore')

    useAppStore().pushToInput({ text: 'only this', replace: true })
    await flushPromises()
    expect(wrapper.vm.getContent().text).toBe('only this')
  })

  it('draftScope=none 的宿主不读写会话草稿', async () => {
    const wrapper = mountInput({ draftScope: 'none', showActions: false })
    await flushPromises()

    wrapper.vm.setContent('scratch')
    expect(useChatSessionStore().getDraft(SESSION)).toBeUndefined()
  })
})
