// @vitest-environment jsdom
/**
 * pi 扩展对话框：引擎提问 → 卡片 → 应答回引擎 的往返 (issue #54)。
 *
 * 用真实 turn store 而不是打桩，因为这条路上出错的地方恰好在中间那一环：
 * 事件处理器要把帧落成一张能答的卡，应答要把可结构化克隆的值交回 IPC，
 * 而失败时又得把卡片退回可重试态。打桩 store 的测试这三样一样都看不见。
 *
 * 钉住的四件事：
 *   1. 四种方法各自的控件与各自的载荷形状（select/input 回 value，confirm 回 confirmed）；
 *   2. 应答参数可过 Electron 的序列化器 —— 选项字符串取自 reactive 的 Map，
 *      不剥 Proxy 就是 "An object could not be cloned"，点了必炸；
 *   3. IPC 失败后卡片回到 pending 且重试真的再发一次；
 *   4. 引擎那侧问题没了（超时 / 进程退出 / 另一个端答掉）时卡片退场，
 *      但用户已经答过的不被后到的通知覆盖。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExtensionDialogCard from '@/components/chat/tools/ExtensionDialogCard.vue'
import { useTurnStore } from '@/stores/turn'
import { useChatSessionStore } from '@/stores/chatSession'
import { extensionDialogService } from '@/services/extensionDialogService'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

vi.mock('@/services/electronAPI', () => ({
  api: {
    readFile: vi.fn(async () => 'content'),
    readFileAsBase64: vi.fn(async () => null),
    loadGuiSettings: vi.fn(async () => ({ success: false })),
    getEnv: vi.fn(async () => undefined),
    terminal: { onExit: vi.fn() },
    trace: { event: vi.fn() },
    showNotification: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS, 'zh-CN': zhCN } })

function makeFakeApi() {
  const handlers: Record<string, any> = {}
  const ipcCalls: unknown[][] = []
  const api = {
    claudeCode: {
      onStreamEvent: (cb: any) => { handlers.onStreamEvent = cb; return () => {} },
      onAssistant: (cb: any) => { handlers.onAssistant = cb; return () => {} },
      onToolUse: (cb: any) => { handlers.onToolUse = cb; return () => {} },
      onToolResult: (cb: any) => { handlers.onToolResult = cb; return () => {} },
      onUser: (cb: any) => { handlers.onUser = cb; return () => {} },
      onSystem: (cb: any) => { handlers.onSystem = cb; return () => {} },
      onResult: (cb: any) => { handlers.onResult = cb; return () => {} },
      onExit: (cb: any) => { handlers.onExit = cb; return () => {} },
      onError: (cb: any) => { handlers.onError = cb; return () => {} },
      onPermissionRequest: (cb: any) => { handlers.onPermissionRequest = cb; return () => {} },
      onPermissionRequestCancelled: (cb: any) => { handlers.onPermissionRequestCancelled = cb; return () => {} },
      onExtensionDialogRequest: (cb: any) => { handlers.onExtensionDialogRequest = cb; return () => {} },
      onExtensionDialogClosed: (cb: any) => { handlers.onExtensionDialogClosed = cb; return () => {} },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn().mockResolvedValue(undefined),
      denyPermission: vi.fn().mockResolvedValue(undefined),
      submitToolAnswer: vi.fn().mockResolvedValue(undefined),
      skipToolAnswer: vi.fn().mockResolvedValue(undefined),
      respondExtensionDialog: vi.fn(async (...args: unknown[]) => {
        ipcCalls.push(args)
        // 模仿 Electron：任何参数是 Proxy 就抛，而不是静默降级
        structuredClone(args[2])
      }),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
    _ipcCalls: ipcCalls,
  }
  return api
}

/**
 * 宏任务 flush。应答失败那条链要跨过几个微任务才解开（store 撤回 → 卡片 catch →
 * finally 复位 submitting），`$nextTick` 只排到渲染，等不到链尾 —— 用 setTimeout(0)
 * 才真的把 submitting 放回 false（PermissionRequestCard 的边界测试是同一个理由）。
 */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** 起会话 → 让引擎发一帧对话框 → 挂载真实卡片，全程走 store */
