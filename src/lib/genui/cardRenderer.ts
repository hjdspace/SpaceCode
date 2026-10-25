/**
 * 卡片渲染的宿主侧编排（票 02）。
 *
 * 这个模块只管**编排**：把卡片渲染进容器、把主题/语言变化推下去、把失败与高度变化上报给
 * 桥。真正的物料渲染由调用方注入 —— 桌面沙箱注入官方 `GenuiRenderer + miniMaterials`
 * （`sandbox/cardMaterials.ts`），测试注入替身。官方 Vue 渲染器在 jsdom 里装不起来
 * （依赖链上有模块在导入期就摸 DOM），所以真实渲染按 PRD 归手工验收，CI 只钉这条编排缝。
 *
 * 两条失败路径汇到同一个上报口：物料渲染抛错（`onErrorCaptured`）与渲染器自己判定
 * schema 渲染失败（注入实现调用 `notifyFailure`）。宿主收到上报后只换这一张卡的占位。
 */
import {
  createApp,
  defineComponent,
  nextTick,
  onErrorCaptured,
  reactive,
  ref,
  watch,
  type App,
  type VNode,
} from 'vue'
import type { GenuiCardActionName, GenuiTheme } from '@/shared/genuiSandbox'

export type CardAppearance = { theme: GenuiTheme; locale: string }

/** 沙箱内发起、尚未经宿主桥校验的动作请求。 */
export type CardActionRequest = {
  action: GenuiCardActionName
  payload?: unknown
}

export type CardRendererHooks = {
  onError: () => void
  onResize: (height: number) => void
  /** 注入实现（官方 customActions）发起动作时上报；校验与执行在宿主一侧 */
  onAction?: (request: CardActionRequest) => void
}

export type MountedCard = {
  dispose: () => void
  applyAppearance: (appearance: CardAppearance) => void
}

/** ResizeObserver 的可注入形状：jsdom 没有实现，测试用假对象驱动高度上报。 */
export type ResizeObserverLike = {
  observe: (target: Element) => void
  disconnect: () => void
}

export type CardRenderContext = {
  schema: Record<string, unknown>
  /** 响应式的主题/语言；注入实现把它读进自己的组件属性即可跟随推送 */
  appearance: CardAppearance
  /** 注入实现发现渲染失败时调用（官方渲染器把错误算在插槽的 isError 上） */
  notifyFailure: () => void
  /** 注入实现把渲染器 action 转成动作请求的出口 */
  requestAction: (action: GenuiCardActionName, payload?: unknown) => void
}

export type CardRendererDeps = {
  render: (context: CardRenderContext) => VNode
  observerFactory?: (callback: () => void) => ResizeObserverLike
}

export function mountGenuiCard(
  container: HTMLElement,
  schema: Record<string, unknown>,
  appearance: CardAppearance,
  hooks: CardRendererHooks,
  deps: CardRendererDeps,
): MountedCard {
  const observerFactory = deps.observerFactory ?? ((callback) => new ResizeObserver(callback))
  const state = reactive<CardAppearance>({ ...appearance })
  const renderFailed = ref(false)

  const CardRoot = defineComponent({
    name: 'GenuiCardRoot',
    setup() {
      // 物料在**子组件**里抛错走这条路（Vue 的 errorCaptured 不捕获自己 render 里的异常）
      onErrorCaptured(() => {
        renderFailed.value = true
        return false
      })

      const context: CardRenderContext = {
        schema,
        appearance: state,
        notifyFailure: () => { renderFailed.value = true },
        requestAction: (action, payload) => {
          hooks.onAction?.(payload === undefined ? { action } : { action, payload })
        },
      }

      return () => {
        // 注入实现自己的 render 抛错必须由这里兜住：沙箱文档里没有第二个错误边界，
        // 漏出去就是一条未捕获异常 + 一张空白卡片，而不是宿主可见的错误态。
        try {
          return deps.render(context)
        } catch {
          renderFailed.value = true
          return null
        }
      }
    },
  })

  // 高度只在变化时上报：iframe 变高会再触发一次 observe，回同一个值没必要再问宿主
  let lastHeight = 0
  const reportHeight = () => {
    const height = Math.ceil(Math.max(container.scrollHeight, container.getBoundingClientRect().height))
    if (!Number.isFinite(height) || height <= 0 || height === lastHeight) return
    lastHeight = height
    hooks.onResize(height)
  }

  const app: App = createApp(CardRoot)

  let disposed = false
  // 监听必须建在 mount 之前：首次渲染里就失败（物料直接抛错）是最常见的一种，
  // 挂在 mount 之后再建就错过这次变化，卡片会停在空白而不是错误占位。
  const stopFailureWatch = watch(renderFailed, failed => {
    if (failed && !disposed) hooks.onError()
  })

  app.mount(container)

  const observer = observerFactory(reportHeight)
  observer.observe(container)
  void nextTick(reportHeight)

  return {
    dispose() {
      if (disposed) return
      disposed = true
      stopFailureWatch()
      observer.disconnect()
      app.unmount()
    },
    applyAppearance(next: CardAppearance) {
      state.theme = next.theme
      state.locale = next.locale
    },
  }
}
