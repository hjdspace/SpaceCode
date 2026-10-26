import { describe, it, expect } from 'vitest'
import {
  GENUI_MAX_CARD_SCHEMA_BYTES,
  GENUI_MAX_CARDS_PER_MESSAGE,
  mergeGenuiCardRecords,
  projectGenuiCards,
} from '../cardProjection'
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'

const M = 'm1'

const byteLen = (value: string): number => new TextEncoder().encode(value).length

/** 拼一个围栏：info 默认 schemaJson，默认闭合。 */
function fence(body: string, info = 'schemaJson', open = '```', close = '```'): string {
  return [`${open}${info}`, body, close].join('\n')
}

const formCard = (title: string) => JSON.stringify({ componentName: 'TinyForm', props: { title } })

describe('闭合围栏识别', () => {
  it('单卡：正文只剩空串，卡片记录带确定性 id 与协议版本', () => {
    const out = projectGenuiCards(fence(formCard('A')), M, { final: true })

    expect(out.text).toBe('')
    expect(out.fallbacks).toEqual([])
    expect(out.cards).toEqual([
      {
        id: `${M}:card:0`,
        protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
        // 根节点是 TinyForm：渲染器会把它画成一个 div，所以宿主先包一层容器再交给沙箱
        schema: {
          componentName: 'div',
          children: [{ componentName: 'TinyForm', props: { title: 'A' } }],
        },
      },
    ])
  })

  it('围栏前后散文保留，移除后不留下多余空行', () => {
    const raw = ['先解释一句', '', fence(formCard('A')), '', '再补一句'].join('\n')
    const out = projectGenuiCards(raw, M, { final: true })

    expect(out.text).toBe('先解释一句\n\n再补一句')
    expect(out.cards).toHaveLength(1)
  })

  it('多卡按围栏顺序排列，散文穿插保留', () => {
    const raw = [
      '第一段时间',
      fence(formCard('A')),
      '第二段说明',
      fence(JSON.stringify({ componentName: 'TinyButton', props: { text: '点我' } })),
      '收尾',
    ].join('\n\n')
    const out = projectGenuiCards(raw, M, { final: true })

    expect(out.cards.map(c => c.id)).toEqual([`${M}:card:0`, `${M}:card:1`])
    expect(out.text).toBe('第一段时间\n\n第二段说明\n\n收尾')
  })

  it('CRLF 与围栏行的行尾空格都不影响识别', () => {
    const raw = `说明\r\n${fence(formCard('A'))}\r\n`
    const out = projectGenuiCards(raw, M, { final: true })

    expect(out.cards).toHaveLength(1)
    expect(out.text).toBe('说明')
  })

  it('围栏内出现空行不截断卡片体', () => {
    const body = '{\n  "componentName": "TinyCard",\n\n  "props": { "title": "带空行" }\n}'
    const out = projectGenuiCards(fence(body), M, { final: true })

    expect(out.cards[0]?.schema).toEqual({
      componentName: 'div',
      children: [{ componentName: 'TinyCard', props: { title: '带空行' } }],
    })
  })
})

/**
 * 渲染器把根节点一律当「Page」处理：不管 componentName 写什么，画出来都是一个 div，
 * props 漏成 DOM 属性。所以根节点写 TinyCard / TinyForm 的卡会丢掉整层外壳 ——
 * 宿主必须替它包一层，把组件身份挪到 children 里。
 */
