// @vitest-environment node
/**
 * contextUsage 的纯函数边界：分类归一化/缺口分摊、窗口与阈值推导、警告状态机。
 * 这块直接决定上下文面板的数字与告警文案，错了用户会在错误时机被 compact。
 */
import { describe, it, expect } from 'vitest'
import {
  getCategoryI18nKey,
  sortContextCategories,
  roughTokenEstimate,
  estimateMessageBreakdownFromMessages,
  normalizeContextCategories,
  getVisibleContextCategories,
  resolveContextWindowOverrides,
  getContextWindowForModel,
  getMaxOutputTokensForModel,
  getEffectiveContextWindowSize,
  getAutoCompactThreshold,
  getWarningThreshold,
  formatTokens,
  formatNumber,
  calculateCacheHitRate,
  getContextFillFromApiUsage,
  calculateContextPercentages,
  calculateTokenWarningState,
  sumSessionTokensFromMessages,
  buildSnapshotFromEngineData,
  buildFallbackSnapshot,
  categoryColorToCss,
} from '@/utils/contextUsage'
import type { ContextUsageData, ContextApiUsage } from '@/types/contextUsage'
import type { Message } from '@/types'

const MODEL = 'claude-sonnet-4-5' // 无特殊匹配 → 默认 200k 窗口

function makeData(partial: Partial<ContextUsageData>): ContextUsageData {
  return {
    categories: [],
    totalTokens: 0,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 0,
    model: MODEL,
    isAutoCompactEnabled: true,
    apiUsage: null,
    ...partial,
  }
}

function makeMessage(partial: Partial<Message>): Message {
  return { id: 'm1', role: 'user', content: '', timestamp: 0, ...partial }
}

describe('getCategoryI18nKey', () => {
  it('命中已知分类返回 i18n key，未知分类返回 undefined', () => {
    expect(getCategoryI18nKey('Skills')).toBe('contextUsage.categorySkills')
    expect(getCategoryI18nKey('Messages')).toBe('contextUsage.categoryConversation')
    expect(getCategoryI18nKey('不存在的分类')).toBeUndefined()
  })
})

describe('sortContextCategories', () => {
  it('按固定展示顺序排列，未知名排最后', () => {
    const sorted = sortContextCategories([
      { name: 'Messages', tokens: 100 },
      { name: '未知类别', tokens: 1 },
      { name: 'System prompt', tokens: 50 },
    ])
    expect(sorted.map(c => c.name)).toEqual(['System prompt', 'Messages', '未知类别'])
  })

  it('同一排序位（都未知名）时按 tokens 降序', () => {
    const sorted = sortContextCategories([
      { name: 'b', tokens: 10 },
      { name: 'a', tokens: 99 },
    ])
    expect(sorted.map(c => c.name)).toEqual(['a', 'b'])
  })

  it('不改动原数组', () => {
    const input = [{ name: 'Messages', tokens: 1 }, { name: 'System prompt', tokens: 2 }]
    sortContextCategories(input)
    expect(input[0].name).toBe('Messages')
  })
})

describe('roughTokenEstimate', () => {
  it('空串为 0，非空按 chars/4 向上取整且至少为 1', () => {
    expect(roughTokenEstimate('')).toBe(0)
    expect(roughTokenEstimate('a')).toBe(1)
    expect(roughTokenEstimate('aaaa')).toBe(1)
    expect(roughTokenEstimate('aaaaa')).toBe(2)
  })
})

describe('estimateMessageBreakdownFromMessages', () => {
  it('按角色与载荷分别累计', () => {
    const messages: Message[] = [
      makeMessage({
        id: 'a',
        role: 'assistant',
        content: 'a'.repeat(100), // 25
        reasoning: { content: 'r'.repeat(40), startTime: 0 }, // 10
        toolCalls: [{ id: 't1', name: 'A', input: {}, status: 'completed' }], // {"name":"A","input":{}} = 22 → 6
      }),
      makeMessage({
        id: 'u',
        role: 'user',
        content: 'u'.repeat(8), // 2
        attachments: [{ path: 'f' } as never], // {"path":"f"} = 12 → 3
        imageAttachments: [{ data: 'x'.repeat(8), name: 'i' } as never], // 8/4 = 2
      }),
      makeMessage({
        id: 'r',
        role: 'user',
        content: '',
        toolResults: [{ output: 'o'.repeat(16) } as never], // 4
      }),
    ]
    expect(estimateMessageBreakdownFromMessages(messages)).toEqual({
      toolCallTokens: 6,
      toolResultTokens: 4,
      attachmentTokens: 5,
      assistantMessageTokens: 35,
      userMessageTokens: 2,
    })
  })

  it('空消息列表全为 0', () => {
    expect(estimateMessageBreakdownFromMessages([])).toEqual({
      toolCallTokens: 0,
      toolResultTokens: 0,
      attachmentTokens: 0,
      assistantMessageTokens: 0,
      userMessageTokens: 0,
    })
  })
})

