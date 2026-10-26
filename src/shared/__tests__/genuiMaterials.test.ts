import { describe, it, expect } from 'vitest'
import { miniMaterialsMeta } from '@opentiny/genui-sdk-materials-vue-opentiny-vue/meta'
import { GENUI_MATERIAL_WHITELIST, isGenuiComponentAllowed } from '../genuiMaterials'

/**
 * 白名单漂移由测试钉住（docs/prd/genui-cards.md §6）：宿主判定与沙箱注册共用这一份名单，
 * 而名单的事实来源是官方 mini 物料元数据。物料升级而未同步时这里必须失败。
 */
describe('官方 mini 物料白名单', () => {
  it('与 @opentiny 官方 mini 物料元数据的 whiteList 完全一致', () => {
    expect(GENUI_MATERIAL_WHITELIST).toEqual(miniMaterialsMeta.whiteList)
  })

  it('名单非空且没有重复项', () => {
    expect(GENUI_MATERIAL_WHITELIST.length).toBeGreaterThan(0)
    expect(new Set(GENUI_MATERIAL_WHITELIST).size).toBe(GENUI_MATERIAL_WHITELIST.length)
  })
})

describe('isGenuiComponentAllowed', () => {
  it.each(['TinyForm', 'TinyGrid', 'TinyCard', 'p', 'Text', 'TinyIcon'])('放行 %s', name => {
    expect(isGenuiComponentAllowed(name)).toBe(true)
  })

  // 图表不在 mini 名单里，属于 PRD 明确排除的重物料
  it.each(['TinyHuichartsBar', 'TinyTree', 'TinyTransfer', 'tinyform', '', '  ', 'div ', 'constructor', '__proto__'])(
    '拒绝 %j',
    name => {
      expect(isGenuiComponentAllowed(name)).toBe(false)
    },
  )

  it('非字符串一律拒绝', () => {
    for (const value of [undefined, null, 123, {}, [], true]) {
      expect(isGenuiComponentAllowed(value as unknown as string)).toBe(false)
    }
  })
})
