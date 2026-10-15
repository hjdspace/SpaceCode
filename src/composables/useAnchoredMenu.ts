/**
 * useAnchoredMenu - 给 Teleport 到 body 的下拉浮层算视口坐标。
 *
 * 就地 absolute 的浮层会被宿主链上的 overflow: hidden（中心栏）裁掉、被
 * container-type（输入卡）创建的层叠上下文困住，从而落在右侧面板下方。
 * 组件侧配套：浮层包进 <Teleport to="body">，绑定 menuStyle / menuRef，
 * 并把 menuRef 计入 outside-click 判断（浮层已不在触发元素子树内）。
 */
import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import { placeAnchoredMenu } from '@/utils/menuPosition'

interface AnchoredMenuOptions {
  /** 菜单理想宽度 (px)，超出视口时按视口收窄 */
  width: number
  /** 菜单与触发元素的间距 (px) */
  gap?: number
  /** 菜单理想最大高度 (px)，按视口可用空间再收窄 */
  maxHeight?: number
}

const DEFAULT_GAP = 8
const DEFAULT_MAX_HEIGHT = 400

export function useAnchoredMenu(
  anchorRef: Ref<HTMLElement | null>,
  open: Ref<boolean>,
  options: AnchoredMenuOptions
): { menuRef: Ref<HTMLElement | null>; menuStyle: ComputedRef<Record<string, string>> } {
  const menuRef = ref<HTMLElement | null>(null)
  // 让 menuStyle 在窗口缩放/任意容器滚动时重读触发元素的位置
  const remeasureTick = ref(0)

  function remeasure() {
    remeasureTick.value += 1
  }

  function listen() {
    window.addEventListener('resize', remeasure)
    window.addEventListener('scroll', remeasure, true)
  }

  function unlisten() {
    window.removeEventListener('resize', remeasure)
    window.removeEventListener('scroll', remeasure, true)
  }

  watch(open, (isOpen) => (isOpen ? listen() : unlisten()), { immediate: true })
  onScopeDispose(unlisten)

  const menuStyle = computed<Record<string, string>>(() => {
    if (!open.value) return {}
    void remeasureTick.value
    const anchor = anchorRef.value
    if (!anchor) return {}

    const rect = anchor.getBoundingClientRect()
    const placement = placeAnchoredMenu(
      { left: rect.left, top: rect.top, bottom: rect.bottom },
      {
        width: options.width,
        gap: options.gap ?? DEFAULT_GAP,
        maxHeight: options.maxHeight ?? DEFAULT_MAX_HEIGHT,
      },
      { width: window.innerWidth, height: window.innerHeight }
    )

    const style: Record<string, string> = {
      position: 'fixed',
      left: `${placement.left}px`,
      width: `${placement.width}px`,
      'max-height': `${placement.maxHeight}px`,
    }
    style[placement.side] = `${placement.offset}px`
    return style
  })

  return { menuRef, menuStyle }
}
