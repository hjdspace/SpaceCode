/**
 * 路由评测 fixture 回归测试。
 *
 * 不调真实模型 — 用 fixture 里的 modelOutput 模拟 LLM 返回，验证：
 * 1. buildRouterPrompt 对每条样例产出合法 prompt（含候选清单、路由提示）
 * 2. parseRoutingDecision 正确解析模型输出（ranked name 序列匹配）
 * 3. resolveRoutingOutcome 的处置结果与标注预期一致（auto / candidates / none）
 * 4. 含 routingHints 的候选集在 prompt 中出现路由提示文本
 */
import { describe, expect, it } from 'vitest'

import {
  buildRouterPrompt,
  parseRoutingDecision,
  resolveRoutingOutcome,
} from '@/services/assistantRouter'
import type { RoutingCandidate } from '@/types/workRouting'

import {
  FIXTURES,
  FIXTURE_CANDIDATES,
  FIXTURE_CANDIDATES_WITH_HINTS,
} from './routingFixtures'

describe('routing evaluation fixtures', () => {
  const baseCandidates: RoutingCandidate[] = FIXTURE_CANDIDATES.map(c => ({
    name: c.name,
    description: c.description,
  }))
  const hintedCandidates: RoutingCandidate[] = FIXTURE_CANDIDATES_WITH_HINTS.map(c => ({
    name: c.name,
    description: c.description,
    ...(c.routingHints ? { routingHints: c.routingHints } : {}),
  }))

  // 每 fixture 独立 it，方便定位失败样例
  for (const fixture of FIXTURES) {
    const candidates = fixture.hasRoutingHints ? hintedCandidates : baseCandidates

    it(`[${fixture.category}] ${fixture.id}: prompt + parse + resolve`, () => {
      // 1. buildRouterPrompt 必须产出合法 prompt
      const prompt = buildRouterPrompt(fixture.message, candidates, fixture.isZh)
      expect(prompt.system).toBeTruthy()
      expect(prompt.user).toContain(fixture.message)
      // 候选清单里的第一个助手名必须出现在 user prompt 中
      expect(prompt.user).toContain(candidates[0].name)

      // 含 routingHints 的样例，prompt 必须包含路由提示文本
      if (fixture.hasRoutingHints) {
        const hintedNames = ['ppt-creator', 'ppt-office-assistant', 'html-ppt-creator']
        const hinted = candidates.find(c => c.routingHints && hintedNames.includes(c.name))
        if (hinted?.routingHints) {
          expect(prompt.user).toContain(hinted.routingHints)
        }
      }

      // 2. parseRoutingDecision 解析模型输出
      const decision = parseRoutingDecision(fixture.modelOutput, candidates)
      expect(decision.ranked.map(r => r.name)).toEqual(fixture.expectedRankedNames)

      // 3. resolveRoutingOutcome 的处置与标注预期一致
      const outcome = resolveRoutingOutcome(decision)
      if (fixture.expectedOutcome === 'auto') {
        expect(outcome.kind).toBe('auto')
      } else if (fixture.expectedOutcome === 'candidates') {
        expect(outcome.kind).toBe('candidates')
      } else if (fixture.expectedOutcome === 'none') {
        expect(outcome.kind).toBe('none')
      }
    })
  }

  it('has at least 30 fixtures', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(30)
  })

  it('covers all required categories', () => {
    const categories = new Set(FIXTURES.map(f => f.category))
    expect(categories).toContain('ppt-ambiguity')
    expect(categories).toContain('multilingual')
    expect(categories).toContain('greeting')
    expect(categories).toContain('off-domain')
    expect(categories).toContain('custom-agent')
    expect(categories).toContain('routing-hints-contrast')
  })

  it('includes routing-hints contrast pairs (same message, with vs without hints)', () => {
    const contrastMessages = FIXTURES
      .filter(f => f.category === 'routing-hints-contrast')
      .map(f => f.message)
    // 至少有 2 条不同消息出现在 routing-hints-contrast 类别中
    const uniqueMessages = new Set(contrastMessages)
    expect(uniqueMessages.size).toBeGreaterThanOrEqual(2)

    // 每条消息至少有 with-hints 和 without-hints 两个版本
    for (const msg of uniqueMessages) {
      const withHints = FIXTURES.some(f => f.message === msg && f.hasRoutingHints)
      const withoutHints = FIXTURES.some(f => f.message === msg && !f.hasRoutingHints)
      expect(withHints).toBe(true)
      expect(withoutHints).toBe(true)
    }
  })
})
