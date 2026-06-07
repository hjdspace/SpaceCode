/**
 * Agents Service - Handles agent management and workflow operations
 */

import { ipcMain, app } from 'electron'
import { join, basename } from 'path'
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'

// Types
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

// Constants
const AGENTS_LIB_DIR = 'agents-lib'

function getAgentsLibRoot(): string {
  if (app.isPackaged) {
    const primaryPath = join(process.resourcesPath, AGENTS_LIB_DIR)
    const fallbackPaths = [
      primaryPath,
      join(__dirname, '..', AGENTS_LIB_DIR),
    ]
    for (const candidate of fallbackPaths) {
      if (existsSync(candidate)) return candidate
    }
    return primaryPath
  }
  return join(__dirname, '..', AGENTS_LIB_DIR)
}

function getGlobalAgentsDir(): string {
  return join(app.getPath('home'), '.claude', 'agents')
}

function getProjectAgentsDir(cwd: string): string {
  return join(cwd, '.claude', 'agents')
}

function parseYamlFrontMatter(content: string): Record<string, any> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  try {
    const yaml = match[1]
    const result: Record<string, any> = {}
    const lines = yaml.split('\n')
    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue
      const key = line.slice(0, colonIndex).trim()
      let value: string | string[] = line.slice(colonIndex + 1).trim()
      if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, ''))
      } else if (typeof value === 'string' && (value.startsWith('"') || value.startsWith("'"))) {
        value = value.slice(1, -1)
      }
      result[key] = value
    }
    return result
  } catch {
    return null
  }
}

function inferCategory(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('reviewer')) return 'reviewer'
  if (lower.includes('resolver') || lower.includes('builder') || lower.startsWith('build-')) return 'builder'
  if (lower.includes('architect') || lower.includes('planner')) return 'architect'
  if (lower.includes('security')) return 'security'
  return 'general'
}

function checkAgentInstalled(agentName: string, cwd?: string): { installed: boolean; scope?: 'global' | 'project' } {
  const globalDir = getGlobalAgentsDir()
  const globalPath = join(globalDir, `${agentName}.md`)
  if (existsSync(globalPath)) return { installed: true, scope: 'global' }

  if (cwd) {
    const projectPath = join(getProjectAgentsDir(cwd), `${agentName}.md`)
    if (existsSync(projectPath)) return { installed: true, scope: 'project' }
  }

  return { installed: false }
}

function readAgentFile(filePath: string, cwd?: string): AgentDef | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const fm = parseYamlFrontMatter(content)
    const name = fm?.name || basename(filePath, '.md')
    const description = fm?.description || ''
    const tools = fm?.tools ? (Array.isArray(fm.tools) ? fm.tools : [fm.tools]) : undefined
    const model = fm?.model
    const color = fm?.color
    const status = checkAgentInstalled(name, cwd)

    return {
      name,
      description,
      content,
      tools,
      model,
      color,
      sourceDir: join(filePath, '..'),
      agentPath: filePath,
      isInstalled: status.installed,
      installedScope: status.scope,
      category: inferCategory(name),
    }
  } catch (err) {
    console.error(`[Agents] Failed to read agent file: ${filePath}`, err)
    return null
  }
}

async function handleScanLibrary(
  _event: Electron.IpcMainInvokeEvent,
  cwd?: string
): Promise<{ agents: AgentDef[] }> {
  const agents: AgentDef[] = []
  const libRoot = getAgentsLibRoot()

  if (!existsSync(libRoot)) {
    return { agents }
  }

  try {
    const entries = readdirSync(libRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const agent = readAgentFile(join(libRoot, entry.name), cwd)
        if (agent) agents.push(agent)
      }
    }
  } catch (err) {
    console.error('[Agents] Failed to scan library:', err)
  }

  return { agents }
}

async function handleInstallAgent(
  _event: Electron.IpcMainInvokeEvent,
  agentName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<{ success: boolean }> {
  const libRoot = getAgentsLibRoot()
  const sourcePath = join(libRoot, `${agentName}.md`)

  if (!existsSync(sourcePath)) {
    throw new Error(`Agent '${agentName}' not found in library`)
  }

  const targetDir = scope === 'global' ? getGlobalAgentsDir() : getProjectAgentsDir(cwd || process.cwd())
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  const targetPath = join(targetDir, `${agentName}.md`)
  if (existsSync(targetPath)) {
    throw new Error(`Agent '${agentName}' is already installed at ${targetPath}`)
  }

  const content = readFileSync(sourcePath, 'utf-8')
  writeFileSync(targetPath, content, 'utf-8')

  console.log(`[Agents] Installed agent '${agentName}' to ${scope}`)
  return { success: true }
}

async function handleUninstallAgent(
  _event: Electron.IpcMainInvokeEvent,
  agentName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<{ success: boolean }> {
  const targetDir = scope === 'global' ? getGlobalAgentsDir() : getProjectAgentsDir(cwd || process.cwd())
  const targetPath = join(targetDir, `${agentName}.md`)

  if (!existsSync(targetPath)) {
    throw new Error(`Agent '${agentName}' is not installed`)
  }

  unlinkSync(targetPath)
  console.log(`[Agents] Uninstalled agent '${agentName}' from ${scope}`)
  return { success: true }
}

async function handleGetInstalled(
  _event: Electron.IpcMainInvokeEvent,
  cwd?: string
): Promise<{ agents: AgentDef[] }> {
  const agents: AgentDef[] = []

  // Global agents
  const globalDir = getGlobalAgentsDir()
  if (existsSync(globalDir)) {
    try {
      const entries = readdirSync(globalDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const agent = readAgentFile(join(globalDir, entry.name), cwd)
          if (agent) {
            agent.isInstalled = true
            agent.installedScope = 'global'
            agents.push(agent)
          }
        }
      }
    } catch (err) {
      console.error('[Agents] Failed to read global agents:', err)
    }
  }

  // Project agents
  if (cwd) {
    const projectDir = getProjectAgentsDir(cwd)
    if (existsSync(projectDir)) {
      try {
        const entries = readdirSync(projectDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const agent = readAgentFile(join(projectDir, entry.name), cwd)
            if (agent) {
              agent.isInstalled = true
              agent.installedScope = 'project'
              agents.push(agent)
            }
          }
        }
      } catch (err) {
        console.error('[Agents] Failed to read project agents:', err)
      }
    }
  }

  return { agents }
}

export function registerAgentsIPCHandlers(): void {
  ipcMain.handle('agents:scanLibrary', handleScanLibrary)
  ipcMain.handle('agents:install', handleInstallAgent)
  ipcMain.handle('agents:uninstall', handleUninstallAgent)
  ipcMain.handle('agents:getInstalled', handleGetInstalled)

  console.log('[Agents] IPC handlers registered')
}
