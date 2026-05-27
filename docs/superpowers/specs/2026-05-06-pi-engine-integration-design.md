# Pi Coding Agent 引擎集成设计文档

> 日期: 2026-05-06
> 状态: 待审查
> 范围: 为 SpaceCode 桌面应用新增 pi-coding-agent 作为可选引擎

## 1. 背景与目标

SpaceCode 当前仅支持 claude-code 作为底层 agent 引擎，通过子进程 spawn + stdin/stdout stream-json 协议通信。用户希望新增 pi-coding-agent 作为可选引擎，并在设置中可切换。

**目标**:
- 新增 pi 引擎，与现有 claude-code 引擎并存
- 设置页面可切换引擎
- 不影响现有 claude-code 引擎的任何功能
- pi 引擎采用 SDK 直接集成方式（参考 pi Web UI 模式）

## 2. 方案选型

### 2.1 为什么选择 SDK 直接集成而非 RPC 子进程

| 维度 | RPC 子进程 | SDK 直接集成 |
|------|-----------|-------------|
| 事件映射 | 需将 pi AgentEvent 映射为 claude-code stream-json 格式 | 直接处理 AgentEvent，类型安全 |
| 进程管理 | 需管理子进程生命周期 | 无子进程，更简单 |
| API 丰富度 | 仅限 RPC 协议定义的命令 | 完整 API：model 切换、thinking level、compaction 等 |
| 调试体验 | 跨进程调试 | 单进程，断点直接命中 |
| 类型安全 | JSONL 文本协议 | TypeScript 原生类型 |
| 依赖风险 | 无 | 需处理依赖版本差异（可控） |

pi 的 Web UI（`ChatPanel.ts`）直接使用 `Agent` 对象，通过 `agent.subscribe()` 订阅事件，通过 `session.prompt()` 发送消息。Electron 主进程同样是 Node.js 环境，完全可以采用相同方式。

### 2.2 依赖冲突分析与解决

| 包名 | SpaceCode 现有 | pi 需要 | 处理方式 |
|------|---------------|--------|---------|
| `@anthropic-ai/sdk` | ^0.27.0 | ^0.91.1 | 升级到 ^0.91.1（向后兼容） |
| `openai` | ^4.28.0 | 6.26.0 | 升级到 6.x（主进程使用，风险可控） |
| `diff` | ^5.2.0 | ^8.0.2 | 升级到 ^8.0.2 |
| `marked` | ^12.0.0 | ^15.0.12 | 升级到 ^15.0.12 |
| `undici` | 无 | ^7.19.1 | 新增 |
| `typebox` | 无 | ^1.1.24 | 新增（pi 核心依赖） |

**关键策略**: pi 的 `@mariozechner/pi-ai` 统一封装了所有 provider SDK，SpaceCode 后续可考虑移除直接依赖的 `@anthropic-ai/sdk` 和 `openai`，转而使用 pi 的统一 API，减少重复依赖。

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main Process                     │
│                                                              │
│  ┌──────────────────┐     ┌────────────────────────────┐   │
│  │  ClaudeCodeEngine │     │  PiEngine                  │   │
│  │  (现有子进程模式)  │     │  (SDK 直接集成)             │   │
│  │                   │     │                             │   │
│  │  - spawn 子进程    │     │  - createAgentSession()     │   │
│  │  - stream-json    │     │  - session.prompt()         │   │
│  │  - stdin/stdout   │     │  - session.subscribe()      │   │
│  └────────┬──────────┘     └──────────┬─────────────────┘   │
│           │                            │                      │
│  ┌────────▼────────────────────────────▼──────────────────┐  │
│  │              IEngine (统一接口)                          │  │
│  │  startSession(sessionId, config)                        │  │
│  │  sendMessage(sessionId, content)                        │  │
│  │  abort(sessionId)                                      │  │
│  │  stop(sessionId)                                       │  │
│  │  onEvent(callback) → UnifiedEngineEvent                │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │ IPC                               │
└───────────────────────────┼──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│                    Renderer Process                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Chat Store                                            │  │
│  │  - 根据 settingsStore.engineType 选择引擎               │  │
│  │  - 统一处理 UnifiedEngineEvent                         │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Settings Store                                        │  │
│  │  - engineType: 'claude-code' | 'pi'                    │  │
│  │  - pi 引擎独立配置 (provider, model, apiKey)            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 IEngine 统一接口

