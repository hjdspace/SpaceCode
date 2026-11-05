// @vitest-environment node
/**
 * Report 严格 JSON 块解析契约（T06 #76）：
 *  - Worker 消息中 ```super-agent:report 围栏块必须唯一（0/多个都按协议失败）；
 *  - 必填 assignmentId/reportId/kind/summary，可选 details/artifacts/question/
 *    askedBy/answers；progress 类专属字段 currentTool/toolCalls/elapsedMs
 *    只允许出现在 kind='progress'；
 *  - 未知字段、恶意嵌套、非法类型一律拒绝；
 *  - 所有协议失败抛稳定错误码（reportMissing/reportNotUnique/reportUnparsable/
 *    reportInvalid），供上层本地化，不透出英文异常。
 */
import { describe, expect, it } from 'vitest'
import { isSuperAgentDomainError, superAgentErrorCategory } from '../errors'
import {
  parseSuperAgentReportText,
  SUPER_AGENT_REPORT_FENCE,
  type ParsedSuperAgentReport,
} from '../reportParser'

function block(json: unknown): string {
  return `\`\`\`${SUPER_AGENT_REPORT_FENCE}\n${JSON.stringify(json)}\n\`\`\``
}

function validReport(overrides: Record<string, unknown> = {}): string {
  return block({
    assignmentId: 'assignment-1',
    reportId: 'report-1',
    kind: 'progress',
    summary: '正在修复登录',
    ...overrides,
  })
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (err) {
    expect(isSuperAgentDomainError(err)).toBe(true)
    if (isSuperAgentDomainError(err)) {
      expect(err.code).toBe(code)
      expect(superAgentErrorCategory(err.code)).toBe('refused')
    }
    return
  }
  throw new Error(`expected ${code} but nothing thrown`)
}

describe('parseSuperAgentReportText 唯一性', () => {
  it('parses the single report block among ordinary prose', () => {
    const text = `我先看一下相关文件。\n${validReport()}\n继续执行中。`
    const parsed = parseSuperAgentReportText(text)
    expect(parsed.assignmentId).toBe('assignment-1')
    expect(parsed.reportId).toBe('report-1')
    expect(parsed.kind).toBe('progress')
    expect(parsed.summary).toBe('正在修复登录')
  })

  it('rejects text without any report block (reportMissing)', () => {
    expectCode(() => parseSuperAgentReportText('普通消息，没有报告块'), 'reportMissing')
  })

  it('rejects multiple report blocks (reportNotUnique)', () => {
    expectCode(
      () => parseSuperAgentReportText(`${validReport()}\n中间正文\n${validReport({ reportId: 'r2' })}`),
      'reportNotUnique',
    )
  })

  it('ignores fences with other info strings', () => {
    const text = '```json\n{"kind":"hack"}\n```'
    expectCode(() => parseSuperAgentReportText(text), 'reportMissing')
  })
})