describe('非 div 根节点归一', () => {
  it('div 根节点原样透传，不多包一层', () => {
    const schema = { componentName: 'div', children: [{ componentName: 'p', children: 'hi' }] }
    const out = projectGenuiCards(fence(JSON.stringify(schema)), M, { final: true })

    expect(out.cards[0].schema).toEqual(schema)
  })

  it('页面级字段上提到新容器，state 绑定不会因为多包一层而失效', () => {
    const schema = {
      componentName: 'TinyForm',
      state: { env: 'prod' },
      methods: { onGo: { type: 'JSFunction', value: 'function(){}' } },
      css: '.x{padding:8px}',
      props: { labelWidth: '80px' },
      children: [{ componentName: 'TinyInput' }],
    }
    const out = projectGenuiCards(fence(JSON.stringify(schema)), M, { final: true })

    expect(out.cards[0]?.schema).toEqual({
      componentName: 'div',
      state: schema.state,
      methods: schema.methods,
      css: schema.css,
      children: [
        {
          componentName: 'TinyForm',
          props: schema.props,
          children: schema.children,
        },
      ],
    })
  })

  it('白名单判的是模型真正写出来的根组件名，不是包好之后的 div', () => {
    const rejected = projectGenuiCards(fence(JSON.stringify({ componentName: 'Page' })), M, { final: true })
    expect(rejected.cards).toHaveLength(0)
    expect(rejected.fallbacks[0]?.reason).toBe('unsupported-component')

    // 归一之后的形状对宿主与沙箱都是可渲染的
    const accepted = projectGenuiCards(fence(JSON.stringify({ componentName: 'TinyCard' })), M, { final: true })
    expect(accepted.cards[0]).toMatchObject({ schema: { componentName: 'div' } })
  })

  it('协议版本仍然按原始 schema 判定，归一不会把它带到 wrapper 上', () => {
    const out = projectGenuiCards(
      fence(JSON.stringify({ componentName: 'TinyCard', protocolVersion: 99 })),
      M,
      { final: true },
    )

    expect(out.cards).toHaveLength(0)
    expect(out.fallbacks[0]?.reason).toBe('protocol-version')
  })
})

describe('非 schemaJson 围栏一律不动', () => {
  it.each(['json', 'ts', 'javascript', '', 'schemajson', 'SchemaJson', 'schemaJson extra'])(
    '语言标记 %j 的围栏原样保留',
    info => {
      const raw = ['前', fence('{"componentName":"TinyForm"}', info), '后'].join('\n\n')
      const out = projectGenuiCards(raw, M, { final: true })

      expect(out.cards).toEqual([])
      expect(out.fallbacks).toEqual([])
      expect(out.text).toBe(raw)
    },
  )

  it('缩进的 schemaJson 围栏按普通文本处理', () => {
    const raw = ['```schemaJson', formCard('A'), '```'].join('\n')
      .split('\n')
      .map(line => `  ${line}`)
      .join('\n')
    const out = projectGenuiCards(raw, M, { final: true })

    expect(out.cards).toEqual([])
    expect(out.text).toBe(raw)
  })

  it('行内出现 schemaJson 字样不开启围栏', () => {
    const raw = '请用 ```schemaJson 包裹卡片'
    const out = projectGenuiCards(raw, M, { final: true })

    expect(out.cards).toEqual([])
    expect(out.text).toBe(raw)
  })

  it('四反引号开栏需要等长或更长的反引号行才闭合', () => {
    const body = formCard('A')
    const closed = projectGenuiCards(fence(body, 'schemaJson', '````', '````'), M, { final: true })
    const unterminated = projectGenuiCards(fence(body, 'schemaJson', '````', '```'), M, { final: true })

    expect(closed.cards).toHaveLength(1)
    expect(closed.text).toBe('')
    // 三反引号不足以闭合四反引号围栏：收口时按代码块显示
    expect(unterminated.cards).toEqual([])
    expect(unterminated.text).toBe(fence(body, 'schemaJson', '````', '```'))
  })
})

describe('未闭合围栏', () => {
  it('流式期间从可见文本隐藏，且不生成卡片', () => {
    const raw = ['说明', '', fence(formCard('A')).split('\n').slice(0, 2).join('\n')].join('\n')
    const out = projectGenuiCards(raw, M, { final: false })

    expect(out.text).toBe('说明')
    expect(out.cards).toEqual([])
    expect(out.fallbacks).toEqual([])
  })

  it('未闭合围栏之后的散文一并隐藏，避免半个卡片里夹正文', () => {
    const raw = ['开头', '```schemaJson', '{"componentName": "TinyForm"', '后面的说明'].join('\n')
    const out = projectGenuiCards(raw, M, { final: false })

    expect(out.text).toBe('开头')
  })

  it('收口时仍未闭合则整段按普通代码块显示', () => {
    const raw = ['开头', '', '```schemaJson', '{"componentName": "TinyForm"'].join('\n')
    const out = projectGenuiCards(raw, M, { final: true })

    expect(out.cards).toEqual([])
    expect(out.fallbacks).toEqual([])
    expect(out.text).toBe(raw)
  })

  it('闭合之后卡片照常出现，同一条消息里的未闭合部分隐藏', () => {
    const raw = [fence(formCard('A')), '', '```schemaJson', '{"componentName": "TinyButton"'].join('\n')
    const out = projectGenuiCards(raw, M, { final: false })

    expect(out.cards.map(c => c.id)).toEqual([`${M}:card:0`])
    expect(out.text).toBe('')
  })
})

