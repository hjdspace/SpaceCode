import { describe, it, expect } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import NextStepActions from '../NextStepActions.vue'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

// vue-i18n 9.x 的 useI18n() 需要 app.use(i18n) 安装，否则抛错。
// 通过 @vue/test-utils 的全局 plugins 注入 i18n 实例，加载真实 locale messages，
// 便于断言翻译文案并避免 missing-key 警告。
const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
})
config.global.plugins = [i18n]

describe('NextStepActions', () => {
  it('渲染动作按钮', () => {
    const w = mount(NextStepActions, {
      props: { actions: [{ label: '调整配色', prompt: '改主色' }, { label: '换布局', prompt: '换' }] },
    })
    expect(w.findAll('button')).toHaveLength(2)
    expect(w.text()).toContain('调整配色')
  })

  it('点击触发 select 事件并携带 prompt', async () => {
    const w = mount(NextStepActions, {
      props: { actions: [{ label: 'x', prompt: 'do x' }] },
    })
    await w.find('button').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['do x'])
  })

  it('空数组不渲染', () => {
    const w = mount(NextStepActions, { props: { actions: [] } })
    expect(w.find('.next-steps').exists()).toBe(false)
  })
})
