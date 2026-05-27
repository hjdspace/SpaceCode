# Pi Coding Agent 引擎集成 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 SpaceCode 桌面应用新增 pi-coding-agent 作为可选 agent 引擎，在设置中可切换，不影响现有 claude-code 引擎功能。

**架构：** 引入 IEngine 统一接口抽象层，ClaudeCodeEngine 适配器包装现有子进程模式，PiEngine 通过 SDK 直接集成（createAgentSession + subscribe）。前端通过 EngineFactory 根据 engineType 选择引擎实例。事件通过 UnifiedEngineEvent 统一格式传递到渲染进程。

**技术栈：** Electron 33 + Vue 3 + Pinia + TypeScript + @mariozechner/pi-coding-agent SDK

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `electron/engines/types.ts` | 创建 | IEngine 接口、UnifiedEngineEvent、EngineType、EngineSessionConfig |
| `electron/engines/EngineFactory.ts` | 创建 | 引擎工厂，根据 EngineType 创建/缓存引擎实例 |
| `electron/engines/ClaudeCodeEngine.ts` | 创建 | IEngine 适配器，委托给现有 ClaudeCodeProcessPool |
| `electron/engines/PiEngine.ts` | 创建 | Pi SDK 直接集成，createAgentSession + 事件映射 |
| `electron/engines/PiEventMapper.ts` | 创建 | AgentEvent → UnifiedEngineEvent 映射逻辑 |
| `electron/claudeCodeIPC.ts` | 修改 | 使用 EngineFactory 路由到正确引擎 |
| `electron/preload.ts` | 修改 | 新增 pi 引擎状态 IPC（pi:status） |
| `src/stores/settings.ts` | 修改 | 新增 engineType、piConfig 字段 |
| `src/components/settings/GeneralSettings.vue` | 修改 | 新增引擎选择 UI 和 pi 配置表单 |
| `src/types/index.ts` | 修改 | 新增 EngineType 类型导出 |

---

### 任务 1：创建引擎类型定义

**文件：**
- 创建：`electron/engines/types.ts`

- [ ] **步骤 1：创建 types.ts 文件**

```typescript
// electron/engines/types.ts

import type { BrowserWindow } from 'electron'

export type EngineType = 'claude-code' | 'pi'

export interface EngineSessionConfig {
  cwd: string
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  thinkingEnabled?: boolean
  effortLevel?: string
  systemPrompt?: string
  agent?: string
  engineType?: EngineType
}

export interface UnifiedEngineEvent {
  sessionId: string
  type:
    | 'assistant'
    | 'tool_use'
    | 'tool_result'
    | 'stream_event'
    | 'result'
    | 'system'
    | 'error'
    | 'exit'
    | 'log'
    | 'suspended'
    | 'eviction_blocked'
    | 'user'
    | 'compact'
    | 'api_retry'
  data: any
}

export interface EngineSessionStatus {
  sessionId: string
  engineSessionId: string | null
  status: 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
  isRunning: boolean
}

export interface IEngine {
  readonly type: EngineType
  startSession(sessionId: string, config: EngineSessionConfig): Promise<void>
  sendMessage(sessionId: string, content: string): Promise<void>
  abort(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  suspendSession?(sessionId: string): void
  resumeSession?(sessionId: string): Promise<void>
  getSessionStatus(sessionId: string): EngineSessionStatus | null
  getActiveSessions(): EngineSessionStatus[]
  listAgents?(cwd?: string): Promise<AgentInfo[]>
  setMainWindow(window: BrowserWindow): void
}

export interface AgentInfo {
  agentType: string
  description: string
  source: 'built-in' | 'user' | 'project' | 'plugin'
  model?: string
  color?: string
}
```

- [ ] **步骤 2：验证 TypeScript 编译**

运行：`npx tsc --noEmit electron/engines/types.ts`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add electron/engines/types.ts
git commit -m "feat(pi-engine): add IEngine interface and unified event types"
```

---

### 任务 2：创建 ClaudeCodeEngine 适配器

**文件：**
- 创建：`electron/engines/ClaudeCodeEngine.ts`

- [ ] **步骤 1：创建 ClaudeCodeEngine.ts**

将现有 `ClaudeCodeProcessPool` 包装为 `IEngine` 接口。关键点：
- `ClaudeCodeProcessPool` 的事件通过 `routeEvent` 发送到 `mainWindow.webContents.send()`
- 适配器需要将 pool 的事件路由到 `UnifiedEngineEvent` 格式
- pool 的 `routeEvent` 已经发送 `claude-code:${eventType}` 格式，与 `UnifiedEngineEvent.type` 基本对齐

```typescript
// electron/engines/ClaudeCodeEngine.ts

