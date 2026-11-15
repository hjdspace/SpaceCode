// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { EXTENSION_DIALOG_WATCHDOG_MS } from '@/shared/channels/claudeCode'
import type {
  ExtensionDialogAnswer,
  ExtensionDialogClosedEvent,
  ExtensionDialogRequest,
  PermissionMode,
} from '@/shared/channels/claudeCode'
import { matchDialogToQuestion, matchPlanActionDialog } from '@/lib/planModeDialogMatcher'
import { createImageGenAuthorization } from '../imageGenAuthorization'
import type { ImageGenAuthorizationRequest } from '../imageGenAuthorization'

const REQUEST: ImageGenAuthorizationRequest = {
  sessionId: 'session-1',
  provider: 'OpenAI',
  model: 'gpt-image-1',
  count: 1,
  prompt: 'a cover image of a quiet harbour at dawn',
}

function harness(overrides: Partial<Parameters<typeof createImageGenAuthorization>[0]> = {}) {
  const dialogs: Array<{ sessionId: string; request: ExtensionDialogRequest }> = []
  const closed: Array<{ sessionId: string; event: ExtensionDialogClosedEvent }> = []
  const traces: string[] = []
  let mode: PermissionMode | undefined = 'default'
  let minted = 0

  const authorization = createImageGenAuthorization({
    sendDialog: (sessionId, request) => { dialogs.push({ sessionId, request }) },
    sendClosed: (sessionId, event) => { closed.push({ sessionId, event }) },
    permissionMode: () => mode,
    locale: () => 'zh-CN',
    mintId: () => `host-dialog-${(minted += 1)}`,
    trace: message => { traces.push(message) },
    ...overrides,
  })

  return {
    authorization,
    dialogs,
    closed,
    traces,
    setMode: (next: PermissionMode | undefined) => { mode = next },
    /** 卡片正文 = 标题 + message，两处都算「用户看得见的字」 */
    body: (index = 0) => `${dialogs[index].request.title}\n${dialogs[index].request.message ?? ''}`,
  }
}

describe('改图授权卡', () => {
  it('正文写明这是改图与参考图张数，选项签名不变、仍不被 plan-mode 认走', async () => {
    const h = harness()

    const decision = h.authorization.authorize({ ...REQUEST, prompt: 'make it warm', referenceCount: 2 })

    const dialog = h.dialogs[0].request
    expect(dialog.title).toBe('允许这次改图吗？')
    expect(dialog.options).toEqual(['允许一次', '本会话总是允许', '拒绝'])
    const body = h.body()
    expect(body).toContain('参考图：2 张')
    expect(body).toContain('make it warm')
    expect(body).toContain('计费')
    expect(matchPlanActionDialog(dialog)).toBe(false)

    h.authorization.respond(dialog.dialogId, { kind: 'value', value: '允许一次' })
    await expect(decision).resolves.toBe('allow')
  })

  it('英文界面下同样是改图口径', () => {
    const h = harness({ locale: () => 'en-US' })

    void h.authorization.authorize({ ...REQUEST, referenceCount: 3 })

    expect(h.dialogs[0].request.title).toBe('Allow this image edit?')
    expect(h.body()).toContain('Reference images: 3')
  })

  it('文生图不带参考图行，标题仍是生图', () => {
    const h = harness()

    void h.authorization.authorize(REQUEST)

    expect(h.dialogs[0].request.title).toBe('允许这次生图吗？')
    expect(h.body()).not.toContain('参考图')
  })
})