```typescript
// electron/engines/types.ts

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
}

export interface UnifiedEngineEvent {
  sessionId: string
  type:
    | 'assistant'       // 助手消息（含文本/思考/工具调用）
    | 'tool_use'        // 工具调用开始
    | 'tool_result'     // 工具调用结果
    | 'stream_event'    // 流式事件（增量文本/思考）
    | 'result'          // 对话轮次结束
    | 'system'          // 系统消息
    | 'error'           // 错误
    | 'exit'            // 进程/会话退出
  data: any
}

export interface IEngine {
  readonly type: EngineType

  startSession(sessionId: string, config: EngineSessionConfig): Promise<void>
  sendMessage(sessionId: string, content: string): Promise<void>
  abort(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  getSessionStatus(sessionId: string): EngineSessionStatus | null
  getActiveSessions(): EngineSessionStatus[]
  listAgents?(cwd?: string): Promise<AgentInfo[]>

  setMainWindow(window: BrowserWindow): void
}

export interface EngineSessionStatus {
  sessionId: string
  engineSessionId: string | null
  status: 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
  isRunning: boolean
}
```

### 3.3 PiEngine 实现

```typescript
// electron/engines/PiEngine.ts

import { createAgentSession, type AgentSession, type AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AgentEvent, AgentMessage, ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Model } from '@mariozechner/pi-ai'

export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'

  private sessions: Map<string, PiSession> = new Map()
  private mainWindow: BrowserWindow | null = null
  private eventListeners: Array<(event: UnifiedEngineEvent) => void> = []

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    // 1. 将 EngineSessionConfig 转换为 pi 的 CreateAgentSessionOptions
    const piConfig = this.mapConfig(config)

    // 2. 调用 pi SDK 创建 AgentSession
    const { session, extensionsResult } = await createAgentSession(piConfig)

    // 3. 订阅事件并转换为 UnifiedEngineEvent
    //    AgentSessionEvent = AgentEvent | 额外会话事件 (queue_update, compaction_*, etc.)
    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      const unifiedEvent = this.mapEvent(sessionId, event)
      if (unifiedEvent) {
        this.emitEvent(unifiedEvent)
      }
    })

    // 4. 保存会话
    this.sessions.set(sessionId, { session, unsubscribe, config })
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const piSession = this.sessions.get(sessionId)
    if (!piSession) throw new Error(`Session ${sessionId} not found`)
    await piSession.session.prompt(content)
  }

  async abort(sessionId: string): Promise<void> {
    const piSession = this.sessions.get(sessionId)
    if (!piSession) return
    await piSession.session.abort()
  }

  // ... 其他方法
}
```

### 3.4 事件映射（核心）

pi 的 `AgentEvent` 与 claude-code 的 stream-json 格式不同，需要映射为 `UnifiedEngineEvent`。

**pi AgentEvent 完整类型定义**（来自 `@mariozechner/pi-agent-core`）：

```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
```

**pi AgentSessionEvent 额外事件**（来自 `@mariozechner/pi-coding-agent`）：

```typescript
type AgentSessionEvent =
  | AgentEvent
  | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] }
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | { type: "compaction_end"; reason: "manual" | "threshold" | "overflow"; result: CompactionResult | undefined; aborted: boolean; willRetry: boolean; errorMessage?: string }
  | { type: "session_info_changed"; name: string | undefined }
  | { type: "thinking_level_changed"; level: ThinkingLevel }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
```

**事件映射表**：