import type { BrowserWindow } from 'electron'
import { ClaudeCodeProcessPool } from '../claudeCodeProcessPool'
import { SessionConfig } from '../claudeCodeProcessManager'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo } from './types'
import * as fs from 'fs'
import * as path from 'path'
import { info, error } from '../logger'

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

  sendMessage(sessionId: string, content: string): Promise<void> {
    this.pool.sendMessage(sessionId, content)
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
```

- [ ] **步骤 2：验证 TypeScript 编译**

运行：`npx tsc --noEmit --project tsconfig.node.json`
预期：无错误（可能需要调整 tsconfig 包含 engines/ 目录）

- [ ] **步骤 3：Commit**

```bash
git add electron/engines/ClaudeCodeEngine.ts
git commit -m "feat(pi-engine): add ClaudeCodeEngine adapter wrapping existing ProcessPool"
```

---

### 任务 3：创建 EngineFactory

**文件：**
- 创建：`electron/engines/EngineFactory.ts`

- [ ] **步骤 1：创建 EngineFactory.ts**

```typescript
// electron/engines/EngineFactory.ts

import type { BrowserWindow } from 'electron'
import type { EngineType, IEngine } from './types'
import { ClaudeCodeEngine } from './ClaudeCodeEngine'
import { PiEngine } from './PiEngine'
import { info } from '../logger'

export class EngineFactory {
  private static engines: Map<EngineType, IEngine> = new Map()
  private static mainWindow: BrowserWindow | null = null

  static setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    for (const engine of this.engines.values()) {
      engine.setMainWindow(window)
    }
  }

  static getEngine(type: EngineType): IEngine {
    if (!this.engines.has(type)) {
      switch (type) {
        case 'claude-code':
          this.engines.set(type, new ClaudeCodeEngine())
          break
        case 'pi':
          this.engines.set(type, new PiEngine())
          break
        default:
          throw new Error(`Unknown engine type: ${type}`)
      }
      info('EngineFactory', `Created engine instance | type=${type}`)
      if (this.mainWindow) {
        this.engines.get(type)!.setMainWindow(this.mainWindow)
      }
    }
    return this.engines.get(type)!
  }

  static getAllEngines(): IEngine[] {
    return Array.from(this.engines.values())
  }

  static killAll(): void {
    for (const engine of this.engines.values()) {
      const sessions = engine.getActiveSessions()
      for (const session of sessions) {
        engine.stop(session.sessionId).catch(() => {})
      }
    }
  }
}
```

- [ ] **步骤 2：验证 TypeScript 编译**

运行：`npx tsc --noEmit --project tsconfig.node.json`
预期：PiEngine 尚未创建，先创建占位文件

- [ ] **步骤 3：创建 PiEngine 占位文件**

```typescript
// electron/engines/PiEngine.ts

import type { BrowserWindow } from 'electron'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo } from './types'
import { info, error } from '../logger'

export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'
  private mainWindow: BrowserWindow | null = null

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    info('PiEngine', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd}`)
    throw new Error('PiEngine not yet implemented')
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    throw new Error('PiEngine not yet implemented')
  }

  async abort(sessionId: string): Promise<void> {
    throw new Error('PiEngine not yet implemented')
  }

  async stop(sessionId: string): Promise<void> {
    throw new Error('PiEngine not yet implemented')
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    return null
  }

  getActiveSessions(): EngineSessionStatus[] {
    return []
  }

  async listAgents(cwd?: string): Promise<AgentInfo[]> {
    return []
  }
}
```

- [ ] **步骤 4：验证 TypeScript 编译**

运行：`npx tsc --noEmit --project tsconfig.node.json`
预期：无错误

- [ ] **步骤 5：Commit**

```bash
git add electron/engines/EngineFactory.ts electron/engines/PiEngine.ts
git commit -m "feat(pi-engine): add EngineFactory and PiEngine placeholder"
```

---

### 任务 4：修改 claudeCodeIPC.ts 使用 EngineFactory

