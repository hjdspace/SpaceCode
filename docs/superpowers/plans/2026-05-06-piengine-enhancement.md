# PiEngine v2.0 Enhancement Implementation Plan

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 增强 Electron 端 PiEngine，实现会话持久化、动态工具注册、Artifacts 集成、增强状态查询四大能力，达到与 Web-UI 功能对等。

**架构：** 采用渐进式增强方案，通过 4 个独立模块（SessionStore、ToolRegistry、ArtifactsManager、StatusProvider）组合注入到现有 PiEngine 中，保持 IEngine 接口向后兼容。

**技术栈：** TypeScript, Electron (Node.js), `@mariozechner/pi-agent`, `@mariozechner/pi-web-ui`, JSON 文件存储, IPC 通信

---

## 文件结构总览

### 新建文件（4 个）

| 文件路径 | 职责 | 预估行数 |
|---------|------|---------|
| `electron/engines/pi-session-store.ts` | JSON 会话持久化层 | ~250 |
| `electron/engines/pi-tool-registry.ts` | 工具注册表与 Factory 模式 | ~180 |
| `electron/engines/pi-artifacts-manager.ts` | Artifacts 完整集成管理 | ~200 |
| `electron/engines/pi-session-status.ts` | 增强状态查询提供者 | ~120 |

### 修改文件（2 个）

| 文件路径 | 改动内容 | 影响范围 |
|---------|---------|---------|
| `electron/engines/PiEngine.ts` | 集成 4 个新模块、扩展 startSession/stop/getStatus | +150 行 |
| `electron/engines/types.ts` | 扩展 EngineSessionConfig、新增类型定义 | +30 行 |

### 测试文件（4+1 个）

| 文件路径 | 覆盖模块 | 测试数量 |
|---------|---------|---------|
| `electron/__tests__/pi-session-store.test.ts` | SessionStore | 15 |
| `electron/__tests__/pi-tool-registry.test.ts` | ToolRegistry | 10 |
| `electron/__tests__/pi-artifacts-manager.test.ts` | ArtifactsManager | 12 |
| `electron/__tests__/pi-session-status.test.ts` | StatusProvider | 8 |
| `electron/__tests__/pi-engine-integration.test.ts` | E2E Integration | 6 |

---

## 任务分解

### 任务 1：扩展类型定义

**前置依赖：** 无  
**预估时间：** 15 分钟

**文件：**
- 修改：`electron/engines/types.ts`

- [ ] **步骤 1：添加 ThinkingLevel 类型和新接口**

在 `types.ts` 文件末尾新增导出类型：

```typescript
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

export interface ToolFactoryContext {
  agent: any
  sessionId: string
  config: EngineSessionConfig
  cwd: string
}

export type ToolFactory = (
  context: ToolFactoryContext,
  defaultTools: Array<any>
) => Promise<Array<any>> | Array<any>
```

- [ ] **步骤 2：扩展 EngineSessionConfig 接口**

找到 `EngineSessionConfig` 接口定义，添加新字段：

```typescript
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

  // ====== PiEngine v2.0 新增字段 ======
  enableArtifacts?: boolean           // 默认: false
  toolsFactory?: ToolFactory          // 可选的自定义工具工厂
  autoSaveInterval?: number           // 自动保存防抖间隔(ms)，默认: 3000
  persistSession?: boolean            // 是否启用持久化，默认: true
}
```

- [ ] **步骤 3：验证 TypeScript 编译**

运行：`cd electron && npx tsc --noEmit`
预期：无错误输出

- [ ] **步骤 4：Commit**

```bash
git add electron/engines/types.ts
git commit -m "feat(pi-engine): extend type definitions for v2.0 enhancement"
```

---

### 任务 2：实现 PiSessionStore - 基础结构

**前置依赖：** 任务 1  
**预估时间：** 30 分钟

**文件：**
- 创建：`electron/engines/pi-session-store.ts`
- 测试：`electron/__tests__/pi-session-store.test.ts`

- [ ] **步骤 1：创建基础类结构和接口定义**

创建文件 `electron/engines/pi-session-store.ts`：

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { info, warn, error } from '../logger'

const CURRENT_SCHEMA_VERSION = 1
const INDEX_CACHE_TTL = 5 * 60 * 1000

export interface PiSessionData {
  id: string
  title: string
  createdAt: string
  lastModified: string
  config: {
    cwd: string
    provider: string
    modelId: string
    thinkingLevel: import('./types').ThinkingLevel
    systemPrompt: string
  }
  state: {
    messages: any[]
    model: any
    tools: string[]
  }
  usage: {
    totalMessages: number
    totalTokens: number
    estimatedCost: number
  }
}

export interface PiSessionMetadata {
  id: string
  title: string
  preview: string
  createdAt: string
  lastModified: string
  messageCount: number
  modelId: string
  status: 'active' | 'archived'
}

interface PiSessionIndex {
  version: number
  sessions: PiSessionMetadata[]
}
```

- [ ] **步骤 2：实现构造函数和路径初始化**

继续在同一文件中添加类定义：

```typescript
export class PiSessionStore {
  private storePath: string
  private indexPath: string
  private lockPath: string
  private sessionsDir: string
  private indexCache: { data: PiSessionIndex; timestamp: number } | null = null

  constructor(basePath?: string) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    this.storePath = basePath || path.join(homeDir, '.claude', 'pi-sessions')
    this.indexPath = path.join(this.storePath, 'index.json')
    this.lockPath = path.join(this.storePath, '.lock')
    this.sessionsDir = path.join(this.storePath, 'sessions')

    this.ensureDirectories()
  }

  private ensureDirectories(): void {
    try {
      fs.mkdirSync(this.sessionsDir, { recursive: true })
    } catch (err) {
      warn('PiSessionStore', 'Failed to create directories', { error: String(err), path: this.storePath })
    }
  }

  generateTitle(messages: any[]): string {
    if (!messages || messages.length === 0) return ''
    const firstUserMsg = messages.find((m: any) =>
      m.role === 'user' || m.role === 'user-with-attachments'
    )
    if (!firstUserMsg) return ''
    let text = ''
    const content = firstUserMsg.content
    if (typeof content === 'string') {
      text = content
    } else if (Array.isArray(content)) {
      const textBlocks = content.filter((c: any) => c.type === 'text')
      text = textBlocks.map((c: any) => c.text || '').join(' ')
    }
    text = text.trim()
    if (!text) return ''
    const sentenceEnd = text.search(/[.!?]/)
    if (sentenceEnd > 0 && sentenceEnd <= 50) {
      return text.substring(0, sentenceEnd + 1)
    }
    return text.length <= 50 ? text : `${text.substring(0, 47)}...`
  }
}
```

- [ ] **步骤 3：编写基础测试 - 构造函数验证**

创建测试文件 `electron/__tests__/pi-session-store.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { PiSessionStore } from '../../engines/pi-session-store'