describe('normalizeContextCategories', () => {
  it('从 detail 字段补齐分类，未加载的 MCP 工具不计入', () => {
    const categories = normalizeContextCategories(
      makeData({
        totalTokens: 10_000,
        memoryFiles: [{ path: 'CLAUDE.md', type: 'memory', tokens: 1000 }],
        mcpTools: [
          { name: 'a', tokens: 2000, isLoaded: true },
          { name: 'b', tokens: 500, isLoaded: false },
        ],
        agents: [{ agentType: 'x', tokens: 300 }],
        skills: { totalSkills: 2, includedSkills: 1, tokens: 400, skillFrontmatter: [] },
        messageBreakdown: {
          toolCallTokens: 100,
          toolResultTokens: 100,
          attachmentTokens: 100,
          assistantMessageTokens: 100,
          userMessageTokens: 100,
        },
      }),
    )
    const byName = new Map(categories.map(c => [c.name, c.tokens]))
    expect(byName.get('Memory files')).toBe(1000)
    expect(byName.get('MCP tools')).toBe(2000)
    expect(byName.get('Custom agents')).toBe(300)
    expect(byName.get('Skills')).toBe(400)
    // Messages 明细 500，再并入缺口分摊后的余量（见下条用例的分摊演算）
    expect(byName.get('Messages')).toBe(1660)
  })

  it('引擎给了 messageBreakdown 时缺口并进 Messages 且不标记估算', () => {
    const categories = normalizeContextCategories(
      makeData({
        totalTokens: 50_000,
        messageBreakdown: {
          toolCallTokens: 1000,
          toolResultTokens: 1000,
          attachmentTokens: 1000,
          assistantMessageTokens: 500,
          userMessageTokens: 500,
        },
      }),
    )
    const messages = categories.find(c => c.name === 'Messages')
    // 明细 4000 + 缺口 46000 经固定开销分摊(budget 18000 → 分摊 13640)后余 32360
    expect(messages?.tokens).toBe(36_360)
    expect(messages?.isEstimated).toBeUndefined()
    // 估算的固定开销分类被标 isEstimated
    expect(categories.find(c => c.name === 'System prompt')?.isEstimated).toBe(true)
  })

  it('已有 System prompt 时不再重复分摊固定开销', () => {
    const categories = normalizeContextCategories(
      makeData({
        totalTokens: 50_000,
        categories: [{ name: 'System prompt', tokens: 2000, color: 'system' }],
        messageBreakdown: {
          toolCallTokens: 0,
          toolResultTokens: 0,
          attachmentTokens: 0,
          assistantMessageTokens: 1000,
          userMessageTokens: 0,
        },
      }),
    )
    expect(categories.find(c => c.name === 'System tools')).toBeUndefined()
    expect(categories.find(c => c.name === 'System prompt')?.tokens).toBe(2000)
    // 缺口 47000 全进 Messages
    expect(categories.find(c => c.name === 'Messages')?.tokens).toBe(1000 + 47_000)
  })

  it('无 messageBreakdown 时用客户端消息估算并标记 isEstimated', () => {
    const categories = normalizeContextCategories(
      makeData({ totalTokens: 1000 }),
      [makeMessage({ role: 'user', content: 'u'.repeat(8) })], // 2 tokens
    )
    const messages = categories.find(c => c.name === 'Messages')
    expect(messages?.tokens).toBeGreaterThanOrEqual(2)
    expect(messages?.isEstimated).toBe(true)
  })

  it('保留分类（Free space 等）不参与缺口计算', () => {
    const categories = normalizeContextCategories(
      makeData({
        totalTokens: 10_000,
        categories: [
          { name: 'Free space', tokens: 5000 },
          { name: 'Messages', tokens: 1000 },
        ],
      }),
    )
    // 缺口 = 10000 - 1000(Free space 被排除) = 9000；经固定开销分摊余 1800 并进 Messages
    expect(categories.find(c => c.name === 'Messages')?.tokens).toBe(1000 + 1800)
  })
})

