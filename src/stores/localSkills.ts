import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const electronAPI = (window as any).electronAPI

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
  const customDirectories = ref<string[]>([])
  const selectedCategory = ref<string>('all')
  const selectedDirectory = ref<string | null>(null)
  const searchQuery = ref('')
  const viewMode = ref<'grid' | 'list'>('grid')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const installingId = ref<string | null>(null)

  const allDirectoryPaths = computed(() => [BUILTIN_DIR, ...customDirectories.value])

  const filteredSkills = computed(() => {
    let result = skills.value

    if (selectedCategory.value !== 'all') {
      result = result.filter(s => s.category === selectedCategory.value)
    }

    if (selectedDirectory.value) {
      const sel = selectedDirectory.value
      result = result.filter(s => s.sourceDir === sel)
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

  const categoryStats = computed(() => {
    const stats: Record<string, number> = { all: skills.value.length }
    skills.value.forEach(skill => {
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
      if (electronAPI?.skills?.scanLocalLibrary) {
        const dirPaths = allDirectoryPaths.value
        const data = await electronAPI.skills.scanLocalLibrary(dirPaths, cwd)
        skills.value = data.skills || []
      } else {
        console.warn('Electron API not available for scanning local library')
        skills.value = []
      }
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
      if (electronAPI?.skills?.installLocal) {
        const skill = skills.value.find(s => s.name === skillName)
        await electronAPI.skills.installLocal(skillName, scope, cwd, skill?.skillPath)
        if (skill) {
          skill.isInstalled = true
          skill.installedScope = scope
          skill.installedAt = new Date()
        }
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to install skill:', err)
      throw err
    } finally {
      installingId.value = null
    }
  }

  async function uninstallSkill(skillName: string, cwd?: string) {
    try {
      if (electronAPI?.skills?.uninstallLocal) {
        await electronAPI.skills.uninstallLocal(skillName, cwd)
        const skill = skills.value.find(s => s.name === skillName)
        if (skill) {
          skill.isInstalled = false
          skill.installedScope = undefined
          skill.installedAt = undefined
        }
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to uninstall skill:', err)
      throw err
    }
  }

  async function addCustomDirectory(dirPath: string) {
    try {
      if (electronAPI?.skills?.addCustomDir) {
        await electronAPI.skills.addCustomDir(dirPath)
        if (!customDirectories.value.includes(dirPath)) {
          customDirectories.value.push(dirPath)
        }
        await fetchLocalSkills()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to add custom directory:', err)
      throw err
    }
  }

  async function removeCustomDirectory(dirPath: string) {
    try {
      if (electronAPI?.skills?.removeCustomDir) {
        await electronAPI.skills.removeCustomDir(dirPath)
        customDirectories.value = customDirectories.value.filter(d => d !== dirPath)
        if (selectedDirectory.value === dirPath) {
          selectedDirectory.value = null
        }
        await fetchLocalSkills()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to remove custom directory:', err)
      throw err
    }
  }

  async function loadCustomDirectories() {
    try {
      if (electronAPI?.skills?.getCustomDirs) {
        const data = await electronAPI.skills.getCustomDirs()
        customDirectories.value = data.directories || []
      }
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
    categoryStats,
    categoriesWithCount,
    fetchLocalSkills,
    installSkill,
    uninstallSkill,
    addCustomDirectory,
    removeCustomDirectory,
    loadCustomDirectories,
    selectCategory,
    selectDirectory,
    setSearchQuery,
    setViewMode
  }
})
