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
  VoiceSessionStatePayload,
  VoiceStopSessionResult,
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
  model: {
    name: 'sherpa-onnx X-ASR 480ms streaming zipformer',
    spec: 'zh-en · streaming · punctuation · int8',
    upstreamUrl: 'https://example.com/upstream',
    license: 'Apache-2.0',
  },
  sources: [{ kind: 'github', url: 'https://example.com/model.tar.bz2' }],
}

let partialHandler: ((payload: VoicePartialPayload) => void) | null = null
let sessionStateHandler: ((payload: VoiceSessionStatePayload) => void) | null = null
let captureHandlers: VoiceCaptureHandlers | null = null

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
  sessionStateHandler = null
  captureHandlers = null
  captureMock.start.mockReset().mockImplementation(async (handlers) => {
    captureHandlers = handlers
    return { sampleRate: 16_000 }
  })
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
  vi.spyOn(api.voice, 'onSessionState').mockImplementation((handler) => {
    sessionStateHandler = handler
    return () => {}
  })
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

  it('切换会话立即取消录音、丢弃实时转写并释放会话', async () => {
    const wrapper = mountInput()
    await flushPromises()
    wrapper.vm.setContent('草稿')
    await flushPromises()
    await startRecording(wrapper)
    emitPartial('不该留下')
    await nextTick()
    const sid = sessionIdOfStart()

    await wrapper.setProps({ sessionId: 'session-other' })
    await flushPromises()

    expect(api.voice.cancelSession).toHaveBeenCalledWith({ sessionId: sid })
    expect(wrapper.find('.voice-cancel-btn').exists()).toBe(false)
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')
    expect(editorEl(wrapper).textContent).not.toContain('不该留下')
    expect(wrapper.find('.voice-live-transcript').exists()).toBe(false)
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

  it('麦克风权限被拒后再次点击可正常录音，无需重启', async () => {
    captureMock.start.mockRejectedValueOnce(new VoiceCaptureError('permission-denied', 'denied'))
    const wrapper = mountInput()
    await flushPromises()
    await startRecording(wrapper)

    expect(wrapper.find('.voice-hint').text()).toContain('Microphone access is blocked')

    await startRecording(wrapper)

    expect(api.voice.startSession).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.voice-cancel-btn').exists()).toBe(true)
    // 重试成功后旧的失败提示不应继续挂着。
    expect(wrapper.find('.voice-hint').exists()).toBe(false)
  })

  it('录音中麦克风失效：展示设备错误、恢复草稿并允许再次录音', async () => {
    const wrapper = mountInput()
    await flushPromises()
    wrapper.vm.setContent('草稿')
    await flushPromises()
    await startRecording(wrapper)

    captureHandlers?.onError(new VoiceCaptureError('device-unavailable', 'unplugged'))
    await flushPromises()

    const hint = wrapper.find('.voice-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('No microphone is available')
    expect(editorEl(wrapper).textContent).toBe('草稿')
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')
    expect(captureMock.stop).toHaveBeenCalled()
    expect(wrapper.find('.voice-live-transcript').exists()).toBe(false)

    await startRecording(wrapper)
    expect(api.voice.startSession).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.voice-cancel-btn').exists()).toBe(true)
  })

  it('推理 worker 失败时提示重试、释放麦克风且可再次录音', async () => {
    const wrapper = mountInput()
    await flushPromises()
    await startRecording(wrapper)
    const sid = sessionIdOfStart()

    sessionStateHandler?.({
      sessionId: sid,
      state: 'failed',
      errorCode: 'engine-failed',
      error: 'worker exited',
    })
    await flushPromises()

    const hint = wrapper.find('.voice-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('worker exited')
    expect(captureMock.stop).toHaveBeenCalled()
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')

    await startRecording(wrapper)
    expect(api.voice.startSession).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.voice-cancel-btn').exists()).toBe(true)
  })

  it('模型损坏时拒绝开始并从同一按钮给出重新安装入口', async () => {
    vi.mocked(api.voice.getModelStatus).mockResolvedValue(status('corrupted'))
    const wrapper = mountInput()
    await flushPromises()

    await wrapper.find('.voice-btn').trigger('click')
    await flushPromises()

    expect(api.voice.startSession).not.toHaveBeenCalled()
    expect(wrapper.find('.vmd-title').exists()).toBe(true)
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')
  })

  it('首次安装下载失败时展示原因，并可从同一入口重试', async () => {
    vi.mocked(api.voice.getModelStatus).mockResolvedValue(status('missing'))
    vi.mocked(api.voice.installModel).mockResolvedValueOnce({
      success: false,
      errorCode: 'network',
      error: 'All download sources failed: ECONNRESET',
      status: status('missing'),
    })
    const wrapper = mountInput()
    await flushPromises()

    await wrapper.find('.voice-btn').trigger('click')
    await flushPromises()
    await wrapper.find('.vmd-btn-primary').trigger('click')
    await flushPromises()

    const hint = wrapper.find('.voice-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('ECONNRESET')
    expect(api.voice.startSession).not.toHaveBeenCalled()
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')

    // 同一个麦克风按钮重新打开确认框，确认后重试安装。
    await wrapper.find('.voice-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.vmd-title').exists()).toBe(true)

    await wrapper.find('.vmd-btn-primary').trigger('click')
    await flushPromises()
    expect(api.voice.installModel).toHaveBeenCalledTimes(2)
    expect(api.voice.startSession).toHaveBeenCalledTimes(1)
  })

  it('读取安装信息失败时给出可见错误提示，不再静默', async () => {
    vi.mocked(api.voice.getModelStatus).mockResolvedValue(status('missing'))
    vi.mocked(api.voice.getInstallInfo).mockRejectedValue(
      new Error("No handler registered for 'voice:getInstallInfo'"),
    )
    const wrapper = mountInput()
    await flushPromises()

    await wrapper.find('.voice-btn').trigger('click')
    await flushPromises()

    const hint = wrapper.find('.voice-hint')
    expect(hint.exists()).toBe(true)
    expect(hint.classes()).toContain('is-error')
    expect(hint.text()).toContain('No handler registered')
    expect(wrapper.find('.vmd-title').exists()).toBe(false)
    expect(api.voice.startSession).not.toHaveBeenCalled()
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')
  })

  it('收口中重复点击停止只提交一次终稿', async () => {
    const wrapper = mountInput()
    await flushPromises()
    wrapper.vm.setContent('草稿')
    await flushPromises()
    await startRecording(wrapper)

    let resolveStop!: (result: VoiceStopSessionResult) => void
    vi.mocked(api.voice.stopSession).mockImplementation(
      () =>
        new Promise<VoiceStopSessionResult>((resolve) => {
          resolveStop = resolve
        }),
    )

    const button = wrapper.find('.voice-btn')
    await button.trigger('click')
    await button.trigger('click')
    await button.trigger('click')
    await flushPromises()

    expect(api.voice.stopSession).toHaveBeenCalledTimes(1)

    resolveStop({ success: true, text: '终稿' })
    await flushPromises()

    expect(editorEl(wrapper).textContent).toBe('草稿\n终稿')
    expect(editorEl(wrapper).getAttribute('contenteditable')).toBe('true')
    expect(captureMock.stop).toHaveBeenCalledTimes(1)
  })

  it('录音中关闭输入框（定时任务弹窗卸载）立即取消会话并释放麦克风', async () => {
    const wrapper = mountInput()
    await flushPromises()
    wrapper.vm.setContent('弹窗草稿')
    await flushPromises()
    await startRecording(wrapper)
    const sid = sessionIdOfStart()

    wrapper.unmount()
    await flushPromises()

    // 快照恢复发生在 cancel 里、DOM 拆除之前，卸载后只剩会话与设备侧可见。
    expect(api.voice.cancelSession).toHaveBeenCalledWith({ sessionId: sid })
    expect(captureMock.stop).toHaveBeenCalled()
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
