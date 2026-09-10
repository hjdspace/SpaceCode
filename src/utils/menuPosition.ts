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