describe('getVisibleContextCategories', () => {
  it('data 为空返回空数组', () => {
    expect(getVisibleContextCategories(null)).toEqual([])
    expect(getVisibleContextCategories(undefined)).toEqual([])
  })

  it('过滤零值/保留/deferred 分类并排序', () => {
    const visible = getVisibleContextCategories(
      makeData({
        totalTokens: 2000,
        categories: [
          { name: 'Messages', tokens: 1000 },
          { name: 'Free space', tokens: 500 },
          { name: 'MCP tools', tokens: 300, isDeferred: true },
          { name: 'Skills', tokens: 0 },
          { name: 'System prompt', tokens: 100 },
        ],
      }),
    )
    expect(visible.map(c => c.name)).toEqual(['System prompt', 'Messages'])
  })
})

describe('resolveContextWindowOverrides', () => {
  it('modelCapabilities 优先于旧版 modelContextWindows，非正值被忽略', () => {
    expect(
      resolveContextWindowOverrides(
        { a: { contextWindow: 2000 } as never, c: { contextWindow: 0 } as never },
        { a: 1000, b: -5 },
      ),
    ).toEqual({ a: 2000 })
  })

  it('两者都缺省时返回空表', () => {
    expect(resolveContextWindowOverrides()).toEqual({})
  })
})

describe('模型窗口与输出上限', () => {
  it('用户覆盖优先；[1m] 后缀给 1M；默认 200k', () => {
    expect(getContextWindowForModel(MODEL, 50_000)).toBe(50_000)
    expect(getContextWindowForModel('claude-opus-4-6[1m]')).toBe(1_000_000)
    expect(getContextWindowForModel(MODEL)).toBe(200_000)
  })

  it('输出上限按型号分档', () => {
    expect(getMaxOutputTokensForModel('claude-opus-4-6')).toBe(64_000)
    expect(getMaxOutputTokensForModel('claude-sonnet-4-6')).toBe(32_000)
    expect(getMaxOutputTokensForModel('claude-haiku-4')).toBe(32_000)
  })

  it('有效窗口 = 窗口 - 输出预留（预留不超过窗口 25%）', () => {
    // 200k：reserved = min(32000, 20000, 50000) = 20000
    expect(getEffectiveContextWindowSize(MODEL)).toBe(180_000)
    // 小窗口 40k：reserved = min(32000, 20000, 10000) = 10000
    expect(getEffectiveContextWindowSize(MODEL, 40_000)).toBe(30_000)
  })

  it('auto-compact 与告警阈值沿有效窗口推导', () => {
    // 180000 - min(13000, 60000) = 167000
    expect(getAutoCompactThreshold(MODEL)).toBe(167_000)
    expect(getWarningThreshold(MODEL)).toBe(147_000)
  })
})

describe('formatTokens / formatNumber', () => {
  it('M/k 分档并去掉多余的 .0', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_500)).toBe('1.5k')
    expect(formatTokens(2_000)).toBe('2k')
    expect(formatTokens(999)).toBe('999')
  })

  it('formatNumber 走 en-US 千分位', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
  })
})

describe('calculateCacheHitRate', () => {
  it('prompt 总量为 0 返回 null，否则保留两位小数', () => {
    expect(
      calculateCacheHitRate({ inputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }),
    ).toBeNull()
    expect(
      calculateCacheHitRate({ inputTokens: 100, cacheReadInputTokens: 50, cacheCreationInputTokens: 50 }),
    ).toBe(25)
  })
})

describe('getContextFillFromApiUsage / calculateContextPercentages', () => {
  const usage: ContextApiUsage = {
    input_tokens: 30_000,
    output_tokens: 10_000,
    cache_creation_input_tokens: 5_000,
    cache_read_input_tokens: 5_000,
  }

  it('填充量含 output（下一轮请求的上下文），空 usage 为 0', () => {
    expect(getContextFillFromApiUsage(usage)).toBe(50_000)
    expect(getContextFillFromApiUsage(null)).toBe(0)
    expect(getContextFillFromApiUsage(undefined)).toBe(0)
  })

  it('百分比按窗口换算并夹在 0–100', () => {
    expect(calculateContextPercentages(usage, 200_000)).toEqual({ used: 25, remaining: 75 })
    expect(calculateContextPercentages(usage, 40_000)).toEqual({ used: 100, remaining: 0 })
    expect(calculateContextPercentages(null, 200_000)).toEqual({ used: null, remaining: null })
  })
})

