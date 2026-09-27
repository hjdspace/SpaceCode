/**
 * Agents Service - Handles agent management operations
 */

import { ipcMain, app } from 'electron'
import { join, basename } from 'path'
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'

import { parseYamlFrontMatter } from '../infra/frontMatter'

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
  /** Work / Code 模式归属（缺省 'code'）。 */
  mode?: 'work' | 'code'
  /** 展示用头像（emoji 或图标名）。 */
  avatar?: string
  /** 该助手默认权限模式。 */
  permission?: string
  /** 绑定的技能名（选中时注入会话 .claude/skills）。 */
  skills?: string[]
  /** 绑定的 MCP id。 */
  mcps?: string[]
  /** 推荐起手 prompt。 */
  recommendedPrompts?: string[]
  /** 中文描述（i18n）。 */
  descriptionZh?: string
  /** 中文推荐 prompt（i18n）。 */
  recommendedPromptsZh?: string[]

  // ===== Phase 4 新增 =====
  /** 技能是否为必须（缺则无法启动会话）。 */
  skillsRequired?: boolean
  /** 技能依赖的运行时，用于可用性检测。 */
  skillRuntime?: 'officecli' | 'node' | 'none'
  /** 技能描述（用于 UI 展示，非技能名）。 */
  skillDescriptions?: string[]
}

// Constants
const AGENTS_LIB_DIR = 'agents-lib' // packed to resources/agents-lib via extraResources

function getAgentsLibRoot(): string {
  if (app.isPackaged) {
    const primaryPath = join(process.resourcesPath, AGENTS_LIB_DIR)
    const fallbackPaths = [
      primaryPath,
      join(__dirname, '..', 'resources', AGENTS_LIB_DIR),
    ]
    for (const candidate of fallbackPaths) {
      if (existsSync(candidate)) return candidate
    }
    return primaryPath
  }
  return join(__dirname, '..', 'resources', AGENTS_LIB_DIR)
}

function getGlobalAgentsDir(): string {
  return join(app.getPath('home'), '.claude', 'agents')
}

function getProjectAgentsDir(cwd: string): string {
  return join(cwd, '.claude', 'agents')
}

function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return undefined
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
    const mode = fm?.mode === 'work' ? 'work' : (fm?.mode === 'code' ? 'code' : undefined)
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
      category: (fm?.category as string) || inferCategory(name),
      mode,
      avatar: typeof fm?.avatar === 'string' ? fm.avatar : undefined,
      permission: typeof fm?.permission === 'string' ? fm.permission : undefined,
      skills: toStringArray(fm?.skills),
      mcps: toStringArray(fm?.mcps),
      recommendedPrompts: toStringArray(fm?.recommendedPrompts),
      descriptionZh: typeof fm?.description_zh === 'string' ? fm.description_zh : undefined,
      recommendedPromptsZh: toStringArray(fm?.recommendedPrompts_zh),
      skillsRequired: fm?.skills_required === true || fm?.skillsRequired === true,
      skillRuntime: (fm?.skill_runtime as 'officecli' | 'node' | 'none' | undefined) ||
        (fm?.skillRuntime as 'officecli' | 'node' | 'none' | undefined),
      skillDescriptions: toStringArray(fm?.skill_descriptions || fm?.skillDescriptions),
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

  // 递归扫描根目录及一层子目录（如 agents-lib/work/），收集所有 .md 助手
  const scanDir = (dir: string, depth: number) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      console.error('[Agents] Failed to scan dir:', dir, err)
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const agent = readAgentFile(full, cwd)
        if (agent) agents.push(agent)
      } else if (entry.isDirectory() && depth > 0) {
        scanDir(full, depth - 1)
      }
    }
  }
  scanDir(libRoot, 1)

  return { agents }
}

/** 在 agents-lib 根目录及一层子目录中查找某助手的源 .md 路径。 */
function findAgentSourcePath(agentName: string): string | null {
  const libRoot = getAgentsLibRoot()
  const direct = join(libRoot, `${agentName}.md`)
  if (existsSync(direct)) return direct
  try {
    for (const entry of readdirSync(libRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const nested = join(libRoot, entry.name, `${agentName}.md`)
        if (existsSync(nested)) return nested
      }
    }
  } catch { /* ignore */ }
  return null
}

async function handleInstallAgent(
  _event: Electron.IpcMainInvokeEvent,
  agentName: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<{ success: boolean }> {
  if (agentName.includes('/') || agentName.includes('\\') || agentName.includes('..')) {
    throw new Error('Invalid agent name')
  }
  const sourcePath = findAgentSourcePath(agentName)

  if (!sourcePath) {
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
  if (agentName.includes('/') || agentName.includes('\\') || agentName.includes('..')) {
    throw new Error('Invalid agent name')
  }
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

  // Phase 5: 保存自定义助手到 ~/.claude/agents/<name>.md
  ipcMain.handle('agents:saveCustom', async (_event, agentName: string, content: string) => {
    if (agentName.includes('/') || agentName.includes('\\') || agentName.includes('..')) {
      throw new Error('Invalid agent name')
    }
    const targetDir = getGlobalAgentsDir()
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }
    const targetPath = join(targetDir, `${agentName}.md`)
    writeFileSync(targetPath, content, 'utf-8')
    console.log(`[Agents] Custom agent saved: ${agentName}`)
    return { success: true, path: targetPath }
  })

  console.log('[Agents] IPC handlers registered')
}
