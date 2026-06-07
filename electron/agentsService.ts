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
      category: (fm?.category as string) || inferCategory(name),
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
  if (agentName.includes('/') || agentName.includes('\\') || agentName.includes('..')) {
    throw new Error('Invalid agent name')
  }
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

// ==================== Workflow Functions ====================

interface WorkflowNode {
  id: string
  type: 'agent' | 'condition' | 'merge' | 'input' | 'output'
  position: { x: number; y: number }
  data: Record<string, any>
}

interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourcePort?: 'true' | 'false' | 'default'
}

interface WorkflowDef {
  id: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: string
  updatedAt: string
}

function getWorkflowsDir(): string {
  const dir = join(app.getPath('home'), '.claude', 'agent-workflows')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

async function handleListWorkflows(): Promise<{ workflows: WorkflowDef[] }> {
  const dir = getWorkflowsDir()
  const workflows: WorkflowDef[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = readFileSync(join(dir, entry.name), 'utf-8')
          workflows.push(JSON.parse(content))
        } catch {}
      }
    }
  } catch {}
  return { workflows }
}

async function handleSaveWorkflow(
  _event: Electron.IpcMainInvokeEvent,
  workflow: WorkflowDef
): Promise<{ success: boolean }> {
  const dir = getWorkflowsDir()
  const filePath = join(dir, `${workflow.id}.json`)
  workflow.updatedAt = new Date().toISOString()
  writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf-8')
  return { success: true }
}

async function handleDeleteWorkflow(
  _event: Electron.IpcMainInvokeEvent,
  id: string
): Promise<{ success: boolean }> {
  const filePath = join(getWorkflowsDir(), `${id}.json`)
  if (!existsSync(filePath)) {
    throw new Error(`Workflow '${id}' not found`)
  }
  unlinkSync(filePath)
  return { success: true }
}

async function handleExportWorkflow(
  _event: Electron.IpcMainInvokeEvent,
  id: string,
  scope: 'global' | 'project',
  cwd?: string
): Promise<{ content: string; path: string }> {
  const filePath = join(getWorkflowsDir(), `${id}.json`)
  if (!existsSync(filePath)) {
    throw new Error(`Workflow '${id}' not found`)
  }
  const workflow: WorkflowDef = JSON.parse(readFileSync(filePath, 'utf-8'))

  // Generate agent .md content
  const agentNodes = workflow.nodes.filter(n => n.type === 'agent')
  const allTools = new Set<string>()
  for (const node of agentNodes) {
    if (node.data?.agentName) {
      const agentPath = join(getAgentsLibRoot(), `${node.data.agentName}.md`)
      if (existsSync(agentPath)) {
        const content = readFileSync(agentPath, 'utf-8')
        const fm = parseYamlFrontMatter(content)
        if (fm?.tools) {
          const tools = Array.isArray(fm.tools) ? fm.tools : [fm.tools]
          tools.forEach((t: string) => allTools.add(t))
        }
      }
    }
  }

  let stepNum = 1
  let flowSteps = ''
  for (const node of workflow.nodes) {
    if (node.type === 'agent') {
      flowSteps += `${stepNum}. **${node.data?.label || node.data?.agentName}**：调用 ${node.data?.agentName} agent\n`
      if (node.data?.inputTemplate) {
        flowSteps += `   输入模板：${node.data.inputTemplate}\n`
      }
      stepNum++
    } else if (node.type === 'condition') {
      flowSteps += `${stepNum}. **条件判断**：${node.data?.condition}\n`
      stepNum++
    } else if (node.type === 'merge') {
      flowSteps += `${stepNum}. **汇总**：${node.data?.strategy === 'summarize' ? '由 LLM 总结合并' : '直接拼接合并'}\n`
      stepNum++
    }
  }

  const mdContent = `---
name: ${workflow.name}
description: ${workflow.description || `编排工作流：${workflow.name}`}
tools: [${Array.from(allTools).join(', ')}]
model: sonnet
---

你是一个编排代理。按以下流程执行：

## 执行流程

${flowSteps}

## 输出格式

将每个阶段的结果汇总为结构化报告。
`

  const targetDir = scope === 'global' ? getGlobalAgentsDir() : getProjectAgentsDir(cwd || process.cwd())
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }
  const targetPath = join(targetDir, `${workflow.name}.md`)
  writeFileSync(targetPath, mdContent, 'utf-8')

  return { content: mdContent, path: targetPath }
}

export function registerAgentsIPCHandlers(): void {
  ipcMain.handle('agents:scanLibrary', handleScanLibrary)
  ipcMain.handle('agents:install', handleInstallAgent)
  ipcMain.handle('agents:uninstall', handleUninstallAgent)
  ipcMain.handle('agents:getInstalled', handleGetInstalled)
  ipcMain.handle('agents:listWorkflows', handleListWorkflows)
  ipcMain.handle('agents:saveWorkflow', handleSaveWorkflow)
  ipcMain.handle('agents:deleteWorkflow', handleDeleteWorkflow)
  ipcMain.handle('agents:exportWorkflow', handleExportWorkflow)

  console.log('[Agents] IPC handlers registered')
}