describe('calculateTokenWarningState（默认 200k 模型：阈值 167k / 告警 147k / 阻塞 177k）', () => {
  it('远低于告警线 → ok，无文案', () => {
    const state = calculateTokenWarningState(100_000, MODEL)
    expect(state.warningLevel).toBe('ok')
    expect(state.warningMessage).toBeNull()
    expect(state.percentLeft).toBe(40)
  })

  it('越过告警线 → error，开启 auto-compact 时报剩余百分比', () => {
    const state = calculateTokenWarningState(150_000, MODEL, true)
    expect(state.warningLevel).toBe('error')
    expect(state.warningMessage).toBe('10% until auto-compact')
  })

  it('关闭 auto-compact 时按有效窗口算，文案改为剩余量提示', () => {
    const state = calculateTokenWarningState(165_000, MODEL, false)
    expect(state.warningLevel).toBe('error')
    expect(state.warningMessage).toBe('Context low (8% remaining)')
  })

  it('越过阻塞线 → blocking，提示手动 /compact，percentLeft 夹到 0', () => {
    const state = calculateTokenWarningState(178_000, MODEL)
    expect(state.warningLevel).toBe('blocking')
    expect(state.warningMessage).toBe('Context nearly full · run /compact to continue')
    expect(state.percentLeft).toBe(0)
  })
})

describe('sumSessionTokensFromMessages', () => {
  it('只累计 metadata 里出现的字段', () => {
    const totals = sumSessionTokensFromMessages([
      makeMessage({ metadata: { inputTokens: 100, outputTokens: 50 } as never }),
      makeMessage({ metadata: { cacheReadInputTokens: 10 } as never }),
      makeMessage({}),
    ])
    expect(totals).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 0,
    })
  })
})

describe('buildSnapshotFromEngineData', () => {
  const usage: ContextApiUsage = {
    input_tokens: 40_000,
    output_tokens: 5_000,
    cache_creation_input_tokens: 3_000,
    cache_read_input_tokens: 2_000,
  }

  it('无覆盖时用 rawMaxTokens 计算占比与会话合计', () => {
    const snap = buildSnapshotFromEngineData(
      makeData({ totalTokens: 50_000, rawMaxTokens: 200_000, apiUsage: usage }),
      MODEL,
    )
    expect(snap.usedPercentage).toBe(25)
    expect(snap.remainingPercentage).toBe(75)
    expect(snap.sessionTotals).toEqual({
      inputTokens: 40_000,
      outputTokens: 5_000,
      cacheReadInputTokens: 2_000,
      cacheCreationInputTokens: 3_000,
    })
  })

  it('用户覆盖窗口时按覆盖值重算 percentage', () => {
    const snap = buildSnapshotFromEngineData(
      makeData({ totalTokens: 100_000, rawMaxTokens: 200_000, apiUsage: usage }),
      MODEL,
      100_000,
    )
    expect(snap.data?.rawMaxTokens).toBe(100_000)
    expect(snap.data?.percentage).toBe(100)
  })
})

describe('buildFallbackSnapshot', () => {
  it('优先使用最后一条消息的 apiCallUsage（避免累计 usage 重复计 cache）', () => {
    const snap = buildFallbackSnapshot(
      [
        makeMessage({ id: 'a', metadata: { inputTokens: 1000 } as never }),
        makeMessage({
          id: 'b',
          metadata: {
            inputTokens: 9999,
            apiCallUsage: {
              input_tokens: 500,
              output_tokens: 50,
              cache_read_input_tokens: 200,
              cache_creation_input_tokens: 100,
            },
          } as never,
        }),
      ],
      MODEL,
    )
    expect(snap.data?.totalTokens).toBe(850)
    // sessionTotals 累计所有消息的顶层 metadata.inputTokens（1000 + 9999）
    expect(snap.sessionTotals.inputTokens).toBe(10_999)
    expect(snap.usedPercentage).toBe(0) // 850/200000 四舍五入为 0
  })

  it('没有任何 usage 元数据时按内容长度 chars/4 估算', () => {
    const snap = buildFallbackSnapshot(
      [makeMessage({ content: 'x'.repeat(400) })],
      MODEL,
    )
    expect(snap.data?.totalTokens).toBe(100)
    expect(snap.usedPercentage).toBe(0)
  })

  it('空消息列表也能产出合法快照', () => {
    const snap = buildFallbackSnapshot([], MODEL)
    expect(snap.data?.totalTokens).toBe(0)
    expect(snap.warningLevel).toBe('ok')
  })
})

describe('categoryColorToCss', () => {
  it('命中映射表，缺省与未知值回落到默认蓝', () => {
    expect(categoryColorToCss('permission')).toBe('#d97757')
    expect(categoryColorToCss(undefined)).toBe('#6a9bcc')
    expect(categoryColorToCss('不存在的key')).toBe('#6a9bcc')
  })
})