**文件：**
- 修改：`electron/claudeCodeIPC.ts`

- [ ] **步骤 1：修改 claudeCodeIPC.ts**

将所有 `pool.xxx` 调用替换为 `engine.xxx` 调用。保留 `getPool()` 向后兼容。

关键修改点：
1. 移除 `let pool: ClaudeCodeProcessPool | null = null`
2. 引入 `EngineFactory`
3. 所有 IPC handler 通过 `EngineFactory.getEngine(engineType)` 路由
4. `engineType` 从 config 参数或默认值获取
5. 保留 `getPool()` 兼容函数（返回 null，因为 pool 不再直接暴露）

```typescript
// electron/claudeCodeIPC.ts — 修改后的完整文件

import { ipcMain, BrowserWindow } from 'electron'
import { EngineFactory } from './engines/EngineFactory'
import type { EngineSessionConfig, AgentInfo } from './engines/types'
import { info, warn, error, debug } from './logger'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window
  EngineFactory.setMainWindow(window)
}

export function registerClaudeCodeIPC() {
  info('ClaudeCodeIPC', 'Initializing with EngineFactory')

  ipcMain.handle('claude-code:startSession', async (_, sessionId: string, config: EngineSessionConfig) => {
    const engineType = config.engineType || 'claude-code'
    info('ClaudeCodeIPC', `→ startSession | sessionId=${sessionId.slice(0, 8)} | engine=${engineType} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)
    const startMs = Date.now()
    try {
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

  ipcMain.handle('claude-code:sendMessage', async (_, sessionId: string, content: string) => {
    info('ClaudeCodeIPC', `→ sendMessage | sessionId=${sessionId.slice(0, 8)} | contentLen=${content.length}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      engine.sendMessage(sessionId, content)
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
    const engine = findEngineForSession(sessionId)
    await engine.stop(sessionId)
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
}

function findEngineForSession(sessionId: string) {
  for (const engine of EngineFactory.getAllEngines()) {
    if (engine.getSessionStatus(sessionId)) {
      return engine
    }
  }
  return EngineFactory.getEngine('claude-code')
}

export function getPool(): null {
  return null
}
```

- [ ] **步骤 2：验证现有 claude-code 引擎功能不受影响**

启动应用，测试：
1. 创建新会话 → 能正常启动
2. 发送消息 → 能正常收到回复
3. 工具调用 → 能正常执行
4. 中止/停止 → 能正常工作

- [ ] **步骤 3：Commit**

```bash
git add electron/claudeCodeIPC.ts
git commit -m "refactor(pi-engine): route IPC through EngineFactory instead of direct pool access"
```

---

### 任务 5：创建 PiEventMapper

**文件：**
- 创建：`electron/engines/PiEventMapper.ts`

- [ ] **步骤 1：创建 PiEventMapper.ts**

将 pi 的 `AgentSessionEvent` 映射为 `UnifiedEngineEvent`。这是集成的核心——pi 的事件模型与 claude-code 不同，需要精确映射。

```typescript
// electron/engines/PiEventMapper.ts

import type { UnifiedEngineEvent } from './types'

export interface PiAgentEvent {
  type: string
  [key: string]: any
}

export function mapPiEvent(sessionId: string, event: PiAgentEvent): UnifiedEngineEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { sessionId, type: 'system', data: { subtype: 'agent_start' } }

    case 'agent_end':
      return {
        sessionId,
        type: 'result',
        data: {
          result: extractFinalText(event.messages),
          stop_reason: 'end_turn',
          messages: event.messages,
        },
      }

    case 'turn_start':
      return null

    case 'turn_end':
      return null

    case 'message_start': {
      const msg = event.message
      if (msg?.role === 'assistant') {
        return {
          sessionId,
          type: 'assistant',
          data: { message: mapAssistantMessage(msg) },
        }
      }
      if (msg?.role === 'user') {
        return {
          sessionId,
          type: 'user',
          data: { message: msg },
        }
      }
      return null
    }

    case 'message_update': {
      const delta = event.assistantMessageEvent
      if (!delta) return null
      return {
        sessionId,
        type: 'stream_event',
        data: { event: delta },
      }
    }

    case 'message_end': {
      const msg = event.message
      if (msg?.role === 'assistant') {
        return {
          sessionId,
          type: 'assistant',
          data: { message: mapAssistantMessage(msg) },
        }
      }
      return null
    }

    case 'tool_execution_start':
      return {
        sessionId,
        type: 'tool_use',
        data: {
          id: event.toolCallId,
          name: event.toolName,
          input: event.args,
        },
      }

    case 'tool_execution_update':
      return {
        sessionId,
        type: 'stream_event',
        data: {
          event: {
            type: 'content_block_delta',
            delta: {
              type: 'tool_execution_delta',
              toolCallId: event.toolCallId,
              partialResult: event.partialResult,
            },
          },
        },
      }

    case 'tool_execution_end':
      return {
        sessionId,
        type: 'tool_result',
        data: {
          tool_use_id: event.toolCallId,
          output: formatToolResult(event.result),
          is_error: event.isError,
        },
      }

    case 'compaction_start':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'compaction_start', reason: event.reason },
      }

    case 'compaction_end':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'compaction_end', reason: event.reason, aborted: event.aborted },
      }

    case 'thinking_level_changed':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'thinking_level_changed', level: event.level },
      }

    case 'auto_retry_start':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'auto_retry_start', attempt: event.attempt, maxAttempts: event.maxAttempts },
      }

    case 'auto_retry_end':
      return {
        sessionId,
        type: 'system',
        data: { subtype: 'auto_retry_end', success: event.success, attempt: event.attempt },
      }

    case 'queue_update':
      return null

    case 'session_info_changed':
      return null

    default:
      return null
  }
}

function mapAssistantMessage(msg: any): any {
  return {
    role: 'assistant',
    content: msg.content,
    model: msg.model,
    usage: msg.usage,
  }
}

function extractFinalText(messages: any[]): string {
  if (!Array.isArray(messages)) return ''
  const lastAssistant = [...messages].reverse().find((m: any) => m.role === 'assistant')
  if (!lastAssistant) return ''
  const content = lastAssistant.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textBlock = content.find((c: any) => c.type === 'text')
    return textBlock?.text || ''
  }
  return ''
}

function formatToolResult(result: any): string {
  if (result === undefined || result === null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}
```

- [ ] **步骤 2：验证 TypeScript 编译**

运行：`npx tsc --noEmit --project tsconfig.node.json`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add electron/engines/PiEventMapper.ts
git commit -m "feat(pi-engine): add PiEventMapper for AgentEvent → UnifiedEngineEvent mapping"
```

---

### 任务 6：实现 PiEngine 核心

**文件：**
- 修改：`electron/engines/PiEngine.ts`

- [ ] **步骤 1：构建 pi-engine 依赖**

```bash
cd d:\AI\SpaceCode\pi-engine
npm install
npm run build
```

预期：构建成功，生成 dist/ 目录

- [ ] **步骤 2：在 SpaceCode 的 package.json 中添加 pi 依赖**

在 `package.json` 的 `dependencies` 中添加：

```json
"@mariozechner/pi-coding-agent": "file:./pi-engine/packages/coding-agent",
"@mariozechner/pi-agent-core": "file:./pi-engine/packages/agent",
"@mariozechner/pi-ai": "file:./pi-engine/packages/ai"
```

- [ ] **步骤 3：安装依赖**

```bash
cd d:\AI\SpaceCode
npm install
```

预期：安装成功，可能需要解决依赖冲突

- [ ] **步骤 4：实现 PiEngine.ts**

```typescript
// electron/engines/PiEngine.ts

import type { BrowserWindow } from 'electron'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo, UnifiedEngineEvent } from './types'
import { mapPiEvent } from './PiEventMapper'
import { info, warn, error } from '../logger'

interface PiSessionEntry {
  session: any
  unsubscribe: () => void
  config: EngineSessionConfig
  status: 'starting' | 'active' | 'idle' | 'exited'
}

export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'
  private mainWindow: BrowserWindow | null = null
  private sessions: Map<string, PiSessionEntry> = new Map()

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    info('PiEngine', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)

    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId)!
      if (existing.status === 'active' || existing.status === 'idle') {
        info('PiEngine', `[${sessionId.slice(0, 8)}] Session already active, reusing`)
        return
      }
    }

    try {
      const { createAgentSession } = await import('@mariozechner/pi-coding-agent')
      const { AuthStorage } = await import('@mariozechner/pi-coding-agent')
      const { ModelRegistry } = await import('@mariozechner/pi-coding-agent')

      const authStorage = AuthStorage.create()
      if (config.apiKey && config.provider) {
        await authStorage.setApiKey(config.provider, config.apiKey)
      }

      const modelRegistry = ModelRegistry.create(authStorage)

      const piConfig: any = {
        cwd: config.cwd,
        authStorage,
        modelRegistry,
      }

      if (config.model) {
        const models = await modelRegistry.getAvailable()
        const matched = models.find((m: any) => m.id === config.model || m.id.includes(config.model!))
        if (matched) {
          piConfig.model = matched
        }
      }

      if (config.thinkingEnabled !== undefined) {
        piConfig.thinkingLevel = config.thinkingEnabled ? 'medium' : 'off'
      }

      const { session } = await createAgentSession(piConfig)

      const unsubscribe = session.subscribe((event: any) => {
        this.handlePiEvent(sessionId, event)
      })

      this.sessions.set(sessionId, {
        session,
        unsubscribe,
        config,
        status: 'idle',
      })

      info('PiEngine', `[${sessionId.slice(0, 8)}] Session started successfully`)
    } catch (err) {
      error('PiEngine', `[${sessionId.slice(0, 8)}] Failed to start session`, { error: String(err) })
      throw err
    }
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)

    info('PiEngine', `[${sessionId.slice(0, 8)}] Sending message | contentLen=${content.length}`)
    entry.status = 'active'
    try {
      await entry.session.prompt(content)
      entry.status = 'idle'
    } catch (err) {
      entry.status = 'idle'
      error('PiEngine', `[${sessionId.slice(0, 8)}] Error sending message`, { error: String(err) })
      throw err
    }
  }

  async abort(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    info('PiEngine', `[${sessionId.slice(0, 8)}] Aborting session`)
    try {
      await entry.session.abort()
    } catch (err) {
      error('PiEngine', `[${sessionId.slice(0, 8)}] Error aborting session`, { error: String(err) })
    }
  }

  async stop(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    info('PiEngine', `[${sessionId.slice(0, 8)}] Stopping session`)
    entry.unsubscribe()
    try {
      entry.session.dispose()
    } catch {}
    this.sessions.delete(sessionId)
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    const entry = this.sessions.get(sessionId)
    if (!entry) return null
    return {
      sessionId,
      engineSessionId: null,
      status: entry.status,
      isRunning: entry.status === 'active',
    }
  }

  getActiveSessions(): EngineSessionStatus[] {
    return Array.from(this.sessions.entries()).map(([sessionId, entry]) => ({
      sessionId,
      engineSessionId: null,
      status: entry.status,
      isRunning: entry.status === 'active',
    }))
  }

  async listAgents(cwd?: string): Promise<AgentInfo[]> {
    return [
      {
        agentType: 'general-purpose',
        description: 'Pi coding agent - general purpose coding assistant',
        source: 'built-in' as const,
      },
    ]
  }

  private handlePiEvent(sessionId: string, event: any): void {
    const unifiedEvent = mapPiEvent(sessionId, event)
    if (!unifiedEvent) return

    const windowAvailable = this.mainWindow && !this.mainWindow.isDestroyed()
    if (windowAvailable) {
      this.mainWindow!.webContents.send(`claude-code:${unifiedEvent.type}`, { sessionId, data: unifiedEvent.data })
    } else {
      warn('PiEngine', `[${sessionId.slice(0, 8)}] Cannot route event to renderer | type=${unifiedEvent.type}`)
    }
  }
}
```

- [ ] **步骤 5：验证 TypeScript 编译**

运行：`npx tsc --noEmit --project tsconfig.node.json`
预期：无错误（可能需要调整 import 路径或 tsconfig）

- [ ] **步骤 6：Commit**

```bash
git add electron/engines/PiEngine.ts package.json package-lock.json
git commit -m "feat(pi-engine): implement PiEngine with SDK direct integration"
```

---

### 任务 7：扩展 Settings Store

**文件：**
- 修改：`src/stores/settings.ts`

- [ ] **步骤 1：在 settings.ts 中新增 engineType 和 piConfig**

在 `AuthSettings` 接口中新增字段：

```typescript
export type EngineType = 'claude-code' | 'pi'