| pi AgentEvent | UnifiedEngineEvent | 说明 |
|---------------|-------------------|------|
| `agent_start` | `system` | agent 开始运行 |
| `agent_end` | `result` | agent 运行结束，含最终 messages |
| `turn_start` | (内部) | 新轮次开始 |
| `turn_end` | (内部) | 轮次结束，含最终 assistant message 和 tool results |
| `message_start` (assistant) | `assistant` | 助手消息开始 |
| `message_update` (assistant) | `stream_event` | 流式增量（`assistantMessageEvent` 含 text_delta/thinking_delta） |
| `message_end` (assistant) | `assistant` | 助手消息完成 |
| `tool_execution_start` | `tool_use` | 工具调用开始，含 toolCallId/toolName/args |
| `tool_execution_update` | `stream_event` | 工具执行进度，含 partialResult |
| `tool_execution_end` | `tool_result` | 工具调用完成，含 result/isError |
| `compaction_start` | `system` | 上下文压缩开始 |
| `compaction_end` | `system` | 上下文压缩完成 |
| `thinking_level_changed` | `system` | 思考级别变更 |
| `auto_retry_start` | `system` | 自动重试开始 |
| `auto_retry_end` | `system` | 自动重试结束 |

**映射实现要点**:
- pi 的 `message_update` 事件中 `assistantMessageEvent` 字段包含增量数据（`text_delta`、`thinking_delta`），需映射为 `stream_event` 的 `content_block_delta`
- pi 的 `tool_execution_start` 包含 `toolCallId`、`toolName`、`args`，需映射为 `tool_use` 的 `id`、`name`、`input`
- pi 的 `tool_execution_end` 包含 `result`、`isError`，需映射为 `tool_result`
- pi 的 `agent_end` 包含最终 `messages`，需映射为 `result` 表示对话结束

## 4. 文件结构

新增/修改的文件：

```
electron/
├── engines/                          # 新增：引擎抽象层
│   ├── types.ts                      # IEngine 接口、UnifiedEngineEvent、EngineType
│   ├── EngineFactory.ts              # 引擎工厂，根据 engineType 创建实例
│   ├── ClaudeCodeEngine.ts           # 现有 claude-code 引擎的 IEngine 适配器
│   └── PiEngine.ts                   # pi 引擎实现（SDK 直接集成）
├── claudeCodeIPC.ts                  # 修改：使用 IEngine 接口
├── claudeCodeProcessManager.ts       # 保留：ClaudeCodeEngine 内部使用
├── claudeCodeProcessPool.ts          # 保留：ClaudeCodeEngine 内部使用
├── sessionProcess.ts                 # 保留：ClaudeCodeEngine 内部使用
└── preload.ts                        # 修改：新增 pi 引擎相关 IPC

src/
├── stores/
│   ├── settings.ts                   # 修改：新增 engineType、piConfig
│   └── chat.ts                       # 修改：根据 engineType 选择引擎
├── components/
│   └── settings/
│       └── GeneralSettings.vue       # 修改：新增引擎选择 UI
└── types/
    └── index.ts                      # 修改：新增 EngineType 类型

pi-engine/                            # 已克隆的 pi-mono 源码
```

## 5. 详细设计

### 5.1 Settings Store 扩展

```typescript
// 新增类型
export type EngineType = 'claude-code' | 'pi'

export interface PiEngineConfig {
  provider: string       // 'anthropic' | 'openai' | 'google' | 'openrouter' | ...
  model: string          // e.g. 'claude-sonnet-4-5'
  apiKey: string
  baseUrl: string
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
}

// AuthSettings 扩展
export interface AuthSettings {
  // ... 现有字段保持不变
  engineType: EngineType          // 新增，默认 'claude-code'
  piConfig: PiEngineConfig        // 新增
}
```

### 5.2 PiEngine 核心实现

PiEngine 不使用子进程，直接在 Electron 主进程中运行 pi SDK：

**pi CreateAgentSessionOptions 完整字段**（来自 `@mariozechner/pi-coding-agent`）：

```typescript
interface CreateAgentSessionOptions {
  cwd?: string                          // 工作目录，默认 process.cwd()
  agentDir?: string                     // 全局配置目录，默认 ~/.pi/agent
  authStorage?: AuthStorage             // 认证存储，默认 AuthStorage.create(agentDir/auth.json)
  modelRegistry?: ModelRegistry         // 模型注册表，默认 ModelRegistry.create(authStorage, agentDir/models.json)
  model?: Model<any>                    // 使用的模型，默认从 settings 或第一个可用模型
  thinkingLevel?: ThinkingLevel         // 思考级别，默认 'medium'
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>  // 可切换模型列表
  noTools?: "all" | "builtin"           // 工具抑制模式
  tools?: string[]                      // 工具白名单
  customTools?: ToolDefinition[]        // 自定义工具
  resourceLoader?: ResourceLoader       // 资源加载器
  sessionManager?: SessionManager       // 会话管理器
  settingsManager?: SettingsManager     // 设置管理器
  sessionStartEvent?: SessionStartEvent // 会话启动事件元数据
}
```