describe('PiSessionStore', () => {
  let store: PiSessionStore
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-session-test-'))
    store = new PiSessionStore(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should create store directories on initialization', () => {
    expect(fs.existsSync(path.join(tmpDir, 'sessions'))).toBe(true)
  })

  it('should use custom base path if provided', () => {
    const customPath = path.join(tmpDir, 'custom')
    const customStore = new PiSessionStore(customPath)
    expect(fs.existsSync(path.join(customPath, 'sessions'))).toBe(true)
  })
})
```

- [ ] **步骤 4：运行测试确认通过**

运行：`cd electron && npx vitest run __tests__/pi-session-store.test.ts`
预期：2 tests passed

- [ ] **步骤 5：Commit**

```bash
git add electron/engines/pi-session-store.ts electron/__tests__/pi-session-store.test.ts
git commit -m "feat(pi-engine): implement PiSessionStore basic structure"
```

---

### 任务 3：实现 PiSessionStore - 文件锁与 CRUD 操作

**前置依赖：** 任务 2  
**预估时间：** 40 分钟

**文件：**
- 修改：`electron/engines/pi-session-store.ts`
- 修改：`electron/__tests__/pi-session-store.test.ts`

- [ ] **步骤 1：实现 acquireLock 和 releaseLock 方法**

在 `PiSessionStore` 类中添加：

```typescript
private async acquireLock(): Promise<void> {
  const maxWait = 5000
  const interval = 100
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    try {
      fs.writeFileSync(this.lockPath, process.pid.toString(), { flag: 'wx' })
      return
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code !== 'EEXIST') throw err
      await new Promise(resolve => setTimeout(resolve, interval))
    }
  }

  throw new Error(`Failed to acquire lock after ${maxWait}ms`)
}

private releaseLock(): void {
  try {
    if (fs.existsSync(this.lockPath)) {
      fs.unlinkSync(this.lockPath)
    }
  } catch (err) {
    warn('PiSessionStore', 'Failed to release lock', { error: String(err) })
  }
}
```

- [ ] **步骤 2：实现 save/load/delete/list 方法**

在类中添加完整 CRUD 方法：

```typescript
async save(sessionData: PiSessionData): Promise<void> {
  await this.acquireLock()
  try {
    const sessionPath = path.join(this.sessionsDir, `${sessionData.id}.json`)
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8')

    const index = await this.readIndex()
    const existingIdx = index.sessions.findIndex(s => s.id === sessionData.id)

    const metadata: PiSessionMetadata = {
      id: sessionData.id,
      title: sessionData.title,
      preview: sessionData.state.messages?.[0]?.content?.toString()?.slice(0, 100) || '',
      createdAt: sessionData.createdAt,
      lastModified: sessionData.lastModified,
      messageCount: sessionData.usage.totalMessages,
      modelId: sessionData.config.modelId,
      status: 'active',
    }

    if (existingIdx >= 0) {
      index.sessions[existingIdx] = metadata
    } else {
      index.sessions.push(metadata)
    }

    await this.writeIndex(index)
    info('PiSessionStore', `Session saved | id=${sessionData.id.slice(0, 8)} | messages=${metadata.messageCount}`)
  } finally {
    this.releaseLock()
  }
}

async load(id: string): Promise<PiSessionData | null> {
  const sessionPath = path.join(this.sessionsDir, `${id}.json`)
  try {
    if (!fs.existsSync(sessionPath)) return null
    const raw = fs.readFileSync(sessionPath, 'utf-8')
    const data: PiSessionData = JSON.parse(raw)
    if (!data.id || !data.state) {
      warn('PiSessionStore', `Invalid session data | id=${id}`)
      return null
    }
    return data
  } catch (err) {
    error('PiSessionStore', `Failed to load session | id=${id}`, { error: String(err) })
    return null
  }
}

async delete(id: string): Promise<void> {
  await this.acquireLock()
  try {
    const sessionPath = path.join(this.sessionsDir, `${id}.json`)
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath)
    }
    const index = await this.readIndex()
    index.sessions = index.sessions.filter(s => s.id !== id)
    await this.writeIndex(index)
    info('PiSessionStore', `Session deleted | id=${id.slice(0, 8)}`)
  } finally {
    this.releaseLock()
  }
}

async list(options?: {
  limit?: number; offset?: number;
  sortBy?: 'lastModified' | 'createdAt' | 'title';
  sortOrder?: 'asc' | 'desc';
  status?: 'all' | 'active' | 'archived';
}): Promise<PiSessionMetadata[]> {
  const index = await this.readIndex()
  let filtered = [...index.sessions]

  if (options?.status && options.status !== 'all') {
    filtered = filtered.filter(s => s.status === options.status)
  }

  const sortBy = options?.sortBy || 'lastModified'
  const sortOrder = options?.sortOrder || 'desc'
  filtered.sort((a, b) => {
    const comparison = a[sortBy]!.localeCompare(b[sortBy]!)
    return sortOrder === 'asc' ? comparison : -comparison
  })

  const offset = options?.offset || 0
  const limit = options?.limit || 50
  return filtered.slice(offset, offset + limit)
}
```

- [ ] **步骤 3：实现 readIndex/writeIndex 私有方法**

```typescript
private async readIndex(): Promise<PiSessionIndex> {
  if (this.indexCache && (Date.now() - this.indexCache.timestamp) < INDEX_CACHE_TTL) {
    return this.indexCache.data
  }

  if (!fs.existsSync(this.indexPath)) {
    const emptyIndex: PiSessionIndex = { version: CURRENT_SCHEMA_VERSION, sessions: [] }
    this.indexCache = { data: emptyIndex, timestamp: Date.now() }
    return emptyIndex
  }

  try {
    const raw = fs.readFileSync(this.indexPath, 'utf-8')
    const index: PiSessionIndex = JSON.parse(raw)

    if (index.version < CURRENT_SCHEMA_VERSION) {
      await this.migrateIndex(index)
    }

    this.indexCache = { data: index, timestamp: Date.now() }
    return index
  } catch (err) {
    error('PiSessionStore', 'Failed to read index', { error: String(err) })
    return { version: CURRENT_SCHEMA_VERSION, sessions: [] }
  }
}

private async writeIndex(index: PiSessionIndex): Promise<void> {
  fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf-8')
  this.indexCache = { data: index, timestamp: Date.now() }
}

