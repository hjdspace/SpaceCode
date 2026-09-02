import { describe, it, expect } from 'vitest'
import {
  buildInitialGoalPrompt,
  buildContinuationPrompt,
  parseGoalMarkers,
  MAX_GOAL_TURNS,
  BLOCKED_ATTEMPT_THRESHOLD,
} from '@/lib/goalPrompts'

describe('goalPrompts — prompt builders', () => {
  it('初始提示词包含目标、审计规则与 XML 包裹', () => {
    const prompt = buildInitialGoalPrompt('修复登录页面的 bug')

    expect(prompt).toContain('<goal-steering type="objective_updated">')
    expect(prompt).toContain('</goal-steering>')
    expect(prompt).toContain('修复登录页面的 bug')
    expect(prompt).toContain('<goal-complete>')
    expect(prompt).toContain('<goal-blocked>reason</goal-blocked>')
    expect(prompt).toContain('Completion Audit')
  })

  it('续跑提示词包含目标与轮数进度', () => {
    const prompt = buildContinuationPrompt({
      objective: '写单元测试',
      status: 'active',
      turnsExecuted: 7,
    })

    expect(prompt).toContain('<goal-steering type="continuation">')
    expect(prompt).toContain('写单元测试')
    expect(prompt).toContain(`7 / ${MAX_GOAL_TURNS}`)
  })

  it('常量与引擎侧保持一致', () => {
    expect(MAX_GOAL_TURNS).toBe(150)
    expect(BLOCKED_ATTEMPT_THRESHOLD).toBe(3)
  })
})

describe('goalPrompts — parseGoalMarkers', () => {
  it('空文本不触发任何标记', () => {
    expect(parseGoalMarkers('')).toEqual({ complete: false })
    expect(parseGoalMarkers('普通工作汇报，没有标记')).toEqual({ complete: false })
  })

  it('独立成行的 <goal-complete> 被识别', () => {
    const text = '所有测试已通过。\n<goal-complete>\n'
    expect(parseGoalMarkers(text).complete).toBe(true)
  })

  it('行内（非独立成行）的 <goal-complete> 不触发', () => {
    const text = '下一行的说明是 <goal-complete> 标记的用法'
    expect(parseGoalMarkers(text).complete).toBe(false)
  })

  it('允许前后有空白字符', () => {
    const text = 'done\n  <goal-complete>  '
    expect(parseGoalMarkers(text).complete).toBe(true)
  })

  it('<goal-blocked>reason</goal-blocked> 提取阻塞原因', () => {
    const text = '无法继续。\n<goal-blocked>缺少 API key</goal-blocked>'
    const markers = parseGoalMarkers(text)
    expect(markers.complete).toBe(false)
    expect(markers.blockedReason).toBe('缺少 API key')
  })

  it('空 reason 视为无阻塞原因但标记仍存在', () => {
    const text = '<goal-blocked></goal-blocked>'
    const markers = parseGoalMarkers(text)
    expect(markers.blockedReason).toBeUndefined()
    // blockedReason 为 undefined 时调用方按"无 blocked 标记"处理，
    // 因此这里只需保证不抛错且 complete 为 false。
    expect(markers.complete).toBe(false)
  })

  it('代码块中的标记文本同样按行首规则解析（保守设计）', () => {
    // 标记在行首即视为有效信号——提示词明确要求最后一行输出，
    // 代码块中出现行首标记的概率极低，保守按有效处理。
    const text = '```\n<goal-complete>\n```'
    expect(parseGoalMarkers(text).complete).toBe(true)
  })
})
