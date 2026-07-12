import { ipcMain, BrowserWindow, app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { EngineFactory } from './engines/EngineFactory'
import type { EngineSessionConfig, AgentInfo } from './engines/types'
import { info, warn, error, debug } from './logger'
import { SessionHistoryManager, SessionLite } from './sessionHistoryManager'
import { detectInstalledCli, checkEnvironment, installCli, isCommandAvailable, installCommand } from './cliDetector'
import { proxyManager } from './proxyManager'
import { probeMcpServer, type McpProbeConfig, type McpProbeResult } from './mcpProbe'
import { loadMcpConfig, saveMcpConfig, buildEnabledMcpConfig } from './mcpConfigStore'
import { findCuaDriverBinary, getCuaDriverVersion } from './cuaDriverService'
import {
  detectBuiltinFromConfig,
  resolveBuiltinMcp,
} from './mcpConfigResolver'
import { installPiSdk } from './piInstaller'
import { engineGateway, findEngineForSession } from './engineGateway'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window
  EngineFactory.setMainWindow(window)
}

export function registerClaudeCodeIPC() {
  info('ClaudeCodeIPC', 'Initializing with EngineFactory')

  ipcMain.handle('claude-code:startSession', async (_, sessionId: string, config: EngineSessionConfig) => engineGateway.startSession(sessionId, config))

  ipcMain.handle('claude-code:sendMessage', async (_, sessionId: string, content: string, images?: any[]) => engineGateway.sendMessage(sessionId, content, images))

  ipcMain.handle('claude-code:abort', async (_, sessionId: string) => engineGateway.abort(sessionId))

  ipcMain.handle('claude-code:stop', async (_, sessionId: string) => engineGateway.stop(sessionId))

  ipcMain.handle('claude-code:suspendSession', async (_, sessionId: string) => engineGateway.suspendSession(sessionId))

  ipcMain.handle('claude-code:resumeSession', async (_, sessionId: string) => engineGateway.resumeSession(sessionId))

  ipcMain.handle('claude-code:getSessionStatus', async (_, sessionId: string) => engineGateway.getSessionStatus(sessionId))

  ipcMain.handle('claude-code:getActiveSessions', async () => engineGateway.getActiveSessions())

  ipcMain.handle('claude-code:isSessionActive', async (_, sessionId?: string) => engineGateway.isSessionActive(sessionId))

  ipcMain.handle('claude-code:log', async () => {
  })

  ipcMain.handle('claude-code:listAgents', async (_, cwd?: string, engineType?: string) => engineGateway.listAgents(cwd, engineType as any))

  ipcMain.handle('claude-code:updateThinkingLevel', async (_, sessionId: string, enabled: boolean) => {
    info('ClaudeCodeIPC', `→ updateThinkingLevel | sessionId=${sessionId.slice(0, 8)} | enabled=${enabled}`)
    try {
      const engine = findEngineForSession(sessionId)
      if (engine.type === 'pi' && typeof (engine as any).updateThinkingLevel === 'function') {
        ;(engine as any).updateThinkingLevel(sessionId, enabled)
      }
    } catch (err) {
      error('ClaudeCodeIPC', `✗ updateThinkingLevel | sessionId=${sessionId.slice(0, 8)}`, { error: String(err) })
    }
  })

  ipcMain.handle('claude-code:isEngineAvailable', async (_, engineType: string) => {
    debug('ClaudeCodeIPC', `→ isEngineAvailable | engine=${engineType}`)
    return EngineFactory.isEngineAvailableAsync(engineType as any)
  })

  ipcMain.handle('claude-code:installPiSdk', async () => {
    info('ClaudeCodeIPC', '→ installPiSdk')
    return installPiSdk()
  })

  ipcMain.handle('claude-code:submitToolAnswer', async (_, sessionId: string, toolCallId: string, answers: Record<string, string>) => engineGateway.submitToolAnswer(sessionId, toolCallId, answers))

  // ==================== 会话历史管理 ====================
  ipcMain.handle('claude-code:listProjectSessions', async (_, cwd: string) => {
    info('ClaudeCodeIPC', `→ listProjectSessions | cwd=${cwd}`)
    try {
      const sessions = await SessionHistoryManager.listProjectSessions(cwd)
      return sessions.map(s => ({
        ...s,
        title: SessionHistoryManager.getSessionTitle(s),
        displayTime: SessionHistoryManager.formatTimestamp(s.lastMessageTimestamp),
      }))
    } catch (err) {
      error('ClaudeCodeIPC', `✗ listProjectSessions`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:skipToolAnswer', async (_, sessionId: string, toolCallId: string) => engineGateway.skipToolAnswer(sessionId, toolCallId))

  // ──────────────────── can_use_tool / control_request ────────────────────

  ipcMain.handle(
    'claude-code:allowPermission',
    async (_, sessionId: string, requestId: string, updatedInput?: Record<string, unknown>, decisionClassification?: 'user_temporary' | 'user_permanent') =>
      engineGateway.allowPermission(sessionId, requestId, updatedInput, decisionClassification),
  )

  ipcMain.handle(
    'claude-code:denyPermission',
    async (_, sessionId: string, requestId: string, message?: string, options?: { interrupt?: boolean }) =>
      engineGateway.denyPermission(sessionId, requestId, message, options),
  )

  ipcMain.handle(
    'claude-code:respondPermission',
    async (_, sessionId: string, requestId: string, decision: any) =>
      engineGateway.respondPermission(sessionId, requestId, decision),
  )

  ipcMain.handle(
    'claude-code:setPermissionMode',
    async (_, sessionId: string, mode: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions') =>
      engineGateway.setPermissionMode(sessionId, mode),
  )

  ipcMain.handle('claude-code:setModel', async (_, sessionId: string, model: string | undefined) => engineGateway.setModel(sessionId, model))

  ipcMain.handle('claude-code:getMcpStatus', async (_, sessionId: string) => engineGateway.getMcpStatus(sessionId))

  ipcMain.handle('claude-code:getContextUsage', async (_, sessionId: string) => engineGateway.getContextUsage(sessionId))

  ipcMain.handle('claude-code:getSettings', async (_, sessionId: string) => engineGateway.getSettings(sessionId))

  ipcMain.handle('claude-code:stopEngineTask', async (_, sessionId: string, taskId: string) => engineGateway.stopEngineTask(sessionId, taskId))

  ipcMain.handle('claude-code:getPendingPermissionRequestIds', async (_, sessionId: string) => engineGateway.getPendingPermissionRequestIds(sessionId))

  ipcMain.handle('claude-code:listAllSessions', async () => {
    info('ClaudeCodeIPC', '→ listAllSessions')
    try {
      const sessions = await SessionHistoryManager.listAllSessions()
      return sessions.map(s => ({
        ...s,
        title: SessionHistoryManager.getSessionTitle(s),
        displayTime: SessionHistoryManager.formatTimestamp(s.lastMessageTimestamp),
      }))
    } catch (err) {
      error('ClaudeCodeIPC', `✗ listAllSessions`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:getFullSession', async (_, projectPath: string, sessionId: string) => {
    info('ClaudeCodeIPC', `→ getFullSession | projectPath=${projectPath} | sessionId=${sessionId.slice(0, 8)}`)
    try {
      const fullSession = await SessionHistoryManager.getFullSession(projectPath, sessionId)
      return fullSession
    } catch (err) {
      error('ClaudeCodeIPC', `✗ getFullSession`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:resolveAgentTranscriptPath', async (_, projectPath: string, sessionId: string, agentId: string) => {
    try {
      return SessionHistoryManager.getAgentTranscriptPath(projectPath, sessionId, agentId)
    } catch (err) {
      error('ClaudeCodeIPC', `✗ resolveAgentTranscriptPath`, { error: String(err) })
      return null
    }
  })

  ipcMain.handle('claude-code:restoreSession', async (_, sessionId: string, projectPath: string) => {
    info('ClaudeCodeIPC', `→ restoreSession | sessionId=${sessionId.slice(0, 8)} | projectPath=${projectPath}`)
    try {
      const fullSession = await SessionHistoryManager.getFullSession(projectPath, sessionId)
      return fullSession
    } catch (err) {
      error('ClaudeCodeIPC', `✗ restoreSession`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:detectInstalledCli', async () => {
    return detectInstalledCli()
  })

  ipcMain.handle('claude-code:checkEnvironment', async () => {
    return checkEnvironment()
  })

  ipcMain.handle('claude-code:installCli', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return installCli(win, (progress) => {
      win?.webContents.send('claude-code:installProgress', progress)
    })
  })

  ipcMain.handle('claude-code:getProxyStatus', async () => {
    return proxyManager.getStatus()
  })

  ipcMain.handle('claude-code:isProxyRunning', async () => {
    return proxyManager.isRunning()
  })

  // ── MCP Probe ── 直接探测 MCP 服务器（不依赖 engine session）
  ipcMain.handle('mcp:probeServer', async (_, config: McpProbeConfig): Promise<McpProbeResult> => {
    // 内置 MCP 服务器（cua-driver / browser-use）路径解析委托给 mcpConfigResolver，
    // 与 buildEnabledMcpConfig 共享同一份解析逻辑。
    const builtin = detectBuiltinFromConfig(config)
    if (builtin) {
      const resolution = resolveBuiltinMcp(builtin)
      if (resolution.status === 'missing') {
        return { status: 'failed', error: resolution.error }
      }
      config = {
        ...config,
        command: resolution.config.command,
        args: resolution.config.args ?? config.args,
        env: { ...config.env, ...resolution.config.env },
      }
    }

    debug('McpProbe', `Probing server | type=${config.type} | command=${config.command || config.url}`)
    const result = await probeMcpServer(config)
    debug('McpProbe', `Probe result | status=${result.status} | tools=${result.tools?.length ?? 0} | error=${result.error || '(none)'}`)
    return result
  })

  // ── MCP Dependency Check ── 检测内置 MCP 服务器依赖的命令（uvx/npx 等）是否可用
ipcMain.handle('mcp:checkDependency', async (_, command: string) => {
  debug('McpDependency', `Checking dependency | command=${command}`)
  // cua-driver 特殊处理：它的安装路径不在系统 PATH 里（安装脚本创建的
  // junction/symlink 可能尚未被 Electron 进程的 PATH 缓存感知），
  // 使用 cuaDriverService 的 findCuaDriverBinary() 统一检测逻辑。
  if (command === 'cua-driver') {
    const binaryPath = findCuaDriverBinary()
    if (!binaryPath) {
      debug('McpDependency', 'cua-driver not found in PATH or well-known locations')
      return { available: false, version: null, path: null }
    }
    const version = await getCuaDriverVersion(binaryPath)
    debug('McpDependency', `cua-driver found | path=${binaryPath} | version=${version || '(none)'}`)
    return { available: true, version, path: binaryPath }
  }
  const status = await isCommandAvailable(command)
  debug('McpDependency', `Result | available=${status.available} | version=${status.version || '(none)'}`)
  return status
})

  // ── MCP Dependency Install ── 一键安装缺失的依赖（当前仅支持 uv → 提供 uvx）
  ipcMain.handle('mcp:installDependency', async (event, command: 'uv') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    info('McpDependency', `Installing dependency | command=${command}`)
    return installCommand(command, (progress) => {
      win?.webContents.send('mcp:installProgress', progress)
    })
  })

  // ── MCP Config CRUD ── 持久化到 <userData>/mcp-servers.json
  // 文件路径与加载/保存逻辑共享自 mcpConfigStore，供 sessionProcess 的
  // --mcp-config 注入路径复用，避免两边各自实现导致行为分歧。

  ipcMain.handle('mcp:getServers', async () => {
    const servers = loadMcpConfig()
    return { mcpServers: servers }
  })

  ipcMain.handle('mcp:addServer', async (_event, name: string, server: any) => {
    const servers = loadMcpConfig()
    servers[name] = { ...server, _source: 'settings.json' }
    saveMcpConfig(servers)
    return { success: true }
  })

  ipcMain.handle('mcp:updateServers', async (_event, servers: Record<string, any>) => {
    saveMcpConfig(servers)
    return { success: true }
  })

  ipcMain.handle('mcp:deleteServer', async (_event, name: string) => {
    const servers = loadMcpConfig()
    delete servers[name]
    saveMcpConfig(servers)
    return { success: true }
  })

  ipcMain.handle('mcp:toggleEnabled', async (_event, name: string, enabled: boolean) => {
    const servers = loadMcpConfig()
    if (servers[name]) {
      servers[name].enabled = enabled
      saveMcpConfig(servers)
    }
    return { success: true }
  })

  /**
   * 返回当前会被注入到 claude-code CLI 的 MCP 服务器名称列表。
   *
   * 用于 UI 给已注册到 CLI 的服务器加一个「Claude Code 已加载」标记，
   * 让用户能直观看到哪些 MCP 真正在对话里可用。
   */
  ipcMain.handle('mcp:getActiveMcpNames', async () => {
    const cfg = buildEnabledMcpConfig()
    return cfg ? Object.keys(cfg.mcpServers) : []
  })
}

export function getPool(): { killAll: () => void } | null {
  return null
}