async function setup(frame: Record<string, unknown> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const fake = makeFakeApi()
  const turn = useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [] })
  const sid = sessionStore.currentSessionId!

  fake._handlers.onExtensionDialogRequest({
    sessionId: sid,
    data: {
      dialogId: 'uuid-1',
      method: 'select',
      title: 'Allow dangerous command?',
      options: ['Allow', 'Block'],
      ...frame,
    },
  })

  const dialog = extensionDialogService.get(sid, 'uuid-1')!
  const wrapper = mount(ExtensionDialogCard, {
    props: { dialog },
    global: { plugins: [i18n, pinia] },
  })

  return { wrapper, fake, turn, sid, dialog }
}

beforeEach(() => {
  extensionDialogService.clear()
})

describe('对话框落成一张能答的卡', () => {
  it('select 把每个选项渲染成一行可点的按钮', async () => {
    const { wrapper } = await setup()

    const options = wrapper.findAll('.option-btn')
    expect(options).toHaveLength(2)
    expect(options[0].text()).toBe('Allow')
    expect(options[1].text()).toBe('Block')
    expect(wrapper.find('.waiting-indicator').exists()).toBe(true)
  })

  it('confirm 给两键，且不把 cancelled 当成默认出口', async () => {
    const { wrapper, fake } = await setup({ method: 'confirm', message: 'All messages will be lost.' })

    expect(wrapper.find('.option-list').exists()).toBe(false)
    expect(wrapper.find('.dialog-message').text()).toBe('All messages will be lost.')

    await wrapper.find('.action-btn.primary').trigger('click')

    expect(fake._ipcCalls[0][2]).toEqual({ kind: 'confirmed', confirmed: true })
  })

  it('input 用 placeholder 起稿，空文本不给提交', async () => {
    const { wrapper, fake } = await setup({ method: 'input', placeholder: 'type something...', options: undefined })

    const field = wrapper.find('input.field-input')
    expect((field.element as HTMLInputElement).placeholder).toBe('type something...')
    expect(wrapper.find('.action-btn.primary').attributes('disabled')).toBeDefined()

    await field.setValue('export/plan.md')
    await wrapper.find('form').trigger('submit.prevent')

    expect(fake._ipcCalls[0][2]).toEqual({ kind: 'value', value: 'export/plan.md' })
  })

  it('editor 预填正文，清空它也算一次有意义的应答', async () => {
    const { wrapper, fake } = await setup({ method: 'editor', prefill: 'Line 1\nLine 2', options: undefined })

    const area = wrapper.find('textarea.field-input')
    expect((area.element as HTMLTextAreaElement).value).toBe('Line 1\nLine 2')

    await area.setValue('')
    await wrapper.find('form').trigger('submit.prevent')

    // editor 的空文本 = 「把它清空」，不是「没填」，必须放行
    expect(fake._ipcCalls[0][2]).toEqual({ kind: 'value', value: '' })
  })

  it('没有 dialogId 的帧落成不了卡：宁可不显示，也不造一张点了必失败的卡', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const fake = makeFakeApi()
    useTurnStore(fake as any)
    const sid = useChatSessionStore().currentSessionId ?? 'sid'

    fake._handlers.onExtensionDialogRequest({ sessionId: sid, data: { method: 'select', title: 'A?' } })

    expect(extensionDialogService.list(sid)).toEqual([])
  })
})

