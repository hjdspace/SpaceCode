/**
 * 官方 mini 物料与白名单的漂移钉（PRD §6「漂移由测试钉住」）。
 *
 * 这里**故意**在测试里 import 官方物料表：沙箱注册哪组件不是我们说了算，事实来源是
 * `@opentiny/genui-sdk-materials-vue-opentiny-vue`。物料升级后如果名单对不上，这条先红。
 * 官方 Vue 渲染器本身在 jsdom 装不起来（依赖链上有模块导入期就摸 DOM），所以这里只测物料表；
 * 真实渲染归手工验收。
 *
 * 冷启动要 transform ~2000 个模块，超时放宽到 4 分钟（vitest 需要把 @opentiny 交给 Vite
 * 处理，配置见 vitest.config.ts 的 server.deps.inline）。
 */
import { describe, it, expect } from 'vitest'
import { miniMaterials } from '@opentiny/genui-sdk-materials-vue-opentiny-vue/materials'
import { GENUI_MATERIAL_WHITELIST, pickWhitelistedMaterials } from '@/shared/genuiMaterials'

const names = Object.keys(miniMaterials.components ?? {})

describe('官方 mini 物料表', { timeout: 240_000 }, () => {
  it('miniMaterials 的注册表其实是全量的，含图表', () => {
    // 这条不是断言「应该如此」，而是钉住我们为什么还要再过一遍白名单
    expect(names.filter(name => name.startsWith('TinyHuicharts'))).not.toEqual([])
  })

  it('按白名单过滤后只剩 mini 物料，图表被摘掉', () => {
    const picked = Object.keys(pickWhitelistedMaterials(miniMaterials.components ?? {}))

    expect(picked).toEqual(expect.arrayContaining(['TinyForm', 'TinyFormItem', 'TinyButton', 'TinyInput', 'TinyGrid', 'TinyCard']))
    expect(picked.filter(name => name.startsWith('TinyHuicharts'))).toEqual([])
    expect(picked.filter(name => name === 'TinyTree' || name === 'TinyTransfer')).toEqual([])
    for (const name of picked) expect(GENUI_MATERIAL_WHITELIST).toContain(name)
  })

  it('白名单里的 Tiny 组件在官方物料表里都存在', () => {
    // 名单点名了但物料表没有 = 宿主放行一张沙箱画不出来的卡
    const tinyOnList = GENUI_MATERIAL_WHITELIST.filter(name => name.startsWith('Tiny'))
    expect(tinyOnList.filter(name => !names.includes(name))).toEqual([])
  })
})
