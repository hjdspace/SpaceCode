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

export interface McpProbeResult {
  status: 'connected' | 'failed' | 'probing'
  serverInfo?: { name: string; version: string }
  tools?: McpToolInfo[]
  error?: string
  probedAt?: number
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

/** Strip Vue reactive Proxy — Electron IPC uses structured clone which
 *  cannot serialize Proxy objects, causing "An object could not be cloned". */
function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export const useMcpStore = defineStore('mcp', () => {
  const servers = ref<Record<string, MCPServer>>({})
  const runtimeStatus = ref<McpRuntimeStatus[]>([])
  const loading = ref(false)
  const runtimeLoading = ref(false)
  const error = ref<string | null>(null)
  const activeSessionId = ref<string | null>(null)
  const probeResults = ref<Record<string, McpProbeResult>>({})

  const serverList = computed(() => Object.entries(servers.value).map(([name, server]) => ({
    ...server,
    name
  })))

  const enabledCount = computed(() =>
    Object.values(servers.value).filter(s => s.enabled !== false).length
  )

  const serverCount = computed(() => Object.keys(servers.value).length)

  /** Normalize raw server data from IPC or localStorage into MCPServer records */
  function normalizeServers(raw: Record<string, any>): Record<string, MCPServer> {
    // Handle double-nested { mcpServers: { ... } } that may slip through
    if (raw.mcpServers && typeof raw.mcpServers === 'object' && !raw.command && !raw.type) {
      raw = raw.mcpServers
    }

    const result: Record<string, MCPServer> = {}
    for (const [name, server] of Object.entries(raw)) {
      if (!server || typeof server !== 'object') continue
      // Skip keys that look like wrapper objects rather than server configs
      if (name === 'mcpServers') continue
      result[name] = {
        id: server.id || crypto.randomUUID(),
        name: server.name || name,
        command: server.command ?? '',
        args: server.args || [],
        env: server.env || {},
        enabled: server.enabled !== false,
        type: server.type,
        url: server.url,
        headers: server.headers,
        _source: server._source,
      }
    }
    return result
  }

  async function fetchServers() {
    loading.value = true
    error.value = null
    try {
      if (electronAPI?.mcp?.getServers) {
        const data = await electronAPI.mcp.getServers()
        if (data?.mcpServers) {
          servers.value = normalizeServers(data.mcpServers)
        }
      } else {
        // Fallback: load from localStorage
        const stored = localStorage.getItem(MCP_STORAGE_KEY)
        if (stored) {
          servers.value = normalizeServers(JSON.parse(stored))
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
        await electronAPI.mcp.addServer(name, toPlain(server))
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
        await electronAPI.mcp.updateServers(toPlain(updated))
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

      if (electronAPI?.mcp?.toggleEnabled) {
        await electronAPI.mcp.toggleEnabled(name, enabled)
      } else if (electronAPI?.mcp?.updateServers) {
        await electronAPI.mcp.updateServers(toPlain(updated))
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
        await electronAPI.mcp.updateServers(toPlain(merged))
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

  function getProbeResult(name: string): McpProbeResult | undefined {
    return probeResults.value[name]
  }

  async function probeServer(name: string) {
    const server = servers.value[name]
    if (!server) return

    probeResults.value = {
      ...probeResults.value,
      [name]: { status: 'probing', probedAt: Date.now() },
    }

    try {
      const config = {
        type: server.type || 'stdio',
        command: server.command || undefined,
        args: server.args || [],
        env: server.env || {},
        url: server.url || undefined,
        headers: server.headers || {},
      }

      const result = await electronAPI?.mcp?.probeServer(toPlain(config))
      if (result) {
        probeResults.value = {
          ...probeResults.value,
          [name]: {
            ...result,
            probedAt: Date.now(),
          },
        }
      } else {
        probeResults.value = {
          ...probeResults.value,
          [name]: { status: 'failed', error: 'No response from probe', probedAt: Date.now() },
        }
      }
    } catch (err) {
      probeResults.value = {
        ...probeResults.value,
        [name]: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          probedAt: Date.now(),
        },
      }
    }
  }

  /** Collect all MCP tools from probe results and runtime status */
  const allMcpTools = computed<{ serverName: string; tool: McpToolInfo }[]>(() => {
    const tools: { serverName: string; tool: McpToolInfo }[] = []
    const seen = new Set<string>()

    // 1) From probe results (has description)
    for (const [serverName, probe] of Object.entries(probeResults.value)) {
      if (probe.status === 'connected' && probe.tools) {
        for (const tool of probe.tools) {
          const key = `${serverName}::${tool.name}`
          if (!seen.has(key)) {
            seen.add(key)
            tools.push({ serverName, tool })
          }
        }
      }
    }

    // 2) From runtime status
    for (const rs of runtimeStatus.value) {
      if (rs.tools) {
        for (const tool of rs.tools) {
          const key = `${rs.name}::${tool.name}`
          if (!seen.has(key)) {
            seen.add(key)
            tools.push({ serverName: rs.name, tool })
          }
        }
      }
    }

    return tools
  })

  async function probeAllServers() {
    const names = Object.keys(servers.value).filter(
      n => servers.value[n].enabled !== false
    )
    await Promise.allSettled(names.map(n => probeServer(n)))
  }

  return {
    servers,
    serverList,
    runtimeStatus,
    loading,
    runtimeLoading,
    error,
    activeSessionId,
    probeResults,
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
    getRuntimeStatusForServer,
    getProbeResult,
    probeServer,
    probeAllServers,
    allMcpTools
  }
})
