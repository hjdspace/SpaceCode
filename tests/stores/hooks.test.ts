/**
 * Hooks store tests — localStorage persistence, config round-trip,
 * CRUD + toggle, settings file load/save with legacy double-wrap migration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { HookFlatItem } from '@/types/hooks'

const apiMocks = vi.hoisted(() => ({
  loadHooksSettings: vi.fn(),
  saveHooksSettings: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))

import { useHooksStore } from '@/stores/hooks'

const HOOKS_STORAGE_KEY = 'hooks_config'

function makeHook(overrides: Partial<Omit<HookFlatItem, 'id'>> = {}): Omit<HookFlatItem, 'id'> {
  return {
    name: 'test hook',
    event: 'PreToolUse',
    matcher: 'Bash',
    type: 'command',
    command: 'echo hi',
    timeout: 30,
    scope: 'project',
    disabled: false,
    ...overrides,
  }
}

describe('hooks store — initial state & persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('starts empty with project scope when storage has no saved config', () => {
    const store = useHooksStore()
    expect(store.hooks).toEqual([])
    expect(store.activeScope).toBe('project')
    expect(store.loading).toBe(false)
  })

  it('restores hooks saved in localStorage on store creation', () => {
    const saved = [{ id: 'h1', ...makeHook({ command: 'echo saved' }) }]
    localStorage.setItem(HOOKS_STORAGE_KEY, JSON.stringify(saved))

    const store = useHooksStore()

    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0].command).toBe('echo saved')
  })

  it('falls back to the default when localStorage contains corrupt JSON', () => {
    localStorage.setItem(HOOKS_STORAGE_KEY, '{ not valid json')

    const store = useHooksStore()

    expect(store.hooks).toEqual([])
  })
})

describe('hooks store — hooksByEvent / counts / lookup', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('groups hooks by event and reports enabled/total counts', () => {
    const store = useHooksStore()
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Bash' }))
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Read' }))
    store.addHook(makeHook({ event: 'Stop', disabled: true }))

    expect(store.totalCount).toBe(3)
    expect(store.enabledCount).toBe(2)
    expect(store.hooksByEvent.get('PreToolUse')).toHaveLength(2)
    expect(store.hooksByEvent.get('Stop')).toHaveLength(1)
    expect(store.getHooksForEvent('PostToolUse')).toEqual([])
    expect(store.getHooksForEvent('PreToolUse')).toHaveLength(2)
  })
})

describe('hooks store — CRUD', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('addHook generates an id and persists to localStorage', () => {
    const store = useHooksStore()
    store.addHook(makeHook({ command: 'echo a' }))

    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0].id).toHaveLength(36)

    const persisted = JSON.parse(localStorage.getItem(HOOKS_STORAGE_KEY)!)
    expect(persisted).toHaveLength(1)
    expect(persisted[0].command).toBe('echo a')
  })

  it('updateHook merges partial updates and persists', () => {
    const store = useHooksStore()
    store.addHook(makeHook({ command: 'echo a' }))
    const id = store.hooks[0].id

    store.updateHook(id, { command: 'echo b', disabled: true })

    expect(store.hooks[0].command).toBe('echo b')
    expect(store.hooks[0].disabled).toBe(true)
    const persisted = JSON.parse(localStorage.getItem(HOOKS_STORAGE_KEY)!)
    expect(persisted[0].command).toBe('echo b')
  })

  it('updateHook leaves unknown ids untouched', () => {
    const store = useHooksStore()
    store.addHook(makeHook())
    store.updateHook('nope', { command: 'changed' })
    expect(store.hooks[0].command).toBe('echo hi')
  })

  it('removeHook deletes and persists', () => {
    const store = useHooksStore()
    store.addHook(makeHook())
    store.addHook(makeHook({ event: 'Stop', matcher: '*' }))
    const targetId = store.hooks[0].id

    store.removeHook(targetId)

    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0].id).not.toBe(targetId)
    expect(JSON.parse(localStorage.getItem(HOOKS_STORAGE_KEY)!)).toHaveLength(1)
  })

  it('toggleHook flips the disabled flag', () => {
    const store = useHooksStore()
    store.addHook(makeHook())
    const id = store.hooks[0].id

    store.toggleHook(id)
    expect(store.hooks[0].disabled).toBe(true)

    store.toggleHook(id)
    expect(store.hooks[0].disabled).toBe(false)
  })

  it('toggleHook is a no-op for unknown ids', () => {
    const store = useHooksStore()
    store.addHook(makeHook())
    store.toggleHook('missing')
    expect(store.hooks[0].disabled).toBe(false)
  })
})

describe('hooks store — toRawConfig grouping', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('groups by event + matcher, skips disabled, drops default timeout', () => {
    const store = useHooksStore()
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Bash', command: 'echo a', timeout: 30 }))
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Bash', command: 'echo b', timeout: 15 }))
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Read', type: 'prompt', command: 'prompt-text' }))
    store.addHook(makeHook({ event: 'Stop', matcher: '*', command: 'exit', timeout: 45 }))
    store.addHook(makeHook({ event: 'Stop', matcher: '*', command: 'skipped', disabled: true }))

    const config = store.toRawConfig()

    expect(config).toEqual({
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }, { type: 'command', command: 'echo b', timeout: 15 }] },
        { matcher: 'Read', hooks: [{ type: 'prompt', prompt: 'prompt-text' }] },
      ],
      Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'exit', timeout: 45 }] }],
    })
  })
})

describe('hooks store — fromRawConfig flattening', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('flattens matchers with defaults for timeout/disabled/name', () => {
    const store = useHooksStore()
    const items = store.fromRawConfig(
      {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a', timeout: 7 }] },
          { matcher: 'Read', hooks: [{ type: 'command', command: 'echo b', disabled: true }] },
        ],
        Stop: [{ matcher: '*', hooks: [{ type: 'prompt', prompt: 'bye' }] }],
      },
      'local',
    )

    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      event: 'PreToolUse',
      matcher: 'Bash',
      type: 'command',
      command: 'echo a',
      timeout: 7,
      scope: 'local',
      disabled: false,
      name: '',
    })
    expect(items[0].id).toHaveLength(36)
    expect(items[1].timeout).toBe(30)
    expect(items[1].disabled).toBe(true)
    // prompt-type hooks expose their prompt text through the command field
    expect(items[2].command).toBe('bye')
  })

  it('round-trips through toRawConfig', () => {
    const store = useHooksStore()
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Bash', command: 'echo a', timeout: 5 }))
    store.addHook(makeHook({ event: 'PostToolUse', matcher: '*', type: 'prompt', command: 'note' }))

    const config = store.toRawConfig()
    const flattened = store.fromRawConfig(config, 'project')

    expect(flattened).toHaveLength(2)
    expect(flattened.map((h) => ({ ...h, id: '' }))).toEqual([
      { id: '', name: '', event: 'PreToolUse', matcher: 'Bash', type: 'command', command: 'echo a', timeout: 5, scope: 'project', disabled: false },
      { id: '', name: '', event: 'PostToolUse', matcher: '*', type: 'prompt', command: 'note', timeout: 30, scope: 'project', disabled: false },
    ])
  })

  it('returns an empty list for empty input', () => {
    const store = useHooksStore()
    expect(store.fromRawConfig({}, 'project')).toEqual([])
  })
})

describe('hooks store — loadFromSettingsFile', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('populates hooks from a plain settings config and persists to localStorage', async () => {
    apiMocks.loadHooksSettings.mockResolvedValue({
      success: true,
      data: JSON.stringify({ Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'exit' }] }] }),
    })

    const store = useHooksStore()
    await store.loadFromSettingsFile()

    expect(store.loading).toBe(false)
    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0].event).toBe('Stop')
    expect(store.hooks[0].matcher).toBe('*')
    expect(store.hooks[0].command).toBe('exit')
    expect(JSON.parse(localStorage.getItem(HOOKS_STORAGE_KEY)!)).toHaveLength(1)
    expect(apiMocks.saveHooksSettings).not.toHaveBeenCalled()
  })

  it('unwraps a legacy double-wrapped config and migrates it back to disk', async () => {
    apiMocks.loadHooksSettings.mockResolvedValue({
      success: true,
      data: JSON.stringify({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'exit' }] }] } }),
    })

    const store = useHooksStore()
    await store.loadFromSettingsFile()

    expect(store.hooks).toHaveLength(1)
    expect(store.hooks[0].event).toBe('Stop')
    expect(apiMocks.saveHooksSettings).toHaveBeenCalledTimes(1)
    expect(apiMocks.saveHooksSettings).toHaveBeenCalledWith(expect.stringContaining('"Stop"'), 'project')
  })

  it('does nothing when load reports success: false', async () => {
    apiMocks.loadHooksSettings.mockResolvedValue({ success: false, data: null, error: 'boom' })

    const store = useHooksStore()
    await store.loadFromSettingsFile()

    expect(store.hooks).toEqual([])
    expect(apiMocks.saveHooksSettings).not.toHaveBeenCalled()
  })

  it('keeps hooks untouched and finishes loading when the JSON is invalid', async () => {
    apiMocks.loadHooksSettings.mockResolvedValue({ success: true, data: '{ not json' })

    const store = useHooksStore()
    await store.loadFromSettingsFile()

    expect(store.hooks).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('swallows api failures', async () => {
    apiMocks.loadHooksSettings.mockRejectedValue(new Error('ipc down'))

    const store = useHooksStore()
    await store.loadFromSettingsFile()

    expect(store.hooks).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('uses the current active scope when loading', async () => {
    apiMocks.loadHooksSettings.mockResolvedValue({
      success: true,
      data: JSON.stringify({ Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'exit' }] }] }),
    })

    const store = useHooksStore()
    store.activeScope = 'user'
    await store.loadFromSettingsFile()

    expect(apiMocks.loadHooksSettings).toHaveBeenCalledWith('user')
    expect(store.hooks[0].scope).toBe('user')
  })
})

describe('hooks store — saveToSettingsFile', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('writes the raw config JSON for the active scope', async () => {
    const store = useHooksStore()
    store.addHook(makeHook({ event: 'PreToolUse', matcher: 'Bash', command: 'echo a' }))

    await store.saveToSettingsFile()

    expect(apiMocks.saveHooksSettings).toHaveBeenCalledTimes(1)
    const [json, scope] = apiMocks.saveHooksSettings.mock.calls[0]
    expect(scope).toBe('project')
    expect(JSON.parse(json)).toEqual({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo a' }] }],
    })
  })

  it('swallows persistence failures', async () => {
    apiMocks.saveHooksSettings.mockRejectedValue(new Error('disk full'))

    const store = useHooksStore()
    store.addHook(makeHook())

    await expect(store.saveToSettingsFile()).resolves.toBeUndefined()
  })
})