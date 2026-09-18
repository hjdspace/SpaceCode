import { createI18n } from 'vue-i18n'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WelcomeHero from '@/components/chat/WelcomeHero.vue'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})

interface WelcomeTask {
  name: string
  description?: string
}

const mountHero = (props: {
  title: string
  subtitle: string
  projectPath?: string
  tasks: WelcomeTask[]
}) => mount(WelcomeHero, { props, global: { plugins: [i18n] } })

describe('WelcomeHero', () => {
  const tasks = [
    { name: '梳理项目架构', description: '快速理解模块与数据流' },
    { name: '修复编译错误', description: '定位并修复报错与失败用例' },
  ]

  it('渲染 eyebrow、标题、副标题与任务磁贴', () => {
    const wrapper = mountHero({
      title: '你好，我能帮你做点什么？',
      subtitle: '直接描述你的需求，或从下方选择一个快捷任务开始。',
      projectPath: 'D:\\doc\\AI\\SpaceCode',
      tasks,
    })
    expect(wrapper.text()).toContain('开始你的项目')
    expect(wrapper.text()).toContain('你好，我能帮你做点什么？')
    expect(wrapper.text()).toContain('直接描述你的需求，或从下方选择一个快捷任务开始。')
    expect(wrapper.text()).toContain('D:\\doc\\AI\\SpaceCode')
    expect(wrapper.text()).toContain('梳理项目架构')
    expect(wrapper.text()).toContain('修复编译错误')
    expect(wrapper.findAll('[data-test="task-tile"]')).toHaveLength(2)
  })

  it('projectPath 为空时不渲染路径 pill', () => {
    const wrapper = mountHero({
      title: '你好',
      subtitle: '副标题',
      projectPath: '',
      tasks,
    })
    expect(wrapper.find('.hero-project').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="task-tile"]')).toHaveLength(2)
  })

  it('点击磁贴触发 select 事件，载荷为任务文本', async () => {
    const wrapper = mountHero({
      title: '你好',
      subtitle: '副标题',
      projectPath: '',
      tasks,
    })
    await wrapper.find('[data-test="task-tile"]').trigger('click')
    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')![0]).toEqual(['梳理项目架构'])
  })
})