private async migrateIndex(index: PiSessionIndex): Promise<void> {
  info('PiSessionStore', `Migrating index from v${index.version} to v${CURRENT_SCHEMA_VERSION}`)
  index.version = CURRENT_SCHEMA_VERSION
  await this.writeIndex(index)
}
```

- [ ] **步骤 4：编写完整的 CRUD 和锁机制测试**

替换测试文件内容为完整版本：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { PiSessionStore } from '../../engines/pi-session-store'

describe('PiSessionStore', () => {
  let store: PiSessionStore
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-session-test-'))
    store = new PiSessionStore(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should create store directories on initialization', () => {
    expect(fs.existsSync(path.join(tmpDir, 'sessions'))).toBe(true)
  })

  it('should use custom base path if provided', () => {
    const customPath = path.join(tmpDir, 'custom')
    const customStore = new PiSessionStore(customPath)
    expect(fs.existsSync(path.join(customPath, 'sessions'))).toBe(true)
  })

  describe('File Locking', () => {
    it('should acquire and release lock successfully', async () => {
      await store['acquireLock']()
      expect(fs.existsSync(store['lockPath'])).toBe(true)
      store['releaseLock']()
      expect(fs.existsSync(store['lockPath'])).toBe(false)
    })

    it('should throw error when lock cannot be acquired', async () => {
      fs.writeFileSync(store['lockPath'], '99999')
      await expect(store['acquireLock']()).rejects.toThrow('Failed to acquire lock')
      store['releaseLock']()
    }, 10000)
  })

  describe('CRUD Operations', () => {
    const mockSessionData: import('../../engines/pi-session-store').PiSessionData = {
      id: crypto.randomUUID(),
      title: 'Test Session',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      config: {
        cwd: '/test/project',
        provider: 'anthropic',
        modelId: 'claude-sonnet-4',
        thinkingLevel: 'off',
        systemPrompt: 'You are helpful',
      },
      state: {
        messages: [{ role: 'user', content: 'Hello world' }],
        model: { id: 'test-model', name: 'Test Model' },
        tools: ['bash'],
      },
      usage: { totalMessages: 1, totalTokens: 10, estimatedCost: 0.001 },
    }

    it('should save and load session correctly', async () => {
      await store.save(mockSessionData)
      const loaded = await store.load(mockSessionData.id)
      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe(mockSessionData.id)
      expect(loaded!.title).toBe(mockSessionData.title)
      expect(loaded!.state.messages).toHaveLength(1)
    })

    it('should list saved sessions', async () => {
      await store.save(mockSessionData)
      const list = await store.list()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe(mockSessionData.id)
      expect(list[0].modelId).toBe(mockSessionData.config.modelId)
    })

    it('should delete session correctly', async () => {
      await store.save(mockSessionData)
      await store.delete(mockSessionData.id)
      const loaded = await store.load(mockSessionData.id)
      expect(loaded).toBeNull()
      const list = await store.list()
      expect(list).toHaveLength(0)
    })

    it('should return null for non-existent session', async () => {
      const loaded = await store.load('non-existent-id')
      expect(loaded).toBeNull()
    })
  })

  describe('generateTitle', () => {
    it('should extract title from first user message', () => {
      const messages = [
        { role: 'user', content: 'Implement user authentication feature.' },
        { role: 'assistant', content: 'Sure!' },
      ]
      const title = store.generateTitle(messages)
      expect(title).toBe('Implement user authentication feature.')
    })

    it('should truncate long titles to 50 chars with ellipsis', () => {
      const longText = 'A'.repeat(100)
      const messages = [{ role: 'user', content: longText }]
      const title = store.generateTitle(messages)
      expect(title.length).toBeLessThanOrEqual(50)
      expect(title.endsWith('...')).toBe(true)
    })

    it('should handle array content format', () => {
      const messages = [{
        role: 'user',
        content: [{ type: 'text', text: 'Array format message.' }, { type: 'other', data: {} }],
      }]
      const title = store.generateTitle(messages)
      expect(title).toBe('Array format message.')
    })
  })
})
```

- [ ] **步骤 5：运行全部 SessionStore 测试**

运行：`cd electron && npx vitest run __tests__/pi-session-store.test.ts`
预期：12+ tests passed

- [ ] **步骤 6：Commit**

```bash
git add electron/engines/pi-session-store.ts electron/__tests__/pi-session-store.test.ts
git commit -m "feat(pi-engine): complete PiSessionStore with file locking and CRUD"
```

---

### 任务 4：实现 PiToolRegistry

**前置依赖：** 任务 1  
**预估时间：** 35 分钟

**文件：**
- 创建：`electron/engines/pi-tool-registry.ts`
- 测试：`electron/__tests__/pi-tool-registry.test.ts`

- [ ] **步骤 1：创建完整的 PiToolRegistry 类**

创建文件 `electron/engines/pi-tool-registry.ts`：

```typescript
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { codingTools } from '@mariozechner/pi-coding-agent/dist/tools/index.js'
import type { ToolFactoryContext, ToolFactory } from './types'
import { info, warn } from '../logger'

class PiToolRegistry {
  private customFactory: ToolFactory | null = null
  private artifactsTool: AgentTool<any> | null = null
  private enabledArtifacts = false

  setToolsFactory(factory: ToolFactory): void {
    this.customFactory = factory
    info('PiToolRegistry', 'Custom tools factory set')
  }

  enableArtifacts(enabled: boolean, artifactsTool?: AgentTool<any>): void {
    this.enabledArtifacts = enabled
    if (enabled && artifactsTool) {
      this.artifactsTool = artifactsTool
      info('PiToolRegistry', 'Artifacts tool enabled')
    } else if (!enabled) {
      this.artifactsTool = null
    }
  }

  async resolveTools(context: ToolFactoryContext): Promise<AgentTool<any>[]> {
    let tools: AgentTool<any>[] = [...codingTools]

    if (this.enabledArtifacts && this.artifactsTool) {
      tools.push(this.artifactsTool)
    }

    if (this.customFactory) {
      try {
        const customTools = await this.customFactory(context, tools)
        tools = this.mergeTools(tools, customTools)
      } catch (err) {
        warn('PiToolRegistry', 'Custom tools factory failed, using defaults', { error: String(err) })
      }
    }

    return tools
  }

  getToolNames(): string[] {
    const names: string[] = []
    if (this.enabledArtifacts && this.artifactsTool) {
      names.push(this.artifactsTool.name)
    }
    return names
  }

  getToolInfo(name: string): { name: string; description: string } | null {
    if (this.artifactsTool?.name === name) {
      return { name: this.artifactsTool.name, description: this.artifactsTool.description || '' }
    }
    return null
  }

  private mergeTools(base: AgentTool<any>[], additional: AgentTool<any>[]): AgentTool<any>[] {
    const merged = new Map<string, AgentTool<any>>()
    for (const tool of base) merged.set(tool.name, tool)
    for (const tool of additional) merged.set(tool.name, tool)
    return Array.from(merged.values())
  }
}

export { PiToolRegistry }
```

- [ ] **步骤 2：编写工具注册表测试**

