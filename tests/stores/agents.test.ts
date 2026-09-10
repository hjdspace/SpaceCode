/**
 * Agents store tests — filtering, install/uninstall lifecycle,
 * category stats, and workflow CRUD.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  agents: {
    scanLibrary: vi.fn(),
    getInstalled: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    listWorkflows: vi.fn(),
    saveWorkflow: vi.fn(),
    deleteWorkflow: vi.fn(),
    exportWorkflow: vi.fn(),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))

import { useAgentsStore, AGENT_CATEGORIES } from '@/stores/agents'

function makeAgent(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    name: 'test-agent',
    description: 'A test agent',
    content: 'You are a test agent',
    sourceDir: '/agents',
    agentPath: '/agents/test-agent.md',
    isInstalled: false,
    category: 'general',
    ...overrides,
  }
}

describe('agents store — initial state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with empty library and installed agents', () => {
    const store = useAgentsStore()
    expect(store.libraryAgents).toEqual([])
    expect(store.installedAgents).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(store.selectedCategory).toBe('all')
    expect(store.searchQuery).toBe('')
  })

  it('AGENT_CATEGORIES has expected entries', () => {
    expect(AGENT_CATEGORIES.length).toBeGreaterThan(0)
    expect(AGENT_CATEGORIES.find(c => c.id === 'all')).toBeDefined()
    expect(AGENT_CATEGORIES.find(c => c.id === 'reviewer')).toBeDefined()
  })
})

describe('agents store — fetchLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('fetches library and populates libraryAgents', async () => {
    const mockAgents = [makeAgent({ name: 'a1' }), makeAgent({ name: 'a2' })]
    apiMocks.agents.scanLibrary.mockResolvedValue({ agents: mockAgents })

    const store = useAgentsStore()
    await store.fetchLibrary('/repo')

    expect(store.libraryAgents).toEqual(mockAgents)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('handles fetch error and sets error', async () => {
    apiMocks.agents.scanLibrary.mockRejectedValue(new Error('network'))

    const store = useAgentsStore()
    await store.fetchLibrary()

    expect(store.loading).toBe(false)
    expect(store.error).toBe('network')
  })

  it('handles empty agents response', async () => {
    apiMocks.agents.scanLibrary.mockResolvedValue({})

    const store = useAgentsStore()
    await store.fetchLibrary()

    expect(store.libraryAgents).toEqual([])
  })
})

describe('agents store — fetchInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('fetches installed agents and populates installedAgents', async () => {
    const mockInstalled = [makeAgent({ name: 'a1', isInstalled: true, installedScope: 'global' })]
    apiMocks.agents.getInstalled.mockResolvedValue({ agents: mockInstalled })

    const store = useAgentsStore()
    await store.fetchInstalled('/repo')

    expect(store.installedAgents).toEqual(mockInstalled)
  })

  it('handles fetch error silently', async () => {
    apiMocks.agents.getInstalled.mockRejectedValue(new Error('fail'))

    const store = useAgentsStore()
    await store.fetchInstalled()
    // Error is caught and logged, no state change
    expect(store.installedAgents).toEqual([])
  })
})

describe('agents store — installAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('installs agent and updates library + installed lists', async () => {
    const agent = makeAgent({ name: 'coder', isInstalled: false })
    apiMocks.agents.scanLibrary.mockResolvedValue({ agents: [agent] })
    apiMocks.agents.install.mockResolvedValue(undefined)
    apiMocks.agents.getInstalled.mockResolvedValue({
      agents: [{ ...agent, isInstalled: true, installedScope: 'project' }],
    })

    const store = useAgentsStore()
    await store.fetchLibrary()
    await store.installAgent('coder', 'project', '/repo')

    expect(apiMocks.agents.install).toHaveBeenCalledWith('coder', 'project', '/repo')
    expect(store.libraryAgents[0].isInstalled).toBe(true)
    expect(store.libraryAgents[0].installedScope).toBe('project')
    expect(store.installingName).toBeNull()
  })

  it('propagates install error and clears installingName', async () => {
    const agent = makeAgent({ name: 'coder' })
    apiMocks.agents.scanLibrary.mockResolvedValue({ agents: [agent] })
    apiMocks.agents.install.mockRejectedValue(new Error('install failed'))

    const store = useAgentsStore()
    await store.fetchLibrary()

    await expect(store.installAgent('coder', 'global')).rejects.toThrow('install failed')
    expect(store.installingName).toBeNull()
  })
})

describe('agents store — uninstallAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('uninstalls agent and updates library', async () => {
    const agent = makeAgent({ name: 'coder', isInstalled: true, installedScope: 'global' })
    apiMocks.agents.scanLibrary.mockResolvedValue({ agents: [agent] })
    apiMocks.agents.uninstall.mockResolvedValue(undefined)
    apiMocks.agents.getInstalled.mockResolvedValue({ agents: [] })

    const store = useAgentsStore()
    await store.fetchLibrary()
    await store.uninstallAgent('coder', 'global', '/repo')

    expect(apiMocks.agents.uninstall).toHaveBeenCalledWith('coder', 'global', '/repo')
    expect(store.libraryAgents[0].isInstalled).toBe(false)
    expect(store.libraryAgents[0].installedScope).toBeUndefined()
  })

  it('propagates uninstall error', async () => {
    apiMocks.agents.scanLibrary.mockResolvedValue({ agents: [] })
    apiMocks.agents.uninstall.mockRejectedValue(new Error('uninstall failed'))

    const store = useAgentsStore()
    await store.fetchLibrary()
    await expect(store.uninstallAgent('x', 'project')).rejects.toThrow('uninstall failed')
  })
})

describe('agents store — filtering', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('filteredAgents returns all when category=all and no search', () => {
    const store = useAgentsStore()
    store.libraryAgents = [
      makeAgent({ name: 'alpha', category: 'general' }),
      makeAgent({ name: 'beta', category: 'reviewer' }),
    ]
    expect(store.filteredAgents).toHaveLength(2)
  })

  it('filteredAgents filters by category', () => {
    const store = useAgentsStore()
    store.libraryAgents = [
      makeAgent({ name: 'alpha', category: 'general' }),
      makeAgent({ name: 'beta', category: 'reviewer' }),
      makeAgent({ name: 'gamma', category: 'reviewer' }),
    ]
    store.selectCategory('reviewer')
    expect(store.filteredAgents).toHaveLength(2)
    expect(store.filteredAgents.every(a => a.category === 'reviewer')).toBe(true)
  })

  it('filteredAgents filters by search query (name match)', () => {
    const store = useAgentsStore()
    store.libraryAgents = [
      makeAgent({ name: 'code-reviewer', description: 'x' }),
      makeAgent({ name: 'builder', description: 'x' }),
    ]
    store.setSearchQuery('code')
    expect(store.filteredAgents).toHaveLength(1)
    expect(store.filteredAgents[0].name).toBe('code-reviewer')
  })

  it('filteredAgents filters by search query (description match)', () => {
    const store = useAgentsStore()
    store.libraryAgents = [
      makeAgent({ name: 'a', description: 'Reviews code quality' }),
      makeAgent({ name: 'b', description: 'Builds stuff' }),
    ]
    store.setSearchQuery('review')
    expect(store.filteredAgents).toHaveLength(1)
    expect(store.filteredAgents[0].name).toBe('a')
  })

  it('filteredAgents combines category + search', () => {
    const store = useAgentsStore()
    store.libraryAgents = [
      makeAgent({ name: 'code-reviewer', description: 'x', category: 'reviewer' }),
      makeAgent({ name: 'security-check', description: 'x', category: 'reviewer' }),
      makeAgent({ name: 'builder', description: 'x', category: 'builder' }),
    ]
    store.selectCategory('reviewer')
    store.setSearchQuery('code')
    expect(store.filteredAgents).toHaveLength(1)
    expect(store.filteredAgents[0].name).toBe('code-reviewer')
  })

  it('filteredAgents is case-insensitive', () => {
    const store = useAgentsStore()
    store.libraryAgents = [makeAgent({ name: 'CodeReviewer', description: 'x' })]
    store.setSearchQuery('codereviewer')
    expect(store.filteredAgents).toHaveLength(1)
  })
})

describe('agents store — computed properties', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('globalInstalled filters by installedScope=global', () => {
    const store = useAgentsStore()
    store.installedAgents = [
      makeAgent({ name: 'a', installedScope: 'global' }),
      makeAgent({ name: 'b', installedScope: 'project' }),
    ]
    expect(store.globalInstalled).toHaveLength(1)
    expect(store.globalInstalled[0].name).toBe('a')
  })

  it('projectInstalled filters by installedScope=project', () => {
    const store = useAgentsStore()
    store.installedAgents = [
      makeAgent({ name: 'a', installedScope: 'global' }),
      makeAgent({ name: 'b', installedScope: 'project' }),
    ]
    expect(store.projectInstalled).toHaveLength(1)
    expect(store.projectInstalled[0].name).toBe('b')
  })

  it('categoryStats counts agents per category', () => {
    const store = useAgentsStore()
    store.libraryAgents = [
      makeAgent({ name: 'a', category: 'general' }),
      makeAgent({ name: 'b', category: 'reviewer' }),
      makeAgent({ name: 'c', category: 'reviewer' }),
    ]
    const stats = store.categoryStats
    expect(stats.all).toBe(3)
    expect(stats.reviewer).toBe(2)
    expect(stats.general).toBe(1)
  })

  it('categoryStats with empty library returns { all: 0 }', () => {
    const store = useAgentsStore()
    expect(store.categoryStats).toEqual({ all: 0 })
  })
})

describe('agents store — selectCategory & setSearchQuery', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('selectCategory updates selectedCategory', () => {
    const store = useAgentsStore()
    store.selectCategory('reviewer')
    expect(store.selectedCategory).toBe('reviewer')
  })

  it('setSearchQuery updates searchQuery', () => {
    const store = useAgentsStore()
    store.setSearchQuery('test query')
    expect(store.searchQuery).toBe('test query')
  })
})

describe('agents store — workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('fetchWorkflows populates workflows array', async () => {
    const mockWorkflows = [{ id: '1', name: 'wf1' }]
    apiMocks.agents.listWorkflows.mockResolvedValue({ workflows: mockWorkflows })

    const store = useAgentsStore()
    await store.fetchWorkflows()

    expect(store.workflows).toEqual(mockWorkflows)
    expect(store.workflowLoading).toBe(false)
  })

  it('fetchWorkflows handles error gracefully', async () => {
    apiMocks.agents.listWorkflows.mockRejectedValue(new Error('fail'))

    const store = useAgentsStore()
    await store.fetchWorkflows()

    expect(store.workflowLoading).toBe(false)
    expect(store.workflows).toEqual([])
  })

  it('saveWorkflow calls api and refreshes', async () => {
    apiMocks.agents.saveWorkflow.mockResolvedValue(undefined)
    apiMocks.agents.listWorkflows.mockResolvedValue({ workflows: [{ id: '1' }] })

    const store = useAgentsStore()
    await store.saveWorkflow({ name: 'new wf' })

    expect(apiMocks.agents.saveWorkflow).toHaveBeenCalledWith({ name: 'new wf' })
    expect(store.workflows).toHaveLength(1)
  })

  it('saveWorkflow propagates error', async () => {
    apiMocks.agents.saveWorkflow.mockRejectedValue(new Error('save failed'))

    const store = useAgentsStore()
    await expect(store.saveWorkflow({})).rejects.toThrow('save failed')
  })

  it('deleteWorkflow calls api and refreshes', async () => {
    apiMocks.agents.deleteWorkflow.mockResolvedValue(undefined)
    apiMocks.agents.listWorkflows.mockResolvedValue({ workflows: [] })

    const store = useAgentsStore()
    await store.deleteWorkflow('wf-1')

    expect(apiMocks.agents.deleteWorkflow).toHaveBeenCalledWith('wf-1')
    expect(store.workflows).toEqual([])
  })

  it('deleteWorkflow propagates error', async () => {
    apiMocks.agents.deleteWorkflow.mockRejectedValue(new Error('del fail'))

    const store = useAgentsStore()
    await expect(store.deleteWorkflow('x')).rejects.toThrow('del fail')
  })

  it('exportWorkflow calls api and returns result', async () => {
    const mockResult = { path: '/exported/wf.json' }
    apiMocks.agents.exportWorkflow.mockResolvedValue(mockResult)

    const store = useAgentsStore()
    const result = await store.exportWorkflow('wf-1', 'global', '/repo')

    expect(apiMocks.agents.exportWorkflow).toHaveBeenCalledWith('wf-1', 'global', '/repo')
    expect(result).toEqual(mockResult)
  })

  it('exportWorkflow propagates error', async () => {
    apiMocks.agents.exportWorkflow.mockRejectedValue(new Error('export fail'))

    const store = useAgentsStore()
    await expect(store.exportWorkflow('x', 'global')).rejects.toThrow('export fail')
  })
})
