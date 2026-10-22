import { describe, expect, it } from 'vitest'
import { localizePlanActionBlock, localizePlanActionText } from '@/lib/planActionL10n'

/**
 * pi-plan-mode 固定文案的宿主侧本地化。钉两条纪律：
 *   1. 只有已知精确字符串才有译文 —— 未知的（模型自由生成、未来版本措辞）原样透传；
 *   2. 非 zh-CN 一律原样 —— 应答值永远走原文，译文只存在于显示层。
 */
describe('localizePlanActionText 整串精确匹配', () => {
  it('zh-CN 下已知标题与选项给译文', () => {
    expect(localizePlanActionText('Proposed plan ready. What next?', 'zh-CN')).toBe('计划已就绪，接下来做什么？')
    expect(localizePlanActionText('Implement here', 'zh-CN')).toBe('在本会话实施')
    expect(localizePlanActionText('Stay in Plan mode', 'zh-CN')).toBe('留在计划模式')
    expect(localizePlanActionText('Discard plan and exit', 'zh-CN')).toBe('放弃计划并退出')
  })

  it('省略号两种形态（U+2026 与三点）都映射', () => {
    expect(localizePlanActionText('Export plan…', 'zh-CN')).toBe('导出计划…')
    expect(localizePlanActionText('Export plan...', 'zh-CN')).toBe('导出计划…')
  })

  it('未知字符串原样透传（不猜语义）', () => {
    const unknown = 'Deploy to production'
    expect(localizePlanActionText(unknown, 'zh-CN')).toBe(unknown)
  })

  it('非 zh-CN locale 一律原样', () => {
    expect(localizePlanActionText('Implement here', 'en-US')).toBe('Implement here')
  })
})

describe('localizePlanActionBlock 逐行映射', () => {
  it('title 整段（标题 + 说明行）逐行换译文，未知行保留', () => {
    const title = [
      'Proposed plan ready. What next?',
      'Implement here keeps this planning conversation.',
      'Start fresh transfers only the approved plan to a new session.',
      'Plan reinjection: Off; use conversation history only.',
    ].join('\n')

    const localized = localizePlanActionBlock(title, 'zh-CN')

    expect(localized).toContain('计划已就绪，接下来做什么？')
    expect(localized).toContain('「在本会话实施」将继续当前的规划对话。')
    expect(localized).toContain('「转到新会话实施」只会把已批准的计划带进一个新会话。')
    expect(localized).toContain('计划回注：关闭，仅使用对话历史。')
    expect(localized).not.toContain('Proposed plan ready')
  })

  it('混合未知行时不丢行、顺序不变', () => {
    const localized = localizePlanActionBlock('Proposed plan ready. What next?\nSome future line', 'zh-CN')
    expect(localized).toBe('计划已就绪，接下来做什么？\nSome future line')
  })

  it('非 zh-CN locale 原样返回', () => {
    const title = 'Proposed plan ready. What next?\nImplement here keeps this planning conversation.'
    expect(localizePlanActionBlock(title, 'en-US')).toBe(title)
  })
})
