import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type MCPServerType = 'stdio' | 'sse' | 'http'

export interface MCPServer {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  enabled: boolean
  type?: MCPServerType
  url?: string
  headers?: Record<string, string>
  _source?: string
}

export interface McpToolInfo {
  name: string
  description?: string
  annotations?: {
    readOnly?: boolean
    destructive?: boolean
    openWorld?: boolean
  }
}

export interface McpRuntimeStatus {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  serverInfo?: { name: string; version: string }
  error?: string
  tools?: McpToolInfo[]
}

const MCP_STORAGE_KEY = 'claude_desktop_mcp_servers'

// Get electron API
const electronAPI = (window as any).electronAPI

export const useMcpStore = defineStore('mcp', () => {
  const servers = ref<Record<string, MCPServer>>({})
  const runtimeStatus = ref<McpRuntimeStatus[]>([])
  const loading = ref(false)
  const runtimeLoading = ref(false)
  const error = ref<string | null>(null)
  const activeSessionId = ref<string | null>(null)

  const serverList = computed(() => Object.entries(servers.value).map(([name, server]) => ({
    ...server,
    name
  })))

  const enabledCount = computed(() =>
    Object.values(servers.value).filter(s => s.enabled !== false).length
  )

  const serverCount = computed(() => Object.keys(servers.value).length)

  async function fetchServers() {
    loading.value = true
    error.value = null
    try {
      if (electronAPI?.mcp?.getServers) {
        const data = await electronAPI.mcp.getServers()
        if (data.mcpServers) {
          servers.value = data.mcpServers
        }
      } else {
        // Fallback: load from localStorage
        const stored = localStorage.getItem(MCP_STORAGE_KEY)
        if (stored) {
          servers.value = JSON.parse(stored)
        }
      }
    } catch (err) {
      console.error('Failed to fetch MCP servers:', err)
      error.value = 'Failed to connect to API'
    } finally {
      loading.value = false
    }
  }

  async function fetchRuntimeStatus() {
    runtimeLoading.value = true
    try {
      const claudeCode = electronAPI?.claudeCode
      if (!claudeCode?.getMcpStatus) return

      // 1. 找一个正在运行的 engine session。
      //    MCP 连接只在 engine session 启动后才会建立（由 engine 在
      //    initialize 时去 spawn stdio / 连 SSE / HTTP），所以没有
      //    active session 就拿不到 runtime 状态。
      let sessionId: string | null = null
      if (typeof claudeCode.getActiveSessions === 'function') {
        const sessions = await claudeCode.getActiveSessions()
        if (Array.isArray(sessions) && sessions.length > 0) {
          const first = sessions[0] as { sessionId?: string; id?: string }
          sessionId = first.sessionId ?? first.id ?? null
        }
      }

      if (!sessionId) {
        activeSessionId.value = null
        runtimeStatus.value = []
        return
      }

      // 2. 拉取该 session 的 MCP 运行时状态。
      //    引擎返回的 schema 是 { mcpServers: McpServerStatus[] }
      //    （见 engine/src/cli/print.ts:2972-2975 的 mcp_status handler）
      const data = await claudeCode.getMcpStatus(sessionId)
      if (data && Array.isArray((data as any).mcpServers)) {
        runtimeStatus.value = (data as any).mcpServers as McpRuntimeStatus[]
        activeSessionId.value = sessionId
      } else {
        activeSessionId.value = sessionId
        runtimeStatus.value = []
      }
    } catch (err) {
      console.error('Failed to fetch runtime status:', err)
    } finally {
      runtimeLoading.value = false
    }
  }

  async function addServer(name: string, server: Omit<MCPServer, 'id' | 'name'>) {
    try {
      const newServer = { ...server, id: crypto.randomUUID(), name }
      if (electronAPI?.mcp?.addServer) {
        await electronAPI.mcp.addServer(name, server)
      }
      servers.value = { ...servers.value, [name]: newServer }
      localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers.value))
    } catch (err) {
      console.error('Failed to add MCP server:', err)
      throw err
    }
  }

  async function updateServer(name: string, server: Omit<MCPServer, 'id' | 'name'>, originalName?: string) {
    try {
      let updated = { ...servers.value }

      if (originalName && originalName !== name) {
        const original = servers.value[originalName]
        delete updated[originalName]
        updated[name] = { ...server, id: original?.id || crypto.randomUUID(), name, _source: original?._source }
      } else {
        const original = servers.value[name]
        updated[name] = { ...server, id: original?.id || crypto.randomUUID(), name, _source: original?._source }
      }

      if (electronAPI?.mcp?.updateServers) {
        await electronAPI.mcp.updateServers(updated)
      }
      servers.value = updated
      localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers.value))
      return true
    } catch (err) {
      console.error('Failed to update MCP server:', err)
      throw err
    }
  }

  async function deleteServer(name: string) {
    try {
      if (electronAPI?.mcp?.deleteServer) {
        await electronAPI.mcp.deleteServer(name)
      }
      const updated = { ...servers.value }
      delete updated[name]
      servers.value = updated
      localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers.value))
      return true
    } catch (err) {
      console.error('Failed to delete MCP server:', err)
      throw err
    }
  }

  async function toggleServerEnabled(name: string, enabled: boolean) {
    try {
      const updated = { ...servers.value }
      if (updated[name]) {
        updated[name] = { ...updated[name], enabled }
      }

      if (electronAPI?.mcp?.updateServers) {
        await electronAPI.mcp.updateServers(updated)
      }
      servers.value = updated
      localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers.value))
    } catch (err) {
      console.error('Failed to toggle MCP server:', err)
      await fetchServers()
    }
  }

  async function reconnectServer(serverName: string) {
    if (!activeSessionId.value) return
    try {
      if (electronAPI?.mcp?.reconnectServer) {
        await electronAPI.mcp.reconnectServer(activeSessionId.value, serverName)
      }
    } catch (err) {
      console.error('Failed to reconnect server:', err)
    }
  }

  async function toggleServerRuntime(serverName: string, enabled: boolean) {
    if (!activeSessionId.value) return
    try {
      if (electronAPI?.mcp?.toggleServerRuntime) {
        await electronAPI.mcp.toggleServerRuntime(activeSessionId.value, serverName, enabled)
      }
    } catch (err) {
      console.error('Failed to toggle server runtime:', err)
    }
  }

  async function saveJsonConfig(jsonStr: string) {
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, Omit<MCPServer, 'id' | 'name'>>

      const claudeJsonServers: Record<string, MCPServer> = {}
      for (const [name, server] of Object.entries(servers.value)) {
        if (server._source === 'claude.json') {
          claudeJsonServers[name] = server
        }
      }

      const settingsServers: Record<string, MCPServer> = {}
      for (const [name, server] of Object.entries(parsed)) {
        settingsServers[name] = { ...server, id: crypto.randomUUID(), name, _source: 'settings.json' }
      }

      const merged = { ...claudeJsonServers, ...settingsServers }

      if (electronAPI?.mcp?.updateServers) {
        await electronAPI.mcp.updateServers(merged)
      }
      servers.value = merged
      localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers.value))
    } catch (err) {
      console.error('Failed to save MCP config:', err)
      throw err
    }
  }

  function getRuntimeStatusForServer(name: string): McpRuntimeStatus | undefined {
    return runtimeStatus.value.find(s => s.name === name)
  }

  return {
    servers,
    serverList,
    runtimeStatus,
    loading,
    runtimeLoading,
    error,
    activeSessionId,
    enabledCount,
    serverCount,
    fetchServers,
    fetchRuntimeStatus,
    addServer,
    updateServer,
    deleteServer,
    toggleServerEnabled,
    reconnectServer,
    toggleServerRuntime,
    saveJsonConfig,
    getRuntimeStatusForServer
  }
})
