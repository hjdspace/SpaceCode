import { describe, expect, it } from 'vitest'
import { clampMenuPosition, MENU_WIDTH, VIEWPORT_MARGIN } from '../utils/menuPosition'

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
