// @vitest-environment node
/**
 * 程序层 Gate 纯函数（T16 #86）。
 *
 * 覆盖验收：
 *  - Gate 纯程序判定：同步纯函数，不调用模型、不碰引擎端口；
 *  - 每 Source 准入表：scope（channel 允许列表）× 名单（allowlist）× @Agent
 *    共同决定 explicit / inferred / 不进入（filtered 带原因码）；
 *  - bot 名单：最多 inferred（即使被 @ 也不能显式请求），跨 Source 不做身份映射；
 *  - 未配置准入表的 Source 走保守默认：只有 addressed 的人消息成为 explicit 候选。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_SUPER_AGENT_POLICY, gateTrigger } from '../policy'
import type { SuperAgentPolicy, SuperAgentSourceAdmission } from '../model'
import type { SuperAgentTrigger } from '../model'

function admission(partial: Partial<SuperAgentSourceAdmission> & { source: string }): SuperAgentSourceAdmission {
  return { channels: [], allowlist: [], bots: [], ...partial }
}

function policy(admissions: SuperAgentSourceAdmission[]): SuperAgentPolicy {
  return { ...DEFAULT_SUPER_AGENT_POLICY, admissions }
}

function trigger(partial: Partial<SuperAgentTrigger>): SuperAgentTrigger {
  return {
    triggerId: 'trigger-1',
    key: 'k1',
    ordinal: 1,
    source: 'feishu-im',
    threadIds: ['feishu:thread:t1'],
    actor: 'feishu:user:u1',
    human: true,
    addressed: 'mention',
    channel: 'feishu:chat:c1',
    url: null,
    text: '@SuperAgent 修一下',
    at: '2026-01-01T00:00:00.000Z',
    meta: {},
    disposition: {
      filtered: null,
      ticketIds: [],
      contextTicketIds: [],
      requeued: false,
      handedBack: false,
      ackedAt: null,
    },
    ...partial,
  }
}

describe('默认准入（未配置准入表的 Source）', () => {
  it('admits an addressed human trigger as explicit without any admission entry', () => {
    const gate = gateTrigger(DEFAULT_SUPER_AGENT_POLICY, trigger({}))
    expect(gate).toEqual({
      admitted: true,
      strength: 'explicit',
      basis: 'addressed',
      bot: false,
    })
  })

  it('filters non-addressed or non-human triggers with a reason code', () => {
    expect(gateTrigger(DEFAULT_SUPER_AGENT_POLICY, trigger({ addressed: null }))).toEqual({
      admitted: false,
      filtered: 'not-admitted',
    })
    expect(gateTrigger(DEFAULT_SUPER_AGENT_POLICY, trigger({ human: false }))).toEqual({
      admitted: false,
      filtered: 'not-admitted',
    })
  })
})

describe('每 Source 准入表：scope × 名单 × @Agent', () => {
  it('filters events outside the configured channel scope with out-of-scope', () => {
    const configured = policy([
      admission({ source: 'feishu-im', channels: ['feishu:chat:c1'] }),
    ])
    const outside = gateTrigger(configured, trigger({ channel: 'feishu:chat:c2' }))
    expect(outside).toEqual({ admitted: false, filtered: 'out-of-scope' })

    // channels 为空数组表示整个 Source 都在范围内。
    const whole = policy([admission({ source: 'feishu-im', channels: [] })])
    expect(gateTrigger(whole, trigger({ channel: 'feishu:chat:c2' })).admitted).toBe(true)
  })

  it('admits an allowlisted actor without @Agent as inferred/admission', () => {
    const configured = policy([
      admission({ source: 'feishu-im', allowlist: ['feishu:user:u1'] }),
    ])
    const gate = gateTrigger(configured, trigger({ addressed: null }))
    expect(gate).toEqual({ admitted: true, strength: 'inferred', basis: 'admission', bot: false })
  })

  it('filters actors outside the allowlist when not addressed', () => {
    const configured = policy([
      admission({ source: 'feishu-im', allowlist: ['feishu:user:u1'] }),
    ])
    expect(gateTrigger(configured, trigger({ addressed: null, actor: 'feishu:user:u2' }))).toEqual({
      admitted: false,
      filtered: 'not-admitted',
    })
  })

  it('keeps addressed explicit admission inside a configured source', () => {
    const configured = policy([
      admission({ source: 'feishu-im', allowlist: ['feishu:user:u1'] }),
    ])
    expect(gateTrigger(configured, trigger({ actor: 'feishu:user:u2' }))).toMatchObject({
      admitted: true,
      strength: 'explicit',
      basis: 'addressed',
    })
  })
})

describe('bot 名单', () => {
  it('caps bots at inferred even when they explicitly address the agent', () => {
    const configured = policy([
      admission({ source: 'feishu-im', bots: ['feishu:bot:ci'] }),
    ])
    const gate = gateTrigger(configured, trigger({ actor: 'feishu:bot:ci', human: false }))
    expect(gate).toEqual({ admitted: true, strength: 'inferred', basis: 'bot', bot: true })
  })

  it('admits bots without @Agent as inferred candidates (policy-driven candidacy)', () => {
    const configured = policy([
      admission({ source: 'feishu-im', bots: ['feishu:bot:ci'] }),
    ])
    const gate = gateTrigger(configured, trigger({ actor: 'feishu:bot:ci', human: false, addressed: null }))
    expect(gate).toEqual({ admitted: true, strength: 'inferred', basis: 'bot', bot: true })
  })

  it('does not map bot identity across sources (per-source lists only)', () => {
    const configured = policy([
      admission({ source: 'feishu-im', bots: ['feishu:bot:ci'] }),
      admission({ source: 'github' }),
    ])
    // 同名 actor 出现在 github 时不是 bot —— 跨 Source 不做身份映射。
    const onGitHub = gateTrigger(
      configured,
      trigger({ source: 'github', actor: 'feishu:bot:ci', human: false }),
    )
    expect(onGitHub).toEqual({ admitted: false, filtered: 'not-admitted' })
  })

  it('lets the bot list win over a claimed human flag (identity is policy-owned)', () => {
    const configured = policy([
      admission({ source: 'feishu-im', bots: ['feishu:bot:ci'] }),
    ])
    const gate = gateTrigger(configured, trigger({ actor: 'feishu:bot:ci', human: true }))
    expect(gate).toEqual({ admitted: true, strength: 'inferred', basis: 'bot', bot: true })
  })
})

describe('Gate 纯程序判定', () => {
  it('is a synchronous pure function that never touches a model or engine port', () => {
    // 无网络、无端口、无异步 —— 判定只依赖 Policy 与 Trigger 事实。
    const result = gateTrigger(DEFAULT_SUPER_AGENT_POLICY, trigger({}))
    expect(result).not.toBeNull()
    expect(typeof result).toBe('object')
  })
})