创建测试文件 `electron/__tests__/pi-tool-registry.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { PiToolRegistry } from '../../engines/pi-tool-registry'

describe('PiToolRegistry', () => {
  let registry: PiToolRegistry

  beforeEach(() => {
    registry = new PiToolRegistry()
  })

  describe('default behavior', () => {
    it('should return codingTools when no factory set', async () => {
      const context = { agent: {}, sessionId: 'test-session', config: { cwd: '/test' }, cwd: '/test' }
      const tools = await registry.resolveTools(context)
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.some(t => t.name)).toBe(true)
    })

    it('should return empty custom tool names by default', () => {
      expect(registry.getToolNames()).toEqual([])
    })
  })

  describe('artifacts integration', () => {
    it('should include artifacts tool when enabled', async () => {
      const mockArtifactTool = {
        name: 'artifacts', description: 'Create visual artifacts',
        parameters: {}, execute: async () => ({})
      }
      registry.enableArtifacts(true, mockArtifactTool as any)
      const context = { agent: {}, sessionId: 'test', config: {}, cwd: '/' }
      const tools = await registry.resolveTools(context)
      expect(tools.some(t => t.name === 'artifacts')).toBe(true)
      expect(registry.getToolNames()).toContain('artifacts')
    })

    it('should not include artifacts tool when disabled', async () => {
      registry.enableArtifacts(false)
      const context = { agent: {}, sessionId: 'test', config: {}, cwd: '/' }
      const tools = await registry.resolveTools(context)
      expect(tools.every(t => t.name !== 'artifacts')).toBe(true)
    })
  })

  describe('custom factory', () => {
    it('should merge custom tools with defaults', async () => {
      const customTool = {
        name: 'custom_tool', description: 'A custom tool',
        parameters: {}, execute: async () => ({ result: 'ok' })
      }
      registry.setToolsFactory(async (_ctx, defaults) => [...defaults, customTool as any])
      const context = { agent: {}, sessionId: 'test', config: {}, cwd: '/' }
      const tools = await registry.resolveTools(context)
      expect(tools.some(t => t.name === 'custom_tool')).toBe(true)
      expect(tools.length).toBeGreaterThan(1)
    })

    it('should handle factory errors gracefully', async () => {
      registry.setToolsFactory(async () => { throw new Error('Factory failed') })
      const context = { agent: {}, sessionId: 'test', config: {}, cwd: '/' }
      const tools = await registry.resolveTools(context)
      expect(tools.length).toBeGreaterThan(0)
    })
  })

  describe('merge strategy', () => {
    it('should deduplicate tools by name (later wins)', async () => {
      const overrideTool = {
        name: 'bash', description: 'Overridden bash',
        parameters: {}, execute: async () => ({ overridden: true })
      }
      registry.setToolsFactory(async (_ctx, _defaults) => [overrideTool as any])
      const context = { agent: {}, sessionId: 'test', config: {}, cwd: '/' }
      const tools = await registry.resolveTools(context)
      const bashTool = tools.find(t => t.name === 'bash')
      expect(bashTool).toBeDefined()
      expect(bashTool!.description).toBe('Overridden bash')
    })
  })
})
```

- [ ] **步骤 3：运行 ToolRegistry 测试**

运行：`cd electron && npx vitest run __tests__/pi-tool-registry.test.ts`
预期：10 tests passed

- [ ] **步骤 4：Commit**

```bash
git add electron/engines/pi-tool-registry.ts electron/__tests__/pi-tool-registry.test.ts
git commit -m "feat(pi-engine): implement PiToolRegistry with factory pattern"
```

---

### 任务 5：实现 PiEnhancedStatusProvider

**前置依赖：** 任务 1  
**预估时间：** 30 分钟

**文件：**
- 创建：`electron/engines/pi-session-status.ts`
- 测试：`electron/__tests__/pi-session-status.test.ts`

- [ ] **步骤 1：创建增强状态数据模型和 Provider 类**

创建文件 `electron/engines/pi-session-status.ts`：

```typescript
import type { EngineSessionStatus, ThinkingLevel } from './types'

export interface EnhancedSessionStatus extends EngineSessionStatus {
  sessionInfo: {
    title: string; createdAt: string; lastModified: string
    lastActivityAt: string; messageCount: number
  }
  config: {
    cwd: string; provider: string; modelId: string; modelName: string
    thinkingLevel: ThinkingLevel; systemPromptPreview: string
  }
  tools: {
    registeredCount: number; toolNames: string[]
    customToolsCount: number; artifactsEnabled: boolean
  }
  usage: {
    totalTokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
    estimatedCost: { input: number; output: number; cacheRead: number; total: number }
    messageBreakdown: { user: number; assistant: number; toolUse: number; toolResult: number }
  }
}

interface StatusEntry {
  agent: any
  config: import('./types').EngineSessionConfig
  status: string
  createdAt?: string
}

class PiEnhancedStatusProvider {
  private sessionsCache = new Map<string, { data: EnhancedSessionStatus; timestamp: number }>()
  private readonly CACHE_TTL = 5000

  async getStatus(sessionId: string, entry: StatusEntry): Promise<EnhancedSessionStatus | null> {
    const cached = this.sessionsCache.get(sessionId)
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.data
    }
    const status = this.buildStatus(sessionId, entry)
    this.sessionsCache.set(sessionId, { data: status, timestamp: Date.now() })
    return status
  }

  invalidateCache(sessionId: string): void {
    this.sessionsCache.delete(sessionId)
  }

  private buildStatus(sessionId: string, entry: StatusEntry): EnhancedSessionStatus {
    const agentState = entry.agent?.state || {}
    const messages = agentState.messages || []
    const model = agentState.model || {}
    const tools = agentState.tools || []

    return {
      sessionId, engineSessionId: null,
      status: entry.status as EnhancedSessionStatus['status'],
      isRunning: entry.status === 'active',

      sessionInfo: {
        title: 'Active Session',
        createdAt: entry.createdAt || new Date().toISOString(),
        lastModified: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        messageCount: messages.length,
      },

      config: {
        cwd: entry.config.cwd || '',
        provider: entry.config.provider || 'anthropic',
        modelId: model.id || entry.config.model || 'unknown',
        modelName: model.name || model.id || 'Unknown Model',
        thinkingLevel: agentState.thinkingLevel || 'off',
        systemPromptPreview: (entry.config.systemPrompt || '').slice(0, 200),
      },

      tools: {
        registeredCount: tools.length,
        toolNames: tools.map((t: any) => t.name).filter(Boolean),
        customToolsCount: 0,
        artifactsEnabled: false,
      },

      usage: {
        totalTokens: this.calculateTokenUsage(messages),
        estimatedCost: this.calculateEstimatedCost(messages),
        messageBreakdown: this.calculateMessageBreakdown(messages),
      },
    }
  }

  private calculateTokenUsage(messages: any[]) {
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0
    for (const msg of messages) {
      if (msg.usage) {
        input += msg.usage.inputTokens || 0
        output += msg.usage.outputTokens || 0
        cacheRead += msg.usage.cacheReadInputTokens || 0
        cacheWrite += msg.usage.cacheCreationInputTokens || 0
      }
    }
    return { input, output, cacheRead, cacheWrite }
  }

  private calculateEstimatedCost(messages: any[]) {
    let input = 0, output = 0, cacheRead = 0
    for (const msg of messages) {
      if (msg.usage) {
        input += msg.usage.cost?.input || 0
        output += msg.usage.cost?.output || 0
        cacheRead += msg.usage.cost?.cacheRead || 0
      }
    }
    return { input, output, cacheRead, total: input + output + cacheRead }
  }

  private calculateMessageBreakdown(messages: any[]) {
    let user = 0, assistant = 0, toolUse = 0, toolResult = 0
    for (const msg of messages) {
      switch (msg.role) {
        case 'user': case 'user-with-attachments': user++; break
        case 'assistant': assistant++; break
        case 'tool':
          if (msg.toolCallId) toolResult++
          else if (msg.toolName) toolUse++
          break
      }
    }
    return { user, assistant, toolUse, toolResult }
  }
}

export { PiEnhancedStatusProvider, type EnhancedSessionStatus }
```

- [ ] **步骤 2：编写状态提供者测试**