**PiEngine 使用策略**：
- `cwd`：从 SpaceCode 的 Session.workingDirectory 传入
- `authStorage`：使用 SpaceCode 设置页面管理的 API 密钥构建
- `model`：根据用户在设置页面选择的 provider/model 解析
- `thinkingLevel`：从 SpaceCode 设置传入
- `noTools` / `tools`：不设置，使用 pi 默认工具集（read, bash, edit, write）
- 其他字段使用 pi 默认值

```typescript
export class PiEngine implements IEngine {
  private sessions: Map<string, {
    session: AgentSession
    unsubscribe: () => void
    config: EngineSessionConfig
  }> = new Map()

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    const { session, extensionsResult } = await createAgentSession({
      cwd: config.cwd,
      model: await this.resolveModel(config),
      thinkingLevel: this.mapThinkingLevel(config.thinkingEnabled),
      // 不启用 TUI 相关工具
      noTools: undefined,
      tools: undefined,
    })

    const unsubscribe = session.subscribe((event: AgentEvent) => {
      this.handlePiEvent(sessionId, event, session)
    })

    this.sessions.set(sessionId, { session, unsubscribe, config })
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)
    await entry.session.prompt(content)
  }

  async abort(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    await entry.session.abort()
  }

  async stop(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.unsubscribe()
    // AgentSession 的 dispose 由 pi 内部处理
    this.sessions.delete(sessionId)
  }
}
```

### 5.3 事件映射实现

```typescript
private handlePiEvent(sessionId: string, event: AgentEvent, session: AgentSession): void {
  switch (event.type) {
    case 'message_start': {
      // 助手消息开始 → 发送 assistant 事件
      this.emitEvent({
        sessionId,
        type: 'assistant',
        data: this.mapAssistantMessage(event.message)
      })
      break
    }
    case 'message_update': {
      // 流式增量 → 发送 stream_event
      const delta = event.assistantMessageEvent
      if (delta?.type === 'content_block_delta') {
        this.emitEvent({
          sessionId,
          type: 'stream_event',
          data: { event: delta }
        })
      }
      break
    }
    case 'message_end': {
      // 消息完成 → 发送最终 assistant 事件
      this.emitEvent({
        sessionId,
        type: 'assistant',
        data: this.mapAssistantMessage(event.message)
      })
      break
    }
    case 'tool_execution_start': {
      // 工具调用开始 → 发送 tool_use 事件
      this.emitEvent({
        sessionId,
        type: 'tool_use',
        data: {
          id: event.toolCallId,
          name: event.toolName,
          input: event.args
        }
      })
      break
    }
    case 'tool_execution_end': {
      // 工具调用完成 → 发送 tool_result 事件
      this.emitEvent({
        sessionId,
        type: 'tool_result',
        data: {
          tool_use_id: event.toolCallId,
          output: this.formatToolResult(event.result),
          is_error: event.isError
        }
      })
      break
    }
    case 'agent_end': {
      // agent 运行结束 → 发送 result 事件
      this.emitEvent({
        sessionId,
        type: 'result',
        data: {
          result: this.extractFinalText(event.messages),
          stop_reason: 'end_turn'
        }
      })
      break
    }
  }
}
```

### 5.4 ClaudeCodeEngine 适配器

将现有 claude-code 引擎包装为 IEngine 接口，内部仍使用子进程模式：

```typescript
export class ClaudeCodeEngine implements IEngine {
  readonly type: EngineType = 'claude-code'
  private pool: ClaudeCodeProcessPool

  // 所有方法委托给现有的 ClaudeCodeProcessPool
  // 事件通过 pool 的 routeEvent 转换为 UnifiedEngineEvent
}
```

