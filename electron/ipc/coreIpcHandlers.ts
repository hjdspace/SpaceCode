/**
 * Core IPC handlers — window controls, filesystem, shell, dialog,
 * HTTP proxy, terminal, CLI path resolution, log bridge, debug,
 * image persistence, and turn checkpoints.
 *
 * This module consolidates all the "miscellaneous" IPC handlers that
 * were previously inline in main.ts.
 */
import { ipcMain, app, shell, dialog, net, clipboard } from 'electron'
import { join, resolve, dirname } from 'path'
import {
  readFileSync, readdirSync, statSync, existsSync, writeFileSync,
  mkdirSync, copyFileSync, renameSync, rmSync,
} from 'fs'
import { debug, info, error, warn } from '../infra/logger'
import { piShellCommand } from '../engine/engines/piCliResolver'
import { getMainWindow } from '../windows/mainWindow'
import { TerminalManager } from '../infra/terminalManager'
import { channelNames } from '@/shared/channelMap'
import { terminalNamespace } from '@/shared/channels/terminal'
import { EDITOR_LAUNCHERS, openPathInEditor, type ExternalEditor } from './editorLauncher'
import {
  listDebugFiles, readDebugFile,
  listTraceSessions, readTraceEvents, traceEvent,
} from '../infra/logger'