describe('畸形与不合法 schema 降级为文本', () => {
  it.each([
    ['malformed-json', '{componentName: TinyForm,}'],
    ['malformed-json', ''],
    ['malformed-json', '   '],
    ['not-an-object', '[{"componentName":"TinyForm"}]'],
    ['not-an-object', '"只是字符串"'],
    ['not-an-object', 'null'],
    ['missing-component-name', '{"props":{"title":"没有根组件"}}'],
    ['missing-component-name', '{"componentName":123}'],
    ['missing-component-name', '{"componentName":"  "}'],
    ['unsupported-component', '{"componentName":"TinyHuichartsBar"}'],
    ['unsupported-component', '{"componentName":"MyCustomCard"}'],
  ])('%s: %j 的围栏留在正文并给出可见原因', (reason, body) => {
    const raw = ['说明', '', fence(body)].join('\n')
    const out = projectGenuiCards(raw, M, { final: true })

    expect(out.cards).toEqual([])
    expect(out.fallbacks).toHaveLength(1)
    expect(out.fallbacks[0]).toMatchObject({ id: `${M}:fallback:0`, reason })
    // 原文不丢：围栏仍在可见正文里
    expect(out.text).toContain(body.trim())
    expect(out.text).toContain('说明')
  })

  it('协议版本由 schema 声明且与宿主不一致时降级', () => {
    const body = JSON.stringify({ componentName: 'TinyForm', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION + 1 })
    const out = projectGenuiCards(fence(body), M, { final: true })

    expect(out.cards).toEqual([])
    expect(out.fallbacks[0]).toMatchObject({ reason: 'protocol-version' })
  })

  it('协议版本一致时卡片带该版本', () => {
    const body = JSON.stringify({ componentName: 'TinyForm', protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION })
    const out = projectGenuiCards(fence(body), M, { final: true })

    expect(out.cards[0].protocolVersion).toBe(GENUI_SANDBOX_PROTOCOL_VERSION)
  })
})

describe('限额', () => {
  const oversized = JSON.stringify({ componentName: 'TinyCard', props: { text: 'x'.repeat(GENUI_MAX_CARD_SCHEMA_BYTES) } })

  it('单卡超过 64KB 降级为文本并说明原因', () => {
    const out = projectGenuiCards(fence(oversized), M, { final: true })

    expect(out.cards).toEqual([])
    expect(out.fallbacks[0]).toMatchObject({ reason: 'oversized-schema' })
  })

  it('刚好等于限额的单卡仍然放行', () => {
    const shell = JSON.stringify({ componentName: 'TinyCard', props: { text: '' } })
    const body = JSON.stringify({ componentName: 'TinyCard', props: { text: 'x'.repeat(GENUI_MAX_CARD_SCHEMA_BYTES - byteLen(shell)) } })
    expect(byteLen(body)).toBe(GENUI_MAX_CARD_SCHEMA_BYTES)

    expect(projectGenuiCards(fence(body), M, { final: true }).cards).toHaveLength(1)
  })

  it('第 9 张卡起降级为文本，前 8 张正常成卡', () => {
    const raw = Array.from({ length: GENUI_MAX_CARDS_PER_MESSAGE + 1 }, (_, i) => fence(formCard(`C${i}`))).join('\n\n')
    const out = projectGenuiCards(raw, M, { final: true })

    expect(out.cards).toHaveLength(GENUI_MAX_CARDS_PER_MESSAGE)
    expect(out.fallbacks).toEqual([{ id: `${M}:fallback:8`, reason: 'too-many-cards', componentName: 'TinyForm' }])
  })

  it('超限与降级都计入可见提示，不静默丢弃', () => {
    const raw = [fence('{"componentName":"Nope"}'), fence(formCard('A')), fence(oversized)].join('\n\n')
    const out = projectGenuiCards(raw, M, { final: true })

    expect(out.cards.map(c => c.id)).toEqual([`${M}:card:1`])
    expect(out.fallbacks.map(f => [f.id, f.reason])).toEqual([
      [`${M}:fallback:0`, 'unsupported-component'],
      [`${M}:fallback:2`, 'oversized-schema'],
    ])
  })
})