### 5.5 EngineFactory

```typescript
export class EngineFactory {
  private static engines: Map<EngineType, IEngine> = new Map()

  static getEngine(type: EngineType): IEngine {
    if (!this.engines.has(type)) {
      switch (type) {
        case 'claude-code':
          this.engines.set(type, new ClaudeCodeEngine())
          break
        case 'pi':
          this.engines.set(type, new PiEngine())
          break
      }
    }
    return this.engines.get(type)!
  }
}
```

### 5.6 IPC 层修改

现有的 `claudeCodeIPC.ts` 中的 IPC 通道保持不变，内部委托给 IEngine：

```typescript
// 修改前
ipcMain.handle('claude-code:startSession', async (_, sessionId, config) => {
  await pool.startSession(sessionId, config)
})

// 修改后
ipcMain.handle('claude-code:startSession', async (_, sessionId, config) => {
  const engineType = config.engineType || 'claude-code'
  const engine = EngineFactory.getEngine(engineType)
  await engine.startSession(sessionId, config)
})
```

### 5.7 前端设置页面

在 GeneralSettings.vue 中新增引擎选择区域：

```
┌──────────────────────────────────────────────────┐
│  引擎选择                                         │
│                                                   │
│  ┌──────────────────┐  ┌──────────────────┐      │
│  │  Claude Code     │  │  Pi Agent        │      │
│  │  (子进程模式)     │  │  (SDK 集成)      │      │
│  │  ✓ 已选中        │  │                  │      │
│  └──────────────────┘  └──────────────────┘      │
│                                                   │
│  ─── Pi 引擎配置 ───                              │
│  Provider:  [Anthropic ▼]                         │
│  API Key:   [••••••••••••]                        │
│  Base URL:  [https://api.anthropic.com]           │
│  Model:     [claude-sonnet-4-5 ▼]                 │
│  Thinking:  [medium ▼]                            │
└──────────────────────────────────────────────────┘
```

### 5.8 Chat Store 修改

```typescript
// initClaudeCodeSession 中根据 engineType 选择配置
async function initClaudeCodeSession(sessionId: string): Promise<void> {
  const engineType = settingsStore.engineType  // 新增字段
  const config = engineType === 'pi'
    ? settingsStore.piConfig   // 新增：pi 引擎配置
    : settingsStore.config     // 现有：claude-code 配置

  await claudeCode.startSession(sessionId, {
    ...config,
    engineType,  // 传递引擎类型
  })
}
```

## 6. Pi 引擎配置管理

### 6.1 Pi 的认证模型

pi 使用 `~/.pi/agent/auth.json` 存储 API 密钥，使用 `~/.pi/agent/models.json` 存储模型配置。SpaceCode 需要桥接两种配置方式：

**方案**: SpaceCode 的设置页面管理 pi 的 API 密钥和模型选择，在创建 AgentSession 时通过 `CreateAgentSessionOptions` 传入，不依赖 pi 的文件配置。

```typescript
// PiEngine 中的模型解析
private async resolveModel(config: EngineSessionConfig): Promise<Model<any> | undefined> {
  // 使用 pi 的 ModelRegistry 发现可用模型
  const authStorage = AuthStorage.create()
  const modelRegistry = ModelRegistry.create(authStorage)

  // 设置用户配置的 API 密钥
  if (config.apiKey) {
    await authStorage.setApiKey(config.provider, config.apiKey)
  }

  const models = await modelRegistry.getAvailable()
  if (config.model) {
    return models.find(m => m.id === config.model || m.id.includes(config.model!))
  }
  return models[0]  // 默认第一个可用模型
}
```

### 6.2 Pi 的多 Provider 支持

pi 的 `@mariozechner/pi-ai` 原生支持多 provider：
- Anthropic (直接 API)
- OpenAI (直接 API)
- Google Gemini (直接 API)
- OpenRouter (代理)
- AWS Bedrock
- Azure OpenAI
- Mistral
- 自定义 OpenAI 兼容端点

SpaceCode 的设置页面需要新增 pi provider 选择，与现有 claude-code 的 provider 选择独立。

## 7. 构建与打包