describe('parseSuperAgentReportText 严格校验', () => {
  it('rejects invalid JSON (reportUnparsable)', () => {
    expectCode(
      () => parseSuperAgentReportText(`\`\`\`${SUPER_AGENT_REPORT_FENCE}\n{not json}\n\`\`\``),
      'reportUnparsable',
    )
  })

  it('rejects non-object JSON (reportInvalid)', () => {
    expectCode(() => parseSuperAgentReportText(block(['fake'])), 'reportInvalid')
    expectCode(() => parseSuperAgentReportText(block(42)), 'reportInvalid')
    expectCode(() => parseSuperAgentReportText(block(null)), 'reportInvalid')
  })

  it('rejects missing required fields (reportInvalid)', () => {
    expectCode(() => parseSuperAgentReportText(block({ reportId: 'r', kind: 'progress', summary: 's' })), 'reportInvalid')
    expectCode(() => parseSuperAgentReportText(block({ assignmentId: 'a', kind: 'progress', summary: 's' })), 'reportInvalid')
    expectCode(() => parseSuperAgentReportText(block({ assignmentId: 'a', reportId: 'r', summary: 's' })), 'reportInvalid')
    expectCode(() => parseSuperAgentReportText(block({ assignmentId: 'a', reportId: 'r', kind: 'progress' })), 'reportInvalid')
  })

  it('rejects blank required fields (reportInvalid)', () => {
    expectCode(
      () => parseSuperAgentReportText(validReport({ assignmentId: '' })),
      'reportInvalid',
    )
    expectCode(() => parseSuperAgentReportText(validReport({ summary: '' })), 'reportInvalid')
  })

  it('rejects unknown kind (reportInvalid)', () => {
    expectCode(() => parseSuperAgentReportText(validReport({ kind: 'done' })), 'reportInvalid')
  })

  it('accepts every documented kind', () => {
    for (const kind of ['progress', 'waiting', 'ready', 'blocked', 'failed', 'dropped']) {
      const parsed = parseSuperAgentReportText(validReport({ kind }))
      expect(parsed.kind).toBe(kind)
    }
  })

  it('rejects unknown fields (reportInvalid)', () => {
    expectCode(
      () => parseSuperAgentReportText(validReport({ role: 'system' })),
      'reportInvalid',
    )
  })

  it('rejects malicious nested values (reportInvalid)', () => {
    expectCode(
      () => parseSuperAgentReportText(validReport({ artifacts: [['rm -rf /']] })),
      'reportInvalid',
    )
    expectCode(
      () => parseSuperAgentReportText(validReport({ answers: [{ inject: true }] })),
      'reportInvalid',
    )
  })

  it('rejects wrong-typed optional fields (reportInvalid)', () => {
    expectCode(() => parseSuperAgentReportText(validReport({ artifacts: 'src/' })), 'reportInvalid')
    expectCode(() => parseSuperAgentReportText(validReport({ answers: [42] })), 'reportInvalid')
    expectCode(() => parseSuperAgentReportText(validReport({ details: 3 })), 'reportInvalid')
  })

  it('rejects progress-only fields on non-progress kinds (reportInvalid)', () => {
    expectCode(
      () => parseSuperAgentReportText(validReport({ kind: 'ready', currentTool: 'Edit' })),
      'reportInvalid',
    )
    expectCode(
      () => parseSuperAgentReportText(validReport({ kind: 'ready', toolCalls: 2 })),
      'reportInvalid',
    )
  })

  it('rejects invalid progress facts on progress kind (reportInvalid)', () => {
    expectCode(
      () => parseSuperAgentReportText(validReport({ toolCalls: -1 })),
      'reportInvalid',
    )
    expectCode(
      () => parseSuperAgentReportText(validReport({ toolCalls: 1.5 })),
      'reportInvalid',
    )
    expectCode(
      () => parseSuperAgentReportText(validReport({ elapsedMs: 'many' })),
      'reportInvalid',
    )
  })
})

describe('parseSuperAgentReportText 完整载荷', () => {
  it('carries question/askedBy/answers/details/artifacts for the domain', () => {
    const parsed: ParsedSuperAgentReport = parseSuperAgentReportText(
      validReport({
        kind: 'waiting',
        question: '采用哪种方案？',
        askedBy: 'input-1',
        details: '两种方案各有取舍',
        artifacts: ['src/a.ts'],
      }),
    )
    expect(parsed.question).toBe('采用哪种方案？')
    expect(parsed.askedBy).toBe('input-1')
    expect(parsed.details).toBe('两种方案各有取舍')
    expect(parsed.artifacts).toEqual(['src/a.ts'])
    expect(parsed.answers).toEqual([])
    // 非 progress 类不携带进度事实
    expect(parsed.progress).toBeNull()
  })

  it('normalizes progress facts with currentTool/toolCalls/elapsedMs', () => {
    const parsed = parseSuperAgentReportText(
      validReport({ currentTool: 'Edit', toolCalls: 7, elapsedMs: 12345 }),
    )
    expect(parsed.progress).toEqual({
      currentTool: 'Edit',
      toolCalls: 7,
      elapsedMs: 12345,
    })
  })

  it('keeps the raw block text for audit (原文保留)', () => {
    const raw = JSON.stringify({
      assignmentId: 'assignment-1',
      reportId: 'report-1',
      kind: 'progress',
      summary: 's',
    })
    const parsed = parseSuperAgentReportText(`\`\`\`${SUPER_AGENT_REPORT_FENCE}\n${raw}\n\`\`\``)
    expect(parsed.raw).toBe(raw)
  })

  it('omits absent optional fields as documented defaults', () => {
    const parsed = parseSuperAgentReportText(validReport())
    expect(parsed.question).toBeNull()
    expect(parsed.askedBy).toBeNull()
    expect(parsed.details).toBeNull()
    expect(parsed.artifacts).toEqual([])
    expect(parsed.answers).toEqual([])
  })
})
