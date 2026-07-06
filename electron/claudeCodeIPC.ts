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
import { getBrowserUseMcpServerConfig } from './browserUseService'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window
  EngineFactory.setMainWindow(window)
}

export function registerClaudeCodeIPC() {
  info('ClaudeCodeIPC', 'Initializing with EngineFactory')

  ipcMain.handle('claude-code:startSession', async (_, sessionId: string, config: EngineSessionConfig) => {
    let engineType = config.engineType || 'claude-code'
    info('ClaudeCodeIPC', `→ startSession | sessionId=${sessionId.slice(0, 8)} | engine=${engineType} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)
    const startMs = Date.now()
    try {
      if (engineType !== 'claude-code' && !(await EngineFactory.isEngineAvailableAsync(engineType))) {
        warn('ClaudeCodeIPC', `Engine "${engineType}" not available, falling back to claude-code | sessionId=${sessionId.slice(0, 8)}`)
        engineType = 'claude-code'
      }
      const engine = EngineFactory.getEngine(engineType)
      await engine.startSession(sessionId, config)
      const status = engine.getSessionStatus(sessionId)
      info('ClaudeCodeIPC', `← startSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms | status=${status?.status} | isRunning=${status?.isRunning}`)
      return status
    } catch (err) {
      error('ClaudeCodeIPC', `✗ startSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:sendMessage', async (_, sessionId: string, content: string, images?: any[]) => {
    info('ClaudeCodeIPC', `→ sendMessage | sessionId=${sessionId.slice(0, 8)} | contentLen=${content.length} | images=${images?.length || 0}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      await engine.sendMessage(sessionId, content, images)
      info('ClaudeCodeIPC', `← sendMessage | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`)
    } catch (err) {
      error('ClaudeCodeIPC', `✗ sendMessage | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:abort', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ abort | sessionId=${sessionId.slice(0, 8)}`)
    const engine = findEngineForSession(sessionId)
    await engine.abort(sessionId)
  })

  ipcMain.handle('claude-code:stop', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ stop | sessionId=${sessionId.slice(0, 8)}`)
    // Stop on every engine that still tracks this session so switching engines
    // leaves no dangling entries that `findEngineForSession` could resurrect.
    for (const engine of EngineFactory.getAllEngines()) {
      if (engine.getSessionStatus(sessionId)) {
        try {
          await engine.stop(sessionId)
        } catch (err) {
          warn('ClaudeCodeIPC', `stop failed on engine=${engine.type} | sessionId=${sessionId.slice(0, 8)}`, { error: String(err) })
        }
      }
    }
  })

  ipcMain.handle('claude-code:suspendSession', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ suspendSession | sessionId=${sessionId.slice(0, 8)}`)
    const engine = findEngineForSession(sessionId)
    engine.suspendSession?.(sessionId)
  })

  ipcMain.handle('claude-code:resumeSession', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ resumeSession | sessionId=${sessionId.slice(0, 8)}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      await engine.resumeSession?.(sessionId)
      const status = engine.getSessionStatus(sessionId)
      info('ClaudeCodeIPC', `← resumeSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms | status=${status?.status}`)
      return status
    } catch (err) {
      error('ClaudeCodeIPC', `✗ resumeSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:getSessionStatus', async (_, sessionId: string) => {
    debug('ClaudeCodeIPC', `→ getSessionStatus | sessionId=${sessionId.slice(0, 8)}`)
    const engine = findEngineForSession(sessionId)
    return engine.getSessionStatus(sessionId)
  })

  ipcMain.handle('claude-code:getActiveSessions', async () => {
    debug('ClaudeCodeIPC', '→ getActiveSessions')
    const allSessions: any[] = []
    for (const engine of EngineFactory.getAllEngines()) {
      allSessions.push(...engine.getActiveSessions())
    }
    return allSessions
  })

  ipcMain.handle('claude-code:isSessionActive', async (_, sessionId?: string) => {
    debug('ClaudeCodeIPC', `→ isSessionActive | sessionId=${sessionId?.slice(0, 8) || '(all)'}`)
    if (sessionId) {
      const engine = findEngineForSession(sessionId)
      const status = engine.getSessionStatus(sessionId)
      return status?.isRunning ?? false
    }
    for (const engine of EngineFactory.getAllEngines()) {
      if (engine.getActiveSessions().length > 0) return true
    }
    return false
  })

  ipcMain.handle('claude-code:log', async () => {
  })

  ipcMain.handle('claude-code:listAgents', async (_, cwd?: string, engineType?: string) => {
    debug('ClaudeCodeIPC', `→ listAgents | cwd=${cwd || '(none)'} | engine=${engineType || '(default)'}`)
    const type = (engineType as any) || 'claude-code'
    const engine = EngineFactory.getEngine(type)
    if (engine.listAgents) {
      return engine.listAgents(cwd)
    }
    return []
  })

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
    try {
      const { spawn } = require('child_process') as typeof import('child_process')
      const platform = process.platform

      // Try npm first, then bun
      const installers: Array<{ cmd: string; args: string[]; label: string }> = [
        { cmd: 'npm', args: ['install', '-g', '@mariozechner/pi-coding-agent'], label: 'npm' },
      ]

      // Check if bun is available (bundled or global)
      const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
      const resourcesDir = process.resourcesPath || ''
      const bundledBun = join(resourcesDir, 'engine', 'bin', bunName)
      const devBun = join(__dirname, '../../engine/bin', bunName)

      const fs = require('fs') as typeof import('fs')
      if (fs.existsSync(bundledBun) || fs.existsSync(devBun)) {
        const bunPath = fs.existsSync(bundledBun) ? bundledBun : devBun
        installers.push({ cmd: bunPath, args: ['install', '-g', '@mariozechner/pi-coding-agent'], label: 'bundled bun' })
      }
      installers.push({ cmd: 'bun', args: ['install', '-g', '@mariozechner/pi-coding-agent'], label: 'global bun' })

      let lastError: string | null = null
      for (const installer of installers) {
        try {
          info('ClaudeCodeIPC', `Trying ${installer.label}: ${installer.cmd} ${installer.args.join(' ')}`)
          const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
            const child = spawn(installer.cmd, installer.args, {
              stdio: ['pipe', 'pipe', 'pipe'],
              shell: platform === 'win32',
            })
            let stdout = ''
            let stderr = ''
            child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
            child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
            child.on('close', (code: number | null) => {
              if (code === 0) {
                resolve({ success: true })
              } else {
                resolve({ success: false, error: `${installer.label} exited with code ${code}: ${stderr.trim() || stdout.trim()}` })
              }
            })
            child.on('error', (err: Error) => {
              resolve({ success: false, error: `${installer.label} failed: ${err.message}` })
            })
            // Timeout after 120 seconds
            setTimeout(() => {
              child.kill()
              resolve({ success: false, error: `${installer.label} timed out after 120s` })
            }, 120_000)
          })

          if (result.success) {
            info('ClaudeCodeIPC', `Pi SDK installed successfully via ${installer.label}`)
            return { success: true }
          }
          lastError = result.error || 'Unknown error'
          info('ClaudeCodeIPC', `${installer.label} failed: ${lastError}`)
        } catch (err) {
          lastError = String(err)
        }
      }

      return { success: false, error: lastError || 'No installer available. Please install Node.js or Bun first.' }
    } catch (err) {
      error('ClaudeCodeIPC', 'installPiSdk failed', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('claude-code:submitToolAnswer', async (_, sessionId: string, toolCallId: string, answers: Record<string, string>) => {
    info('ClaudeCodeIPC', `→ submitToolAnswer | sessionId=${sessionId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)} | answers=${JSON.stringify(answers)}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      if (typeof engine.submitToolAnswer === 'function') {
        await engine.submitToolAnswer(sessionId, toolCallId, answers)
        info('ClaudeCodeIPC', `← submitToolAnswer | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`)
      } else {
        warn('ClaudeCodeIPC', `submitToolAnswer not implemented in engine=${engine.type}`)
      }
    } catch (err) {
      error('ClaudeCodeIPC', `✗ submitToolAnswer | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

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

  ipcMain.handle('claude-code:skipToolAnswer', async (_, sessionId: string, toolCallId: string) => {
    info('ClaudeCodeIPC', `→ skipToolAnswer | sessionId=${sessionId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      if (typeof engine.skipToolAnswer === 'function') {
        await engine.skipToolAnswer(sessionId, toolCallId)
        info('ClaudeCodeIPC', `← skipToolAnswer | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`)
      } else {
        warn('ClaudeCodeIPC', `skipToolAnswer not implemented in engine=${engine.type}`)
      }
    } catch (err) {
      error('ClaudeCodeIPC', `✗ skipToolAnswer | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  // ──────────────────── can_use_tool / control_request ────────────────────

  ipcMain.handle(
    'claude-code:allowPermission',
    async (
      _,
      sessionId: string,
      requestId: string,
      updatedInput?: Record<string, unknown>,
      decisionClassification?: 'user_temporary' | 'user_permanent',
    ) => {
      info(
        'ClaudeCodeIPC',
        `→ allowPermission | sessionId=${sessionId.slice(0, 8)} | requestId=${requestId.slice(0, 8)} | classification=${decisionClassification || '(none)'}`,
      )
      const engine = findEngineForSession(sessionId)
      if (typeof engine.allowPermission === 'function') {
        await engine.allowPermission(sessionId, requestId, updatedInput, decisionClassification)
      } else {
        warn('ClaudeCodeIPC', `allowPermission not implemented in engine=${engine.type}`)
      }
    },
  )

  ipcMain.handle(
    'claude-code:denyPermission',
    async (
      _,
      sessionId: string,
      requestId: string,
      message?: string,
      options?: { interrupt?: boolean },
    ) => {
      info(
        'ClaudeCodeIPC',
        `→ denyPermission | sessionId=${sessionId.slice(0, 8)} | requestId=${requestId.slice(0, 8)} | interrupt=${!!options?.interrupt}`,
      )
      const engine = findEngineForSession(sessionId)
      if (typeof engine.denyPermission === 'function') {
        await engine.denyPermission(sessionId, requestId, message, options)
      } else {
        warn('ClaudeCodeIPC', `denyPermission not implemented in engine=${engine.type}`)
      }
    },
  )

  ipcMain.handle(
    'claude-code:respondPermission',
    async (_, sessionId: string, requestId: string, decision: any) => {
      info(
        'ClaudeCodeIPC',
        `→ respondPermission | sessionId=${sessionId.slice(0, 8)} | requestId=${requestId.slice(0, 8)} | behavior=${decision?.behavior}`,
      )
      const engine = findEngineForSession(sessionId)
      if (typeof engine.respondPermission === 'function') {
        await engine.respondPermission(sessionId, requestId, decision)
      } else {
        warn('ClaudeCodeIPC', `respondPermission not implemented in engine=${engine.type}`)
      }
    },
  )

  ipcMain.handle(
    'claude-code:setPermissionMode',
    async (_, sessionId: string, mode: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions') => {
      info('ClaudeCodeIPC', `→ setPermissionMode | sessionId=${sessionId.slice(0, 8)} | mode=${mode}`)
      const engine = findEngineForSession(sessionId)
      if (typeof engine.setPermissionMode === 'function') {
        await engine.setPermissionMode(sessionId, mode)
      } else {
        warn('ClaudeCodeIPC', `setPermissionMode not implemented in engine=${engine.type}`)
      }
    },
  )

  ipcMain.handle('claude-code:setModel', async (_, sessionId: string, model: string | undefined) => {
    info('ClaudeCodeIPC', `→ setModel | sessionId=${sessionId.slice(0, 8)} | model=${model || '(default)'}`)
    const engine = findEngineForSession(sessionId)
    if (typeof engine.setModel === 'function') {
      await engine.setModel(sessionId, model)
    } else {
      warn('ClaudeCodeIPC', `setModel not implemented in engine=${engine.type}`)
    }
  })

  ipcMain.handle('claude-code:getMcpStatus', async (_, sessionId: string) => {
    debug('ClaudeCodeIPC', `→ getMcpStatus | sessionId=${sessionId.slice(0, 8)}`)
    const engine = findEngineForSession(sessionId)
    if (typeof engine.getMcpStatus === 'function') {
      return engine.getMcpStatus(sessionId)
    }
    return null
  })

  ipcMain.handle('claude-code:getContextUsage', async (_, sessionId: string) => {
    debug('ClaudeCodeIPC', `→ getContextUsage | sessionId=${sessionId.slice(0, 8)}`)
    try {
      const engine = findEngineForSession(sessionId)
      if (typeof engine.getContextUsage === 'function') {
        return await engine.getContextUsage(sessionId)
      }
      return null
    } catch (err) {
      debug(
        'ClaudeCodeIPC',
        `getContextUsage failed | sessionId=${sessionId.slice(0, 8)} | ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  })

  ipcMain.handle('claude-code:getSettings', async (_, sessionId: string) => {
    debug('ClaudeCodeIPC', `→ getSettings | sessionId=${sessionId.slice(0, 8)}`)
    const engine = findEngineForSession(sessionId)
    if (typeof engine.getSettings === 'function') {
      return engine.getSettings(sessionId)
    }
    return null
  })

  ipcMain.handle('claude-code:stopEngineTask', async (_, sessionId: string, taskId: string) => {
    info('ClaudeCodeIPC', `→ stopEngineTask | sessionId=${sessionId.slice(0, 8)} | taskId=${taskId}`)
    const engine = findEngineForSession(sessionId)
    if (typeof engine.stopEngineTask === 'function') {
      await engine.stopEngineTask(sessionId, taskId)
    } else {
      warn('ClaudeCodeIPC', `stopEngineTask not implemented in engine=${engine.type}`)
    }
  })

  ipcMain.handle('claude-code:getPendingPermissionRequestIds', async (_, sessionId: string) => {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.getPendingPermissionRequestIds === 'function') {
      return engine.getPendingPermissionRequestIds(sessionId)
    }
    return []
  })

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
    // cua-driver 特殊处理：二进制可能不在 Electron 进程的 PATH 上
    // （安装脚本创建的 junction/symlink 尚未被 Electron 缓存的 PATH 感知），
    // 使用 findCuaDriverBinary() 解析绝对路径，与 buildEnabledMcpConfig
    // 注入 CLI 时的逻辑保持一致。找不到时直接返回失败，避免 spawn 后
    // "Process exited with code 1" 这种无上下文的错误。
    if (config.command === 'cua-driver') {
      const driverPath = findCuaDriverBinary()
      if (driverPath) {
        config = {
          ...config,
          command: driverPath,
          env: { ...config.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' },
        }
        debug('McpProbe', `Resolved cua-driver binary: ${driverPath}`)
      } else {
        debug('McpProbe', 'cua-driver binary not found in PATH or well-known locations')
        return {
          status: 'failed',
          error: 'cua-driver binary not found. Please install it in Computer Use settings or add it to PATH.',
        }
      }
    }

    // browser-use 特殊处理：内置预设存储的 config 是相对路径（python bridge.py --mcp），
    // probe 时需要解析为实际 Python 路径 + bridge.py 绝对路径 + LLM 环境变量。
    // 与 mcpConfigStore.buildEnabledMcpConfig 注入 CLI 时的逻辑保持一致。
    // 检测条件：command 为 'python' 且 args 包含 'bridge.py'
    if (
      config.type === 'stdio' &&
      config.command &&
      (config.command === 'python' || config.command === 'python3') &&
      config.args &&
      config.args.some(a => a === 'bridge.py' || a.endsWith('/bridge.py') || a.endsWith('\\bridge.py'))
    ) {
      const buConfig = getBrowserUseMcpServerConfig()
      if (buConfig) {
        config = {
          ...config,
          command: buConfig.command,
          args: buConfig.args,
          env: { ...config.env, ...buConfig.env },
        }
        debug('McpProbe', `Resolved browser-use: ${buConfig.command} ${buConfig.args.join(' ')}`)
      } else {
        debug('McpProbe', 'browser-use Python or bridge.py not found')
        return {
          status: 'failed',
          error: 'Python 3.11+ or browser-use bridge script not found. Please install Browser Use from the settings panel.',
        }
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

function findEngineForSession(sessionId: string) {
  // Prefer an engine that actually has a live process for this session. This
  // matters when the user switches engines on an existing session: the old
  // engine's pool may still remember the session (its `exit` handler does not
  // evict the map entry), so a naive lookup would keep routing messages to
  // the dead engine.
  let fallback: ReturnType<typeof EngineFactory.getEngine> | null = null
  for (const engine of EngineFactory.getAllEngines()) {
    const status = engine.getSessionStatus(sessionId)
    if (!status) continue
    if (status.isRunning) {
      return engine
    }
    if (!fallback) fallback = engine
  }
  if (fallback) return fallback
  return EngineFactory.getEngine('claude-code')
}

export function getPool(): { killAll: () => void } | null {
  return null
}
