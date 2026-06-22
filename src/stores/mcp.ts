import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  BUILTIN_MCP_PRESETS,
  BUILTIN_MCP_SOURCE,
  isBuiltinServer,
} from '@/lib/builtinMcp'

/** 内置 MCP 依赖命令的检测结果（来自 electron 的 EnvItemStatus）*/
export interface McpDependencyStatus {
  available: boolean
  version: string | null
  path: string | null
}

/** 内置 MCP 依赖安装进度（来自 electron 的 InstallProgress）*/
export interface McpInstallProgress {
  stage: 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  message: string
  percent?: number
}

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

import { api } from '@/services/electronAPI'

const MCP_STORAGE_KEY = 'claude_desktop_mcp_servers'

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

  // ── 内置 MCP 依赖检测 / 一键安装 ──
  /** 按命令名（如 'uvx' / 'npx'）缓存的依赖检测结果 */
  const dependencyStatus = ref<Record<string, McpDependencyStatus>>({})
  /** 当前正在安装的安装器标识（如 'uv'），null 表示空闲 */
  const installingDependency = ref<string | null>(null)
  /** 当前安装进度（仅 installingDependency 非空时有效） */
  const installProgress = ref<McpInstallProgress | null>(null)
  /** 最近一次依赖安装失败的错误信息（成功后清空） */
  const installError = ref<string | null>(null)
  /** electron IPC 进度订阅句柄，store 销毁时复用 */
  let installProgressUnsub: (() => void) | null = null

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

  /**
   * 同步内置 MCP 预设到已加载的服务器列表。
   *
   * 行为约定：
   * - 内置预设默认 **disabled**（它们依赖 uv/npx 与浏览器扩展等外部环境，
   *   自动启用可能触发连接失败）。用户在 UI 上手动开启后才生效。
   * - 如果某个内置服务器已经存在于配置中（用户之前开关过/改过），**保留
   *   用户的现有状态**（enabled、args、env 等都不覆盖），只补上 `_source`
   *   标记与缺失字段。
   * - 仅在内存里合并；持久化由调用方（fetchServers）在有变化时触发一次。
   *
   * @returns 是否发生了变更（需要持久化）
   */
  function syncBuiltinServers(existing: Record<string, MCPServer>): { servers: Record<string, MCPServer>; changed: boolean } {
    let changed = false
    const merged: Record<string, MCPServer> = { ...existing }

    for (const preset of BUILTIN_MCP_PRESETS) {
      const current = merged[preset.key]
      if (current) {
        // 已存在：保留用户状态，仅确保 _source 标记存在
        if (current._source !== BUILTIN_MCP_SOURCE) {
          merged[preset.key] = { ...current, _source: BUILTIN_MCP_SOURCE }
          changed = true
        }
        continue
      }

      // 不存在：注入默认（disabled）的内置服务器
      merged[preset.key] = {
        id: crypto.randomUUID(),
        name: preset.name,
        command: preset.config.command ?? '',
        args: preset.config.args ?? [],
        env: preset.config.env ?? {},
        enabled: false,
        type: preset.config.type,
        url: preset.config.url,
        headers: preset.config.headers,
        _source: BUILTIN_MCP_SOURCE,
      }
      changed = true
    }

    return { servers: merged, changed }
  }

  async function fetchServers() {
    loading.value = true
    error.value = null
    try {
      let rawServers: Record<string, MCPServer> = {}
      const data = await api.mcp.getServers()
      if (data?.mcpServers) {
        rawServers = normalizeServers(data.mcpServers)
      } else {
        // Fallback: load from localStorage
        const stored = localStorage.getItem(MCP_STORAGE_KEY)
        if (stored) {
          rawServers = normalizeServers(JSON.parse(stored))
        }
      }

      // 注入/同步内置 MCP 预设（默认 disabled，不覆盖用户已改过的状态）
      const { servers: merged, changed } = syncBuiltinServers(rawServers)
      servers.value = merged

      // 把新增的内置预设持久化一次，保证下次加载时状态一致
      if (changed) {
        try {
          await api.mcp.updateServers(toPlain(merged))
        } catch (err) {
          console.error('Failed to persist builtin MCP presets:', err)
        }
      }
      if (changed) {
        localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(merged))
      }
    } catch (err) {
      console.error('Failed to fetch MCP servers:', err)
      error.value = 'Failed to connect to API'
    } finally {
      loading.value = false
    }

    // 拉完服务器列表后，顺手把内置 MCP 的依赖命令也探一遍，让 UI 立刻
    // 显示「已安装/未安装」状态。失败不阻塞 fetchServers 主流程。
    checkAllBuiltinDependencies().catch(err =>
      console.warn('Failed to check builtin MCP dependencies:', err)
    )
  }

  /**
   * 并行检测所有内置 MCP 预设声明的依赖命令是否在 PATH 上可用，
   * 把结果写入 dependencyStatus（按命令名去重）。
   */
  async function checkAllBuiltinDependencies() {
    const commands = new Set<string>()
    for (const preset of BUILTIN_MCP_PRESETS) {
      if (preset.dependency?.command) commands.add(preset.dependency.command)
    }
    await Promise.allSettled(
      Array.from(commands).map(async cmd => {
        const result = await api.mcp.checkDependency(cmd)
        if (result && typeof result === 'object') {
          dependencyStatus.value = { ...dependencyStatus.value, [cmd]: result }
        }
      })
    )
  }

  /**
   * 单独检测某个命令（用于安装后立刻刷新状态）。
   */
  async function checkDependency(command: string): Promise<McpDependencyStatus | null> {
    const result = await api.mcp.checkDependency(command)
    if (result && typeof result === 'object') {
      dependencyStatus.value = { ...dependencyStatus.value, [command]: result }
      return result
    }
    return null
  }

  /**
   * 一键安装某个依赖（当前 installer 仅支持 'uv'，安装后会提供 uvx 命令）。
   *
   * 副作用：
   * - 订阅 mcp:installProgress 通道实时更新 installProgress；
   * - 完成后重新 checkAllBuiltinDependencies；
   * - 若安装成功，对所有依赖该命令的内置 MCP 自动 probe 一次，让连接状态即时刷新。
   */
  async function installDependency(installer: 'uv'): Promise<{ success: boolean; error?: string }> {
    if (installingDependency.value) {
      return { success: false, error: 'Another installation is in progress' }
    }
    installingDependency.value = installer
    installError.value = null
    installProgress.value = { stage: 'downloading', message: 'Starting...', percent: 0 }

    // 订阅安装进度
    installProgressUnsub?.()
    installProgressUnsub = api.mcp.onInstallProgress((progress: McpInstallProgress) => {
      installProgress.value = progress
    })

    try {
      const result = await api.mcp.installDependency(installer)
      if (result?.success) {
        // 重新检测所有依赖，并对依赖刚装好的命令的内置 MCP 触发一次 probe
        await checkAllBuiltinDependencies()
        for (const preset of BUILTIN_MCP_PRESETS) {
          if (preset.dependency?.installer === installer) {
            probeServer(preset.key).catch(() => {})
          }
        }
        return { success: true }
      }
      installError.value = result?.error || 'Installation failed'
      return { success: false, error: installError.value || undefined }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      installError.value = msg
      return { success: false, error: msg }
    } finally {
      installingDependency.value = null
      installProgressUnsub?.()
      installProgressUnsub = null
    }
  }

  async function fetchRuntimeStatus() {
    runtimeLoading.value = true
    try {
      const claudeCode = api.claudeCode
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
      await api.mcp.addServer(name, toPlain(server))
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

      await api.mcp.updateServers(toPlain(updated))
      servers.value = updated
      localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers.value))
      return true
    } catch (err) {
      console.error('Failed to update MCP server:', err)
      throw err
    }
  }

  async function deleteServer(name: string) {
    // 内置 MCP 不允许删除，只能在 UI 上关闭。删除后下次 fetchServers
    // 会重新注入，对用户来说就是「删不掉」，所以直接拦截并提示。
    if (isBuiltinServer(servers.value[name])) {
      throw new Error('builtinServerCannotDelete')
    }
    try {
      await api.mcp.deleteServer(name)
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

      try {
        await api.mcp.toggleEnabled(name, enabled)
      } catch {
        await api.mcp.updateServers(toPlain(updated))
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
      await api.mcp.reconnectServer(activeSessionId.value, serverName)
    } catch (err) {
      console.error('Failed to reconnect server:', err)
    }
  }

  async function toggleServerRuntime(serverName: string, enabled: boolean) {
    if (!activeSessionId.value) return
    try {
      await api.mcp.toggleServerRuntime(activeSessionId.value, serverName, enabled)
    } catch (err) {
      console.error('Failed to toggle server runtime:', err)
    }
  }

  async function saveJsonConfig(jsonStr: string) {
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, Omit<MCPServer, 'id' | 'name'>>

      // 保留两类不可通过 JSON 编辑覆盖的服务器：
      //   1. _source === 'claude.json'：由 Claude CLI 管理，只读
      //   2. _source === 'builtin'    ：内置预设，状态由列表页开关管理
      const preservedServers: Record<string, MCPServer> = {}
      for (const [name, server] of Object.entries(servers.value)) {
        if (server._source === 'claude.json' || server._source === BUILTIN_MCP_SOURCE) {
          preservedServers[name] = server
        }
      }

      const settingsServers: Record<string, MCPServer> = {}
      for (const [name, server] of Object.entries(parsed)) {
        settingsServers[name] = { ...server, id: crypto.randomUUID(), name, _source: 'settings.json' }
      }

      const merged = { ...preservedServers, ...settingsServers }

      await api.mcp.updateServers(toPlain(merged))
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

      const result = await api.mcp.probeServer(toPlain(config))
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
    allMcpTools,
    // 内置 MCP 依赖检测 / 一键安装
    dependencyStatus,
    installingDependency,
    installProgress,
    installError,
    checkDependency,
    checkAllBuiltinDependencies,
    installDependency,
  }
})