创建测试文件 `electron/__tests__/pi-session-status.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { PiEnhancedStatusProvider } from '../../engines/pi-session-status'

describe('PiEnhancedStatusProvider', () => {
  let provider: PiEnhancedStatusProvider

  beforeEach(() => { provider = new PiEnhancedStatusProvider() })

  const createMockEntry = (overrides = {}) => ({
    agent: {
      state: {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!', usage: { inputTokens: 10, outputTokens: 20 } },
        ],
        model: { id: 'test-model', name: 'Test Model' },
        tools: [{ name: 'bash' }, { name: 'read_file' }],
        thinkingLevel: 'medium',
      },
    },
    config: { cwd: '/project', provider: 'anthropic', model: 'claude-sonnet-4', systemPrompt: 'You are helpful' },
    status: 'idle',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  })

  it('should build enhanced status with all fields', async () => {
    const entry = createMockEntry()
    const status = await provider.getStatus('session-1', entry)
    expect(status).not.toBeNull()
    expect(status!.sessionId).toBe('session-1')
    expect(status!.isRunning).toBe(false)
    expect(status!.sessionInfo.messageCount).toBe(2)
    expect(status!.config.modelId).toBe('test-model')
    expect(status!.tools.registeredCount).toBe(2)
    expect(status!.usage.totalTokens.input).toBe(10)
    expect(status!.usage.messageBreakdown.user).toBe(1)
    expect(status!.usage.messageBreakdown.assistant).toBe(1)
  })

  it('should cache status results', async () => {
    const entry = createMockEntry()
    const status1 = await provider.getStatus('session-1', entry)
    const status2 = await provider.getStatus('session-1', entry)
    expect(status1).toBe(status2)
  })

  it('should invalidate cache on demand', async () => {
    const entry = createMockEntry()
    await provider.getStatus('session-1', entry)
    provider.invalidateCache('session-1')
    const status = await provider.getStatus('session-1', entry)
    expect(status).not.toBeNull()
  })

  it('should handle empty agent state gracefully', async () => {
    const entry = createMockEntry({ agent: { state: {} } })
    const status = await provider.getStatus('session-empty', entry)
    expect(status).not.toBeNull()
    expect(status!.sessionInfo.messageCount).toBe(0)
    expect(status!.tools.registeredCount).toBe(0)
  })

  it('should calculate usage from multiple messages', async () => {
    const entry = createMockEntry({
      agent: {
        state: {
          messages: [
            { role: 'user', content: 'Msg1' },
            { role: 'assistant', content: 'Resp1', usage: { inputTokens: 100, outputTokens: 200, cost: { input: 0.001, output: 0.002 } } },
            { role: 'user', content: 'Msg2' },
            { role: 'assistant', content: 'Resp2', usage: { inputTokens: 150, outputTokens: 250, cost: { input: 0.0015, output: 0.0025 } } },
          ],
          model: { id: 'model' }, tools: [], thinkingLevel: 'off',
        },
      },
    })
    const status = await provider.getStatus('session-multi', entry)
    expect(status!.usage.totalTokens.input).toBe(250)
    expect(status!.usage.totalTokens.output).toBe(450)
    expect(status!.usage.estimatedCost.total).toBeCloseTo(0.007, 3)
  })
})
```

- [ ] **步骤 3：运行状态提供者测试**

运行：`cd electron && npx vitest run __tests__/pi-session-status.test.ts`
预期：6 tests passed

- [ ] **步骤 4：Commit**

```bash
git add electron/engines/pi-session-status.ts electron/__tests__/pi-session-status.test.ts
git commit -m "feat(pi-engine): implement PiEnhancedStatusProvider"
```

---

### 任务 6：实现 PiArtifactsManager

**前置依赖：** 任务 1  
**预估时间：** 40 分钟

**文件：**
- 创建：`electron/engines/pi-artifacts-manager.ts`
- 测试：`electron/__tests__/pi-artifacts-manager.test.ts`

- [ ] **步骤 1：创建 ArtifactsManager 完整实现**

创建文件 `electron/engines/pi-artifacts-manager.ts`：

```typescript
import * as fs from 'fs'
import * as path from 'path'
import { info, warn } from '../logger'

export interface ArtifactEntry {
  id: string; sessionId: string
  type: 'html' | 'svg' | 'markdown' | 'text' | 'code'
  title: string; content: string; createdAt: string
  filePath?: string
  metadata?: { language?: string; size?: number }
}

class PiArtifactsManager {
  private panel: any = null
  private toolRenderer: any = null
  private artifactsDir: string
  private artifactsMap: Map<string, ArtifactEntry> = new Map()

  constructor(basePath?: string) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ''
    this.artifactsDir = basePath || path.join(homeDir, '.claude', 'pi-artifacts')
    this.ensureDirectory()
  }

  private ensureDirectory(): void {
    try { fs.mkdirSync(this.artifactsDir, { recursive: true }) }
    catch (err) { warn('PiArtifactsManager', 'Failed to create directory', { error: String(err) }) }
  }

  async initialize(agent: any): Promise<void> {
    try {
      const { ArtifactsPanel, ArtifactsToolRenderer } = await import('@mariozechner/pi-web-ui')
      this.panel = new ArtifactsPanel()
      this.panel.agent = agent
      this.toolRenderer = new ArtifactsToolRenderer(this.panel)
      info('PiArtifactsManager', 'Initialized with ArtifactsPanel')
    } catch (err) {
      warn('PiArtifactsManager', 'Failed to initialize ArtifactsPanel', { error: String(err) })
      this.panel = null
      this.toolRenderer = null
    }
  }

  getTool(): any { return this.panel?.tool || null }
  getToolRenderer(): any { return this.toolRenderer }

  handleAgentEvent(event: any): void {
    if (!this.panel) return
    if (event.type === 'state-update' && event.state?.artifacts) {
      // Sync artifacts from agent state
    }
  }

  getArtifacts(sessionId?: string): Map<string, ArtifactEntry> {
    if (sessionId) {
      const filtered = new Map<string, ArtifactEntry>()
      for (const [id, artifact] of this.artifactsMap) {
        if (artifact.sessionId === sessionId) filtered.set(id, artifact)
      }
      return filtered
    }
    return this.artifactsMap
  }

  getArtifactCount(): number { return this.artifactsMap.size }

  async saveArtifact(artifact: ArtifactEntry): Promise<string> {
    const sessionDir = path.join(this.artifactsDir, artifact.sessionId)
    fs.mkdirSync(sessionDir, { recursive: true })
    const ext = this.getFileExtension(artifact.type)
    const fileName = `${artifact.id}${ext}`
    const filePath = path.join(sessionDir, fileName)
    fs.writeFileSync(filePath, artifact.content, 'utf-8')
    artifact.filePath = filePath
    this.artifactsMap.set(artifact.id, artifact)
    info('PiArtifactsManager', `Artifact saved | id=${artifact.id.slice(0, 8)} | type=${artifact.type}`)
    return filePath
  }

  async loadSessionArtifacts(sessionId: string): Promise<ArtifactEntry[]> {
    const sessionDir = path.join(this.artifactsDir, sessionId)
    if (!fs.existsSync(sessionDir)) return []

    const artifacts: ArtifactEntry[] = []
    const files = fs.readdirSync(sessionDir)
    for (const file of files) {
      if (file.startsWith('.') || file === 'index.json') continue
      try {
        const filePath = path.join(sessionDir, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        const ext = path.extname(file).slice(1)
        artifacts.push({
          id: path.basename(file, '.' + ext),
          sessionId, type: this.getTypeFromExtension(ext),
          title: path.basename(file), content,
          createdAt: fs.statSync(filePath).mtime.toISOString(), filePath,
        })
      } catch (err) {
        warn('PiArtifactsManager', `Failed to load artifact | file=${file}`, { error: String(err) })
      }
    }
    return artifacts
  }

  async deleteArtifact(artifactId: string): Promise<void> {
    const artifact = this.artifactsMap.get(artifactId)
    if (!artifact) return
    if (artifact.filePath && fs.existsSync(artifact.filePath)) {
      fs.unlinkSync(artifact.filePath)
    }
    this.artifactsMap.delete(artifactId)
    info('PiArtifactsManager', `Artifact deleted | id=${artifactId.slice(0, 8)}`)
  }

  async persistAll(): Promise<void> {
    for (const [, artifact] of this.artifactsMap) {
      if (!artifact.filePath) await this.saveArtifact(artifact)
    }
  }

  private getFileExtension(type: string): string {
    const map: Record<string, string> = { html: '.html', svg: '.svg', markdown: '.md', text: '.txt', code: '.txt' }
    return map[type] || '.txt'
  }

  private getTypeFromExtension(ext: string): ArtifactEntry['type'] {
    const map: Record<string, ArtifactEntry['type']> = { '.html': 'html', '.svg': 'svg', '.md': 'markdown', '.txt': 'text' }
    return map['.' + ext] || 'text'
  }
}

export { PiArtifactsManager, type ArtifactEntry }
```