describe('应答交回引擎', () => {
  it('按会话与 pi 的 id 定位，值为纯数据', async () => {
    const { wrapper, fake, sid } = await setup()

    await wrapper.findAll('.option-btn')[0].trigger('click')

    expect(fake._ipcCalls).toHaveLength(1)
    expect(fake._ipcCalls[0].slice(0, 2)).toEqual([sid, 'uuid-1'])
    // 选项字符串来自 reactive 的 Map：过得了 structuredClone 才算真能过 IPC
    expect(Object.getPrototypeOf(fake._ipcCalls[0][2])).toBe(Object.prototype)
  })

  it('答完卡片收成一行回执，用的是用户看到的那个标签', async () => {
    const { wrapper, sid } = await setup()

    await wrapper.findAll('.option-btn')[1].trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.option-list').exists()).toBe(false)
    expect(wrapper.find('.resolved-text').text()).toBe('Block')
    expect(extensionDialogService.get(sid, 'uuid-1')!.state).toBe('resolved')
  })

  it('答完按钮就没了，第二次点击没有落点', async () => {
    const { wrapper, fake } = await setup()

    await wrapper.findAll('.option-btn')[0].trigger('click')
    await flush()

    // 折叠本身就是防重复应答的那道闸：引擎按 pi 的 id 认账，第二次提交只会失败，
    // 所以界面上先让这条路走不通，而不是等引擎报错
    expect(wrapper.findAll('.option-btn')).toHaveLength(0)
    expect(fake._ipcCalls).toHaveLength(1)
  })

  it('「关闭」回 cancelled，扩展那侧拿到 undefined', async () => {
    const { wrapper, fake } = await setup()

    await wrapper.find('.dismiss-btn').trigger('click')

    expect(fake._ipcCalls[0][2]).toEqual({ kind: 'cancel' })
  })
})

describe('应答失败的后果', () => {
  it('IPC 失败时卡片退回 pending，重试真的再发一次', async () => {
    const { wrapper, fake, sid } = await setup()
    // mockImplementationOnce 而不是 mockRejectedValueOnce：后者跳过实现体，
    // 失败那次就不进 _ipcCalls，看不出重试有没有真的再发
    fake.claudeCode.respondExtensionDialog.mockImplementationOnce(async (...args: unknown[]) => {
      fake._ipcCalls.push(args)
      throw new Error('No pending extension dialog')
    })

    await wrapper.findAll('.option-btn')[0].trigger('click')
    await flush()

    expect(wrapper.find('.option-list').exists()).toBe(true)
    expect(extensionDialogService.get(sid, 'uuid-1')!.state).toBe('pending')

    await wrapper.findAll('.option-btn')[0].trigger('click')
    await flush()

    expect(fake._ipcCalls).toHaveLength(2)
    expect(wrapper.find('.resolved-text').text()).toBe('Allow')
  })
})

describe('引擎不再等这次提问时卡片退场', () => {
  it('超时通知把卡片收起并写明是没等到答案', async () => {
    const { wrapper, sid, fake } = await setup()

    fake._handlers.onExtensionDialogClosed({
      sessionId: sid,
      data: { dialogId: 'uuid-1', method: 'select', reason: 'timeout' },
    })
    // 卡片自己按 id 读实况，不需要父级重新传一遍 (#54)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.resolved-text').text()).toBe('Timed out before an answer')
  })

  it('用户答过的不被后到的关闭通知覆盖', async () => {
    const { wrapper, sid, fake } = await setup()

    await wrapper.findAll('.option-btn')[0].trigger('click')
    fake._handlers.onExtensionDialogClosed({
      sessionId: sid,
      data: { dialogId: 'uuid-1', method: 'select', reason: 'answered' },
    })
    // 卡片自己按 id 读实况，不需要父级重新传一遍 (#54)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.resolved-text').text()).toBe('Allow')
  })

  it('进程退出把该会话还在等的卡一起收掉', async () => {
    const { sid, fake } = await setup()
    fake._handlers.onExtensionDialogRequest({
      sessionId: sid,
      data: { dialogId: 'uuid-2', method: 'confirm', title: 'Second question?', message: 'go on?' },
    })
    expect(extensionDialogService.hasPending(sid)).toBe(true)

    // killSession 会先摘掉事件处理器再拆进程，逐条的关闭通知发不出来；
    // store 挂在 exit 上的这把兜底就是为那条路准备的 (#54)
    fake._handlers.onExit({ sessionId: sid, data: 0 })

    expect(extensionDialogService.hasPending(sid)).toBe(false)
  })

  it('没有 dialogId 的关闭通知被忽略，不动任何一张卡', async () => {
    const { sid, fake } = await setup()

    fake._handlers.onExtensionDialogClosed({ sessionId: sid, data: { reason: 'timeout' } })

    expect(extensionDialogService.get(sid, 'uuid-1')!.state).toBe('pending')
  })
})