export interface PiEngineConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl: string
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high'
}

export interface AuthSettings {
  authMethod: AuthMethod
  anthropicConfig: ProviderConfig
  openaiConfig: ProviderConfig
  geminiConfig: ProviderConfig
  oauthAccount: OAuthAccountInfo | null
  projectRoot: string
  thinkingEnabled?: boolean
  language?: Locale
  engineType?: EngineType
  piConfig?: PiEngineConfig
}
```

在 `useSettingsStore` 中新增响应式状态：

```typescript
const engineType = ref<EngineType>((saved as any).engineType || 'claude-code')
const piConfig = ref<PiEngineConfig>({
  provider: 'anthropic',
  model: '',
  apiKey: '',
  baseUrl: '',
  thinkingLevel: 'medium',
  ...((saved as any).piConfig || {}),
})
```

在 `saveSettings()` 中保存新字段：

```typescript
function saveSettings() {
  const data: AuthSettings & { effortLevel?: string; language?: Locale; engineType?: EngineType; piConfig?: PiEngineConfig } = {
    authMethod: authMethod.value,
    anthropicConfig: { ...anthropicConfig.value },
    openaiConfig: { ...openaiConfig.value },
    geminiConfig: { ...geminiConfig.value },
    oauthAccount: oauthAccount.value,
    projectRoot: projectRoot.value,
    effortLevel: effortLevel.value,
    thinkingEnabled: thinkingEnabled.value,
    language: language.value,
    engineType: engineType.value,
    piConfig: { ...piConfig.value },
  }
  // ... existing save logic
}
```

在 `applySettings()` 中应用新字段：

```typescript
if (settings.engineType) engineType.value = settings.engineType
if (settings.piConfig) piConfig.value = { ...piConfig.value, ...settings.piConfig }
```

在 return 中导出新字段：

```typescript
return {
  // ... existing exports
  engineType,
  piConfig,
}
```

- [ ] **步骤 2：验证前端编译**

运行：`npx vue-tsc --noEmit`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add src/stores/settings.ts
git commit -m "feat(pi-engine): add engineType and piConfig to settings store"
```

