import { describe, it, expect } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import OdCard from '../OdCard.vue'

// vue-i18n 9.x 的 useI18n() 需要 app.use(i18n) 安装，否则抛错。
// 通过 @vue/test-utils 的全局 plugins 注入最小 i18n 实例，所有 mount 自动复用。
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: {},
})
config.global.plugins = [i18n]

describe('OdCard', () => {
  it('brand-preview 渲染色板', () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'brand-preview', title: '品牌', data: { colors: ['#f00', '#0f0'] } } },
    })
    expect(w.text()).toContain('品牌')
    expect(w.findAll('.swatch')).toHaveLength(2)
  })

  it('direction-swatches 渲染 5 大方向', () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'direction-swatches', data: {} } },
    })
    expect(w.findAll('.direction-item').length).toBeGreaterThan(0)
  })

  it('artifact-thumbnail 渲染打开按钮', () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'artifact-thumbnail', title: 'index.html', data: { path: '/x.html' } } },
    })
    expect(w.text()).toContain('index.html')
    expect(w.find('button.open-in-preview').exists()).toBe(true)
  })

  it('generic 渲染键值对', () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'generic', data: { foo: 'bar' } } },
    })
    expect(w.text()).toContain('foo')
    expect(w.text()).toContain('bar')
  })

  it('点击 artifact-thumbnail 打开按钮触发 open 事件', async () => {
    const w = mount(OdCard, {
      props: { payload: { type: 'artifact-thumbnail', data: { path: '/x.html' } } },
    })
    await w.find('button.open-in-preview').trigger('click')
    expect(w.emitted('open')).toBeTruthy()
  })
})
