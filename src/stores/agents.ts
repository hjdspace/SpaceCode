import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const electronAPI = window.electronAPI

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
      if (electronAPI?.agents?.scanLibrary) {
        const data = await electronAPI.agents.scanLibrary(cwd)
        libraryAgents.value = data.agents || []
      }
    } catch (err) {
      console.error('Failed to fetch agent library:', err)
      error.value = err instanceof Error ? err.message : 'Failed to fetch agent library'
    } finally {
      loading.value = false
    }
  }

  async function fetchInstalled(cwd?: string) {
    try {
      if (electronAPI?.agents?.getInstalled) {
        const data = await electronAPI.agents.getInstalled(cwd)
        installedAgents.value = data.agents || []
      }
    } catch (err) {
      console.error('Failed to fetch installed agents:', err)
    }
  }

  async function installAgent(name: string, scope: 'global' | 'project', cwd?: string) {
    installingName.value = name
    try {
      if (electronAPI?.agents?.install) {
        await electronAPI.agents.install(name, scope, cwd)
        const agent = libraryAgents.value.find(a => a.name === name)
        if (agent) {
          agent.isInstalled = true
          agent.installedScope = scope
        }
        await fetchInstalled(cwd)
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to install agent:', err)
      throw err
    } finally {
      installingName.value = null
    }
  }

  async function uninstallAgent(name: string, scope: 'global' | 'project', cwd?: string) {
    try {
      if (electronAPI?.agents?.uninstall) {
        await electronAPI.agents.uninstall(name, scope, cwd)
        const agent = libraryAgents.value.find(a => a.name === name)
        if (agent) {
          agent.isInstalled = false
          agent.installedScope = undefined
        }
        await fetchInstalled(cwd)
        return true
      }
      return false
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
      if (electronAPI?.agents?.listWorkflows) {
        const data = await electronAPI.agents.listWorkflows()
        workflows.value = data.workflows || []
      }
    } catch (err) {
      console.error('Failed to fetch workflows:', err)
    } finally {
      workflowLoading.value = false
    }
  }

  async function saveWorkflow(workflow: any) {
    try {
      if (electronAPI?.agents?.saveWorkflow) {
        await electronAPI.agents.saveWorkflow(workflow)
        await fetchWorkflows()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to save workflow:', err)
      throw err
    }
  }

  async function deleteWorkflow(id: string) {
    try {
      if (electronAPI?.agents?.deleteWorkflow) {
        await electronAPI.agents.deleteWorkflow(id)
        await fetchWorkflows()
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to delete workflow:', err)
      throw err
    }
  }

  async function exportWorkflow(id: string, scope: 'global' | 'project', cwd?: string) {
    try {
      if (electronAPI?.agents?.exportWorkflow) {
        return await electronAPI.agents.exportWorkflow(id, scope, cwd)
      }
      return null
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