---

### 任务 8：修改前端 Chat Store 传递 engineType

**文件：**
- 修改：`src/stores/chat.ts`

- [ ] **步骤 1：在 chat.ts 中传递 engineType 到 startSession**

找到调用 `claudeCode.startSession` 的位置，将 `engineType` 和 pi 配置传入 config：

```typescript
// 在 initClaudeCodeSession 或类似函数中
const config = settingsStore.engineType === 'pi'
  ? {
      cwd: session.workingDirectory || settingsStore.projectRoot,
      provider: settingsStore.piConfig.provider,
      model: settingsStore.piConfig.model,
      apiKey: settingsStore.piConfig.apiKey,
      baseUrl: settingsStore.piConfig.baseUrl,
      thinkingEnabled: settingsStore.piConfig.thinkingLevel !== 'off',
      engineType: 'pi' as const,
    }
  : {
      ...settingsStore.config,
      cwd: session.workingDirectory || settingsStore.projectRoot,
      thinkingEnabled: settingsStore.thinkingEnabled,
      engineType: 'claude-code' as const,
    }
```

- [ ] **步骤 2：验证前端编译**

运行：`npx vue-tsc --noEmit`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add src/stores/chat.ts
git commit -m "feat(pi-engine): pass engineType and piConfig to startSession"
```

---

### 任务 9：修改设置页面 UI

**文件：**
- 修改：`src/components/settings/GeneralSettings.vue`

- [ ] **步骤 1：在 GeneralSettings.vue 中新增引擎选择区域**

在现有设置表单中，在合适位置（如认证方式选择之前）添加引擎选择 UI：

```vue
<div class="setting-group">
  <label class="setting-label">Agent 引擎</label>
  <div class="engine-selector">
    <button
      :class="['engine-option', { active: settingsStore.engineType === 'claude-code' }]"
      @click="settingsStore.engineType = 'claude-code'; settingsStore.saveSettings()"
    >
      <span class="engine-name">Claude Code</span>
      <span class="engine-desc">子进程模式</span>
    </button>
    <button
      :class="['engine-option', { active: settingsStore.engineType === 'pi' }]"
      @click="settingsStore.engineType = 'pi'; settingsStore.saveSettings()"
    >
      <span class="engine-name">Pi Agent</span>
      <span class="engine-desc">SDK 集成</span>
    </button>
  </div>