describe('生图宿主授权闸门', () => {
  it('未授权时先问出来：select 形态、宿主自铸 id、正文交代供应商/模型/张数/提示词/计费', async () => {
    const h = harness()

    const decision = h.authorization.authorize(REQUEST)

    expect(h.dialogs).toHaveLength(1)
    expect(h.dialogs[0].sessionId).toBe('session-1')
    const dialog = h.dialogs[0].request
    expect(dialog.method).toBe('select')
    expect(dialog.dialogId).toBe('host-dialog-1')
    expect(dialog.options).toEqual(['允许一次', '本会话总是允许', '拒绝'])

    const body = h.body()
    expect(body).toContain('OpenAI')
    expect(body).toContain('gpt-image-1')
    expect(body).toContain('1')
    expect(body).toContain('quiet harbour at dawn')
    expect(body).toContain('计费')

    expect(h.authorization.respond('host-dialog-1', { kind: 'value', value: '允许一次' })).toBe(true)
    await expect(decision).resolves.toBe('allow')
    expect(h.closed).toEqual([
      { sessionId: 'session-1', event: { dialogId: 'host-dialog-1', method: 'select', reason: 'answered' } },
    ])
  })

  it('没人应答时到点拒绝并关卡，迟到的应答不再算宿主的卡', async () => {
    vi.useFakeTimers()
    try {
      const h = harness({ watchdogMs: 1_000 })

      const decision = h.authorization.authorize(REQUEST)
      await vi.advanceTimersByTimeAsync(1_000)

      await expect(decision).resolves.toBe('deny')
      expect(h.closed).toEqual([
        { sessionId: 'session-1', event: { dialogId: 'host-dialog-1', method: 'select', reason: 'watchdog' } },
      ])
      expect(h.authorization.respond('host-dialog-1', { kind: 'value', value: '允许一次' })).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('本会话总是允许只覆盖本会话：第二次不再问，别的会话照旧问', async () => {
    const h = harness()

    const first = h.authorization.authorize(REQUEST)
    h.authorization.respond('host-dialog-1', { kind: 'value', value: '本会话总是允许' })
    await expect(first).resolves.toBe('always')

    await expect(h.authorization.authorize({ ...REQUEST, prompt: 'a second cover' })).resolves.toBe('allow')
    expect(h.dialogs).toHaveLength(1)

    const other = h.authorization.authorize({ ...REQUEST, sessionId: 'session-2' })
    expect(h.dialogs).toHaveLength(2)
    expect(h.dialogs[1].sessionId).toBe('session-2')
    h.authorization.respond('host-dialog-2', { kind: 'value', value: '允许一次' })
    await expect(other).resolves.toBe('allow')
  })

  it('用户已选完全信任时免问，但留下痕迹', async () => {
    const h = harness()
    h.setMode('bypassPermissions')

    await expect(h.authorization.authorize(REQUEST)).resolves.toBe('allow')

    expect(h.dialogs).toHaveLength(0)
    expect(h.traces.join('\n')).toContain('bypassPermissions')
  })

  it('没有会话可问时直接拒绝，不发出一张无人能答的卡', async () => {
    const h = harness()
    h.setMode('bypassPermissions')

    await expect(h.authorization.authorize({ ...REQUEST, sessionId: null })).resolves.toBe('deny')
    await expect(h.authorization.authorize({ ...REQUEST, sessionId: '' })).resolves.toBe('deny')

    expect(h.dialogs).toHaveLength(0)
  })

  it('拒绝、关卡、认不出的值都判拒绝，卡片一律按已答收口', async () => {
    const h = harness()
    const answers: ExtensionDialogAnswer[] = [
      { kind: 'value', value: '拒绝' },
      { kind: 'cancel' },
      { kind: 'value', value: '也许吧' },
      { kind: 'confirmed', confirmed: true },
    ]

    for (const [index, answer] of answers.entries()) {
      const decision = h.authorization.authorize(REQUEST)
      const dialogId = h.dialogs[index].request.dialogId
      expect(h.authorization.respond(dialogId, answer)).toBe(true)
      await expect(decision).resolves.toBe('deny')
      expect(h.closed[index].event).toEqual({ dialogId, method: 'select', reason: 'answered' })
    }
  })

  it('授权卡不会被 plan-mode 的问卷配对或行动菜单认走', async () => {
    const h = harness()
    void h.authorization.authorize(REQUEST)
    const dialog = h.dialogs[0].request

    expect(matchPlanActionDialog(dialog)).toBe(false)
    expect(matchDialogToQuestion(dialog, {
      header: 'Approach',
      question: 'Which layout should the cover use?',
      options: [{ label: 'Grid', description: 'tight grid' }],
    })).toBeNull()
    // 问卷帧的选项是「1. label — description」格式化行，授权选项不能长成那样
    for (const option of dialog.options ?? []) {
      expect(option).not.toMatch(/^\d+\. /)
    }
  })

  it('英文界面下正文与选项都是英文，应答仍按选项认', async () => {
    const h = harness({ locale: () => 'en-US' })

    const decision = h.authorization.authorize(REQUEST)
    const dialog = h.dialogs[0].request
    expect(dialog.options).toEqual(['Allow once', 'Always allow for this session', 'Deny'])
    expect(h.body()).toContain('Provider: OpenAI')
    expect(h.body()).toContain('billable')

    h.authorization.respond(dialog.dialogId, { kind: 'value', value: 'Always allow for this session' })
    await expect(decision).resolves.toBe('always')
  })

  it('默认看门狗沿用既有宿主问答口径', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      let settled = false
      const decision = h.authorization.authorize(REQUEST).then(value => { settled = true; return value })

      await vi.advanceTimersByTimeAsync(EXTENSION_DIALOG_WATCHDOG_MS - 1)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await expect(decision).resolves.toBe('deny')
    } finally {
      vi.useRealTimers()
    }
  })
})