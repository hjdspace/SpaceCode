import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'

export interface AgentDef {
  name: string
  description: string
  content: string
  tools?: string[]
  model?: string
  color?: string
  sourceDir: string
  agentPath: string
  isInstalled: boolean
  installedScope?: 'global' | 'project'
  category: string
  mode?: 'work' | 'code'
  avatar?: string
  permission?: string
  skills?: string[]
  mcps?: string[]
  recommendedPrompts?: string[]
  descriptionZh?: string
  recommendedPromptsZh?: string[]

  // ===== Phase 4 新增 =====
  /** 技能是否为必须（缺则无法启动会话）。 */
  skillsRequired?: boolean
  /** 技能依赖的运行时，用于可用性检测。 */
  skillRuntime?: 'officecli' | 'node' | 'none'
  /** 技能描述（用于 UI 展示，非技能名）。 */
  skillDescriptions?: string[]
}

export interface AgentCategory {
  id: string
  label: string
  icon: string
  color: string
}

export const AGENT_CATEGORIES: AgentCategory[] = [
  { id: 'all', label: '全部', icon: 'Grid3x3', color: '#6b7280' },
  { id: 'reviewer', label: '代码审查', icon: 'Shield', color: '#10b981' },
  { id: 'builder', label: '构建修复', icon: 'Wrench', color: '#f59e0b' },
  { id: 'architect', label: '架构设计', icon: 'Compass', color: '#8b5cf6' },
  { id: 'security', label: '安全', icon: 'Lock', color: '#ef4444' },
  { id: 'general', label: '通用', icon: 'Bot', color: '#3b82f6' },
]

export const useAgentsStore = defineStore('agents', () => {
  const libraryAgents = ref<AgentDef[]>([])
  const installedAgents = ref<AgentDef[]>([])
  const loading = ref(false)
  const installingName = ref<string | null>(null)
  const error = ref<string | null>(null)
  const selectedCategory = ref('all')
  const searchQuery = ref('')

  const filteredAgents = computed(() => {
    let result = libraryAgents.value
    if (selectedCategory.value !== 'all') {
      result = result.filter(a => a.category === selectedCategory.value)
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
      )
    }
    return result
  })

  const globalInstalled = computed(() => installedAgents.value.filter(a => a.installedScope === 'global'))
  const projectInstalled = computed(() => installedAgents.value.filter(a => a.installedScope === 'project'))

  const categoryStats = computed(() => {
    const stats: Record<string, number> = { all: libraryAgents.value.length }
    libraryAgents.value.forEach(a => {
      stats[a.category] = (stats[a.category] || 0) + 1
    })
    return stats
  })

  async function fetchLibrary(cwd?: string) {
    loading.value = true
    error.value = null
    try {
      const data = await api.agents.scanLibrary(cwd)
      libraryAgents.value = data.agents || []
    } catch (err) {
      console.error('Failed to fetch agent library:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch agent library'
    } finally {
      loading.value = false
    }
  }

  async function fetchInstalled(cwd?: string) {
    try {
      const data = await api.agents.getInstalled(cwd)
      installedAgents.value = data.agents || []
    } catch (err) {
      console.error('Failed to fetch installed agents:', err)
    }
  }

  async function installAgent(name: string, scope: 'global' | 'project', cwd?: string) {
    installingName.value = name
    try {
      await api.agents.install(name, scope, cwd)
      const agent = libraryAgents.value.find(a => a.name === name)
      if (agent) {
        agent.isInstalled = true
        agent.installedScope = scope
      }
      await fetchInstalled(cwd)
      return true
    } catch (err) {
      console.error('Failed to install agent:', err)
      throw err
    } finally {
      installingName.value = null
    }
  }

  async function uninstallAgent(name: string, scope: 'global' | 'project', cwd?: string) {
    try {
      await api.agents.uninstall(name, scope, cwd)
      const agent = libraryAgents.value.find(a => a.name === name)
      if (agent) {
        agent.isInstalled = false
        agent.installedScope = undefined
      }
      await fetchInstalled(cwd)
      return true
    } catch (err) {
      console.error('Failed to uninstall agent:', err)
      throw err
    }
  }

  function selectCategory(categoryId: string) {
    selectedCategory.value = categoryId
  }

  function setSearchQuery(query: string) {
    searchQuery.value = query
  }

  // Workflow state
  const workflows = ref<any[]>([])
  const workflowLoading = ref(false)

  async function fetchWorkflows() {
    workflowLoading.value = true
    try {
      const data = await api.agents.listWorkflows()
      workflows.value = data.workflows || []
    } catch (err) {
      console.error('Failed to fetch workflows:', err)
    } finally {
      workflowLoading.value = false
    }
  }

  async function saveWorkflow(workflow: any) {
    try {
      await api.agents.saveWorkflow(workflow)
      await fetchWorkflows()
      return true
    } catch (err) {
      console.error('Failed to save workflow:', err)
      throw err
    }
  }

  async function deleteWorkflow(id: string) {
    try {
      await api.agents.deleteWorkflow(id)
      await fetchWorkflows()
      return true
    } catch (err) {
      console.error('Failed to delete workflow:', err)
      throw err
    }
  }

  async function exportWorkflow(id: string, scope: 'global' | 'project', cwd?: string) {
    try {
      return await api.agents.exportWorkflow(id, scope, cwd)
    } catch (err) {
      console.error('Failed to export workflow:', err)
      throw err
    }
  }

  return {
    libraryAgents,
    installedAgents,
    loading,
    installingName,
    error,
    selectedCategory,
    searchQuery,
    filteredAgents,
    globalInstalled,
    projectInstalled,
    categoryStats,
    fetchLibrary,
    fetchInstalled,
    installAgent,
    uninstallAgent,
    selectCategory,
    setSearchQuery,
    workflows,
    workflowLoading,
    fetchWorkflows,
    saveWorkflow,
    deleteWorkflow,
    exportWorkflow,
  }
})
