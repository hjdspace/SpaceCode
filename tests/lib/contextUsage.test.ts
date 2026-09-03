import { describe, expect, it } from 'vitest'
import { buildSnapshotFromEngineData } from '@/utils/contextUsage'
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
