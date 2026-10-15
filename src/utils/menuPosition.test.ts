import { describe, expect, it } from 'vitest'
import {
  clampMenuPosition,
  MENU_WIDTH,
  VIEWPORT_MARGIN,
  MIN_OVERLAY_MAX_HEIGHT,
  OVERLAY_EDGE_MARGIN,
  placeAnchoredMenu,
} from './menuPosition'

describe('clampMenuPosition', () => {
  const VW = 1920
  const VH = 1080
  const W = MENU_WIDTH // 200
  const H = 370 // 文件节点菜单的实际渲染高度量级

  it('视口中央: 原样返回坐标', () => {
    expect(clampMenuPosition(500, 500, W, H, VW, VH)).toEqual({ left: 500, top: 500 })
  })

  it('靠近底部: 放不下时向上翻转, 菜单底边对齐触发点', () => {
    // y=1000, 底部仅剩 80px, 放不下 370px 高的菜单 → 底边对齐到 y
    const pos = clampMenuPosition(500, 1000, W, H, VW, VH)
    expect(pos.top).toBe(1000 - H)
    expect(pos.top + H).toBeLessThanOrEqual(VH - VIEWPORT_MARGIN)
  })

  it('靠近右边缘: 向左收进视口', () => {
    const pos = clampMenuPosition(1900, 500, W, H, VW, VH)
    expect(pos.left).toBe(VW - W - VIEWPORT_MARGIN)
    expect(pos.left + W).toBeLessThanOrEqual(VW - VIEWPORT_MARGIN)
  })

  it('靠近底部且近右边缘: 两个方向同时修正', () => {
    const pos = clampMenuPosition(1900, 1000, W, H, VW, VH)
    expect(pos.left).toBe(VW - W - VIEWPORT_MARGIN)
    expect(pos.top).toBe(1000 - H)
  })

  it('触发点在上边距内: 不越过上边沿', () => {
    const pos = clampMenuPosition(500, 0, W, H, VW, VH)
    expect(pos.top).toBe(VIEWPORT_MARGIN)
  })

  it('触发点在左边距内: 不越过左边沿', () => {
    const pos = clampMenuPosition(0, 500, W, H, VW, VH)
    expect(pos.left).toBe(VIEWPORT_MARGIN)
  })

  it('菜单比视口高: 顶部对齐边距, 保证顶部可见', () => {
    // 视口高 300, 菜单高 370, 即使翻转也放不下
    const pos = clampMenuPosition(500, 250, W, H, VW, 300)
    expect(pos.top).toBe(VIEWPORT_MARGIN)
  })

  it('视口刚好容纳菜单: 底边对齐边距', () => {
    // 视口高 = 菜单高 + 2*边距, y 在边距处时正好放下
    const vh = H + 2 * VIEWPORT_MARGIN
    const pos = clampMenuPosition(500, VIEWPORT_MARGIN, W, H, VW, vh)
    expect(pos.top).toBe(VIEWPORT_MARGIN)
    expect(pos.top + H).toBe(vh - VIEWPORT_MARGIN)
  })

  it('窄视口放不下菜单宽度: 仍保证左边沿可见', () => {
    // 视口宽 150 < 菜单宽 200 + 边距
    const pos = clampMenuPosition(100, 500, W, H, 150, VH)
    expect(pos.left).toBe(VIEWPORT_MARGIN)
  })
})

describe('placeAnchoredMenu', () => {
  const VP = { width: 1440, height: 900 }
  const DESIRED = { width: 560, gap: 14, maxHeight: 400 }
  // 触发元素在中心栏底部（输入框下方/内部的下拉）
  const BOTTOM_ANCHOR = { left: 320, top: 760, bottom: 790 }

  it('向上展开: 底边锚在触发元素上沿的 gap 处', () => {
    const p = placeAnchoredMenu(BOTTOM_ANCHOR, DESIRED, VP)
    expect(p.side).toBe('bottom')
    expect(p.offset).toBe(VP.height - BOTTOM_ANCHOR.top + DESIRED.gap)
    expect(p.left).toBe(320)
    expect(p.width).toBe(560)
    expect(p.maxHeight).toBe(400)
  })

  it('菜单右沿越过视口: 整块收进右边距内, 右侧面板盖不到', () => {
    const p = placeAnchoredMenu({ left: 1200, top: 760, bottom: 790 }, DESIRED, VP)
    expect(p.left + p.width).toBe(VP.width - OVERLAY_EDGE_MARGIN)
  })

  it('触发元素贴左沿: 不越过左边距', () => {
    const p = placeAnchoredMenu({ left: 0, top: 760, bottom: 790 }, DESIRED, VP)
    expect(p.left).toBe(OVERLAY_EDGE_MARGIN)
  })

  it('上方放不下: 翻到下方, 顶边锚在触发元素下沿的 gap 处', () => {
    const p = placeAnchoredMenu({ left: 320, top: 60, bottom: 90 }, DESIRED, VP)
    expect(p.side).toBe('top')
    expect(p.offset).toBe(90 + DESIRED.gap)
    expect(p.maxHeight).toBe(400)
  })

  it('上下都放不下: 保留最小可用高度, 不压成看不见的一条', () => {
    const p = placeAnchoredMenu({ left: 320, top: 140, bottom: 170 }, DESIRED, { width: 1440, height: 300 })
    expect(p.maxHeight).toBe(MIN_OVERLAY_MAX_HEIGHT)
  })

  it('窄视口: 宽度按视口收窄且 left 不为负', () => {
    const p = placeAnchoredMenu({ left: 300, top: 700, bottom: 730 }, DESIRED, { width: 400, height: 900 })
    expect(p.width).toBe(400 - 2 * OVERLAY_EDGE_MARGIN)
    expect(p.left).toBe(OVERLAY_EDGE_MARGIN)
  })
})
