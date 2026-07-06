import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TemplateScenarioArt from '../TemplateScenarioArt.vue'

describe('TemplateScenarioArt', () => {
  it.each([
    'prototype', 'wireframe', 'mobile', 'deck', 'document',
    'hyperframes', 'live-artifact', 'image', 'video', 'audio',
  ])('%s 渲染非空 SVG', (id) => {
    const w = mount(TemplateScenarioArt, { props: { templateId: id } })
    const svg = w.find('svg')
    expect(svg.exists()).toBe(true)
    expect(svg.attributes('viewBox')).toBe('0 0 60 42')
  })

  it('未知 id 渲染问号图标', () => {
    const w = mount(TemplateScenarioArt, { props: { templateId: 'unknown' } })
    expect(w.find('svg').exists()).toBe(true)
    expect(w.text()).toContain('?')
  })
})
