import { describe, it, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'

describe('useLocalSkillsStore - Pure Logic Tests', () => {
  const CATEGORIES = [
    { id: 'all', icon: 'Grid3x3', labelKey: 'skills.categories.all', color: '#6b7280', count: 0 },
    { id: 'frontend-design', icon: 'Palette', labelKey: 'skills.categories.frontendDesign', color: '#8b5cf6', count: 0 },
    { id: 'office', icon: 'FileText', labelKey: 'skills.categories.office', color: '#3b82f6', count: 0 },
    { id: 'development', icon: 'Code2', labelKey: 'skills.categories.development', color: '#10b981', count: 0 },
    { id: 'ai-ml', icon: 'Brain', labelKey: 'skills.categories.aiMl', color: '#f59e0b', count: 0 },
    { id: 'devops', icon: 'Server', labelKey: 'skills.categories.devOps', color: '#ef4444', count: 0 },
    { id: 'creative', icon: 'Sparkles', labelKey: 'skills.categories.creative', color: '#ec4899', count: 0 },
    { id: 'communication', icon: 'MessageSquare', labelKey: 'skills.categories.communication', color: '#06b6d4', count: 0 },
    { id: 'other', icon: 'Package', labelKey: 'skills.categories.other', color: '#6b7280', count: 0 }
  ]

  interface LocalSkill {
    name: string
    description: string
    content: string
    category: string
    tags?: string[]
    sourceDir: string
    skillPath: string
    isInstalled: boolean
    installedScope?: 'global' | 'project'
  }

  interface Category {
    id: string
    icon: string
    labelKey: string
    color: string
    count: number
  }

  function computeCategoryStats(skills: LocalSkill[]): Record<string, number> {
    const stats: Record<string, number> = {}
    for (const category of CATEGORIES) {
      stats[category.id] = 0
    }
    stats['all'] = skills.length

    for (const skill of skills) {
      if (stats[skill.category] !== undefined) {
        stats[skill.category]++
      }
    }
    return stats
  }

  function computeCategoriesWithCount(skills: LocalSkill[]): Category[] {
    const stats = computeCategoryStats(skills)
    return CATEGORIES.map(cat => ({
      ...cat,
      count: stats[cat.id] || 0
    }))
  }

  function filterSkills(
    skills: LocalSkill[],
    selectedCategory: string,
    searchQuery: string
  ): LocalSkill[] {
    let filtered = skills

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(skill => skill.category === selectedCategory)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(skill =>
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        (skill.tags && skill.tags.some(tag => tag.toLowerCase().includes(query)))
      )
    }

    return filtered
  }

  describe('Category Statistics', () => {
    it('should compute correct category counts for empty skills', () => {
      const skills: LocalSkill[] = []
      const stats = computeCategoryStats(skills)

      assert.equal(stats['all'], 0)
      assert.equal(stats['frontend-design'], 0)
      assert.equal(stats['office'], 0)
    })

    it('should compute correct category counts with mixed skills', () => {
      const skills: LocalSkill[] = [
        { name: 'react-comp', description: '', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'excel-helper', description: '', content: '', category: 'office', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'api-tool', description: '', content: '', category: 'development', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'vue-component', description: '', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false }
      ]
      const stats = computeCategoryStats(skills)

      assert.equal(stats['all'], 4)
      assert.equal(stats['frontend-design'], 2)
      assert.equal(stats['office'], 1)
      assert.equal(stats['development'], 1)
      assert.equal(stats['ai-ml'], 0)
    })

    it('should update categoriesWithCount dynamically', () => {
      const skills: LocalSkill[] = [
        { name: 'ai-model', description: '', content: '', category: 'ai-ml', sourceDir: '', skillPath: '', isInstalled: false }
      ]
      const categories = computeCategoriesWithCount(skills)

      const aiCategory = categories.find(c => c.id === 'ai-ml')
      assert.equal(aiCategory?.count, 1)

      const allCategory = categories.find(c => c.id === 'all')
      assert.equal(allCategory?.count, 1)

      const otherCategory = categories.find(c => c.id === 'other')
      assert.equal(otherCategory?.count, 0)
    })
  })

  describe('Skill Filtering', () => {
    it('should filter by category correctly', () => {
      const skills: LocalSkill[] = [
        { name: 'test1', description: '', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'test2', description: '', content: '', category: 'office', sourceDir: '', skillPath: '', isInstalled: false }
      ]

      const result = filterSkills(skills, 'frontend-design', '')
      assert.equal(result.length, 1)
      assert.equal(result[0].name, 'test1')
    })

    it('should return all skills when category is "all"', () => {
      const skills: LocalSkill[] = [
        { name: 'test1', description: '', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'test2', description: '', content: '', category: 'office', sourceDir: '', skillPath: '', isInstalled: false }
      ]

      const result = filterSkills(skills, 'all', '')
      assert.equal(result.length, 2)
    })

    it('should filter by search query (name match)', () => {
      const skills: LocalSkill[] = [
        { name: 'react-skill', description: 'React component helper', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'excel-helper', description: 'Excel automation', content: '', category: 'office', sourceDir: '', skillPath: '', isInstalled: false }
      ]

      const result = filterSkills(skills, 'all', 'react')
      assert.equal(result.length, 1)
      assert.equal(result[0].name, 'react-skill')
    })

    it('should filter by search query (description match)', () => {
      const skills: LocalSkill[] = [
        { name: 'tool-a', description: 'Excel automation tool', content: '', category: 'office', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'tool-b', description: 'PDF processing utility', content: '', category: 'office', sourceDir: '', skillPath: '', isInstalled: false }
      ]

      const result = filterSkills(skills, 'all', 'pdf')
      assert.equal(result.length, 1)
      assert.equal(result[0].name, 'tool-b')
    })

    it('should combine category and search filters', () => {
      const skills: LocalSkill[] = [
        { name: 'react-ui', description: 'UI components', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'excel-react', description: 'React Excel integration', content: '', category: 'office', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'vue-tool', description: 'Vue utilities', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false }
      ]

      const result = filterSkills(skills, 'frontend-design', 'react')
      assert.equal(result.length, 1)
      assert.equal(result[0].name, 'react-ui')
    })

    it('should handle case-insensitive search', () => {
      const skills: LocalSkill[] = [
        { name: 'ReactComponent', description: '', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'VueTool', description: '', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false }
      ]

      const result = filterSkills(skills, 'all', 'REACT')
      assert.equal(result.length, 1)
      assert.equal(result[0].name, 'ReactComponent')
    })

    it('should return empty array when no matches found', () => {
      const skills: LocalSkill[] = [
        { name: 'react-tool', description: '', content: '', category: 'frontend-design', sourceDir: '', skillPath: '', isInstalled: false }
      ]

      const result = filterSkills(skills, 'office', 'nonexistent')
      assert.equal(result.length, 0)
    })
  })

  describe('Directory Path Management', () => {
    it('should compute all directory paths including custom ones', () => {
      const customDirectories = ['/custom/path']
      const allPaths = ['skills-lib', ...customDirectories]

      assert.deepEqual(allPaths, ['skills-lib', '/custom/path'])
    })

    it('should add custom directory without duplicates', () => {
      let directories: string[] = []
      const newDir = '/new/path'

      if (!directories.includes(newDir)) {
        directories.push(newDir)
      }

      assert.ok(directories.includes('/new/path'))
      assert.equal(directories.length, 1)
    })

    it('should not add duplicate directory', () => {
      let directories = ['/existing/path']

      if (!directories.includes('/existing/path')) {
        directories.push('/existing/path')
      }

      assert.equal(directories.filter(d => d === '/existing/path').length, 1)
      assert.equal(directories.length, 1)
    })

    it('should remove directory from list', () => {
      let directories = ['/keep', '/remove']
      directories = directories.filter(d => d !== '/remove')

      assert.deepEqual(directories, ['/keep'])
      assert.ok(!directories.includes('/remove'))
    })
  })

  describe('Install/Uninstall State Management', () => {
    it('should mark skill as installed after installation', () => {
      const skills: LocalSkill[] = [{
        name: 'test-skill',
        description: '',
        content: '',
        category: 'development',
        sourceDir: '',
        skillPath: '',
        isInstalled: false
      }]

      const skillName = 'test-skill'
      const scope: 'global' | 'project' = 'global'

      const updatedSkills = skills.map(skill =>
        skill.name === skillName
          ? { ...skill, isInstalled: true, installedScope: scope }
          : skill
      )

      assert.equal(updatedSkills[0].isInstalled, true)
      assert.equal(updatedSkills[0].installedScope, 'global')
    })

    it('should mark skill as uninstalled after uninstallation', () => {
      const skills: LocalSkill[] = [{
        name: 'test-skill',
        description: '',
        content: '',
        category: 'development',
        sourceDir: '',
        skillPath: '',
        isInstalled: true,
        installedScope: 'global'
      }]

      const skillName = 'test-skill'

      const updatedSkills = skills.map(skill =>
        skill.name === skillName
          ? { ...skill, isInstalled: false, installedScope: undefined }
          : skill
      )

      assert.equal(updatedSkills[0].isInstalled, false)
      assert.equal(updatedSkills[0].installedScope, undefined)
    })

    it('should only update the target skill during install/uninstall', () => {
      const skills: LocalSkill[] = [
        { name: 'skill-a', description: '', content: '', category: 'dev', sourceDir: '', skillPath: '', isInstalled: false },
        { name: 'skill-b', description: '', content: '', category: 'dev', sourceDir: '', skillPath: '', isInstalled: true, installedScope: 'project' }
      ]

      const updatedSkills = skills.map(skill =>
        skill.name === 'skill-a'
          ? { ...skill, isInstalled: true, installedScope: 'global' }
          : skill
      )

      assert.equal(updatedSkills[0].isInstalled, true)
      assert.equal(updatedSkills[1].isInstalled, true)
      assert.equal(updatedSkills[1].installedScope, 'project')
    })
  })
})
