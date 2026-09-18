import { describe, expect, it } from 'vitest'
import { defineNamespace, channelNames, eventChannels, eventChannelsBySuffix } from './channelMap'

const ns = defineNamespace({
  channels: {
    getStatus: { req: [] as unknown as [id: string], res: null as unknown as { running: boolean } },
    notifySourceChanged: { req: [] as unknown as [source: string], res: undefined, channel: 'sourceChanged' },
    fire: { kind: 'send', req: [] as unknown as [id: string] },
  },
  events: {
    onData: { channel: 'data', args: [] as unknown as [id: string] },
    onExit: { channel: 'exit', args: [] as unknown as [code: number] },
    onEngineSourceChanged: { channel: 'engineSourceChanged', args: [] as unknown as [source: string] },
  },
})

describe('channelNames', () => {
  it('派生名 = 前缀 + 方法名（与 preload bridge 的 wire 名一致）', () => {
    const names = channelNames(ns.channels, 'test:')
    expect(names.getStatus).toBe('test:getStatus')
    expect(names.fire).toBe('test:fire')
  })

  it('channel 覆盖字段为后缀，派生名同样拼前缀', () => {
    const names = channelNames(ns.channels, 'test:')
    expect(names.notifySourceChanged).toBe('test:sourceChanged')
  })

  it('与 eventChannels 的前缀语义对称', () => {
    const eventNames = eventChannels(ns.events, 'test:')
    expect(eventNames.onData).toBe('test:data')
  })
})

describe('eventChannelsBySuffix', () => {
  it('按 channel 后缀反查完整事件 channel 名', () => {
    const bySuffix = eventChannelsBySuffix(ns.events, 'test:')
    expect(bySuffix['data']).toBe('test:data')
    expect(bySuffix['exit']).toBe('test:exit')
    expect(bySuffix['engineSourceChanged']).toBe('test:engineSourceChanged')
  })

  it('与 eventChannels 的结果一致（同一真相源）', () => {
    const names = eventChannels(ns.events, 'test:')
    const bySuffix = eventChannelsBySuffix(ns.events, 'test:')
    expect(Object.values(names).every((name) => bySuffix[name.slice('test:'.length)] === name)).toBe(true)
  })

  it('未知后缀返回 undefined', () => {
    const bySuffix = eventChannelsBySuffix(ns.events, 'test:')
    expect(bySuffix['nonexistent']).toBeUndefined()
  })
})
