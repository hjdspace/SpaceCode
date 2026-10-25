/**
 * 跨输入框目标选择：注册表只认"已挂载 + 可编辑 + 最近聚焦"，
 * 快捷键派发在录音中只停止那一个目标，否则只启动唯一被选中的目标。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  VoiceTargetRegistry,
  dispatchVoiceShortcut,
  type VoiceInputTarget,
} from '../voiceTargetRegistry'

interface FakeTargetOptions {
  editable?: boolean
  recording?: boolean
}

function fakeTarget(id: string, options: FakeTargetOptions = {}) {
  const target: VoiceInputTarget = {
    id,
    isEditable: vi.fn(() => options.editable ?? true),
    isRecording: vi.fn(() => options.recording ?? false),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  }
  return target
}

function setup() {
  let clock = 100
  const registry = new VoiceTargetRegistry({ now: () => clock })
  return {
    registry,
    advance: (ms = 1) => {
      clock += ms
    },
  }
}

describe('VoiceTargetRegistry', () => {
  it('selects the most recently focused mounted input', () => {
    const { registry, advance } = setup()
    const main = fakeTarget('main')
    const mini = fakeTarget('mini')
    registry.register(main)
    registry.register(mini)

    registry.focus('main')
    advance()
    registry.focus('mini')

    expect(registry.select()).toBe(mini)
    expect(registry.focusedId()).toBe('mini')

    advance()
    registry.focus('main')

    expect(registry.select()).toBe(main)
  })

  it('records focus state and the latest focus timestamp', () => {
    const { registry, advance } = setup()
    registry.register(fakeTarget('main'))
    registry.focus('main')
    const focusedAt = registry.lastFocusedAt('main')
    advance(50)
    registry.blur('main')

    expect(registry.focusedId()).toBeNull()
    expect(registry.lastFocusedAt('main')).toBe(focusedAt)
  })

  it('drops unmounted inputs so selection never lands on them', () => {
    const { registry, advance } = setup()
    const main = fakeTarget('main')
    const modal = fakeTarget('modal')
    const unregisterMain = registry.register(main)
    registry.register(modal)

    registry.focus('main')
    advance()
    registry.focus('modal')
    expect(registry.select()).toBe(modal)

    unregisterMain()
    expect(registry.select()).toBe(modal)

    registry.unregister('modal')
    expect(registry.select()).toBeNull()
    expect(registry.size).toBe(0)
  })

  it('skips inputs that are mounted but not editable', () => {
    const { registry, advance } = setup()
    const editable = fakeTarget('editable')
    const locked = fakeTarget('locked', { editable: false })
    registry.register(editable)
    registry.register(locked)

    registry.focus('editable')
    advance()
    registry.focus('locked')

    expect(registry.select()).toBe(editable)
  })
})

describe('dispatchVoiceShortcut', () => {
  it('starts exactly the most recently focused target', async () => {
    const { registry, advance } = setup()
    const main = fakeTarget('main')
    const mini = fakeTarget('mini')
    registry.register(main)
    registry.register(mini)
    registry.focus('main')
    advance()
    registry.focus('mini')

    await expect(dispatchVoiceShortcut(registry)).resolves.toEqual({ kind: 'started', id: 'mini' })
    expect(mini.start).toHaveBeenCalledTimes(1)
    expect(main.start).not.toHaveBeenCalled()
  })

  it('stops the recording target and does not start another input', async () => {
    const { registry } = setup()
    const main = fakeTarget('main')
    const mini = fakeTarget('mini', { recording: true })
    registry.register(main)
    registry.register(mini)
    registry.focus('main')

    await expect(dispatchVoiceShortcut(registry)).resolves.toEqual({ kind: 'stopped', id: 'mini' })
    expect(mini.stop).toHaveBeenCalledTimes(1)
    expect(mini.start).not.toHaveBeenCalled()
    expect(main.start).not.toHaveBeenCalled()
  })

  it('reports no-target without touching any input when the registry is empty', async () => {
    const { registry } = setup()

    await expect(dispatchVoiceShortcut(registry)).resolves.toEqual({ kind: 'no-target' })
  })

  it('reports no-target when every mounted input is non-editable', async () => {
    const { registry } = setup()
    const locked = fakeTarget('locked', { editable: false })
    registry.register(locked)
    registry.focus('locked')

    await expect(dispatchVoiceShortcut(registry)).resolves.toEqual({ kind: 'no-target' })
    expect(locked.start).not.toHaveBeenCalled()
  })
})
