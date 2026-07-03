import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDesignStore } from '../design'

describe('useDesignStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('初始状态不含 brief/selectedSystemId', () => {
    const s = useDesignStore()
    expect((s as any).brief).toBeUndefined()
    expect((s as any).selectedSystemId).toBeUndefined()
    expect((s as any).selectedDirectionId).toBeUndefined()
  })

  it('toolboxSkills 默认含 huashu-design', () => {
    const s = useDesignStore()
    expect(s.toolboxSkills.find(x => x.id === 'huashu-design')).toBeTruthy()
  })

  it('selectedToolboxSkillId 默认 huashu-design', () => {
    const s = useDesignStore()
    expect(s.selectedToolboxSkillId).toBe('huashu-design')
  })

  it('addTab/removeTab/setActiveTab 管理 openTabs', () => {
    const s = useDesignStore()
    const f = { name: 'a.html', path: '/a.html', updatedAt: 0 }
    s.addTab(f)
    expect(s.openTabs).toHaveLength(1)
    expect(s.activeTabPath).toBe('/a.html')
    s.removeTab('/a.html')
    expect(s.openTabs).toHaveLength(0)
    expect(s.activeTabPath).toBeNull()
  })

  it('addTab 重复路径不重复添加', () => {
    const s = useDesignStore()
    const f = { name: 'a.html', path: '/a.html', updatedAt: 0 }
    s.addTab(f)
    s.addTab(f)
    expect(s.openTabs).toHaveLength(1)
  })

  it('removeTab 关闭激活 tab 时激活相邻', () => {
    const s = useDesignStore()
    s.addTab({ name: 'a', path: '/a', updatedAt: 0 })
    s.addTab({ name: 'b', path: '/b', updatedAt: 0 })
    s.addTab({ name: 'c', path: '/c', updatedAt: 0 })
    s.setActiveTab('/b')
    s.removeTab('/b')
    expect(s.activeTabPath).toBe('/c')
  })

  it('setUsage/setNextStepActions 写入状态', () => {
    const s = useDesignStore()
    s.setUsage({ inputTokens: 1, outputTokens: 2, costUsd: 0.01, durationMs: 1000 })
    expect(s.lastUsage?.inputTokens).toBe(1)
    s.setNextStepActions([{ label: 'x', prompt: 'y' }])
    expect(s.nextStepActions).toHaveLength(1)
  })
})
