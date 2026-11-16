// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { RemindersBridgeError, createRemindersBridge, type RemindersExecRequest } from '../remindersBridge'
import { FETCH_SCRIPT, LISTS_SCRIPT, PUSH_SCRIPT, parseScriptResult } from '../remindersScript'

function execReturning(stdout: string, extra: { stderr?: string; code?: number; timedOut?: boolean } = {}) {
  return vi.fn(async (_request: RemindersExecRequest) => ({
    stdout,
    stderr: extra.stderr ?? '',
    code: extra.code ?? 0,
    timedOut: extra.timedOut,
  }))
}

describe('platform gate', () => {
  it('never spawns osascript off macOS', async () => {
    const exec = execReturning('{}')
    const bridge = createRemindersBridge({ exec, platform: 'win32' })
    expect(bridge.supported).toBe(false)
    await expect(bridge.listLists()).rejects.toMatchObject({ code: 'unsupported-platform' })
    await expect(bridge.fetch('L')).rejects.toBeInstanceOf(RemindersBridgeError)
    await expect(bridge.push({ listId: 'L', creates: [], updates: [], deletes: [] })).rejects.toMatchObject({ code: 'unsupported-platform' })
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('script transport', () => {
  it('passes user data as a payload argument, never inside the script source', async () => {
    const exec = execReturning(JSON.stringify({ ok: true, reminders: [] }))
    const bridge = createRemindersBridge({ exec, platform: 'darwin' })
    await bridge.fetch('L1')
    const request = exec.mock.calls[0][0]
    expect(request.script).toBe(FETCH_SCRIPT)
    expect(request.payload).toBe('{"listId":"L1"}')
    expect(request.script).not.toContain('L1')

    const evilTitle = `'); Application('System Events').deleteEverything(); ('`
    await bridge.push({
      listId: 'L1',
      creates: [{ key: 't1', title: evilTitle, notes: '', completed: false, dueAt: null, dueDateOnly: false, priority: 5 }],
      updates: [],
      deletes: [],
    })
    const pushRequest = exec.mock.calls[1][0]
    expect(pushRequest.script).toBe(PUSH_SCRIPT)
    expect(pushRequest.script).not.toContain('deleteEverything')
    expect(JSON.parse(pushRequest.payload ?? '{}').creates[0].title).toBe(evilTitle)
  })

  it('uses the lists script without a payload', async () => {
    const exec = execReturning(JSON.stringify({ ok: true, lists: [{ id: 'L1', title: '提醒事项' }] }))
    const bridge = createRemindersBridge({ exec, platform: 'darwin' })
    expect(await bridge.listLists()).toEqual([{ id: 'L1', title: '提醒事项' }])
    expect(exec.mock.calls[0][0]).toMatchObject({ script: LISTS_SCRIPT, payload: null })
  })

  it('maps the automation-denied error number to permission-denied', async () => {
    const exec = execReturning(JSON.stringify({ ok: false, error: { message: 'Not authorized to send Apple events', number: -1743 } }))
    const bridge = createRemindersBridge({ exec, platform: 'darwin' })
    await expect(bridge.listLists()).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('detects a permission complaint that only shows up on stderr', async () => {
    const exec = execReturning('', { stderr: 'execution error: Not authorized to send Apple events to Reminders. (-1743)', code: 1 })
    const bridge = createRemindersBridge({ exec, platform: 'darwin' })
    await expect(bridge.listLists()).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('reports script failures, timeouts and spawn errors distinctly', async () => {
    const failing = createRemindersBridge({ exec: execReturning(JSON.stringify({ ok: false, error: { message: 'list-not-found:L9' } })), platform: 'darwin' })
    await expect(failing.fetch('L9')).rejects.toMatchObject({ code: 'script-failed' })

    const slow = createRemindersBridge({ exec: execReturning('', { timedOut: true }), platform: 'darwin', timeoutMs: 5 })
    await expect(slow.fetch('L1')).rejects.toMatchObject({ code: 'timeout' })

    const broken = createRemindersBridge({
      exec: async () => { throw new Error('spawn osascript ENOENT') },
      platform: 'darwin',
    })
    await expect(broken.fetch('L1')).rejects.toMatchObject({ code: 'script-failed' })
  })

  it('returns push receipts including per-item errors', async () => {
    const receipt = { ok: true, created: [{ key: 't1', id: 'n1' }], updated: ['n2'], deleted: [], errors: [{ key: 'n3', message: 'read-only' }] }
    const bridge = createRemindersBridge({ exec: execReturning(JSON.stringify(receipt)), platform: 'darwin' })
    expect(await bridge.push({ listId: 'L1', creates: [], updates: [], deletes: [] })).toEqual({
      created: [{ key: 't1', id: 'n1' }], updated: ['n2'], deleted: [], errors: [{ key: 'n3', message: 'read-only' }],
    })
  })
})

describe('parseScriptResult', () => {
  it('rejects empty, non-JSON and unexpected shapes', () => {
    expect(parseScriptResult('   ')).toEqual({ ok: false, error: { message: 'empty-script-output' } })
    expect(parseScriptResult('not json').ok).toBe(false)
    expect(parseScriptResult('{"hello":1}')).toEqual({ ok: false, error: { message: 'unexpected-script-output' } })
    expect(parseScriptResult('{"ok":false}').ok).toBe(false)
  })

  it('accepts a well-formed success payload', () => {
    expect(parseScriptResult<{ lists: [] }>('{"ok":true,"lists":[]}')).toEqual({ ok: true, lists: [] })
  })
})