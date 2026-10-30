// @vitest-environment jsdom
/**
 * 卡片 → 真实 turn store → IPC 边界的值可克隆性。
 *
 * 与 PermissionRequestCard.alwaysAllow.test.ts 的分工：那份打桩 store，只验按钮契约；
 * 这里用真实 store，因为 bug 恰恰出在 store 这一环 —— useTurnStore 返回的是 Pinia 的
 * reactive store，getPendingPermissionForToolUse 的返回值会被 Vue 的 getter 深度包成
 * Proxy，而 Electron 的 IPC 序列化器遇到 Proxy 直接抛 "An object could not be cloned"，
 * 于是「始终允许」点了必炸，且引擎永远等不到应答。打桩的测试看不见这件事。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PermissionRequestCard from '@/components/chat/tools/PermissionRequestCard.vue'
import { useTurnStore } from '@/stores/turn'
import { useChatSessionStore } from '@/stores/chatSession'
import { permissionService } from '@/services/permissionService'
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

const SUGGESTIONS = [
  { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
]

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
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn(async (...args: unknown[]) => { ipcCalls.push(args) }),
      denyPermission: vi.fn().mockResolvedValue(undefined),
      submitToolAnswer: vi.fn().mockResolvedValue(undefined),
      skipToolAnswer: vi.fn().mockResolvedValue(undefined),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
    _ipcCalls: ipcCalls,
  }
  // 模仿 Electron：任何参数是 Proxy 就抛，而不是静默降级
  api.claudeCode.allowPermission.mockImplementation(async (...args: unknown[]) => {
    ipcCalls.push(args)
    args.forEach(a => structuredClone(a))
  })
  return api
}

async function setup({ allow = {} }: { allow?: Record<string, unknown> } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const fake = makeFakeApi()
  const turn = useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()

  const message = sessionStore.addMessage({
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'tu-1', name: 'Edit', input: {}, status: 'running', startTime: 0, endTime: 0 }],
  })
  const sid = sessionStore.currentSessionId!

  fake._handlers.onPermissionRequest({
    sessionId: sid,
    data: {
      requestId: 'req-1',
      toolUseId: 'tu-1',
      toolName: 'Edit',
      input: { file_path: 'a.ts' },
      permissionSuggestions: SUGGESTIONS,
    },
  })

  const wrapper = mount(PermissionRequestCard, {
    props: {
      messageId: message.id,
      toolUseId: 'tu-1',
      toolName: 'Edit',
      input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
    },
    global: { plugins: [i18n, pinia] },
  })

  return { wrapper, fake, turn, sid, message }
}

describe('PermissionRequestCard 跨 IPC 边界', () => {
  beforeEach(() => {
    permissionService.clear()
  })

  it('「始终允许」的每个 IPC 参数都可被结构化克隆', async () => {
    const { wrapper, fake } = await setup()

    await wrapper.find('.always-allow').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(fake._ipcCalls).toHaveLength(1)
    // 走到这里没抛就是结论本身；再显式断言一次第 5 个参数的内容没被往返改坏
    const [, , , classification, permissions] = fake._ipcCalls[0]
    expect(classification).toBe('user_permanent')
    expect(permissions).toEqual(SUGGESTIONS)
  })

  it('回传的是纯数据副本，不是 store 里的 reactive 对象', async () => {
    const { wrapper, fake } = await setup()

    await wrapper.find('.always-allow').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    const permissions = fake._ipcCalls[0][4] as Array<Record<string, unknown>>
    expect(Object.getPrototypeOf(permissions)).toBe(Array.prototype)
    expect(Object.getPrototypeOf(permissions[0])).toBe(Object.prototype)
  })

  it('IPC 失败时把 pending 塞回去，重试还能救回这次会话', async () => {
    const { wrapper, fake, sid } = await setup()
    // 用 mockImplementationOnce 而不是 mockRejectedValueOnce：后者会跳过实现体，
    // 失败那次就不进 _ipcCalls，看不出重试到底有没有真的再发一次
    fake.claudeCode.allowPermission.mockImplementationOnce(async (...args: unknown[]) => {
      fake._ipcCalls.push(args)
      throw new Error('transient')
    })

    await wrapper.find('.always-allow').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(fake._ipcCalls).toHaveLength(1)
    expect(permissionService.getPendingPermissionForToolUse('tu-1', sid)).toBeDefined()

    // 重试必须真的把应答送出去，否则引擎永远卡在正在写入
    await wrapper.find('.always-allow').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(fake._ipcCalls).toHaveLength(2)
    expect(permissionService.hasPendingPermissionForToolUse('tu-1', sid)).toBe(false)
  })

  it('嵌入式面板里的卡片应答自己的会话，而不是用户当前查看的那条', async () => {
    const { wrapper, fake, sid } = await setup()
    const sessionStore = useChatSessionStore()
    // 用户在看板接管面板里对话，中间面板仍停在另一条会话上。
    const other = sessionStore.createSession('用户正在看的会话')
    sessionStore.selectSession(other.id)

    await wrapper.setProps({ sessionId: sid })
    await wrapper.find('.allow').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(fake._ipcCalls).toHaveLength(1)
    expect(fake._ipcCalls[0][0]).toBe(sid)
  })
})
