import { describe, expect, it } from 'vitest'
import { buildStartupFingerprint, diffStartupConfig } from '../sessionStartup'

const direct = { apiKey: 'key-A', usesProxy: false }
const applied = buildStartupFingerprint({ ...direct, systemPrompt: 'OLD-PROMPT', agent: 'OLD-SKILL' })

describe('session startup config reconcile', () => {
  it('detects a systemPrompt-only change', () => {
    expect(diffStartupConfig(applied, { ...direct, systemPrompt: 'NEW-PROMPT', agent: 'OLD-SKILL' }))
      .toEqual(['systemPrompt'])
  })

  it('detects an agent-only change', () => {
    expect(diffStartupConfig(applied, { ...direct, systemPrompt: 'OLD-PROMPT', agent: 'NEW-SKILL' }))
      .toEqual(['agent'])
  })

  it('detects a credential-only change in direct mode', () => {
    expect(diffStartupConfig(applied, { ...direct, apiKey: 'key-B', systemPrompt: 'OLD-PROMPT', agent: 'OLD-SKILL' }))
      .toEqual(['credential'])
  })

  it('reports nothing when systemPrompt, agent and key are all unchanged', () => {
    expect(diffStartupConfig(applied, { ...direct, systemPrompt: 'OLD-PROMPT', agent: 'OLD-SKILL' })).toEqual([])
  })

  it('ignores fields the caller did not declare', () => {
    // 普通聊天的 initClaudeCodeSession 不带 overrides：不能把设计会话判成配置漂移
    expect(diffStartupConfig(applied, direct)).toEqual([])
  })

  it('leaves credential reconciliation to the proxy in proxy mode', () => {
    const proxyApplied = buildStartupFingerprint({
      systemPrompt: 'OLD-PROMPT', agent: 'OLD-SKILL', apiKey: 'key-A', usesProxy: true,
    })
    expect(proxyApplied.credential).toBeUndefined()
    expect(diffStartupConfig(proxyApplied, {
      systemPrompt: 'OLD-PROMPT', agent: 'OLD-SKILL', apiKey: 'key-B', usesProxy: true,
    })).toEqual([])
  })

  it('treats a session without a fingerprint as unknown and restarts once', () => {
    expect(diffStartupConfig(undefined, direct)).toEqual(['credential'])
  })

  it('treats an empty key and a missing key as the same credential', () => {
    const oauthApplied = buildStartupFingerprint({ usesProxy: false })
    expect(diffStartupConfig(oauthApplied, { apiKey: '', usesProxy: false })).toEqual([])
    expect(diffStartupConfig(oauthApplied, { apiKey: undefined, usesProxy: false })).toEqual([])
    expect(diffStartupConfig(oauthApplied, { apiKey: 'key-A', usesProxy: false })).toEqual(['credential'])
  })

  it('never exposes the plaintext value through the fingerprint', () => {
    const fingerprint = buildStartupFingerprint({ ...direct, systemPrompt: 'LONG-DESIGN-PROMPT-STACK' })
    expect(JSON.stringify(fingerprint)).not.toContain('key-A')
    expect(JSON.stringify(fingerprint)).not.toContain('LONG-DESIGN-PROMPT-STACK')
    expect(fingerprint).toEqual(buildStartupFingerprint({ ...direct, systemPrompt: 'LONG-DESIGN-PROMPT-STACK' }))
    expect(buildStartupFingerprint({ apiKey: 'key-B', usesProxy: false }).credential)
      .not.toBe(buildStartupFingerprint({ apiKey: 'key-C', usesProxy: false }).credential)
  })
})