</div>

<div v-if="settingsStore.engineType === 'pi'" class="pi-config-section">
  <div class="setting-group">
    <label class="setting-label">Provider</label>
    <select v-model="settingsStore.piConfig.provider" @change="settingsStore.saveSettings()">
      <option value="anthropic">Anthropic</option>
      <option value="openai">OpenAI</option>
      <option value="google">Google Gemini</option>
      <option value="openrouter">OpenRouter</option>
    </select>
  </div>
  <div class="setting-group">
    <label class="setting-label">API Key</label>
    <input
      type="password"
      v-model="settingsStore.piConfig.apiKey"
      @change="settingsStore.saveSettings()"
      placeholder="输入 API Key"
    />
  </div>
  <div class="setting-group">
    <label class="setting-label">Base URL</label>
    <input
      type="text"
      v-model="settingsStore.piConfig.baseUrl"
      @change="settingsStore.saveSettings()"
      placeholder="可选，留空使用默认"
    />
  </div>
  <div class="setting-group">
    <label class="setting-label">Model</label>
    <input
      type="text"
      v-model="settingsStore.piConfig.model"
      @change="settingsStore.saveSettings()"
      placeholder="例如 claude-sonnet-4-5"
    />
  </div>
  <div class="setting-group">
    <label class="setting-label">Thinking Level</label>
    <select v-model="settingsStore.piConfig.thinkingLevel" @change="settingsStore.saveSettings()">
      <option value="off">Off</option>
      <option value="minimal">Minimal</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
    </select>
  </div>