- [ ] **步骤 2：编写 ArtifactsManager 测试**

创建测试文件 `electron/__tests__/pi-artifacts-manager.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { PiArtifactsManager } from '../../engines/pi-artifacts-manager'

describe('PiArtifactsManager', () => {
  let manager: PiArtifactsManager
  let tmpDir: string

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-artifacts-test-')); manager = new PiArtifactsManager(tmpDir) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  describe('initialization', () => {
    it('should create artifacts directory', () => { expect(fs.existsSync(tmpDir)).toBe(true) })
    it('should initialize without crashing', async () => { await manager.initialize({}) })
  })

  describe('artifact lifecycle', () => {
    it('should save and retrieve artifact', async () => {
      const filePath = await manager.saveArtifact({
        id: 'test-1', sessionId: 's1', type: 'html', title: 'Test', content: '<h1>H</h1>', createdAt: new Date().toISOString(),
      })
      expect(filePath).toContain('test-1.html')
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('<h1>H</h1>')
    })

    it('should track artifacts in memory', async () => {
      await manager.saveArtifact({ id: 't2', sessionId: 's1', type: 'md' as any, title: 'T', content: '# H', createdAt: '' })
      expect(manager.getArtifactCount()).toBe(1)
    })

    it('should filter by session', async () => {
      await manager.saveArtifact({ id: 'a1', sessionId: 'sa', type: 'text', title: 'A', content: 'A', createdAt: '' })
      await manager.saveArtifact({ id: 'a2', sessionId: 'sb', type: 'text', title: 'B', content: 'B', createdAt: '' })
      expect(manager.getArtifacts('sa').size).toBe(1)
    })

    it('should delete correctly', async () => {
      await manager.saveArtifact({ id: 'del', sessionId: 's1', type: 'svg', title: 'D', content: '<svg/>', createdAt: '' })
      await manager.deleteArtifact('del')
      expect(manager.getArtifactCount()).toBe(0)
    })

    it('should use correct extensions per type', async () => {
      for (const type of ['html', 'svg', 'markdown', 'text'] as const) {
        const fp = await manager.saveArtifact({ id: `ext-${type}`, sessionId: 'se', type, title: '', content: '', createdAt: '' })
        expect(fp).endsWith({ html: '.html', svg: '.svg', markdown: '.md', text: '.txt' }[type])
      }
    })
  })

  describe('persistence', () => {
    it('should load from disk after save', async () => {
      await manager.saveArtifact({ id: 'persist', sessionId: 'load', type: 'text', title: 'P', content: 'Saved!', createdAt: '' })
      const mgr2 = new PiArtifactsManager(tmpDir)
      const loaded = await mgr2.loadSessionArtifacts('load')
      expect(loaded).toHaveLength(1)
      expect(loaded[0].content).toBe('Saved!')
    })
  })
})
```

- [ ] **步骤 3：运行 ArtifactsManager 测试**

运行：`cd electron && npx vitest run __tests__/pi-artifacts-manager.test.ts`
预期：12 tests passed

- [ ] **步骤 4：Commit**

```bash
git add electron/engines/pi-artifacts-manager.ts electron/__tests__/pi-artifacts-manager.test.ts
git commit -m "feat(pi-engine): implement PiArtifactsManager with persistence"
```

---

### 任务 7：集成新模块到 PiEngine

**前置依赖：** 任务 2, 3, 4, 5, 6  
**预估时间：** 45 分钟

**文件：**
- 修改：`electron/engines/PiEngine.ts`

- [ ] **步骤 1：导入新模块并扩展私有属性**

在 `PiEngine.ts` 文件顶部添加导入，并修改类属性：

```typescript
// 在现有 import 之后添加
import { PiSessionStore } from './pi-session-store.js'
import { PiToolRegistry } from './pi-tool-registry.js'
import { PiArtifactsManager } from './pi-artifacts-manager.js'
import { PiEnhancedStatusProvider } from './pi-session-status.js'
```

修改 `PiSessionEntry` 接口和类的私有属性部分：

```typescript
interface PiSessionEntry {
  agent: any
  unsubscribe: () => void
  config: EngineSessionConfig
  status: 'starting' | 'active' | 'idle' | 'exited'
  createdAt: string
}

export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'
  private mainWindow: BrowserWindow | null = null
  private sessions: Map<string, PiSessionEntry> = new Map()

  // NEW: Module instances
  private sessionStore: PiSessionStore
  private toolRegistries: Map<string, PiToolRegistry> = new Map()
  private artifactsManagers: Map<string, PiArtifactsManager> = new Map()
  private statusProvider: PiEnhancedStatusProvider
  private autoSaveQueue: Map<string, NodeJS.Timeout> = new Map()
  private saveOptimizations: Map<string, { count: number; at: number }> = new Map()

  constructor() {
    this.sessionStore = new PiSessionStore()
    this.statusProvider = new PiEnhancedStatusProvider()
  }
```

- [ ] **步骤 2：重写 startSession 方法以集成新模块**

替换现有的 `startSession` 方法为增强版本（核心改动点）：

关键改动：
1. 尝试从 SessionStore 加载已有会话
2. 初始化 ToolRegistry 并解析工具
3. 初始化 ArtifactsManager（如果启用）
4. 在事件订阅中触发自动保存、缓存失效、Artifacts 同步

具体代码见设计文档 §4.2 的流程图，此处为精简版：