export function registerCoreIPCHandlers(terminalManager: TerminalManager): void {
  const TERMINAL_CHANNELS = channelNames(terminalNamespace.channels, 'terminal:')

  // ── CLI message relay ──────────────────────────────────────────

  ipcMain.handle('cli:sendMessage', async (_event, text: string) => {
    debug('IPC', 'cli:sendMessage', { textLen: text.length })
    return { success: true, message: text }
  })

  ipcMain.handle('cli:getAppState', async () => {
    debug('IPC', 'cli:getAppState')
    return { sessions: [], currentSessionId: null, theme: 'dark' }
  })

  // ── Window controls ────────────────────────────────────────────

  ipcMain.on('window:minimize', () => {
    getMainWindow()?.minimize()
  })

  ipcMain.on('window:toggleMaximize', () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })

  ipcMain.on('window:close', () => {
    getMainWindow()?.close()
  })

  ipcMain.handle('window:isMaximized', () => {
    return getMainWindow()?.isMaximized() ?? false
  })

  // ── Filesystem ─────────────────────────────────────────────────

  ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })
      return entries.map(entry => ({
        name: entry.name,
        path: join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile()
      }))
    } catch (err) {
      error('IPC', 'fs:readDir failed', { dirPath, err })
      return []
    }
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    try {
      return readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }
  })

  ipcMain.handle('fs:readFileAsBase64', async (_event, filePath: string) => {
    try {
      const buffer = readFileSync(filePath)
      return buffer.toString('base64')
    } catch {
      return null
    }
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
    debug('IPC', 'fs:writeFile', { filePath })
    try {
      writeFileSync(filePath, content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      error('IPC', 'fs:writeFile failed', { filePath, err })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:stat', async (_event, filePath: string) => {
    debug('IPC', 'fs:stat', { filePath })
    try {
      const stat = statSync(filePath)
      return {
        size: stat.size,
        isDirectory: stat.isDirectory(),
        isFile: stat.isFile(),
        mtime: stat.mtime.getTime()
      }
    } catch {
      return null
    }
  })

  // ── Recursive file search ──────────────────────────────────────

  ipcMain.handle('fs:searchFiles', async (_event, dirPath: string, query: string, options?: { maxResults?: number }) => {
    try {
      const maxResults = options?.maxResults || 100
      const results: Array<{ name: string; path: string; relativePath: string; isDirectory: boolean; isFile: boolean }> = []
      const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'dist-electron', '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'vendor', 'build', 'out', '.tox', 'target'])

      if (!query) {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') && entry.name !== '.claude') continue
          if (ignoreDirs.has(entry.name)) continue
          results.push({
            name: entry.name,
            path: join(dirPath, entry.name),
            relativePath: entry.name,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile()
          })
        }
        results.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        return results.slice(0, maxResults)
      }

      const q = query.toLowerCase()
      const visited = new Set<string>()

      async function walkDir(currentPath: string, depth: number): Promise<void> {
        if (results.length >= maxResults) return
        if (depth > 8) return

        let entries
        try {
          entries = readdirSync(currentPath, { withFileTypes: true })
        } catch {
          return
        }

        const sorted = entries
          .filter(e => !e.name.startsWith('.') && !ignoreDirs.has(e.name))
          .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
            return a.name.localeCompare(b.name)
          })

        for (const entry of sorted) {
          if (results.length >= maxResults) return

          const fullPath = join(currentPath, entry.name)
          const relativePath = fullPath.slice(dirPath.length + 1).replace(/\\/g, '/')
          const nameLower = entry.name.toLowerCase()
          const relativeLower = relativePath.toLowerCase()

          if (nameLower.includes(q) || relativeLower.includes(q)) {
            if (!visited.has(fullPath)) {
              visited.add(fullPath)
              results.push({
                name: entry.name,
                path: fullPath,
                relativePath,
                isDirectory: entry.isDirectory(),
                isFile: entry.isFile()
              })
            }
          }

          if (entry.isDirectory()) {
            await walkDir(fullPath, depth + 1)
          }
        }
      }

      await walkDir(dirPath, 0)

      results.sort((a, b) => {
        const aNameMatch = a.name.toLowerCase() === q ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2
        const bNameMatch = b.name.toLowerCase() === q ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2
        if (aNameMatch !== bNameMatch) return aNameMatch - bNameMatch
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.relativePath.localeCompare(b.relativePath)
      })

      return results
    } catch (err) {
      error('IPC', 'fs:searchFiles failed', { dirPath, query, err })
      return []
    }
  })

  // ── Environment ────────────────────────────────────────────────

  ipcMain.handle('env:get', async (_event, key: string) => {
    debug('IPC', 'env:get', { key })
    return process.env[key]
  })

  // ── UI relay ───────────────────────────────────────────────────

  ipcMain.on('ui:showDiff', (_event, diffInfo) => {
    debug('IPC', 'ui:showDiff')
    getMainWindow()?.webContents.send('ui:showDiff', diffInfo)
  })

  ipcMain.on('ui:showInfoPanel', (_event, mode) => {
    debug('IPC', 'ui:showInfoPanel', { mode })
    getMainWindow()?.webContents.send('ui:showInfoPanel', mode)
  })

  ipcMain.on('ui:hideInfoPanel', () => {
    debug('IPC', 'ui:hideInfoPanel')
    getMainWindow()?.webContents.send('ui:hideInfoPanel')
  })

  // ── Shell ──────────────────────────────────────────────────────

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    info('IPC', 'shell:openExternal', { url })
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    info('IPC', 'shell:openPath', { targetPath })
    await shell.openPath(targetPath)
  })

  // 卡片复制动作只允许写入字符串；非字符串一律丢弃，不落到系统剪贴板
  ipcMain.handle('clipboard:writeText', async (_event, text: unknown) => {
    if (typeof text !== 'string') return
    clipboard.writeText(text)
  })

  ipcMain.handle('app:openInEditor', async (_event, editor: ExternalEditor, targetPath: string) => {
    info('IPC', 'app:openInEditor', { editor, targetPath })
    if (!EDITOR_LAUNCHERS[editor]) {
      return { success: false, error: 'Unsupported editor' }
    }
    return openPathInEditor(editor, targetPath)
  })

  // ── File operations ────────────────────────────────────────────

  ipcMain.handle('fs:copy', async (_event, srcPath: string, destPath: string) => {
    debug('IPC', 'fs:copy', { srcPath, destPath })
    try {
      const stat = statSync(srcPath)
      if (stat.isDirectory()) {
        copyDirRecursive(srcPath, destPath)
      } else {
        copyFileSync(srcPath, destPath)
      }
      return { success: true }
    } catch (err: any) {
      error('IPC', 'fs:copy failed', { srcPath, destPath, err })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:move', async (_event, srcPath: string, destPath: string) => {
    debug('IPC', 'fs:move', { srcPath, destPath })
    try {
      renameSync(srcPath, destPath)
      return { success: true }
    } catch (err: any) {
      error('IPC', 'fs:move failed', { srcPath, destPath, err })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:rename', async (_event, filePath: string, newName: string) => {
    debug('IPC', 'fs:rename', { filePath, newName })
    try {
      const dir = dirname(filePath)
      const newPath = join(dir, newName)
      renameSync(filePath, newPath)
      return { success: true, newPath }
    } catch (err: any) {
      error('IPC', 'fs:rename failed', { filePath, newName, err })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('fs:delete', async (_event, filePath: string, permanent: boolean = false) => {
    debug('IPC', 'fs:delete', { filePath, permanent })
    try {
      if (permanent) {
        rmSync(filePath, { recursive: true, force: true })
      } else {
        await shell.trashItem(filePath)
      }
      return { success: true }
    } catch (err: any) {
      error('IPC', 'fs:delete failed', { filePath, err })
      return { success: false, error: err.message }
    }
  })

  // ── HTTP proxy ─────────────────────────────────────────────────

  ipcMain.handle('http:fetch', async (_event, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) => {
    const fetchStart = Date.now()
    const timeoutMs = options?.timeoutMs ?? 30000
    debug('IPC', 'http:fetch', { url, method: options?.method, timeoutMs })
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      const response = await net.fetch(url, {
        method: options?.method || 'GET',
        headers: options?.headers || {},
        body: options?.body || undefined,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      const text = await response.text()
      const elapsed = Date.now() - fetchStart
      debug('IPC', `http:fetch response | status=${response.status} elapsed=${elapsed}ms bodyLen=${text.length}`)
      return { ok: response.ok, status: response.status, data: text }
    } catch (err: any) {
      const elapsed = Date.now() - fetchStart
      const errorMsg = err?.name === 'AbortError'
        ? `Request timed out (${Math.round(timeoutMs / 1000)}s)`
        : (err instanceof Error ? err.message : String(err))
      error('IPC', `http:fetch failed | elapsed=${elapsed}ms`, { url, error: errorMsg })
      return { ok: false, status: 0, error: errorMsg }
    }
  })

  // ── System ─────────────────────────────────────────────────────

  ipcMain.handle('system:getCwd', async () => {
    debug('IPC', 'system:getCwd')
    return process.cwd()
  })

  // ── Workspace ──────────────────────────────────────────────────

  ipcMain.handle('workspace:ensureDefaultWork', async () => {
    debug('IPC', 'workspace:ensureDefaultWork')
    let base: string
    try {
      base = app.getPath('documents')
    } catch {
      base = app.getPath('home')
    }
    const dir = join(base, 'SpaceCode')
    try {
      mkdirSync(dir, { recursive: true })
    } catch (err) {
      debug('IPC', 'workspace:ensureDefaultWork mkdir failed', err)
    }
    return dir
  })

  ipcMain.handle('workspace:ensureDir', async (_e, dirPath: string) => {
    debug('IPC', 'workspace:ensureDir')
    if (!dirPath || typeof dirPath !== 'string') return false
    try {
      mkdirSync(dirPath, { recursive: true })
      return true
    } catch {
      return false
    }
  })

  // ── Dialogs ────────────────────────────────────────────────────

  ipcMain.handle('dialog:selectFolder', async () => {
    debug('IPC', 'dialog:selectFolder')
    const win = getMainWindow()
    if (!win) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Project Folder'
    })
    debug('IPC', 'dialog:selectFolder result', { canceled: result.canceled, count: result.filePaths.length })
    return result
  })

  ipcMain.handle('dialog:selectFiles', async () => {
    debug('IPC', 'dialog:selectFiles')
    const win = getMainWindow()
    if (!win) return { canceled: true, filePaths: [] }
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      title: 'Select Files'
    })
    return result
  })

  // ── Terminal ───────────────────────────────────────────────────

  ipcMain.handle(TERMINAL_CHANNELS.create, async (_event, options?: { cwd?: string; command?: string; env?: Record<string, string> }) => {
    try {
      const cwd = options?.cwd || process.cwd()
      const result = terminalManager.create(cwd, options?.command, options?.env)
      info('Terminal', `Created terminal: ${result.id} | cwd=${cwd} | shell=${result.shell} | customEnvKeys=${options?.env ? Object.keys(options.env).join(',') : '(none)'}`)
      return { id: result.id, shell: result.shell }
    } catch (err) {
      error('Terminal', 'Failed to create terminal', err)
      return { id: null, error: String(err) }
    }
  })

  ipcMain.on(TERMINAL_CHANNELS.write, (_event, id: string, data: string) => {
    terminalManager.write(id, data)
  })

  ipcMain.on(TERMINAL_CHANNELS.resize, (_event, id: string, cols: number, rows: number) => {
    terminalManager.resize(id, cols, rows)
  })

  ipcMain.on(TERMINAL_CHANNELS.kill, (_event, id: string) => {
    debug('Terminal', `Kill terminal: ${id}`)
    terminalManager.kill(id)
  })

  ipcMain.on(TERMINAL_CHANNELS.runCommand, (_event, id: string, command: string) => {
    debug('Terminal', `Run command in ${id}: ${command.slice(0, 100)}`)
    terminalManager.write(id, command + '\r')
  })

  // ── CLI Path Resolution ────────────────────────────────────────

  ipcMain.handle('app:getClaudeCliPath', async () => {
    const cliProjectRoot = app.isPackaged
      ? resolve(process.resourcesPath, 'engine')
      : resolve(__dirname, '../engine')

    debug('CLI', `Resolving CLI path | cliRoot=${cliProjectRoot} | isPackaged=${app.isPackaged}`)

    const desktopCliPath = resolve(cliProjectRoot, 'dist-desktop/cli.js')
    if (existsSync(desktopCliPath)) {
      const { execSync } = await import('child_process')
      try {
        execSync('bun --version', { stdio: 'ignore' })
        info('CLI', `Using desktop bundle: bun "${desktopCliPath}"`)
        return `bun "${desktopCliPath}"`
      } catch {
        const bunExe = resolve(cliProjectRoot, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
        if (existsSync(bunExe)) {
          info('CLI', `Using desktop bundle with bundled bun: "${bunExe}" "${desktopCliPath}"`)
          return `"${bunExe}" "${desktopCliPath}"`
        }
        debug('CLI', 'bun not available for desktop bundle')
      }
    }

    const distCliPath = resolve(cliProjectRoot, 'dist/cli.js')
    if (existsSync(distCliPath)) {
      const { execSync } = await import('child_process')
      try {
        execSync('bun --version', { stdio: 'ignore' })
        info('CLI', `Using built CLI: bun "${distCliPath}"`)
        return `bun "${distCliPath}"`
      } catch {
        debug('CLI', 'bun not available for dist/cli.js')
      }
    }

    const srcCliPath = resolve(cliProjectRoot, 'src/entrypoints/cli.tsx')
    if (existsSync(srcCliPath)) {
      const { execSync } = await import('child_process')
      try {
        execSync('bun --version', { stdio: 'ignore' })
        const devScript = resolve(cliProjectRoot, 'scripts/dev.ts')
        info('CLI', `Using source CLI: bun "${devScript}"`)
        return `bun "${devScript}"`
      } catch {
        debug('CLI', 'bun not available for source CLI')
      }
    }

    try {
      const { execSync } = await import('child_process')
      const cmd = process.platform === 'win32' ? 'where ccb' : 'which ccb'
      execSync(cmd, { stdio: 'ignore' })
      info('CLI', 'Using globally installed ccb')
      return 'ccb'
    } catch {}

    warn('CLI', 'No CLI found! All options exhausted')
    return null
  })

  /**
   * 「在终端里开一个 pi」用的命令 —— 必须与应用真正 spawn 的是同一个引擎 (#52)。
   *
   * 这里曾经先 `where pi` 找用户全局装的版本、再退到 bunx/npx 现拉一份，跟应用内部
   * 走的是两套解析；打包版里那份 bundled pi 又不在 node_modules，npx 只会装出第三个
   * 版本。现在只问同一个解析器，命令口径收在 piShellCommand 一处。
   */
  ipcMain.handle('app:getPiCliPath', async () => {
    const command = piShellCommand()
    if (!command) warn('PI', 'No pi CLI resolved | no terminal command available')
    return command
  })

  // ── Renderer Log Bridge ────────────────────────────────────────

  ipcMain.on('log:debug', (_event, scope: string, message: string, data?: any) => {
    debug(`RENDERER:${scope}`, message, data)
  })
  ipcMain.on('log:info', (_event, scope: string, message: string, data?: any) => {
    info(`RENDERER:${scope}`, message, data)
  })
  ipcMain.on('log:warn', (_event, scope: string, message: string, data?: any) => {
    warn(`RENDERER:${scope}`, message, data)
  })
  ipcMain.on('log:error', (_event, scope: string, message: string, data?: any) => {
    error(`RENDERER:${scope}`, message, data)
  })

  ipcMain.on('trace:event', (_event, event: any) => {
    traceEvent({ ...event, source: event?.source || 'renderer' })
  })

  // ── Debug ──────────────────────────────────────────────────────

  ipcMain.handle('debug:listFiles', async () => {
    return listDebugFiles()
  })

  ipcMain.handle('debug:readFile', async (_event, filePath: string, maxBytes?: number) => {
    return readDebugFile(filePath, maxBytes)
  })

  ipcMain.handle('debug:listTraceSessions', async () => {
    return listTraceSessions()
  })

  ipcMain.handle('debug:readTraceEvents', async (_event, sessionId: string, maxEvents?: number) => {
    return readTraceEvents(sessionId, maxEvents)
  })

  // ── Image Persistence ──────────────────────────────────────────

  ipcMain.handle('image:save', async (_event, id: string, dataUrl: string) => {
    try {
      if (!id || typeof id !== 'string' || !/^[0-9a-f-]+$/.test(id)) {
        return { success: false, error: 'Invalid image id' }
      }
      const filePath = join(getChatImagesDir(), `${id}.txt`)
      writeFileSync(filePath, dataUrl, 'utf-8')
      return { success: true }
    } catch (err: any) {
      error('IPC', 'image:save failed', { id, err })
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('image:load', async (_event, id: string) => {
    try {
      if (!id || typeof id !== 'string' || !/^[0-9a-f-]+$/.test(id)) {
        return null
      }
      const filePath = join(getChatImagesDir(), `${id}.txt`)
      if (!existsSync(filePath)) return null
      return readFileSync(filePath, 'utf-8')
    } catch {
      return null
    }
  })

  // ── Turn Checkpoints ───────────────────────────────────────────

  ipcMain.handle('session:getTurnCheckpoints', async (_event, sessionId: string, projectPath?: string) => {
    try {
      const { listSessionTurnCheckpoints } = await import('../session/turnCheckpointService')
      const resolvedProjectPath = projectPath || _event.sender?.getURL?.() || ''

      if (!resolvedProjectPath && !projectPath) {
        const chatStoreData = await _event.sender.executeJavaScript(
          `window.__chatStore_projectRoot || ''`
        ).catch(() => '')

        if (!chatStoreData) {
          return { ok: false, checkpoints: [], error: 'Project path not available' }
        }
      }

      const checkpoints = await listSessionTurnCheckpoints(sessionId, projectPath || '')
      return { ok: true, checkpoints, error: null }
    } catch (err) {
      return {
        ok: false,
        checkpoints: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  ipcMain.handle('session:getTurnRewindPreviewFiles', async (
    _event,
    sessionId: string,
    targetUserMessageId: string,
    userMessageIndex: number | undefined,
    projectPath?: string
  ) => {
    try {
      const { getTurnRewindPreviewFiles } = await import('../session/turnCheckpointService')
      return await getTurnRewindPreviewFiles(
        sessionId,
        projectPath || '',
        targetUserMessageId,
        userMessageIndex
      )
    } catch (err) {
      return {
        ok: false,
        files: [],
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('session:getTurnCheckpointDiff', async (
    _event,
    sessionId: string,
    targetUserMessageId: string,
    filePath: string,
    userMessageIndex?: number,
    projectPath?: string
  ) => {
    try {
      const { getTurnCheckpointDiff } = await import('../session/turnCheckpointService')
      return await getTurnCheckpointDiff(
        sessionId,
        projectPath || '',
        targetUserMessageId,
        filePath,
        userMessageIndex
      )
    } catch (err) {
      return {
        state: 'error' as const,
        path: filePath,
        error: err instanceof Error ? err.message : String(err),
        diff: undefined
      }
    }
  })

  ipcMain.handle('session:getSessionFileDiff', async (
    _event,
    sessionId: string,
    filePath: string,
    projectPath?: string
  ) => {
    try {
      const { getSessionFileDiff } = await import('../session/turnCheckpointService')
      return await getSessionFileDiff(sessionId, projectPath || '', filePath)
    } catch (err) {
      return {
        state: 'error' as const,
        path: filePath,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle('session:rewindTurn', async (
    _event,
    sessionId: string,
    options: { targetUserMessageId: string; userMessageIndex?: number },
    projectPath?: string
  ) => {
    try {
      const { rewindTurn } = await import('../session/turnCheckpointService')
      return await rewindTurn(
        sessionId,
        projectPath || '',
        options.targetUserMessageId,
        options.userMessageIndex
      )
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })
}

// ── Helpers ─────────────────────────────────────────────────────

function copyDirRecursive(src: string, dest: string) {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

function getChatImagesDir(): string {
  const dir = join(app.getPath('userData'), 'chat-images')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}