describe('幂等与重投影', () => {
  const mixed = ['开头', fence(formCard('A')), '中间', fence('{"componentName":"Nope"}'), '结尾'].join('\n\n')

  it('同样输入两次投影结果一致', () => {
    expect(projectGenuiCards(mixed, M, { final: true })).toEqual(projectGenuiCards(mixed, M, { final: true }))
  })

  it('正文移除成卡围栏后再投影，文本不再变化也不重复长卡', () => {
    const first = projectGenuiCards(mixed, M, { final: true })
    const second = projectGenuiCards(first.text, M, { final: true })

    expect(second.text).toBe(first.text)
    expect(second.cards).toEqual([])
    // 降级围栏的原文本来就留在正文里；序号跟着剩余围栏走，但内容不会丢
    expect(second.fallbacks).toHaveLength(first.fallbacks.length)
    expect(second.fallbacks[0].reason).toBe(first.fallbacks[0].reason)
  })

  it('已成卡的围栏从正文移除后，再投影不再产卡', () => {
    const onlyCards = [fence(formCard('A')), '说明', fence(formCard('B'))].join('\n\n')
    const scrubbed = projectGenuiCards(onlyCards, M, { final: true })

    expect(scrubbed.cards).toHaveLength(2)
    expect(projectGenuiCards(scrubbed.text, M, { final: true })).toEqual({
      text: scrubbed.text,
      cards: [],
      fallbacks: [],
    })
  })

  it('某张卡降级不改变其余卡的序号 id', () => {
    const before = projectGenuiCards([fence(formCard('A')), fence(formCard('B'))].join('\n\n'), M, { final: true })
    const after = projectGenuiCards(
      [fence(formCard('A')), fence('{"componentName":"Nope"}'), fence(formCard('B'))].join('\n\n'),
      M,
      { final: true },
    )

    expect(before.cards.map(c => c.id)).toEqual([`${M}:card:0`, `${M}:card:1`])
    expect(after.cards.map(c => c.id)).toEqual([`${M}:card:0`, `${M}:card:2`])
  })

  it('流式到收口期间 id 不变', () => {
    const streaming = projectGenuiCards(mixed, M, { final: false })
    const settled = projectGenuiCards(mixed, M, { final: true })

    expect(streaming.cards.map(c => c.id)).toEqual(settled.cards.map(c => c.id))
  })
})

describe('mergeGenuiCardRecords 按确定性 id 去重', () => {
  const card = (id: string, title = 'A') => ({ id, schema: { componentName: 'TinyForm', props: { title } }, protocolVersion: 1 })

  it('已有记录优先，重复投影不新增', () => {
    const existing = [card(`${M}:card:0`, '旧')]
    const merged = mergeGenuiCardRecords(existing, [card(`${M}:card:0`, '新'), card(`${M}:card:1`)])

    expect(merged).toHaveLength(2)
    expect(merged[0]?.schema?.props).toEqual({ title: '旧' })
    expect(merged[1]?.id).toBe(`${M}:card:1`)
  })

  it('没有既有记录时按注入顺序返回', () => {
    expect(mergeGenuiCardRecords(undefined, [card('b'), card('a')])).toEqual([card('b'), card('a')])
  })

  it('入参不被修改', () => {
    const existing = [card(`${M}:card:0`)]
    mergeGenuiCardRecords(existing, [card(`${M}:card:1`)])

    expect(existing).toHaveLength(1)
  })
})