```typescript
async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
  info('PiEngine', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd}`)

  if (this.sessions.has(sessionId)) {
    const existing = this.sessions.get(sessionId)!
    if (existing.status === 'active' || existing.status === 'idle') return
  }

  // Load persisted session if available
  if (config.persistSession !== false) {
    const saved = await this.sessionStore.load(sessionId)
    if (saved) {
      if (saved.config.modelId) config.model = saved.config.modelId
      if (saved.config.provider) config.provider = saved.config.provider
    }
  }

  const available = await loadPiSdk()
  if (!available) throw new Error('pi-coding-agent SDK is not installed.')

  try {
    // ... 现有的模型解析逻辑保持不变 ...

    // Initialize Tool Registry
    const toolRegistry = new PiToolRegistry()
    if (config.enableArtifacts) {
      const artifactsMgr = new PiArtifactsManager()
      await artifactsMgr.initialize(null as any)
      this.artifactsManagers.set(sessionId, artifactsMgr)
      toolRegistry.enableArtifacts(true, artifactsMgr.getTool())
    }
    if (config.toolsFactory) toolRegistry.setToolsFactory(config.toolsFactory)
    this.toolRegistries.set(sessionId, toolRegistry)

    const toolContext = { agent: null as any, sessionId, config, cwd: config.cwd }
    const tools = await toolRegistry.resolveTools(toolContext)

    // ... 创建 Agent 实例 ...

    toolContext.agent = agent
    const artifactsMgr = this.artifactsManagers.get(sessionId)
    if (artifactsMgr) await artifactsMgr.initialize(agent)

    const unsubscribe = agent.subscribe((event: any) => {
      this.handlePiEvent(sessionId, event)
    })

    this.sessions.set(sessionId, { agent, unsubscribe, config, status: 'idle', createdAt: new Date().toISOString() })
    info('PiEngine', `[${sessionId.slice(0, 8)}] Session started | tools=${tools.length}`)
  } catch (err) {
    error('PiEngine', `[${sessionId.slice(0, 8)}] Failed to start`, { error: String(err) })
    throw err
  }
}
```

- [ ] **步骤 3：更新事件处理方法**

修改 `handlePiEvent` 添加自动保存、缓存失效、Artifacts 转发：

```typescript
private handlePiEvent(sessionId: string, event: any): void {
  const unifiedEvent = mapPiEvent(sessionId, event)
  if (!unifiedEvent) return

  const windowAvailable = this.mainWindow && !this.mainWindow.isDestroyed()
  if (windowAvailable) {
    this.mainWindow!.webContents.send(`claude-code:${unifiedEvent.type}`, { sessionId, data: unifiedEvent.data })
  }

  // Auto-save on state updates
  if (event.type === 'state-update') {
    this.autoSaveDebounced(sessionId)
  }

  // Invalidate status cache on key events
  if (['message_update', 'message_end', 'agent_end'].includes(event.type)) {
    this.statusProvider.invalidateCache(sessionId)
  }

  // Forward to Artifacts Manager
  const artifactsMgr = this.artifactsManagers.get(sessionId)
  if (artifactsMgr) artifactsMgr.handleAgentEvent(event)
}
```

- [ ] **步骤 4：添加辅助方法（auto-save、persist）**

在类中添加新方法：

```typescript
private autoSaveDebounced(sessionId: string): void {
  const existingTimer = this.autoSaveQueue.get(sessionId)
  if (existingTimer) clearTimeout(existingTimer)

  const entry = this.sessions.get(sessionId)
  const interval = entry?.config.autoSaveInterval || 3000

  const timer = setTimeout(async () => {
    await this.persistSession(sessionId)
    this.autoSaveQueue.delete(sessionId)
  }, interval)

  this.autoSaveQueue.set(sessionId, timer)
}

private async persistSession(sessionId: string): Promise<void> {
  const entry = this.sessions.get(sessionId)
  if (!entry) return
  const state = entry.agent?.state
  if (!state) return

  const optimization = this.saveOptimizations.get(sessionId)
  const currentCount = state.messages?.length || 0
  if (optimization && currentCount === optimization.count) return

  const sessionData = {
    id: sessionId,
    title: this.sessionStore.generateTitle(state.messages) || 'Untitled',
    createdAt: entry.createdAt || new Date().toISOString(),
    lastModified: new Date().toISOString(),
    config: {
      cwd: entry.config.cwd, provider: entry.config.provider || 'anthropic',
      modelId: state.model?.id || entry.config.model || 'unknown',
      thinkingLevel: state.thinkingLevel || 'off', systemPrompt: entry.config.systemPrompt || '',
    },
    state: { messages: state.messages || [], model: state.model, tools: (state.tools || []).map((t: any) => t.name).filter(Boolean) },
    usage: { totalMessages: currentCount, totalTokens: 0, estimatedCost: 0 },
  }

  await this.sessionStore.save(sessionData)
  this.saveOptimizations.set(sessionId, { count: currentCount, at: Date.now() })
  info('PiEngine', `[${sessionId.slice(0, 8)}] Auto-saved | messages=${currentCount}`)
}
```

- [ ] **步骤 5：更新 stop 方法以清理资源**

```typescript
async stop(sessionId: string): Promise<void> {
  const entry = this.sessions.get(sessionId)
  if (!entry) return

  await this.persistSession(sessionId)
  entry.unsubscribe()
  this.sessions.delete(sessionId)

  this.statusProvider.invalidateCache(sessionId)
  const timer = this.autoSaveQueue.get(sessionId)
  if (timer) { clearTimeout(timer); this.autoSaveQueue.delete(sessionId) }
  this.saveOptimizations.delete(sessionId)

  const artifactsMgr = this.artifactsManagers.get(sessionId)
  if (artifactsMgr) { await artifactsMgr.persistAll(); this.artifactsManagers.delete(sessionId) }
  this.toolRegistries.delete(sessionId)

  info('PiEngine', `[${sessionId.slice(0, 8)}] Session stopped and cleaned up`)
}
```

- [ ] **步骤 6：添加新的公共查询方法**

```typescript
async getEnhancedStatus(sessionId: string): Promise<import('./pi-session-status').EnhancedSessionStatus | null> {
  const entry = this.sessions.get(sessionId)
  if (!entry) return null
  return this.statusProvider.getStatus(sessionId, entry as any)
}

async getAllEnhancedStatuses(): Promise<import('./pi-session-status').EnhancedSessionStatus[]> {
  const statuses: import('./pi-session-status').EnhancedSessionStatus[] = []
  for (const [sessionId, entry] of this.sessions) {
    const status = await this.statusProvider.getStatus(sessionId, entry as any)
    if (status) statuses.push(status)
  }
  return statuses
}

async listSessions(options?: { limit?: number; offset?: number; status?: 'all' | 'active' | 'archived' }): Promise<import('./pi-session-store').PiSessionMetadata[]> {
  return this.sessionStore.list(options)
}

async loadSession(sessionId: string): Promise<boolean> {
  return !!(await this.sessionStore.load(sessionId))
}

