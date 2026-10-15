/**
 * 菜单定位: 保证菜单完整显示在视口内, 底部/右侧放不下时向上/向左翻转.
 *
 * 视口约定: x/y 是菜单左上角的期望位置 (clientX/clientY),
 * 若在视口内放不下整个菜单, 则将菜单底边/右边对齐到该点向上/向左展开.
 */

export const MENU_WIDTH = 200
export const VIEWPORT_MARGIN = 10

export interface MenuPosition {
  left: number
  top: number
}

export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number
): MenuPosition {
  const margin = VIEWPORT_MARGIN

  // 水平: 右侧放不下时向左收, 但不越过左边沿
  const left = Math.max(margin, Math.min(x, viewportWidth - menuWidth - margin))

  let top: number
  if (y + menuHeight <= viewportHeight - margin) {
    // 下方放得下: 就地展开, 但不越过上边沿
    top = Math.max(margin, y)
  } else if (menuHeight + 2 * margin <= viewportHeight) {
    // 下方放不下但视口装得下: 向上翻转, 底边对齐触发点并收进下边距
    top = Math.max(margin, Math.min(y - menuHeight, viewportHeight - menuHeight - margin))
  } else {
    // 菜单比视口还高: 顶部对齐边距, 保证顶部可见
    top = margin
  }

  return { left, top }
}

/**
 * 锚定式浮层定位: 供 Teleport 到 body 的下拉菜单用视口坐标摆放.
 *
 * 这类菜单原先是宿主内的 absolute 元素, 会被中心栏的 overflow: hidden 裁掉、
 * 并被右侧面板 (backdrop-filter 自成层叠上下文) 压在下面, 所以挪到 body 后
 * 只能按视口算, 不再受宿主容器裁剪.
 *
 * 约定: 优先向上展开 (底边锚在触发元素上沿), 上方空间不够时翻到下方;
 * 左右收进视口边距内, 高度按可用空间收缩.
 */
export const OVERLAY_EDGE_MARGIN = 12
/** 可用空间再小也保留这个高度, 避免菜单被压成看不见的一条. */
export const MIN_OVERLAY_MAX_HEIGHT = 160

export interface MenuAnchorRect {
  left: number
  top: number
  bottom: number
}

export interface MenuDesiredSize {
  width: number
  gap: number
  maxHeight: number
}

export interface AnchoredMenuPlacement {
  left: number
  width: number
  /** CSS 属性名: 向上展开是 bottom (距视口底), 向下展开是 top */
  side: 'top' | 'bottom'
  /** side 对应的偏移值 (px) */
  offset: number
  maxHeight: number
}

export function placeAnchoredMenu(
  anchor: MenuAnchorRect,
  desired: MenuDesiredSize,
  viewport: { width: number; height: number }
): AnchoredMenuPlacement {
  const margin = OVERLAY_EDGE_MARGIN
  const width = Math.max(0, Math.min(desired.width, viewport.width - 2 * margin))
  const left = Math.min(
    Math.max(anchor.left, margin),
    Math.max(margin, viewport.width - width - margin)
  )

  const spaceAbove = anchor.top - desired.gap - margin
  const spaceBelow = viewport.height - anchor.bottom - desired.gap - margin
  const openUpwards = spaceAbove >= Math.min(spaceBelow, desired.maxHeight)
  const available = openUpwards ? spaceAbove : spaceBelow

  return {
    left,
    width,
    side: openUpwards ? 'bottom' : 'top',
    offset: openUpwards ? viewport.height - anchor.top + desired.gap : anchor.bottom + desired.gap,
    maxHeight: Math.max(MIN_OVERLAY_MAX_HEIGHT, Math.min(desired.maxHeight, available)),
  }
}

