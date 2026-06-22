import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'

export interface LocalSkill {
  name: string
  description: string
  content: string
  category: string
  tags?: string[]
  sourceDir: string
  skillPath: string
  isInstalled: boolean
  installedScope?: 'global' | 'project'
  installedAt?: Date
  bundleId?: string
  bundleName?: string
}

export interface LocalSkillBundle {
  id: string
  name: string
  version?: string
  description?: string
  author?: string
  homepage?: string
  license?: string
  keywords?: string[]
  bundleDir: string
  hasHooks: boolean
  hasCommands: boolean
  hasAgents: boolean
  skillCount: number
  isInstalled: boolean
  installedScope?: 'global' | 'project' | 'mixed'
}

export interface Category {
  id: string
  icon: string
  labelKey: string
  color: string
  count: number
}

export const CATEGORIES: Category[] = [
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

const BUILTIN_DIR = 'skills-lib'

export const useLocalSkillsStore = defineStore('localSkills', () => {
  const skills = ref<LocalSkill[]>([])
  const bundles = ref<LocalSkillBundle[]>([])
  const customDirectories = ref<string[]>([])
  const selectedCategory = ref<string>('all')
  const selectedDirectory = ref<string | null>(null)
  const searchQuery = ref('')
  const viewMode = ref<'grid' | 'list'>('grid')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const installingId = ref<string | null>(null)

  const allDirectoryPaths = computed(() => [BUILTIN_DIR, ...customDirectories.value])

  function isWithinDirectory(path: string, dir: string): boolean {
    return path === dir || path.startsWith(dir + '/') || path.startsWith(dir + '\\')
  }

  // "Free" skills only — bundle children render under their bundle card.
  const filteredSkills = computed(() => {
    let result = skills.value.filter(s => !s.bundleId)

    if (selectedCategory.value !== 'all') {
      result = result.filter(s => s.category === selectedCategory.value)
    }

    if (selectedDirectory.value) {
      const sel = selectedDirectory.value
      result = result.filter(s => isWithinDirectory(s.sourceDir, sel) || isWithinDirectory(s.skillPath, sel))
    }

    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase()
      result = result.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query) ||
        s.tags?.some(t => t.toLowerCase().includes(query))
      )
    }

    return result
  })

  const filteredBundles = computed(() => {
    let result = bundles.value

    if (selectedDirectory.value) {
      const sel = selectedDirectory.value
      result = result.filter(b => isWithinDirectory(b.bundleDir, sel))
    }

    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase()
      result = result.filter(b =>
        b.name.toLowerCase().includes(query) ||
        (b.description?.toLowerCase().includes(query) ?? false) ||
        (b.keywords?.some(k => k.toLowerCase().includes(query)) ?? false)
      )
    }

    return result
  })

  function getBundleSkills(bundleId: string): LocalSkill[] {
    return skills.value.filter(s => s.bundleId === bundleId)
  }

  const categoryStats = computed(() => {
    const freeSkills = skills.value.filter(s => !s.bundleId)
    const stats: Record<string, number> = { all: freeSkills.length }
    freeSkills.forEach(skill => {
      stats[skill.category] = (stats[skill.category] || 0) + 1
    })
    return stats
  })

  const categoriesWithCount = computed(() => {
    return CATEGORIES.map(cat => ({
      ...cat,
      count: categoryStats.value[cat.id] || 0
    }))
  })

  async function fetchLocalSkills(cwd?: string) {
    loading.value = true
    error.value = null
    try {
      const dirPaths = allDirectoryPaths.value
      const data = await api.skills.scanLocalLibrary(dirPaths, cwd)
      skills.value = data.skills || []
      bundles.value = data.bundles || []
    } catch (err) {
      console.error('Failed to fetch local skills:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch local skills'
    } finally {
      loading.value = false
    }
  }

  async function installSkill(skillName: string, scope: 'global' | 'project', cwd?: string) {
    installingId.value = skillName
    try {
      const skill = skills.value.find(s => s.name === skillName)
      await api.skills.installLocal(skillName, scope, cwd, skill?.skillPath)
      if (skill) {
        skill.isInstalled = true
        skill.installedScope = scope
        skill.installedAt = new Date()
      }
      return true
    } catch (err) {
      console.error('Failed to install skill:', err)
      throw err
    } finally {
      installingId.value = null
    }
  }

  async function uninstallSkill(skillName: string, cwd?: string) {
    try {
      await api.skills.uninstallLocal(skillName, cwd)
      const skill = skills.value.find(s => s.name === skillName)
      if (skill) {
        skill.isInstalled = false
        skill.installedScope = undefined
        skill.installedAt = undefined
      }
      return true
    } catch (err) {
      console.error('Failed to uninstall skill:', err)
      throw err
    }
  }

  async function installBundle(bundleId: string, scope: 'global' | 'project', cwd?: string) {
    installingId.value = bundleId
    try {
      await api.skills.installLocalBundle(bundleId, scope, cwd)
      await fetchLocalSkills(cwd)
      return true
    } catch (err) {
      console.error('Failed to install bundle:', err)
      throw err
    } finally {
      installingId.value = null
    }
  }

  async function uninstallBundle(bundleName: string, cwd?: string) {
    try {
      await api.skills.uninstallLocalBundle(bundleName, cwd)
      await fetchLocalSkills(cwd)
      return true
    } catch (err) {
      console.error('Failed to uninstall bundle:', err)
      throw err
    }
  }

  async function addCustomDirectory(dirPath: string) {
    try {
      await api.skills.addCustomDir(dirPath)
      if (!customDirectories.value.includes(dirPath)) {
        customDirectories.value.push(dirPath)
      }
      await fetchLocalSkills()
      return true
    } catch (err) {
      console.error('Failed to add custom directory:', err)
      throw err
    }
  }

  async function removeCustomDirectory(dirPath: string) {
    try {
      await api.skills.removeCustomDir(dirPath)
      customDirectories.value = customDirectories.value.filter(d => d !== dirPath)
      if (selectedDirectory.value === dirPath) {
        selectedDirectory.value = null
      }
      await fetchLocalSkills()
      return true
    } catch (err) {
      console.error('Failed to remove custom directory:', err)
      throw err
    }
  }

  async function loadCustomDirectories() {
    try {
      const data = await api.skills.getCustomDirs()
      customDirectories.value = data.directories || []
    } catch (err) {
      console.error('Failed to load custom directories:', err)
    }
  }

  function selectCategory(categoryId: string) {
    selectedCategory.value = categoryId
  }

  function selectDirectory(dirPath: string | null) {
    selectedDirectory.value = dirPath
  }

  function setSearchQuery(query: string) {
    searchQuery.value = query
  }

  function setViewMode(mode: 'grid' | 'list') {
    viewMode.value = mode
  }

  return {
    skills,
    bundles,
    customDirectories,
    selectedCategory,
    selectedDirectory,
    searchQuery,
    viewMode,
    loading,
    error,
    installingId,
    allDirectoryPaths,
    filteredSkills,
    filteredBundles,
    getBundleSkills,
    categoryStats,
    categoriesWithCount,
    fetchLocalSkills,
    installSkill,
    uninstallSkill,
    installBundle,
    uninstallBundle,
    addCustomDirectory,
    removeCustomDirectory,
    loadCustomDirectories,
    selectCategory,
    selectDirectory,
    setSearchQuery,
    setViewMode
  }
})
