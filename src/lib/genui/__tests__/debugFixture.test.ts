import { describe, it, expect } from 'vitest'
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import { createGenuiDebugApi } from '../debugFixture'
import type { GenuiCardRecord } from '@/types/genui'

const LABELS = { title: 'GenUI 沙箱自检', rows: [{ label: '承载方式', value: '独立 origin 的 iframe' }] }

function withCollector(append: (card: GenuiCardRecord) => boolean = () => true) {
  const cards: GenuiCardRecord[] = []
  const api = createGenuiDebugApi({
    appendFixtureMessage: (card) => {
      cards.push(card)
      return append(card)
    },
    fixtureLabels: () => LABELS,
  })
  return { api, cards }
}

describe('内置 fixture 卡片', () => {
  it('注入的卡片带沙箱协议版本与内置 Schema', () => {
    const { api, cards } = withCollector()
    const result = api.addFixtureCard()

    expect(result.ok).toBe(true)
    expect(cards[0]).toEqual({
      id: 'genui-debug:card:1',
      protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
      schema: { componentName: 'FixtureCard', title: LABELS.title, rows: LABELS.rows },
    })
  })

  it('重复调用产生互不相同的卡片，便于连点观察', () => {
    const { api, cards } = withCollector()
    api.addFixtureCard()
    api.addFixtureCard()
    expect(new Set(cards.map((card) => card.id)).size).toBe(2)
  })

  it('没有可写入的会话时给出原因而不是静默失败', () => {
    const { api } = withCollector(() => false)
    expect(api.addFixtureCard()).toEqual({ ok: false, reason: 'no-active-session' })
  })
})
