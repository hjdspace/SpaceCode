import { describe, it, expect } from 'vitest'
import {
  DESIGN_TEMPLATES,
  buildPreamble,
  getTemplateById,
} from '@/lib/design/templates'

const TOOLBOX_SKILL_IDS = new Set([
  'huashu-design',
  'canvas-design',
  'ui-ux-pro-max',
  'html-ppt-skill',
  'officecli-docx',
])

describe('DESIGN_TEMPLATES', () => {
  it('每个模板都有 pluginId 和 projectKind', () => {
    for (const t of DESIGN_TEMPLATES) {
      expect(t.pluginId).toBeTruthy()
      expect(t.projectKind).toBeTruthy()
    }
  })

  it('每个模板的 defaultSkillId 都存在于 toolboxSkills', () => {
    for (const t of DESIGN_TEMPLATES) {
      expect(TOOLBOX_SKILL_IDS.has(t.defaultSkillId)).toBe(true)
    }
  })

  it('wireframe 使用 example-web-prototype + fidelity wireframe', () => {
    const wireframe = getTemplateById('wireframe')!
    expect(wireframe.pluginId).toBe('example-web-prototype')
    expect(wireframe.projectMetadata?.fidelity).toBe('wireframe')
  })

  it('deck 使用 example-simple-deck', () => {
    const deck = getTemplateById('deck')!
    expect(deck.pluginId).toBe('example-simple-deck')
    expect(deck.projectKind).toBe('deck')
  })
})

describe('buildPreamble', () => {
  it('返回包含模板前缀、设计系统名称和元信号的文本', () => {
    const text = buildPreamble('wireframe', 'Agentic')
    expect(text).toContain('低保真线框图')
    expect(text).toContain('Agentic')
    expect(text).toContain('wireframe')
  })

  it('未知 templateId 返回空字符串', () => {
    expect(buildPreamble('unknown', null)).toBe('')
  })
})
