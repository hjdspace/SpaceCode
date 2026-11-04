// @vitest-environment node
/**
 * 稳定错误码与 i18n 键骨架（T03 #73）。
 *
 * 领域抛错只携带 code 与安全参数，渲染层按 `superAgent.errors.<code>` 取文案；
 * 未知 code 必须回退到通用文案，不能把英文异常直接显示给用户。
 */
import { describe, expect, it } from 'vitest'
import enUS from '@/i18n/locales/en-US/superAgent'
import zhCN from '@/i18n/locales/zh-CN/superAgent'
import {
  SUPER_AGENT_ERROR_CODES,
  superAgentError,
  superAgentErrorCategory,
  superAgentErrorI18nKey,
  serializeSuperAgentError,
  type SuperAgentErrorCategory,
} from '../errors'

describe('superAgentError', () => {
  it('carries a stable code, its category and a safe-parameter i18n key', () => {
    const error = superAgentError('questionWithResult', { ticketId: 'ticket-1' })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SuperAgentDomainError')
    expect(error.code).toBe('questionWithResult')
    expect(error.category).toBe('refused')
    expect(error.params).toEqual({ ticketId: 'ticket-1' })
    expect(error.i18nKey).toBe('superAgent.errors.questionWithResult')
    expect(error.message).toContain('questionWithResult')
    expect(error.message).not.toContain('ticket-1')
  })

  it('classifies every built-in code into one of the four categories', () => {
    const categories: SuperAgentErrorCategory[] = ['missing', 'refused', 'conflict', 'unavailable']
    const seen = new Set(SUPER_AGENT_ERROR_CODES.map((code) => superAgentErrorCategory(code)))

    expect(seen.size).toBe(categories.length)
    for (const code of SUPER_AGENT_ERROR_CODES) {
      expect(categories).toContain(superAgentErrorCategory(code))
    }
  })

  it('maps representative codes to the expected category', () => {
    expect(superAgentErrorCategory('ticketNotFound')).toBe('missing')
    expect(superAgentErrorCategory('assignmentNotFound')).toBe('missing')
    expect(superAgentErrorCategory('ticketEnded')).toBe('refused')
    expect(superAgentErrorCategory('assignmentEnded')).toBe('refused')
    expect(superAgentErrorCategory('notAnswerable')).toBe('refused')
    expect(superAgentErrorCategory('conflict')).toBe('conflict')
    expect(superAgentErrorCategory('slotUnavailable')).toBe('unavailable')
  })

  it('includes the four required codes for report and ticket validation', () => {
    expect(SUPER_AGENT_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'questionWithResult',
        'askerWithoutQuestion',
        'notAsker',
        'notAnswerable',
        'ticketEnded',
        'assignmentEnded',
      ]),
    )
  })

  it('falls back to the generic i18n key for an unknown code', () => {
    expect(superAgentErrorI18nKey('questionWithResult')).toBe('superAgent.errors.questionWithResult')
    expect(superAgentErrorI18nKey('someFutureCode')).toBe('superAgent.errors.unknown')
  })
})

describe('error locale skeleton', () => {
  it('defines every built-in code in zh-CN and en-US', () => {
    for (const code of SUPER_AGENT_ERROR_CODES) {
      expect(zhCN.errors).toHaveProperty(code)
      expect(enUS.errors).toHaveProperty(code)
      expect((zhCN.errors as Record<string, string>)[code]).toBeTruthy()
      expect((enUS.errors as Record<string, string>)[code]).toBeTruthy()
    }
  })

  it('defines the generic fallback in both locales', () => {
    expect(zhCN.errors).toHaveProperty('unknown')
    expect(enUS.errors).toHaveProperty('unknown')
  })

  it('keeps the same set of error keys across locales', () => {
    expect(Object.keys(zhCN.errors).sort()).toEqual(Object.keys(enUS.errors).sort())
  })
})

describe('serializeSuperAgentError', () => {
  it('serializes a domain error into the stable payload', () => {
    const payload = serializeSuperAgentError(superAgentError('ticketEnded', { ticketId: 'ticket-1' }))

    expect(payload).toEqual({
      code: 'ticketEnded',
      category: 'refused',
      i18nKey: 'superAgent.errors.ticketEnded',
      params: { ticketId: 'ticket-1' },
      known: true,
    })
  })

  it('accepts a known stable code carried by a plain error object', () => {
    const payload = serializeSuperAgentError(Object.assign(new Error('boom'), { code: 'slotUnavailable' }))

    expect(payload.code).toBe('slotUnavailable')
    expect(payload.category).toBe('unavailable')
    expect(payload.i18nKey).toBe('superAgent.errors.slotUnavailable')
    expect(payload.known).toBe(true)
  })

  it('falls back to the generic key for an unknown code but keeps the code for audit', () => {
    const payload = serializeSuperAgentError(Object.assign(new Error('boom'), { code: 'someFutureCode' }))

    expect(payload.code).toBe('someFutureCode')
    expect(payload.category).toBe('unknown')
    expect(payload.i18nKey).toBe('superAgent.errors.unknown')
    expect(payload.known).toBe(false)
  })

  it('falls back to the generic payload when the error carries no code at all', () => {
    const payload = serializeSuperAgentError(new Error('network hiccup'))

    expect(payload.code).toBe('unknown')
    expect(payload.category).toBe('unknown')
    expect(payload.i18nKey).toBe('superAgent.errors.unknown')
    expect(payload.known).toBe(false)
  })

  it('never leaks the raw exception message into the payload', () => {
    const payload = serializeSuperAgentError(new Error('secret stack detail'))

    expect(JSON.stringify(payload)).not.toContain('secret stack detail')
  })
})
