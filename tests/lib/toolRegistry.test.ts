import { describe, it, expect } from 'vitest'
import {
  TOOL_REGISTRY,
  TOOL_CATEGORIES,
  getToolDefinition,
  getToolDisplayName,
  getToolIcon,
  getToolsByCategory,
  getCoreTools,
  getConditionalTools,
  toolHasSpecialUI,
} from '@/lib/tool-registry'

describe('tool-registry — getToolDefinition', () => {
  it('按名称返回已注册的工具定义', () => {
    const def = getToolDefinition('Bash')
    expect(def).toBeDefined()
    expect(def?.name).toBe('Bash')
    expect(def?.category).toBe('execution')
  })

  it('未注册的工具返回 undefined', () => {
    expect(getToolDefinition('NoSuchTool')).toBeUndefined()
  })

  it('名称匹配区分大小写', () => {
    expect(getToolDefinition('bash')).toBeUndefined()
  })
})

describe('tool-registry — getToolDisplayName', () => {
  it('已注册工具返回 displayName', () => {
    expect(getToolDisplayName('Read')).toBe('Read File')
  })

  it('未注册工具回退为原始名称', () => {
    expect(getToolDisplayName('CustomTool')).toBe('CustomTool')
  })
})

describe('tool-registry — getToolIcon', () => {
  it('已注册工具返回其 icon', () => {
    expect(getToolIcon('Bash')).toBe('Terminal')
  })

  it('未注册工具回退为 Wrench', () => {
    expect(getToolIcon('CustomTool')).toBe('Wrench')
  })
})

describe('tool-registry — toolHasSpecialUI', () => {
  it('hasSpecialUI 为 true 的工具返回 true', () => {
    expect(toolHasSpecialUI('Bash')).toBe(true)
  })

  it('hasSpecialUI 为 false 的工具返回 false', () => {
    expect(toolHasSpecialUI('SendMessage')).toBe(false)
  })

  it('未注册工具回退为 false', () => {
    expect(toolHasSpecialUI('CustomTool')).toBe(false)
  })
})

describe('tool-registry — getToolsByCategory', () => {
  it('返回的 Map 包含所有声明的分类', () => {
    const grouped = getToolsByCategory()
    for (const cat of TOOL_CATEGORIES) {
      expect(grouped.has(cat.id)).toBe(true)
    }
  })

  it('每个工具被放入其声明的分类', () => {
    const grouped = getToolsByCategory()
    const filesystem = grouped.get('filesystem') ?? []
    expect(filesystem.map(t => t.name)).toContain('Read')
    expect(filesystem.map(t => t.name)).toContain('Edit')
    // 不应混入其它分类的工具
    expect(filesystem.map(t => t.name)).not.toContain('Bash')
  })

  it('分组后工具总数与注册表一致（无遗漏、无重复）', () => {
    const grouped = getToolsByCategory()
    let total = 0
    for (const list of grouped.values()) total += list.length
    expect(total).toBe(TOOL_REGISTRY.length)
  })
})

describe('tool-registry — getCoreTools / getConditionalTools', () => {
  it('core 工具 availability 全部为 always', () => {
    const core = getCoreTools()
    expect(core.length).toBeGreaterThan(0)
    for (const t of core) {
      expect(t.availability).toBe('always')
    }
  })

  it('conditional 工具 availability 全部不是 always', () => {
    const conditional = getConditionalTools()
    expect(conditional.length).toBeGreaterThan(0)
    for (const t of conditional) {
      expect(t.availability).not.toBe('always')
    }
  })

  it('core 与 conditional 互补，合计等于注册表总数', () => {
    expect(getCoreTools().length + getConditionalTools().length).toBe(TOOL_REGISTRY.length)
  })

  it('feature-flag 工具必须声明 featureFlag 字段', () => {
    for (const t of getConditionalTools()) {
      if (t.availability === 'feature-flag') {
        expect(t.featureFlag, `${t.name} 缺少 featureFlag`).toBeTruthy()
      }
      if (t.availability === 'env-var') {
        expect(t.envVar, `${t.name} 缺少 envVar`).toBeTruthy()
      }
    }
  })
})

describe('tool-registry — 数据完整性', () => {
  it('工具名称全局唯一', () => {
    const names = TOOL_REGISTRY.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('每个工具的 category 都在 TOOL_CATEGORIES 中声明', () => {
    const declared = new Set(TOOL_CATEGORIES.map(c => c.id))
    for (const t of TOOL_REGISTRY) {
      expect(declared.has(t.category), `${t.name} 的 category ${t.category} 未声明`).toBe(true)
    }
  })
})
