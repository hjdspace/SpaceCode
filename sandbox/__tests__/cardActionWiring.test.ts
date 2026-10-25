/**
 * 沙箱侧动作接线（票 03）。
 *
 * 官方渲染器把 schema 里的 action 交给 `customActions[name].execute(params, context)`；
 * 这里钉住四个白名单动作从渲染器参数到宿主协议消息的规范化：文本/URL 两处都接受
 * 字符串或对象两种写法，缺值时不发动作 —— 校验与拒绝由宿主桥负责。
 */
import { describe, it, expect, vi } from 'vitest'
import { createSandboxCardActions } from '../cardActionWiring'

function setup() {
  const request = vi.fn()
  const actions = createSandboxCardActions(request)
  return { request, actions }
}

describe('沙箱动作接线', () => {
  it('copy 接受字符串或 { text }，统一成 payload.text', () => {
    const { request, actions } = setup()

    actions.copy.execute('剪贴文本', {})
    actions.copy.execute({ text: '另一段' }, {})

    expect(request).toHaveBeenNthCalledWith(1, { action: 'copy', payload: { text: '剪贴文本' } })
    expect(request).toHaveBeenNthCalledWith(2, { action: 'copy', payload: { text: '另一段' } })
  })

  it('copy 拿不到字符串时不发动作', () => {
    const { request, actions } = setup()

    actions.copy.execute({ text: 42 }, {})
    actions.copy.execute(undefined, {})

    expect(request).not.toHaveBeenCalled()
  })

  it('openLink 接受字符串或 { url }', () => {
    const { request, actions } = setup()

    actions.openLink.execute('https://example.com', {})
    actions.openLink.execute({ url: 'https://x.dev/docs' }, {})

    expect(request).toHaveBeenNthCalledWith(1, { action: 'openLink', payload: { url: 'https://example.com' } })
    expect(request).toHaveBeenNthCalledWith(2, { action: 'openLink', payload: { url: 'https://x.dev/docs' } })
  })

  it('openLink 拿不到 URL 时不发动作', () => {
    const { request, actions } = setup()

    actions.openLink.execute({ url: 1 }, {})
    actions.openLink.execute(undefined, {})

    expect(request).not.toHaveBeenCalled()
  })

  it('submit 把对象参数原样作为 payload，非对象给空对象', () => {
    const { request, actions } = setup()

    actions.submit.execute({ name: 'Ada', agree: true }, {})
    actions.submit.execute('raw', {})

    expect(request).toHaveBeenNthCalledWith(1, {
      action: 'submit',
      payload: { name: 'Ada', agree: true },
    })
    expect(request).toHaveBeenNthCalledWith(2, { action: 'submit', payload: {} })
  })

  it('expand 只发动作名，不带 payload', () => {
    const { request, actions } = setup()

    actions.expand.execute(undefined, {})

    expect(request).toHaveBeenCalledWith({ action: 'expand' })
  })
})
