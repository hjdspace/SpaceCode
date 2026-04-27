import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { TOOL_REGISTRY } from '@/lib/tool-registry'

export interface MCPServer {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
}

export interface ToolConfig {
  name: string
  enabled: boolean
}

const MCP_STORAGE_KEY = 'mcp_servers'
const TOOLS_STORAGE_KEY = 'tools_config'

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error(`[ConfigStore] Failed to load ${key} from storage:`, e)
  }
  return defaultValue
}

function saveToStorage<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error(`[ConfigStore] Failed to save ${key} to storage:`, e)
  }
}

export const useConfigStore = defineStore('config', () => {
  const mcpServers = ref<MCPServer[]>(
    loadFromStorage(MCP_STORAGE_KEY, [
      {
        id: 'default',
        name: 'Default Server',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
        env: {},
        enabled: true
      }
    ])
  )

  function getDefaultToolConfigs(): ToolConfig[] {
    return TOOL_REGISTRY.map(tool => ({
      name: tool.name,
      enabled: tool.availability === 'always',
    }))
  }

  const toolConfigs = ref<ToolConfig[]>(
    loadFromStorage(TOOLS_STORAGE_KEY, getDefaultToolConfigs())
  )

  const showMcpPanel = ref(false)
  const showToolsPanel = ref(false)

  watch(mcpServers, (val) => {
    saveToStorage(MCP_STORAGE_KEY, val)
  }, { deep: true })

  watch(toolConfigs, (val) => {
    saveToStorage(TOOLS_STORAGE_KEY, val)
  }, { deep: true })

  function addMCPServer(server: Omit<MCPServer, 'id'>) {
    mcpServers.value.push({
      ...server,
      id: crypto.randomUUID()
    })
  }

  function removeMCPServer(id: string) {
    const index = mcpServers.value.findIndex(s => s.id === id)
    if (index > -1) {
      mcpServers.value.splice(index, 1)
    }
  }

  function updateMCPServer(id: string, updates: Partial<MCPServer>) {
    const server = mcpServers.value.find(s => s.id === id)
    if (server) {
      Object.assign(server, updates)
    }
  }

  function toggleTool(toolName: string) {
    const tool = toolConfigs.value.find(t => t.name === toolName)
    if (tool) {
      tool.enabled = !tool.enabled
    }
  }

  function isToolEnabled(toolName: string): boolean {
    const tool = toolConfigs.value.find(t => t.name === toolName)
    return tool?.enabled ?? true
  }

  function getEnabledTools(): string[] {
    return toolConfigs.value.filter(t => t.enabled).map(t => t.name)
  }

  return {
    mcpServers,
    toolConfigs,
    showMcpPanel,
    showToolsPanel,
    addMCPServer,
    removeMCPServer,
    updateMCPServer,
    toggleTool,
    isToolEnabled,
    getEnabledTools
  }
})