### 7.1 Pi 依赖安装

```json
// package.json 新增依赖
{
  "dependencies": {
    "@mariozechner/pi-coding-agent": "^0.73.0",
    "@mariozechner/pi-agent-core": "^0.73.0",
    "@mariozechner/pi-ai": "^0.73.0"
  }
}
```

### 7.2 Pi 源码构建

pi-engine 目录已克隆源码，需要先构建：

```bash
cd pi-engine
npm install
npm run build
```

然后在 SpaceCode 的 package.json 中使用 workspace 引用：

```json
{
  "dependencies": {
    "@mariozechner/pi-coding-agent": "file:./pi-engine/packages/coding-agent",
    "@mariozechner/pi-agent-core": "file:./pi-engine/packages/agent",
    "@mariozechner/pi-ai": "file:./pi-engine/packages/ai"
  }
}
```

### 7.3 Electron 打包

pi 的依赖需要包含在 asar 中。由于 pi 使用了 native 模块（如 `@silvia-odwyer/photon-node` 的 wasm），需要在 electron-builder 中配置：

```json
{
  "build": {
    "asarUnpack": [
      "node_modules/@silvia-odwyer/photon-node/**/*.wasm"
    ]
  }
}
```

## 8. 风险评估

### 8.1 依赖版本冲突

**风险**: pi 依赖的 `@anthropic-ai/sdk` ^0.91.1 和 `openai` 6.x 与 SpaceCode 现有版本差异大
**缓解**: 这些包仅在 Electron 主进程使用，升级风险可控。可逐步验证功能是否正常。

### 8.2 Pi SDK 初始化失败

**风险**: pi 的 `createAgentSession` 需要 auth 配置，如果用户未配置 API 密钥会失败
**缓解**: PiEngine 在 startSession 时检查配置，给出友好错误提示。

### 8.3 Pi 进程内运行影响主进程

**风险**: pi SDK 在 Electron 主进程中运行，如果 pi 内部出错可能影响整个应用
**缓解**:
- PiEngine 中所有 pi SDK 调用都包裹在 try-catch 中
- 考虑后续将 pi 运行在 UtilityProcess（Electron 的轻量级子进程）中隔离

### 8.4 Pi 版本更新

**风险**: pi 快速迭代，API 可能变更
**缓解**: 锁定 pi 版本，升级时充分测试

## 9. 实施计划

### 阶段 1: 基础架构（1-2 天）
1. 创建 `electron/engines/` 目录，定义 IEngine 接口和 UnifiedEngineEvent
2. 实现 ClaudeCodeEngine 适配器（包装现有代码）
3. 实现 EngineFactory
4. 修改 claudeCodeIPC.ts 使用 IEngine

### 阶段 2: Pi 引擎核心（2-3 天）
1. 安装 pi 依赖，确保构建通过
2. 实现 PiEngine.startSession（createAgentSession 集成）
3. 实现事件映射（AgentEvent → UnifiedEngineEvent）
4. 实现 PiEngine.sendMessage / abort / stop

### 阶段 3: 前端集成（1-2 天）
1. Settings Store 扩展（engineType、piConfig）
2. 设置页面新增引擎选择和 pi 配置 UI
3. Chat Store 修改，根据 engineType 选择引擎
4. preload.ts 新增 pi 相关 IPC

### 阶段 4: 测试与优化（1-2 天）
1. 端到端测试：pi 引擎完整对话流程
2. 引擎切换测试：确保切换不影响现有会话
3. 错误处理：pi 配置缺失、API 密钥无效等场景
4. 性能测试：pi SDK 在 Electron 主进程中的内存占用

## 10. 未来优化

- **UtilityProcess 隔离**: 将 pi SDK 运行在 Electron UtilityProcess 中，实现进程级隔离
- **统一 Provider 管理**: 使用 pi 的 `@mariozechner/pi-ai` 替代 SpaceCode 直接依赖的 provider SDK
- **Pi 扩展系统**: 支持 pi 的 extension 机制，允许用户自定义工具
- **Pi Web UI 组件**: 考虑将 pi 的 `@mariozechner/pi-web-ui` 组件集成到 Vue 前端
