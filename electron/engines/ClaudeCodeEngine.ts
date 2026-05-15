import type { BrowserWindow } from 'electron'
import { ClaudeCodeProcessPool } from '../claudeCodeProcessPool'
import { SessionConfig } from '../claudeCodeProcessManager'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo, ImageAttachment } from './types'
import * as fs from 'fs'
import * as path from 'path'
import { info } from '../logger'

const BUILTIN_AGENTS: AgentInfo[] = [
  {
    agentType: 'general-purpose',
    description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
    source: 'built-in',
  },
  {
    agentType: 'Explore',
    description: 'Fast read-only agent specialized for exploring codebases — finding files, searching code, answering questions about the codebase.',
    source: 'built-in',
    model: 'haiku',
    color: 'blue',
  },
  {
    agentType: 'Plan',
    description: 'Software architect agent for designing implementation plans. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
    source: 'built-in',
    model: 'inherit',
    color: 'purple',
  },
  {
    agentType: 'verification',
    description: 'Verification specialist that tries to break implementations. Runs builds, tests, linters, and adversarial probes to produce a PASS/FAIL verdict.',
    source: 'built-in',
    model: 'inherit',
    color: 'red',
  },
]

export class ClaudeCodeEngine implements IEngine {
  readonly type: EngineType = 'claude-code'
  private pool: ClaudeCodeProcessPool
  private _mainWindow: BrowserWindow | null = null

  constructor() {
    this.pool = new ClaudeCodeProcessPool()
  }

  setMainWindow(window: BrowserWindow): void {
    this._mainWindow = window
    this.pool.setMainWindow(window)
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    const sessionConfig: SessionConfig = {
      cwd: config.cwd,
      provider: config.provider as SessionConfig['provider'],
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      effortLevel: config.effortLevel as SessionConfig['effortLevel'],
      systemPrompt: config.systemPrompt,
      agent: config.agent,
      thinkingEnabled: config.thinkingEnabled,
    }
    await this.pool.startSession(sessionId, sessionConfig)
  }

  sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    this.pool.sendMessage(sessionId, content, images)
    return Promise.resolve()
  }

  submitToolAnswer(sessionId: string, toolCallId: string, answers: Record<string, string>): Promise<void> {
    this.pool.submitToolAnswer(sessionId, toolCallId, answers)
    return Promise.resolve()
  }

  skipToolAnswer(sessionId: string, toolCallId: string): Promise<void> {
    this.pool.skipToolAnswer(sessionId, toolCallId)
    return Promise.resolve()
  }

  abort(sessionId: string): Promise<void> {
    this.pool.abortSession(sessionId)
    return Promise.resolve()
  }

  stop(sessionId: string): Promise<void> {
    this.pool.killSession(sessionId)
    return Promise.resolve()
  }

  suspendSession(sessionId: string): void {
    this.pool.suspendSession(sessionId)
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.pool.resumeSession(sessionId)
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    const status = this.pool.getSessionStatus(sessionId)
    if (!status) return null
    return {
      sessionId: status.sessionId,
      engineSessionId: status.engineSessionId,
      status: status.status,
      isRunning: status.isRunning,
    }
  }

  getActiveSessions(): EngineSessionStatus[] {
    return this.pool.getActiveSessions().map(s => ({
      sessionId: s.sessionId,
      engineSessionId: s.engineSessionId,
      status: s.status,
      isRunning: s.isRunning,
    }))
  }

  async listAgents(cwd?: string): Promise<AgentInfo[]> {
    const agents: AgentInfo[] = [...BUILTIN_AGENTS]
    const searchDirs: string[] = []
    if (cwd) {
      searchDirs.push(path.join(cwd, '.claude', 'agents'))
    }
    const homeDir = process.env.HOME || process.env.USERPROFILE
    if (homeDir) {
      searchDirs.push(path.join(homeDir, '.claude', 'agents'))
    }
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue
      const isProject = dir !== path.join(homeDir!, '.claude', 'agents')
      try {
        const entries = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
        for (const entry of entries) {
          const filePath = path.join(dir, entry)
          try {
            const content = fs.readFileSync(filePath, 'utf8')
            const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
            if (!frontmatterMatch) continue
            const fm = frontmatterMatch[1]
            const nameMatch = fm.match(/^name:\s*['"]?([^'"\n]+)['"]?/m)
            const descMatch = fm.match(/^description:\s*['"]?([^'"\n]+)['"]?/m)
            const modelMatch = fm.match(/^model:\s*['"]?([^'"\n]+)['"]?/m)
            const colorMatch = fm.match(/^color:\s*['"]?([^'"\n]+)['"]?/m)
            if (nameMatch) {
              agents.push({
                agentType: nameMatch[1].trim(),
                description: descMatch ? descMatch[1].trim() : '',
                source: isProject ? 'project' : 'user',
                model: modelMatch?.[1]?.trim(),
                color: colorMatch?.[1]?.trim(),
              })
            }
          } catch {}
        }
      } catch {}
    }
    return agents
  }
}