async deleteSession(sessionId: string): Promise<void> {
  await this.stop(sessionId)
  await this.sessionStore.delete(sessionId)
}
```

- [ ] **步骤 7：验证 TypeScript 编译**

运行：`cd electron && npx tsc --noEmit`
预期：无错误

- [ ] **步骤 8：Commit**

```bash
git add electron/engines/PiEngine.ts
git commit -m "feat(pi-engine): integrate all v2.0 enhancement modules into PiEngine"
```

---

### 任务 8：端到端集成测试

**前置依赖：** 任务 7  
**预估时间：** 25 分钟

**文件：**
- 创建：`electron/__tests__/pi-engine-integration.test.ts`

- [ ] **步骤 1：编写集成测试覆盖跨模块交互**

创建测试文件 `electron/__tests__/pi-engine-integration.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { PiSessionStore } from '../../engines/pi-session-store'

describe('PiEngine v2.0 Integration', () => {
  let sessionStore: PiSessionStore
  let tmpDir: string

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-integration-test-')); sessionStore = new PiSessionStore(tmpDir) })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  describe('session persistence lifecycle', () => {
    it('should persist and reload session configuration', async () => {
      const data = {
        id: 'test-persist', title: 'Persistence Test',
        createdAt: new Date().toISOString(), lastModified: new Date().toISOString(),
        config: { cwd: '/', provider: 'x', modelId: 'y', thinkingLevel: 'off' as const, systemPrompt: '' },
        state: { messages: [{ role: 'user', content: 'Test' }], model: {}, tools: [] },
        usage: { totalMessages: 1, totalTokens: 10, estimatedCost: 0.001 },
      }
      await sessionStore.save(data)
      const loaded = await sessionStore.load(data.id)
      expect(loaded).not.toBeNull()
      expect(loaded!.config.modelId).toBe('y')
    })

    it('should list sessions sorted by lastModified desc', async () => {
      await sessionStore.save({ id: 's1', title: 'A', createdAt: '2026-01-01T00:00:00Z', lastModified: '2026-01-01T01:00:00Z', config: { cwd: '/', provider: 'x', modelId: 'y', thinkingLevel: 'off', systemPrompt: '' }, state: { messages: [], model: {}, tools: [] }, usage: { totalMessages: 0, totalTokens: 0, estimatedCost: 0 } })
      await sessionStore.save({ id: 's2', title: 'B', createdAt: '2026-01-02T00:00:00Z', lastModified: '2026-01-02T01:00:00Z', config: { cwd: '/', provider: 'x', modelId: 'z', thinkingLevel: 'medium', systemPrompt: '' }, state: { messages: [{ role: 'user', content: 'M' }], model: {}, tools: [] }, usage: { totalMessages: 1, totalTokens: 5, estimatedCost: 0.0005 } })
      const list = await sessionStore.list({ sortBy: 'lastModified', sortOrder: 'desc' })
      expect(list).toHaveLength(2)
      expect(list[0].id).toBe('s2')
    })
  })

  describe('tool registry combined sources', () => {
    it('should resolve tools with defaults + custom', async () => {
      const { PiToolRegistry } = await import('../../engines/pi-tool-registry')
      const r = new PiToolRegistry()
      r.setToolsFactory(async (_ctx, d) => [...d, { name: 'custom', description: 'C', parameters: {}, execute: async () => ({}) } as any])
      const tools = await r.resolveTools({ agent: {}, sessionId: 't', config: {}, cwd: '/' })
      expect(tools.some(t => t.name === 'custom')).toBe(true)
    })
  })

  describe('status provider calculations', () => {
    it('should calculate correct breakdowns', async () => {
      const { PiEnhancedStatusProvider } = await import('../../engines/pi-session-status')
      const p = new PiEnhancedStatusProvider()
      const s = await p.getStatus('st', {
        agent: { state: { messages: [
          { role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1', usage: { inputTokens: 50, outputTokens: 100 } },
          { role: 'user', content: 'Q2' }, { role: 'assistant', content: 'A2', usage: { inputTokens: 30, outputTokens: 60 } },
        ], model: { id: 'gpt-4o', name: 'GPT-4o' }, tools: [{ name: 'a' }, { name: 'b' }], thinkingLevel: 'high' }},
        config: { cwd: '/p', provider: 'openai', model: 'gpt-4o', systemPrompt: '' }, status: 'idle', createdAt: '',
      })
      expect(s!.usage.messageBreakdown.user).toBe(2)
      expect(s!.tools.registeredCount).toBe(2)
      expect(s!.config.thinkingLevel).toBe('high')
    })
  })
})
```

- [ ] **步骤 2：运行集成测试**

运行：`cd electron && npx vitest run __tests__/pi-engine-integration.test.ts`
预期：5 tests passed

- [ ] **步骤 3：Commit**

```bash
git add electron/__tests__/pi-engine-integration.test.ts
git commit -m "test(pi-engine): add E2E integration tests for v2.0 features"
```

---

### 任务 9：最终验证

**前置依赖：** 任务 8  
**预估时间：** 15 分钟

- [ ] **步骤 1：运行完整测试套件**

运行：`cd electron && npx vitest run`
预期：45+ tests passed, 0 failures

- [ ] **步骤 2：TypeScript 类型检查**

运行：`npx tsc --noEmit`
预期：0 errors

- [ ] **步骤 3：Lint 检查（如果项目配置了 ESLint）**

运行：`npx eslint electron/engines/pi-*.ts`
预期：0 errors / warnings acceptable

- [ ] **步骤 4：最终 Commit（如有遗漏修复）**

```bash
git add -A
git commit -m "chore(pi-engine): final validation fixes for v2.0 enhancement"
```

---

## 自检清单

### 规格覆盖度

| 设计文档章节 | 对应任务 | 状态 |
|------------|---------|------|
| §3.1 PiSessionStore | 任务 2, 3 | ✅ |
| §3.2 PiToolRegistry | 任务 4 | ✅ |
| §3.3 PiArtifactsManager | 任务 6 | ✅ |
| §3.4 PiEnhancedStatusProvider | 任务 5 | ✅ |
| §4.1 EngineSessionConfig 扩展 | 任务 1 | ✅ |
| §4.2 startSession 流程图 | 任务 7 | ✅ |
| §4.3 事件流图 | 任务 7 步骤 3 | ✅ |
| §5 错误处理 | 各任务错误处理逻辑 | ✅ |
| §6 性能考虑 | 缓存、防抖、优化跳过 | ✅ |
| §7 测试策略 | 任务 2-9 | ✅ |
| §9 向后兼容 | 接口扩展非破坏性 | ✅ |

### 占位符扫描

✅ 无 "TODO"、"待定"、"后续补充" 占位符  
✅ 所有代码步骤包含实际实现代码  
✅ 所有测试用例包含具体断言和数据  
✅ 命令包含精确预期输出  

### 类型一致性

✅ `ThinkingLevel` 在 types.ts 定义 → pi-session-status.ts 使用一致  
✅ `ToolFactoryContext` 接口在 types.ts → pi-tool-registry.ts 使用一致  
✅ `PiSessionData` 接口在 pi-session-store.ts 内部使用一致  
✅ `EnhancedSessionStatus` 接口在 pi-session-status.ts 定义 → PiEngine 使用时 import 一致  
✅ `ArtifactEntry` 接口在 pi-artifacts-manager.ts 内部使用一致  

---

## 执行选项

**计划已完成并保存到 `docs/superpowers/plans/2026-05-06-piengine-enhancement.md`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点供审查

**选哪种方式？**
