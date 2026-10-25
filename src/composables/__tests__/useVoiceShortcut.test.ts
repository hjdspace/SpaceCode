/**
 * useVoiceShortcut —— 主进程 Alt+V 事件到渲染层唯一目标的派发。
 *
 * 事件订阅、目标注册表与"无目标"提示都从接缝注入：断言只看
 * 开始/停止被调了几次、落在哪个输入框，以及提示是否只在该发的时候发。
 */
import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { VoiceTargetRegistry, type VoiceInputTarget } from '@/lib/voice/voiceTargetRegistry'
import type { VoiceShortcutPayload } from '@/shared/channels/voice'
import { useVoiceShortcut } from '../useVoiceShortcut'

vi.mock('@/services/electronAPI', () => ({ api: { voice: {} } }))
vi.mock('@/services/errorHandler', () => ({ errorHandler: { pushToast: vi.fn() } }))

function fakeTarget(id: string, options: { recording?: boolean } = {}): VoiceInputTarget {
  return {
    id,
    isEditable: () => true,
    isRecording: () => options.recording ?? false,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  }
}

function setup(registry = new VoiceTargetRegistry({ now: (() => { let t = 0; return () => ++t })() })) {
  const handlers: Array<(payload: VoiceShortcutPayload) => void> = []
  const unsubscribe = vi.fn()
  const notifyNoTarget = vi.fn()
  const scope = effectScope()
  scope.run(() =>
    useVoiceShortcut({
      registry,
      subscribe: (handler) => {
        handlers.push(handler)
        return unsubscribe
      },
      notifyNoTarget,
    }),
  )
  return {
    registry,
    notifyNoTarget,
    unsubscribe,
    press: () => handlers[0]?.({ source: 'shortcut' }),
    scope,
  }
}

describe('useVoiceShortcut', () => {
  it('starts only the most recently focused input on Alt+V', async () => {
    const { registry, press, notifyNoTarget } = setup()
    const main = fakeTarget('main')
    const mini = fakeTarget('mini')
    registry.register(main)
    registry.register(mini)
    registry.focus('main')
    registry.focus('mini')

    press()
    await vi.waitFor(() => expect(mini.start).toHaveBeenCalledTimes(1))

    expect(main.start).not.toHaveBeenCalled()
    expect(notifyNoTarget).not.toHaveBeenCalled()
  })

  it('stops the active recording instead of starting another input', async () => {
    const { registry, press, notifyNoTarget } = setup()
    const main = fakeTarget('main')
    const mini = fakeTarget('mini', { recording: true })
    registry.register(main)
    registry.register(mini)
    registry.focus('main')

    press()
    await vi.waitFor(() => expect(mini.stop).toHaveBeenCalledTimes(1))

    expect(mini.start).not.toHaveBeenCalled()
    expect(main.start).not.toHaveBeenCalled()
    expect(notifyNoTarget).not.toHaveBeenCalled()
  })

  it('shows the no-target hint once and starts nothing when no input is available', async () => {
    const { press, notifyNoTarget } = setup()

    press()
    await vi.waitFor(() => expect(notifyNoTarget).toHaveBeenCalledTimes(1))
  })

  it('unsubscribes from the shortcut event when its scope is disposed', () => {
    const { scope, unsubscribe } = setup()

    scope.stop()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
