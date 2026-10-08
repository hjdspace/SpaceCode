/**
 * waitNotification — 会话等待用户处理时的桌面通知。
 *
 * 断言的是真实模块与真实 locale 文案（非手抄实现）：
 * 三类中断的文案分流、后台门控标志、以及 session+kind 维度的去重。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const notifyMocks = vi.hoisted(() => ({
  showNotification: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    showNotification: notifyMocks.showNotification,
  },
}))

import {
  classifyWaitingRequest,
  notifyWaitingForUser,
} from '@/services/waitNotification'
import type { PermissionRequest } from '@/services/permissionService'

const showNotification = notifyMocks.showNotification

function req(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    sessionId: 's-1',
    requestId: 'r-1',
    toolName: 'Bash',
    toolUseId: 't-1',
    input: {},
    ...overrides,
  }
}

function env(enabled = true, title = '重构登录页') {
  return { enabled: () => enabled, sessionTitle: () => title }
}

describe('waitNotification', () => {
  beforeEach(() => {
    showNotification.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('classifies the three interrupt kinds by tool name', () => {
    expect(classifyWaitingRequest('AskUserQuestion')).toBe('question')
    expect(classifyWaitingRequest('ExitPlanMode')).toBe('plan')
    expect(classifyWaitingRequest('Bash')).toBe('permission')
  })

  it('notifies with the first question when the AI asks the user', () => {
    notifyWaitingForUser('q-session', req({
      toolName: 'AskUserQuestion',
      input: { questions: [{ question: '要采用哪种方案？' }, { question: '第二问' }] },
    }), env())

    expect(showNotification).toHaveBeenCalledTimes(1)
    const options = showNotification.mock.calls[0][0]
    expect(options.title).toContain('重构登录页')
    expect(options.message).toContain('要采用哪种方案？')
    expect(options.message).not.toContain('第二问')
  })

  it('falls back to a generic question body when the payload has no questions', () => {
    notifyWaitingForUser('empty-q-session', req({ toolName: 'AskUserQuestion', input: {} }), env())

    expect(showNotification.mock.calls[0][0].message).toBe('AI 在等你回答，点击查看')
  })

  it('uses the plan body for ExitPlanMode', () => {
    notifyWaitingForUser('plan-session', req({ toolName: 'ExitPlanMode', input: { plan: 'x' } }), env())

    expect(showNotification.mock.calls[0][0].message).toContain('计划已就绪')
  })

  it('labels a permission request with the engine description when present', () => {
    notifyWaitingForUser('p-session', req({ description: '  允许   执行 rm -rf /tmp  ' }), env())

    expect(showNotification.mock.calls[0][0].message).toBe('需要你授权：允许 执行 rm -rf /tmp')
  })

  it('labels a permission request with the localized tool name otherwise', () => {
    notifyWaitingForUser('p2-session', req({ toolName: 'Bash' }), env())

    expect(showNotification.mock.calls[0][0].message).toContain('执行命令')
  })

  it('truncates a long description', () => {
    notifyWaitingForUser('p3-session', req({ description: 'A'.repeat(200) }), env())

    const message = showNotification.mock.calls[0][0].message
    expect(message).toContain('A'.repeat(59))
    expect(message).not.toContain('A'.repeat(60))
    expect(message.endsWith('…')).toBe(true)
  })

  it('suppresses the notification when the setting is off', () => {
    notifyWaitingForUser('off-session', req(), env(false))

    expect(showNotification).not.toHaveBeenCalled()
  })

  it('de-duplicates repeated requests of the same kind within the window', () => {
    const sid = 'dedupe-session'
    notifyWaitingForUser(sid, req({ toolUseId: 'a' }), env())
    notifyWaitingForUser(sid, req({ toolUseId: 'b' }), env())
    expect(showNotification).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(6_000)
    notifyWaitingForUser(sid, req({ toolUseId: 'c' }), env())
    expect(showNotification).toHaveBeenCalledTimes(2)
  })

  it('keeps question and permission notifications independent for the same session', () => {
    const sid = 'mixed-session'
    notifyWaitingForUser(sid, req({ toolName: 'AskUserQuestion', input: { questions: [{ question: 'Q' }] } }), env())
    notifyWaitingForUser(sid, req({ toolName: 'Bash' }), env())

    expect(showNotification).toHaveBeenCalledTimes(2)
  })

  it('does not deduplicate across sessions', () => {
    notifyWaitingForUser('session-a', req(), env())
    notifyWaitingForUser('session-b', req(), env())

    expect(showNotification).toHaveBeenCalledTimes(2)
  })

  it('reports the decision so the caller can log it', () => {
    expect(notifyWaitingForUser('status-session', req(), env())).toBe('sent')
    expect(notifyWaitingForUser('status-session', req({ toolUseId: 'other' }), env())).toBe('deduped')
    expect(notifyWaitingForUser('off-status-session', req(), env(false))).toBe('disabled')
    expect(showNotification).toHaveBeenCalledTimes(1)
  })
})