</div>
```

添加对应的 CSS 样式：

```css
.engine-selector {
  display: flex;
  gap: 12px;
}
.engine-option {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  border: 2px solid var(--border-color, #333);
  border-radius: 8px;
  background: transparent;
  color: var(--text-color, #fff);
  cursor: pointer;
  transition: border-color 0.2s;
}
.engine-option.active {
  border-color: var(--accent-color, #6366f1);
  background: var(--accent-bg, rgba(99, 102, 241, 0.1));
}
.engine-name {
  font-weight: 600;
  font-size: 14px;
}
.engine-desc {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
}
.pi-config-section {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--border-color, #333);
  border-radius: 8px;
}
```

- [ ] **步骤 2：验证前端编译和 UI 渲染**

运行：`npm run dev`
预期：设置页面显示引擎选择，切换到 Pi Agent 时显示 pi 配置表单

- [ ] **步骤 3：Commit**

```bash
git add src/components/settings/GeneralSettings.vue
git commit -m "feat(pi-engine): add engine selector and pi config UI to settings"
```

---

### 任务 10：端到端集成测试

**文件：**
- 无新增文件

- [ ] **步骤 1：测试 claude-code 引擎功能不受影响**

1. 启动应用，引擎选择 "Claude Code"
2. 创建新会话，发送消息
3. 验证回复正常
4. 验证工具调用正常
5. 验证中止/停止正常

- [ ] **步骤 2：测试 pi 引擎基本功能**

1. 在设置中切换到 "Pi Agent"
2. 配置 Anthropic provider 和 API Key
3. 创建新会话，发送消息
4. 验证收到回复
5. 验证工具调用（如文件读取）正常
6. 验证中止功能正常

- [ ] **步骤 3：测试引擎切换**

1. 在 claude-code 引擎中创建会话
2. 切换到 pi 引擎
3. 创建新会话
4. 验证两个会话独立工作
5. 切换回 claude-code 引擎
6. 验证原有会话仍可使用

- [ ] **步骤 4：测试错误处理**

1. pi 引擎未配置 API Key 时，验证友好错误提示
2. pi 引擎配置无效 API Key 时，验证错误提示
3. pi 引擎启动失败时，验证不影响主应用

- [ ] **步骤 5：Commit**

```bash
git commit --allow-empty -m "test(pi-engine): e2e integration test verified"
```

---

### 任务 11：更新 types/index.ts 导出

**文件：**
- 修改：`src/types/index.ts`

- [ ] **步骤 1：在 index.ts 中导出 EngineType**

```typescript
export type EngineType = 'claude-code' | 'pi'
```

- [ ] **步骤 2：验证编译**

运行：`npx vue-tsc --noEmit`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add src/types/index.ts
git commit -m "feat(pi-engine): export EngineType from types/index.ts"
```
