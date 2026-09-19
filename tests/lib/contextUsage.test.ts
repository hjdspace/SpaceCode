import { describe, expect, it } from 'vitest'
import type { Message } from '@/types'
import {
  buildFallbackSnapshot,
  buildSnapshotFromEngineData,
  calculateTokenWarningState,
  getContextFillFromApiUsage,
} from '@/utils/contextUsage'
import type { ContextUsageData } from '@/types/contextUsage'

function createEngineData(overrides: Partial<ContextUsageData> = {}): ContextUsageData {
  return {
    categories: [],
    totalTokens: 92_154,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 46,
    model: 'claude-sonnet-4-20250514',
    isAutoCompactEnabled: true,
    apiUsage: {
      input_tokens: 47_098,
      output_tokens: 1_291,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 45_056,
    },
    ...overrides,
  }
}

describe('buildSnapshotFromEngineData', () => {
  it('uses the configured context window when the engine reports its default window', () => {
    const snapshot = buildSnapshotFromEngineData(
      createEngineData(),
      'deepseek-v4-flash',
      1_000_000,
    )

    expect(snapshot.data?.rawMaxTokens).toBe(1_000_000)
    expect(snapshot.data?.maxTokens).toBe(1_000_000)
    expect(snapshot.data?.percentage).toBe(9)
    expect(snapshot.usedPercentage).toBe(9)
  })

  it('keeps the engine window when no user override is configured', () => {
    const snapshot = buildSnapshotFromEngineData(
      createEngineData({
        maxTokens: 1_000_000,
        rawMaxTokens: 1_000_000,
        percentage: 9,
      }),
      'claude-sonnet-4-20250514[1m]',
    )

    expect(snapshot.data?.rawMaxTokens).toBe(1_000_000)
    expect(snapshot.data?.maxTokens).toBe(1_000_000)
  })
})

describe('getContextFillFromApiUsage', () => {
  it('includes output tokens — they become part of the next request context', () => {
    // Mirrors cc-haha's getUsageTokenTotal / getTokenCountFromUsage:
    // input + cache_creation + cache_read + output.
    expect(
      getContextFillFromApiUsage({
        input_tokens: 47_098,
        output_tokens: 1_291,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 45_056,
      }),
    ).toBe(93_445)
  })
})

describe('usedPercentage includes output tokens (engine path)', () => {
  it('does not drop right after the model finishes responding', () => {
    // totalTokens (92_154) equals input+cache; output (1_291) arrives on top.
    // 200k window: round(93_445 / 200_000 * 100) = 47 (pre-fix: 46).
    const snapshot = buildSnapshotFromEngineData(
      createEngineData({ percentage: 46 }),
      'claude-sonnet-4-20250514',
    )
    expect(snapshot.usedPercentage).toBe(47)
  })
})

describe('small context window clamps (mirrors cc-haha autoCompact)', () => {
  it('caps the output reserve at 25% of the window', () => {
    // 32k window: reserve = min(32_000, 20_000, floor(32_000*0.25)) = 8_000
    // → effective = 24_000. Pre-fix: 32_000 - 20_000 = 12_000.
    const { percentLeft } = calculateTokenWarningState(12_000, 'claude-sonnet-4-6', true, 32_000)
    // threshold = 24_000 - min(13_000, floor(24_000/3)=8_000) = 16_000
    // percentLeft = round((16_000 - 12_000) / 16_000 * 100) = 25 (pre-fix: threshold
    // = 12_000 - 13_000 = -1_000 → percent = round(11 * 100) = 1100)
    expect(percentLeft).toBe(25)
  })

  it('never returns an absurd percentLeft for tiny windows', () => {
    const { percentLeft } = calculateTokenWarningState(0, 'claude-sonnet-4-6', true, 32_000)
    expect(percentLeft).toBeGreaterThanOrEqual(0)
    expect(percentLeft).toBeLessThanOrEqual(100)
  })
})

describe('buildFallbackSnapshot uses output-inclusive context fill', () => {
  it('bases totalTokens on input + cache + output of the last API call', () => {
    const messages = [
      {
        id: 'm1',
        role: 'user',
        content: 'hi',
        timestamp: Date.now(),
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'hello',
        timestamp: Date.now(),
        metadata: {
          apiCallUsage: {
            input_tokens: 1_000,
            output_tokens: 500,
            cache_read_input_tokens: 2_000,
            cache_creation_input_tokens: 0,
          },
        },
      },
    ] as unknown as Message[]

    const snapshot = buildFallbackSnapshot(messages, 'claude-sonnet-4-6')
    // 1_000 + 2_000 + 500 = 3_500 (pre-fix: 3_000)
    expect(snapshot.data?.totalTokens).toBe(3_500)
    expect(snapshot.usedPercentage).toBe(2)
  })
})
