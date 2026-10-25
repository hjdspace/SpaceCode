/**
 * ChatInput 语音输入：麦克风按钮、只读录音、实时转写、终稿一次性写回与撤销。
 *
 * 采音适配器与主进程会话都在接缝处注入：browserCapture 走模块 mock，
 * api.voice 用 spy 接管；断言只看用户能观察到的 DOM 与 IPC 调用次数。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, nextTick, ref } from 'vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import { VoiceCaptureError } from '@/lib/voice/voiceDictation'
import { dispatchVoiceShortcut, voiceTargetRegistry } from '@/lib/voice/voiceTargetRegistry'
import type {
  VoiceCaptureHandlers,
  VoiceCapturePort,
} from '@/lib/voice/voiceDictation'
import type {
  VoiceModelInstallInfo,
  VoiceModelStatus,
  VoicePartialPayload,
} from '@/shared/channels/voice'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn(),
  llmState: { provider: ref(''), isConfigured: ref(false) },
}))

const captureMock = vi.hoisted(() => ({
  start: vi.fn<(handlers: VoiceCaptureHandlers) => Promise<{ sampleRate: number }>>(),
  stop: vi.fn<() => void>(),
}))

vi.mock('@/lib/voice/browserCapture', () => ({
  createBrowserVoiceCapture: () =>
    ({ start: captureMock.start, stop: captureMock.stop }) as VoiceCapturePort,
}))

const Stub = defineComponent({ render: () => '' })

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS } })
const SESSION = 'session-voice'

function status(state: VoiceModelStatus['state']): VoiceModelStatus {
  return {
    state,
    version: '1.0.0',
    installedBytes: 0,
    diskUsageBytes: 0,
    partialBytes: 0,
    archiveBytes: 0,
    archiveReady: false,
    installedTotalBytes: 0,
    installedAt: null,
  }
}

const INSTALL_INFO: VoiceModelInstallInfo = {
  version: '1.0.0',
  archiveBytes: 1024,
  installedBytes: 2048,
  archiveName: 'model.tar.bz2',
  sources: [{ kind: 'github', url: 'https://example.com/model.tar.bz2' }],
}

let partialHandler: ((payload: VoicePartialPayload) => void) | null = null

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

function emitOf(wrapper: Wrapper, event: string): unknown[][] {
  return (wrapper.emitted() as Record<string, unknown[][]>)[event] ?? []
}

/** 走真实点击路径：prepare → startSession → capture.start 全部落地 */
async function startRecording(wrapper: Wrapper) {
  await wrapper.find('.voice-btn').trigger('click')
  await flushPromises()
}

function sessionIdOfStart(): string {
  return (api.voice.startSession as unknown as { mock: { calls: Array<[{ sessionId: string }]> } })
    .mock.calls[0][0].sessionId
}

function emitPartial(text: string) {
  partialHandler?.({ sessionId: sessionIdOfStart(), text })
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useAppStore().projectRoot = '/proj'
  vi.spyOn(api, 'httpFetch').mockResolvedValue(null)

  ;(window as unknown as { electronAPI?: unknown }).electronAPI = {}

  partialHandler = null
  captureMock.start.mockReset().mockResolvedValue({ sampleRate: 16_000 })
  captureMock.stop.mockReset()

  vi.spyOn(api.voice, 'getModelStatus').mockResolvedValue(status('installed'))
  vi.spyOn(api.voice, 'getInstallInfo').mockResolvedValue(INSTALL_INFO)
  vi.spyOn(api.voice, 'installModel').mockResolvedValue({ success: true, status: status('installed') })
  vi.spyOn(api.voice, 'onModelProgress').mockReturnValue(() => {})
  vi.spyOn(api.voice, 'startSession').mockResolvedValue({ ok: true, sampleRate: 16_000 })
  vi.spyOn(api.voice, 'sendAudio').mockReturnValue(undefined)
  vi.spyOn(api.voice, 'stopSession').mockResolvedValue({ success: true, text: '听写结果' })
  vi.spyOn(api.voice, 'cancelSession').mockResolvedValue({ success: true })
  vi.spyOn(api.voice, 'onPartial').mockImplementation((handler) => {
    partialHandler = handler
    return () => {}
  })
  vi.spyOn(api.voice, 'onSessionState').mockReturnValue(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
  document.body.innerHTML = ''
})