/**
 * 卡片插在时间线的哪个位置，取决于 store 在收到帧那一刻记下的游标 (issue #54)。
 *
 * 没有游标就只能追加到末尾，而末尾意味着：用户答完、LLM 接着往下说，这张已答的卡
 * 会把后续输出全压在上面 —— 看着像提问一直挂在底部没结。游标由 store 记，
 * 渲染层只是照它插，所以这条得钉在 store 这一侧。
 *
 * 三种形态：
 * - 已经跑出事件：锚到最后一个事件之后；
 * - 助手消息还没有任何事件（`/plan` 菜单在首个 token 之前）：记 anchorAtStart；
 * - 连助手消息都没有：不带游标，交给渲染层落末尾。
 */
describe('收到帧时记下时间线游标', () => {
  function lastAssistantMessage(sessionStore: ReturnType<typeof useChatSessionStore>) {
    return [...sessionStore.currentMessages].reverse().find(m => m.role === 'assistant')
  }

  it('正跑着工具时问的，游标指向该轮最后一个 timeline 事件', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const fake = makeFakeApi()
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.addMessage({ role: 'user', content: '继续' })
    const sid = sessionStore.currentSessionId!

    fake._handlers.onToolUse({ sessionId: sid, data: { id: 'tc-1', name: 'Bash', input: { command: 'ls' } } })
    fake._handlers.onExtensionDialogRequest({
      sessionId: sid,
      data: { dialogId: 'uuid-1', method: 'select', title: 'Allow?', options: ['Yes', 'No'] },
    })

    const dialog = extensionDialogService.get(sid, 'uuid-1')!
    const assistant = lastAssistantMessage(sessionStore)
    expect(dialog.anchorMessageId, '没记下当前轮的 assistant 消息，卡片只能吊在末尾').toBe(assistant?.id)
    expect(dialog.anchorEventId).toBe(assistant?.timelineEvents?.[assistant.timelineEvents.length - 1]?.id)
    expect(dialog.anchorAtStart).toBeUndefined()
    expect(turn.getExtensionDialogs(sid)).toHaveLength(1)
  })

  it('助手消息还没有任何事件时记 anchorAtStart，不能退到消息末尾', async () => {
    const { dialog } = await setup()
    const sessionStore = useChatSessionStore()

    expect(dialog.anchorMessageId).toBe(lastAssistantMessage(sessionStore)?.id)
    expect(dialog.anchorAtStart).toBe(true)
    expect(dialog.anchorEventId).toBeUndefined()
  })

  it('会话里连助手消息都没有时不带游标：那种卡落末尾是对的，不是缺陷', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const fake = makeFakeApi()
    useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession()
    const sid = sessionStore.currentSessionId!
    expect(lastAssistantMessage(sessionStore)).toBeUndefined()

    fake._handlers.onExtensionDialogRequest({
      sessionId: sid,
      data: { dialogId: 'uuid-1', method: 'select', title: 'Allow?', options: ['Yes', 'No'] },
    })

    const dialog = extensionDialogService.get(sid, 'uuid-1')!
    expect(dialog.anchorMessageId).toBeUndefined()
    expect(dialog.anchorEventId).toBeUndefined()
    expect(dialog.anchorAtStart).toBeUndefined()
  })
})
