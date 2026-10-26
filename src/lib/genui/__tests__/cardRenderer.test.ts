/**
 * 卡片渲染编排（票 02 第 5、8 条的宿主可见面）。
 *
 * 官方物料在 jsdom 里装不起来（依赖链上有模块导入期就摸 DOM），所以这里注入替身，
 * 只钉住属于我们的行为：schema 交给渲染实现、主题与语言推送不重建应用、失败与高度
 * 各自只上报一次。真实物料渲染按 PRD 归手工验收矩阵。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { h, nextTick, defineComponent, type VNode } from 'vue'
import {
  mountGenuiCard,
  type CardRenderContext,
  type MountedCard,
  type ResizeObserverLike,
} from '../cardRenderer'

function fakeObserver() {
  let callback: (() => void) | null = null
  const state = { observed: 0, disconnected: 0 }
  const observer: ResizeObserverLike & { fire: () => void; state: typeof state } = {
    state,
    observe: () => { state.observed += 1 },
    disconnect: () => { state.disconnected += 1 },
    /** 模拟沙箱内容变化触发的一次 observe 回调 */
    fire: () => callback?.(),
  }
  return { observer, factory: (cb: () => void) => { callback = cb; return observer } }
}

type MountOptions = {
  render?: (context: CardRenderContext) => VNode
  height?: number
}

function mountCard(schema: Record<string, unknown>, options: MountOptions = {}) {
  const container = document.createElement('div')
  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: options.height ?? 0 })
  document.body.appendChild(container)

  const { observer, factory } = fakeObserver()
  const contexts: CardRenderContext[] = []
  const onError = vi.fn()
  const onResize = vi.fn()
  const onAction = vi.fn()
  const render = options.render ?? ((ctx) => h('div', { class: 'fake-card' }, JSON.stringify(ctx.schema)))

  const card: MountedCard = mountGenuiCard(
    container,
    schema,
    { theme: 'light', locale: 'zh-CN' },
    { onError, onResize, onAction },
    {
      render: (ctx) => {
        contexts.push(ctx)
        return render(ctx)
      },
      observerFactory: factory,
    },
  )

  return { container, card, contexts, observer, onError, onResize, onAction }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('把卡片交给渲染实现', () => {
  it('挂载后容器里出现渲染结果，schema 原样传进去', () => {
    const { container, contexts } = mountCard({ componentName: 'TinyButton', props: { text: '提交' } })

    expect(container.querySelector('.fake-card')).not.toBeNull()
    expect(contexts[0].schema).toEqual({ componentName: 'TinyButton', props: { text: '提交' } })
    expect(container.textContent).toContain('TinyButton')
  })

  it('主题与语言推送只改注入值，不重建渲染应用', async () => {
    const { container, card, contexts } = mountCard({ componentName: 'TinyButton' })
    const rootBefore = container.firstElementChild

    card.applyAppearance({ theme: 'dark', locale: 'en-US' })
    await nextTick()

    expect(container.firstElementChild).toBe(rootBefore)
    expect(contexts[contexts.length - 1].appearance).toMatchObject({ theme: 'dark', locale: 'en-US' })
  })
})

describe('卡片动作', () => {
  it('注入实现发起动作时，请求经 hooks 交给沙箱文档', () => {
    const { onAction } = mountCard({ componentName: 'TinyForm' }, {
      render: (ctx) => {
        ctx.requestAction('copy', { text: '你好' })
        return h('div')
      },
    })

    expect(onAction).toHaveBeenCalledWith({ action: 'copy', payload: { text: '你好' } })
  })

  it('expand 没有 payload 时请求里也不带 payload 字段', () => {
    const { onAction } = mountCard({ componentName: 'TinyForm' }, {
      render: (ctx) => {
        ctx.requestAction('expand')
        return h('div')
      },
    })

    expect(onAction).toHaveBeenCalledWith({ action: 'expand' })
  })
})

describe('失败上报', () => {
  it('渲染实现自己判定失败时只上报一次', async () => {
    const { card, onError } = mountCard({ componentName: 'TinyForm' }, {
      render: (ctx) => {
        ctx.notifyFailure()
        return h('div')
      },
    })
    await nextTick()
    card.applyAppearance({ theme: 'dark', locale: 'zh-CN' })
    await nextTick()

    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('物料渲染抛错同样落到这张卡的错误上报', async () => {
    const { onError } = mountCard({ componentName: 'TinyGrid' }, {
      render: () => {
        throw new Error('material boom')
      },
    })
    await nextTick()

    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('卸载之后迟到的失败不再打扰宿主', async () => {
    // 失败在卸载之后才落进来：Vue 会在 mount 末尾同步 flush 前置回调，
    // 同一帧内的失败本来就该上报，所以这里把它推到下一个微任务。
    const { card, onError } = mountCard({ componentName: 'TinyForm' }, {
      render: (ctx) => {
        void Promise.resolve().then(() => ctx.notifyFailure())
        return h('div')
      },
    })
    card.dispose()
    await nextTick()
    await Promise.resolve()

    expect(onError).not.toHaveBeenCalled()
  })
})

describe('高度上报', () => {
  it('首帧量到高度就上报，重复的相同值不再打扰宿主', async () => {
    const { observer, onResize } = mountCard({ componentName: 'TinyButton' }, { height: 320 })
    await nextTick()
    for (let i = 0; i < 3; i += 1) observer.fire()

    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith(320)
  })

  it('内容长高时再报一次新高度', async () => {
    const container = document.createElement('div')
    let height = 200
    Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => height })
    document.body.appendChild(container)

    const { observer, factory } = fakeObserver()
    const onResize = vi.fn()
    mountGenuiCard(
      container,
      { componentName: 'TinyButton' },
      { theme: 'light', locale: 'zh-CN' },
      { onError: () => {}, onResize },
      { render: () => h('div'), observerFactory: factory },
    )
    await nextTick()
    height = 540
    observer.fire()

    expect(onResize).toHaveBeenLastCalledWith(540)
  })

  it('量不到高度（0 高）时不报，避免宿主把 iframe 收成一条线', async () => {
    const { onResize } = mountCard({ componentName: 'TinyButton' }, { height: 0 })
    await nextTick()

    expect(onResize).not.toHaveBeenCalled()
  })
})

describe('卸载', () => {
  it('dispose 摘掉观察器、卸载 DOM，且重复调用安全', () => {
    const { container, card, observer } = mountCard({ componentName: 'TinyButton' }, { height: 120 })

    card.dispose()
    card.dispose()

    expect(container.innerHTML).toBe('')
    expect(observer.state.observed).toBe(1)
    expect(observer.state.disconnected).toBe(1)
  })

  it('渲染实现可以是异步组件，失败前不报错', async () => {
    const Lazy = defineComponent({
      name: 'Lazy',
      setup: () => () => h('p', '懒加载内容'),
    })
    const { container } = mountCard({ componentName: 'TinyCard' }, { render: () => h(Lazy) })

    expect(container.textContent).toContain('懒加载内容')
  })
})