describe('ChatInput · 语音输入', () => {
  it('只在带 Electron 桥的环境渲染麦克风按钮', async () => {
    const supported = mountInput()
    await flushPromises()
    expect(supported.find('.voice-btn').exists()).toBe(true)
    supported.unmount()

    delete (window as unknown as { electronAPI?: unknown }).electronAPI
    const unsupported = mountInput()
    await flushPromises()
    expect(unsupported.find('.voice-btn').exists()).toBe(false)
  })

  it('点麦克风不让按钮抢走编辑器焦点', async () => {
    const wrapper = mountInput()
    await flushPromises()
    const editor = editorEl(wrapper)
    editor.focus()

    // 浏览器靠 mousedown 的默认行为把焦点移到按钮上；阻止后焦点与选区留在编辑器，
    // 快照里的 focused/caret 才是录音前的真实状态（Escape 才能真正恢复）。
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    wrapper.find('.voice-btn').element.dispatchEvent(down)

    expect(down.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(editor)
  })

  it('录音期间编辑器只读，实时转写只显示在快照之后', async () => {
    const wrapper = mountInput()
    await flushPromises()
    wrapper.vm.setContent('已有草稿')
    await flushPromises()

    await startRecording(wrapper)

    expect(api.voice.startSession).toHaveBeenCalledTimes(1)
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('false')
    expect(wrapper.find('.voice-cancel-btn').exists()).toBe(true)

    emitPartial('实时转写')
    await nextTick()

    expect(wrapper.find('.voice-live-transcript').text()).toBe('实时转写')
    expect(editorEl(wrapper).textContent).toBe('已有草稿')
  })

  it('停止只提交一次终稿，不自动发送', async () => {
    const wrapper = mountInput()
    await flushPromises()
    wrapper.vm.setContent('已有草稿')
    await flushPromises()

    await startRecording(wrapper)
    emitPartial('听写结果')
    await nextTick()

    await wrapper.find('.voice-btn').trigger('click')
    await flushPromises()

    expect(api.voice.stopSession).toHaveBeenCalledTimes(1)
    expect(editorEl(wrapper).textContent).toBe('已有草稿\n听写结果')
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')
    expect(emitOf(wrapper, 'send')).toEqual([])
    expect(wrapper.find('.voice-live-transcript').exists()).toBe(false)

    // 再点麦克风不会再提交一次旧的会话
    await startRecording(wrapper)
    expect(api.voice.startSession).toHaveBeenCalledTimes(2)
  })

  it('Escape 精确恢复录音前的编辑器内容与焦点', async () => {
    const wrapper = mountInput()
    await flushPromises()
    wrapper.vm.setContent('第一行')
    await flushPromises()
    const beforeHtml = editorEl(wrapper).innerHTML

    await startRecording(wrapper)
    emitPartial('不该留下')
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(api.voice.cancelSession).toHaveBeenCalledTimes(1)
    expect(editorEl(wrapper).innerHTML).toBe(beforeHtml)
    expect(editorEl(wrapper).textContent).toBe('第一行')
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')
    expect(wrapper.find('.voice-live-transcript').exists()).toBe(false)
  })

  it('组件卸载立即取消录音并释放麦克风', async () => {
    const wrapper = mountInput()
    await flushPromises()
    await startRecording(wrapper)

    const sid = sessionIdOfStart()
    wrapper.unmount()

    expect(captureMock.stop).toHaveBeenCalled()
    expect(api.voice.cancelSession).toHaveBeenCalledWith({ sessionId: sid })
  })

  it('切换会话立即取消录音', async () => {
    const wrapper = mountInput()
    await flushPromises()
    await startRecording(wrapper)
    const sid = sessionIdOfStart()

    await wrapper.setProps({ sessionId: 'session-other' })
    await flushPromises()

    expect(api.voice.cancelSession).toHaveBeenCalledWith({ sessionId: sid })
    expect(wrapper.find('.voice-cancel-btn').exists()).toBe(false)
  })

  it('禁用状态下点击麦克风不会开始录音', async () => {
    const wrapper = mountInput({ disabled: true })
    await flushPromises()

    await wrapper.find('.voice-btn').trigger('click')
    await flushPromises()

    expect(api.voice.getModelStatus).not.toHaveBeenCalled()
    expect(api.voice.startSession).not.toHaveBeenCalled()
  })

  it('模型未安装时先确认，安装成功后自动进入录音', async () => {
    vi.mocked(api.voice.getModelStatus).mockResolvedValue(status('missing'))
    const wrapper = mountInput()
    await flushPromises()

    await wrapper.find('.voice-btn').trigger('click')
    await flushPromises()

    expect(wrapper.find('.vmd-title').exists()).toBe(true)
    expect(api.voice.installModel).not.toHaveBeenCalled()

    await wrapper.find('.vmd-btn-primary').trigger('click')
    await flushPromises()

    expect(api.voice.installModel).toHaveBeenCalledTimes(1)
    expect(api.voice.startSession).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.voice-cancel-btn').exists()).toBe(true)
  })

  it('麦克风权限被拒时展示可操作指引并恢复草稿', async () => {
    captureMock.start.mockRejectedValue(new VoiceCaptureError('permission-denied', 'denied'))
    const wrapper = mountInput()
    await flushPromises()
    wrapper.vm.setContent('草稿')
    await flushPromises()

    await startRecording(wrapper)

    const hint = wrapper.find('.voice-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.classes()).toContain('is-error')
    expect(hint.text()).toContain('Microphone access is blocked')
    expect(editorEl(wrapper).textContent).toBe('草稿')
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')
  })

  it('挂载即成为 Alt+V 候选，卸载后立刻退出候选', async () => {
    const wrapper = mountInput()
    await flushPromises()
    expect(voiceTargetRegistry.size).toBe(1)

    editorEl(wrapper).focus()
    await flushPromises()

    await dispatchVoiceShortcut(voiceTargetRegistry)
    expect(api.voice.startSession).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.voice-cancel-btn').exists()).toBe(true)

    wrapper.unmount()
    expect(voiceTargetRegistry.size).toBe(0)
    expect(voiceTargetRegistry.select()).toBeNull()
  })
})
