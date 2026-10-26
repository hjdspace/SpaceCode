/**
 * jsdom 里的 IntersectionObserver 替身（票 05 组件用例）。
 *
 * jsdom 没有 IntersectionObserver，也没有视口。这里记下每个 observe() 的元素与回调，
 * 让用例手动「滚进 / 滚出」某张卡，断言宿主据此挂载或卸载 iframe —— 真实交叉面积、
 * rootMargin 行为归手工验收。
 */
type ObserverCallback = (
  entries: Array<{ isIntersecting: boolean; target: Element }>,
  observer: IntersectionObserver,
) => void

export type IntersectionObserverStub = {
  install: () => void
  uninstall: () => void
  /** 触发某个元素的可见性变化；element 为组件根节点 */
  trigger: (element: Element, isIntersecting: boolean) => void
  observedCount: () => number
}

export function createIntersectionObserverStub(): IntersectionObserverStub {
  const targets = new Map<Element, { observer: IntersectionObserver; callback: ObserverCallback }>()
  const ctor = function (this: IntersectionObserver, callback: ObserverCallback) {
    const observer = this as IntersectionObserver
    this.observe = (element: Element) => {
      targets.set(element, { observer, callback })
    }
    this.unobserve = (element: Element) => {
      if (targets.get(element)?.observer === observer) targets.delete(element)
    }
    // disconnect 也要把记账清掉：用例靠 observedCount 断言「卸载后不再被观察」
    this.disconnect = () => {
      for (const [element, entry] of [...targets]) {
        if (entry.observer === observer) targets.delete(element)
      }
    }
    this.takeRecords = () => []
  } as unknown as new (callback: ObserverCallback, options?: IntersectionObserverInit) => IntersectionObserver

  const stub = ctor as unknown as (typeof globalThis)['IntersectionObserver']

  return {
    install() {
      targets.clear()
      globalThis.IntersectionObserver = stub
    },
    uninstall() {
      targets.clear()
      delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
    },
    trigger(element, isIntersecting) {
      const entry = targets.get(element)
      if (!entry) throw new Error('该元素没有被 IntersectionObserver 观察')
      entry.callback([{ isIntersecting, target: element }], entry.observer)
    },
    observedCount() {
      return targets.size
    },
  }
}
