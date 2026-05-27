# Pi Engine 重构设计规格文档

**日期**: 2026-05-06  
**状态**: 待审查  
**版本**: 1.0  
**作者**: AI Assistant  

---

## 1. 执行摘要

### 1.1 目标

重构 SpaceCode Electron 应用中的 **PiEngine**，从当前的 **SDK 内联模式** 迁移到 **rpc-node 子进程模式**，以集成 pi coding agent 的完整能力，实现与 ClaudeCodeEngine 架构对齐的、功能完整的 coding agent 引擎。

### 1.2 范围

- ✅ 完全重写 PiEngine，采用 rpc-node 子进程模式
- ✅ 实现完整的 IEngine 接口（startSession, sendMessage, abort, stop, suspend, resume）
- ✅ 支持核心对话能力（prompt, stream events, tool calls）
- ✅ 支持会话管理（new_session, switch_session, fork, clone）
- ✅ 支持高级 Agent 能力（compaction, model cycling, thinking level control）
- ✅ 支持完整 RPC 协议（30+ 命令类型）
- ✅ 完全独立于 ClaudeCodeEngine，拥有自己的进程池
- ✅ 不影响默认引擎的正常功能

### 1.3 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 实现方案 | 方案 A: 复用官方 RpcClient | 成熟稳定、代码量少、自动同步更新 |
| 引擎隔离 | 完全独立 | 最安全，两个引擎互不干扰 |
| 功能范围 | 全功能 | 获得完整 agent 能力 |

---

## 2. 现状分析

### 2.1 当前架构问题

**PiEngine (当前实现)**:
```typescript
// electron/engines/PiEngine.ts (当前)
import { Agent } from '@mariozechner/pi-agent'
import { codingTools } from '@mariozechner/pi-coding-agent/dist/tools/index.js'

export class PiEngine implements IEngine {
  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    // 直接在主进程中创建 Agent 实例
    const agent = new Agent({
      transport,
      tools: codingTools,
      initialState: { systemPrompt, model, thinkingLevel },
    })
    
    // 订阅事件
    const unsubscribe = agent.subscribe((event) => this.handlePiEvent(sessionId, event))
  }
}
```

**问题清单**:
1. ❌ **功能受限**: 只实现了基本的 startSession/sendMessage/abort，缺少会话管理、compaction、extensions 等
2. ❌ **架构不一致**: 使用 SDK 内联模式，而 ClaudeCodeEngine 使用子进程池模式
3. ❌ **稳定性风险**: Agent 运行在主进程中，崩溃可能影响整个应用
4. ❌ **无法利用完整生态**: pi coding agent 的 RPC 模式提供 30+ 命令，当前只用了 3-4 个
5. ❌ **扩展性差**: 难以支持多会话、session 切换等高级工作流

### 2.2 目标架构优势

**重构后的 PiEngine**:
```
PiEngine → PiProcessPool → PiSessionProcess x N → RpcClient → RPC 子进程
```

**优势列表**:
1. ✅ **功能完整**: 支持 pi coding agent 的所有能力
2. ✅ **架构一致**: 与 ClaudeCodeEngine 采用相同的子进程池模式
3. ✅ **稳定性高**: 子进程隔离，崩溃不影响主进程
4. ✅ **可扩展**: 支持多会话、挂起/恢复、驱逐策略
5. ✅ **生态对齐**: 使用官方推荐的 RPC 模式

---

## 3. 架构设计

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────────────────────────┐       │
│  │ claudeCodeIPC │    │        EngineFactory             │       │
│  │   (IPC 层)    │───▶│  ┌────────────────┐            │       │
│  └──────────────┘    │  │ ClaudeCodeEngine │            │       │
│                      │  └────────────────┘            │       │
│                      │                                  │       │
│                      │  ┌────────────────┐            │       │
│                      │  │  PiEngine (新)  │ ◀── 重构目标 │       │
│                      │  └───────┬────────┘            │       │
│                      └──────────┼─────────────────────┘       │
│                                 │                              │
│                                 ▼                              │
│                      ┌─────────────────────┐                  │
│                      │  PiProcessPool (新增)│                  │
│                      │  - 会话生命周期管理    │                  │
│                      │  - 进程池 & 驱逐策略   │                  │
│                      │  - 事件路由到 Renderer│                  │
│                      └──────────┬──────────┘                  │
│                                 │                              │
│                    ┌────────────┼────────────┐                │
│                    ▼            ▼            ▼                │
│           ┌────────────┐ ┌──────────┐ ┌──────────┐           │
│           │ PiSession  │ │ PiSession │ │ PiSession │           │
│           │ Process 1  │ │ Process 2 │ │ Process N │           │
│           └─────┬──────┘ └─────┬────┘ └─────┬────┘           │
│                 │               │            │                │
│                 ▼               ▼            ▼                │
│           ┌──────────┐   ┌──────────┐  ┌──────────┐         │
│           │ RpcClient │   │ RpcClient │  │ RpcClient │         │
│           │(官方库)   │   │(官方库)   │  │(官方库)   │         │
│           └─────┬────┘   └─────┬────┘  └─────┬────┘         │
│                 │               │            │                │
│                 ▼               ▼            ▼                │
│     ┌──────────────────────────────────────────────┐        │
│     │      pi-coding-agent RPC 子进程 x N           │        │
│     │  (node dist/cli.js --mode rpc)                 │        │
│     └──────────────────────────────────────────────┘        │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                        Electron Renderer Process               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              chat.ts (Vue Store)                        │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 模块划分

#### 新增文件结构:

```
electron/engines/
├── PiEngine.ts              # [重写] 主引擎类，实现 IEngine 接口
├── PiEventMapper.ts         # [保留] 事件映射器（可能需要小幅更新）
├── PiProcessPool.ts         # [新增] 进程池管理器
├── PiSessionProcess.ts      # [新增] 会话进程封装（封装 RpcClient）
└── types.ts                 # [保留] 统一类型定义（无需修改）
```

#### 各模块职责:

| 模块 | 文件 | 职责 | 行数估算 |
|------|------|------|----------|
| **PiEngine** | PiEngine.ts | 实现 IEngine 接口，作为 EngineFactory 入口点 | ~150 行 |
| **PiProcessPool** | PiProcessPool.ts | 管理多个会话进程，实现驱逐策略和事件路由 | ~300 行 |
| **PiSessionProcess** | PiSessionProcess.ts | 封装单个 RpcClient，管理单个会话状态 | ~350 行 |
| **PiEventMapper** | PiEventMapper.ts | 将 AgentEvent 转换为 UnifiedEngineEvent | ~250 行（已有） |

**总新增/修改代码量**: ~800 行（其中 250 行为现有代码）

---

## 4. 详细设计

### 4.1 PiSessionProcess 类

**文件**: `electron/engines/PiSessionProcess.ts`  
**职责**: 封装单个 RPC 会话进程，管理其完整生命周期

#### 核心属性:

```typescript
class PiSessionProcess extends EventEmitter {
  readonly sessionId: string
  rpcClient: RpcClient | null = null
  status: ProcessStatus  // 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
  config: EngineSessionConfig
  
  // 状态追踪
  private _pendingToolCalls: Set<string> = new Set()
  private _isProcessing: boolean = false
  lastActivityAt: number = Date.now()
  
  // 事件订阅引用（用于清理）
  private _unsubscribeEvent?: () => void
}
```

#### 核心方法:

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `start()` | - | `Promise<void>` | 启动 RPC 子进程 |
| `sendMessage(content)` | `string` | `Promise<void>` | 发送 prompt 命令 |
| `abort()` | - | `Promise<void>` | 中断当前操作 |
| `suspend()` | - | `Promise<void>` | 安全挂起会话 |
| `resume()` | - | `Promise<void>` | 恢复挂起的会话 |
| `kill()` | - | `Promise<void>` | 强制终止会话 |
| `canSafelySuspend()` | - | `boolean` | 检查是否可以安全挂起 |
| `getPendingToolCount()` | - | `number` | 获取待处理工具调用数 |
| `isRunning()` | - | `boolean` | 检查是否正在运行 |

#### 关键实现细节:

**1. 启动流程 (`start()`)**:
```typescript
async start(): Promise<void> {
  this.status = 'starting'
  
  const options: RpcClientOptions = {
    cliPath: this.resolveCliPath(),  // 解析 CLI 路径
    cwd: this.config.cwd,
    env: this.buildEnv(),            // 构建环境变量（API keys 等）
    provider: this.config.provider,
    model: this.config.model,
    args: this.buildArgs(),          // 构建命令行参数
  }

  this.rpcClient = new RpcClient(options)
  await this.rpcClient.start()

  // 订阅事件
  this._unsubscribeEvent = this.rpcClient.onEvent((event) => {
    this.handleAgentEvent(event)
  })

  this.status = 'idle'
}
```

**2. 事件处理 (`handleAgentEvent()`)**:
```typescript
private handleAgentEvent(event: AgentEvent): void {
  this.lastActivityAt = Date.now()
  
  // 更新状态
  if (event.type === 'result') {
    this.status = 'idle'
    this._isProcessing = false
  } else if (event.type === 'agent_start') {
    this.status = 'active'
    this._isProcessing = true
  }
  
  // 追踪工具调用状态
  if (event.type === 'tool_execution_start') {
    this._pendingToolCalls.add(event.toolCallId)
  } else if (event.type === 'tool_execution_end') {
    this._pendingToolCalls.delete(event.toolCallId)
  }
  
  // 向上层发射事件
  this.emit('message', event)
}
```

**3. 安全挂起检查**:
```typescript
canSafelySuspend(): boolean {
  return this._pendingToolCalls.size === 0 && !this._isProcessing
}
```

---

### 4.2 PiProcessPool 类

**文件**: `electron/engines/PiProcessPool.ts`  
**职责**: 管理多个 PiSessionProcess 实例，实现会话生命周期管理和驱逐策略

#### 核心属性:

```typescript
class PiProcessPool {
  private processes: Map<string, PiSessionProcess> = new Map()
  private mainWindow: BrowserWindow | null = null
  
  // 事件处理器引用（用于清理）
  private poolHandlers: Map<string, {
    message: (msg: any) => void
    exit: (code: number | null) => void
    error: (err: Error) => void
  }> = new Map()
  
  static readonly MAX_PROCESSES = 3  // 最大并发进程数
}
```

#### 核心方法:

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `setMainWindow(window)` | `BrowserWindow` | `void` | 设置主窗口引用 |
| `startSession(id, config)` | `string, EngineSessionConfig` | `Promise<void>` | 启动新会话或复用已有会话 |
| `sendMessage(id, content)` | `string, string` | `void` | 发送消息到指定会话 |
| `abortSession(id)` | `string` | `void` | 中断指定会话 |
| `suspendSession(id)` | `string` | `void` | 挂起指定会话 |
| `resumeSession(id)` | `string` | `Promise<void>` | 恢复挂起的会话 |
| `killSession(id)` | `string` | `void` | 终止指定会话 |
| `getSessionStatus(id)` | `string` | `SessionStatusInfo \| null` | 获取会话状态 |
| `getActiveSessions()` | - | `SessionStatusInfo[]` | 获取所有活跃会话 |
| `killAll()` | - | `void` | 终止所有会话 |

#### 关键实现细节:

**1. 驱逐策略 (`evictIfNeeded()`)**:
```typescript
private evictIfNeeded(): void {
  const runningCount = this.getActiveCount()
  if (runningCount < MAX_PROCESSES) return

  // 优先级 1: 驱逐 idle 且可安全挂起的会话
  const safeIdleCandidates = Array.from(this.processes.values())
    .filter(p => p.isRunning() && p.status === 'idle' && p.canSafelySuspend())
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

  if (safeIdleCandidates.length > 0) {
    safeIdleCandidates[0].suspend()
    return
  }

  // 优先级 2: 驱逐 active 但可安全挂起的会话
  const safeActiveCandidates = Array.from(this.processes.values())
    .filter(p => p.isRunning() && p.status === 'active' && p.canSafelySuspend())
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

  if (safeActiveCandidates.length > 0) {
    safeActiveCandidates[0].suspend()
    return
  }

  // 无法安全驱逐时记录警告
  warn('Cannot evict: sessions have pending operations')
}
```

**2. 事件路由 (`routeEvent()`)**:
```typescript
private routeEvent(sessionId: string, eventType: string, data: any): void {
  // 使用 PiEventMapper 转换为统一格式
  const unifiedEvent = mapPiEvent(sessionId, { type: eventType, ...data })
  
  if (unifiedEvent && this.mainWindow?.isDestroyed() === false) {
    this.mainWindow.webContents.send(
      `claude-code:${unifiedEvent.type}`,
      { sessionId, data: unifiedEvent.data }
    )
  }
}
```

---

### 4.3 PiEngine 类 (重写)

**文件**: `electron/engines/PiEngine.ts`  
**职责**: 实现 IEngine 接口，作为 EngineFactory 的入口点

#### 核心属性:

```typescript
class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'
  private pool: PiProcessPool
  private _mainWindow: BrowserWindow | null = null
}
```

#### 核心方法 (IEngine 接口实现):

| 方法 | 实现方式 | 说明 |
|------|----------|------|
| `setMainWindow(window)` | 传递给 pool | 设置主窗口用于事件路由 |
| `startSession(id, config)` | 委托给 `pool.startSession()` | 启动会话 |
| `sendMessage(id, content)` | 委托给 `pool.sendMessage()` | 发送消息 |
| `abort(id)` | 委托给 `pool.abortSession()` | 中断操作 |
| `stop(id)` | 委托给 `pool.killSession()` | 终止会话 |
| `suspendSession(id)` | 委托给 `pool.suspendSession()` | 挂起会话 |
| `resumeSession(id)` | 委托给 `pool.resumeSession()` | 恢复会话 |
| `getSessionStatus(id)` | 委托给 `pool.getSessionStatus()` | 获取状态 |
| `getActiveSessions()` | 委托给 `pool.getActiveSessions()` | 获取活跃会话列表 |
| `listAgents(cwd?)` | 返回内置 agent 列表 | 列出可用 agents |

#### 特有方法:

| 方法 | 说明 |
|------|------|
| `updateThinkingLevel(id, enabled)` | 更新 thinking 级别（pi-coding agent 特有） |
| `static isAvailableAsync()` | 异步检查 SDK 是否可用 |
| `static isAvailable()` | 同步快速检查 |

---

### 4.4 PiEventMapper (保留及更新)

**文件**: `electron/engines/PiEventMapper.ts`  
**职责**: 将 pi-coding-agent 的 AgentEvent 转换为 UnifiedEngineEvent

#### 事件映射表:

| 输入事件 (AgentEvent) | 输出事件 (UnifiedEngineEvent) | 说明 |
|-----------------------|-------------------------------|------|
| `agent_start` | `{ type: 'system', subtype: 'agent_start' }` | Agent 开始 |
| `agent_end` | `{ type: 'result', ... }` | Agent 结束，包含最终文本 |
| `message_start` (assistant) | `{ type: 'assistant', message }` | 助手消息开始 |
| `message_update` | `{ type: 'stream_event', event }` | 流式更新（thinking/text/toolcall） |
| `message_end` (assistant) | `{ type: 'assistant', message }` | 助手消息结束 |
| `tool_execution_start` | `{ type: 'tool_use', id, name, input }` | 工具调用开始 |
| `tool_execution_update` | `{ type: 'stream_event', partialResult }` | 工具执行进度更新 |
| `tool_execution_end` | `{ type: 'tool_result', output, isError }` | 工具执行结束 |
| `compaction_start` | `{ type: 'system', subtype: 'compaction_start' }` | 压缩开始 |
| `compaction_end` | `{ type: 'system', subtype: 'compaction_end' }` | 压缩结束 |
| `thinking_level_changed` | `{ type: 'system', subtype: 'thinking_level_changed' }` | Thinking 级别变更 |
| `auto_retry_start/end` | `{ type: 'system', subtype: 'auto_retry_*' }` | 自动重试事件 |

**需要更新的部分**:
- 可能需要添加对新事件类型的映射（如果 pi-coding-agent 更新后新增了事件类型）
- 确保 `result` 事件的格式与 ClaudeCodeEngine 一致（包含 `result`, `stop_reason`, `messages` 字段）

---

## 5. 数据流与事件流

### 5.1 用户发送消息流程

```
Renderer (chat.ts)
  │
  ▼ IPC
Main Process (claudeCodeIPC)
  │  ipcMain.handle('claude-code:sendMessage', sessionId, content)
  ▼
EngineFactory.findEngineForSession(sessionId)
  │
  ▼
PiEngine.sendMessage(sessionId, content)
  │
  ▼
PiProcessPool.sendMessage(sessionId, content)
  │
  ▼
PiSessionProcess.sendMessage(content)
  │  this.rpcClient.prompt(content)
  ▼
RpcClient (写入 stdin)
  │  {"type":"prompt","message":"..."}\n
  ▼
RPC 子进程 (pi-coding-agent)
  │  接收命令，开始处理
  ▼
LLM API 调用 (流式响应)
  │
  ▼
RPC 子进程 (stdout 输出 JSONL 事件)
  │  {"type":"agent_start",...}\n
  │  {"type":"message_start",...}\n
  │  {"type":"message_update",...}\n  (多次)
  │  {"type":"tool_execution_start",...}\n
  │  ...
  │  {"type":"result",...}\n
  ▼
RpcClient (读取 stdout, 解析 JSONL)
  │  this.eventListeners.forEach(listener => listener(event))
  ▼
PiSessionProcess.handleAgentEvent(event)
  │  更新状态 (active/idle)
  │  追踪工具调用
  │  this.emit('message', event)
  ▼
PiProcessPool (通过 pool handlers)
  │  this.routeEvent(sessionId, eventType, data)
  │  mapPiEvent() → UnifiedEngineEvent
  ▼
mainWindow.webContents.send('claude-code:eventType', { sessionId, data })
  │
  ▼ IPC
Renderer (chat.ts)
  │  接收事件，更新 UI
```

### 5.2 会话生命周期流程

```
启动会话:
  PiEngine.startSession() 
    → PiProcessPool.startSession()
      → evictIfNeeded()  // 检查是否需要驱逐
      → new PiSessionProcess()
      → PiSessionProcess.start()
        → new RpcClient(options)
        → RpcClient.start()  // spawn 子进程
        → attachPoolHandlers()

挂起会话:
  PiEngine.suspendSession()
    → PiProcessPool.suspendSession()
      → PiSessionProcess.suspend()
        → RpcClient.stop()  // 终止子进程
        → this.status = 'suspended'

恢复会话:
  PiEngine.resumeSession()
    → PiProcessPool.resumeSession()
      → evictIfNeeded()
      → detachPoolHandlers()  // 清理旧处理器
      → attachPoolHandlers()  // 绑定新处理器
      → PiSessionProcess.resume()
        → PiSessionProcess.start()  // 重新启动

终止会话:
  PiEngine.stop()
    → PiProcessPool.killSession()
      → detachPoolHandlers()
      → PiSessionProcess.kill()
        → RpcClient.stop()
        → 清理状态
```

---

## 6. 错误处理机制

### 6.1 错误分类与处理策略

| 错误类型 | 示例 | 处理策略 | 用户提示 |
|----------|------|----------|----------|
| **SDK 未安装** | `Cannot find module '@mariozechner/pi-coding-agent'` | isAvailableAsync() 返回 false，禁用引擎选项 | "Pi Engine SDK 未安装" |
| **CLI 路径不存在** | `ENOENT: dist/cli.js` | 回退到全局安装路径，仍失败则抛出错误 | "无法找到 pi-coding-agent CLI" |
| **子进程启动失败** | exit code != 0 | 记录错误日志，emit('error')，清理资源 | "会话启动失败" |
| **API Key 缺失** | LLM 返回 401/403 | 通过事件系统通知 Renderer | "请配置 API 密钥" |
| **网络超时** | LLM 请求超时 | RpcClient 内部重试，最终超时则通知用户 | "请求超时，请重试" |
| **上下文溢出** | context length exceeded | 触发 compaction 或返回错误 | "上下文过长，已自动压缩" |
| **子进程崩溃** | exit code != 0/null | 标记为 exited，通知 Renderer，不影响其他会话 | "进程异常退出" |
| **stdin 写入失败** | EPIPE (进程已死) | 捕获错误，标记会话为 exited | "连接已断开" |

### 6.2 错误隔离原则

1. **单会话故障不影响其他会话**: 每个 PiSessionProcess 独立运行，崩溃只影响自身
2. **进程池保护**: PiProcessPool 在 catch 块中清理资源，避免泄漏
3. **主进程稳定**: 所有重量级操作在子进程中完成，主进程不会因 LLM 调用而阻塞或崩溃
4. **优雅降级**: 如果 PiEngine 不可用，用户仍可使用 ClaudeCodeEngine

---

## 7. 兼容性与迁移

### 7.1 对默认引擎的影响

**结论**: ✅ **零影响**

理由:
1. **完全独立的代码路径**: PiEngine 和 ClaudeCodeEngine 有各自的进程池和会话管理
2. **EngineFactory 动态选择**: 根据 `config.engineType` 选择引擎，互不干扰
3. **IPC 层统一**: `claudeCodeIPC.ts` 已经支持多引擎，无需修改
4. **Renderer 层兼容**: chat.ts 通过统一的 `UnifiedEngineEvent` 接收事件，不关心底层引擎

### 7.2 数据格式兼容性

**事件格式**: 通过 `PiEventMapper` 统一转换为 `UnifiedEngineEvent`，确保 Renderer 无需修改

**配置接口**: `EngineSessionConfig` 已包含所有必要字段（provider, model, apiKey, baseUrl, thinkingEnabled 等），无需扩展

### 7.3 向后兼容性

**现有用户**:
- 如果用户之前使用 PiEngine（SDK 内联模式），切换到新的 rpc-node 模式后：
  - 配置参数完全兼容（provider, model, apiKey 等）
  - 会话历史不兼容（需要新建会话，因为底层协议不同）
  - UI 层面无感知变化

---

## 8. 测试策略

### 8.1 单元测试

| 测试目标 | 测试内容 | 验证标准 |
|----------|----------|----------|
| **PiSessionProcess** | start/stop/suspend/resume 生命周期 | 状态转换正确，资源无泄漏 |
| **PiSessionProcess** | sendMessage/abort | 命令正确发送到 RpcClient |
| **PiSessionProcess** | canSafelySuspend | 正确判断挂起条件 |
| **PiProcessPool** | evictIfNeeded | 驱逐策略符合预期（优先 idle，其次 active） |
| **PiProcessPool** | routeEvent | 事件正确映射并通过 IPC 发送 |
| **PiProcessPool** | startSession (复用逻辑) | 已存在且活跃的会话不被重复创建 |
| **PiEngine** | IEngine 接口完整性 | 所有方法都正确委托给 pool |
| **PiEngine** | isAvailableAsync | 正确检测 SDK 可用性 |
| **PiEventMapper** | 事件映射覆盖率 | 所有重要事件类型都有对应映射 |

### 8.2 集成测试

| 测试场景 | 测试步骤 | 预期结果 |
|----------|----------|----------|
| **完整对话流程** | startSession → sendMessage → 接收 stream events → result | 消息正确发送，事件正确接收 |
| **多会话并发** | 启动 3 个会话，同时发送消息 | 所有会话正常运行，互不干扰 |
| **会话挂起/恢复** | suspend → resume → sendMessage | 恢复后可正常使用 |
| **驱逐策略** | 启动 4 个会话（超过 MAX_PROCESSES） | 最旧的空闲会话被挂起 |
| **错误恢复** | 启动会话后 kill 子进程 | 会话标记为 exited，不影响其他会话 |
| **引擎切换** | 先用 ClaudeCodeEngine，再切换到 PiEngine | 两个引擎独立工作，无冲突 |

### 8.3 手动验收测试

1. ✅ 在设置中选择 "Pi Engine" 作为引擎
2. ✅ 创建新会话，输入消息，验证响应正常
3. ✅ 验证流式输出（token by token）
4. ✅ 验证工具调用显示（Read, Write, Bash, Edit 等）
5. ✅ 验证 thinking 过程显示（如果启用）
6. ✅ 打开多个会话标签页，验证并发工作
7. ✅ 挂起一个会话，验证其他会话不受影响
8. ✅ 恢复挂起的会话，验证继续正常工作
9. ✅ 切换回 ClaudeCodeEngine，验证默认引擎未受影响
10. ✅ 关闭并重启应用，验证无内存泄漏或僵尸进程

---

## 9. 回滚方案

### 9.1 代码回滚

如果重构后出现严重问题：

```bash
# Git 回滚到重构前的 commit
git revert <commit-hash-of-pi-engine-refactor>

# 或者直接 reset（如果还未合并到 main）
git reset --hard <commit-hash-before-refactor>
```

### 9.2 配置回滚

在 `EngineFactory` 中添加开关：

```typescript
// electron/engines/EngineFactory.ts
static getEngine(type: EngineType): IEngine {
  if (type === 'pi') {
    // 检查是否强制使用旧版 SDK 内联模式
    if (process.env.PI_USE_LEGACY_SDK === 'true') {
      return new LegacyPiEngine()  // 保留旧实现作为 fallback
    }
    return new PiEngine()  // 新版 rpc-node 模式
  }
  // ...
}
```

### 9.3 数据回滚

由于会话数据存储在前端（localStorage/chat store），重构不影响历史数据。
唯一需要注意的是：新版 PiEngine 创建的新会话与旧版不兼容（协议不同），但这是预期行为。

---

## 10. 风险评估与缓解措施

### 10.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| **RpcClient API 变化** | 中 | 中 | 封装适配器层，集中管理依赖；锁定版本号 |
| **pi-coding-agent 版本兼容性** | 低 | 高 | 在 package.json 中固定版本范围；测试矩阵覆盖主要版本 |
| **子进程资源泄漏** | 低 | 高 |完善的 cleanup 逻辑；单元测试覆盖生命周期；进程监控 |
| **性能开销（子进程通信）** | 低 | 低 | JSONL 协议轻量；异步 I/O 不阻塞主进程 |
| **Windows 平台兼容性** | 中 | 中 | 参考 SessionProcess 的 Windows 处理逻辑（taskkill 等） |

### 10.2 业务风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| **用户体验下降** | 低 | 高 | 充分的 E2E 测试；渐进式发布（先 beta 测试）；收集反馈 |
| **默认引擎受影响** | 极低 | 极高 | 完全隔离的代码路径；回归测试覆盖 ClaudeCodeEngine |
| **第三方依赖风险** | 中 | 中 | 监控上游更新；准备 fallback 方案（LegacyPiEngine） |

---

## 11. 实施计划（概要）

### Phase 1: 基础设施搭建 (预计 2-3 天)
- [ ] 创建 `PiSessionProcess.ts`，实现基本生命周期
- [ ] 创建 `PiProcessPool.ts`，实现进程池管理
- [ ] 重写 `PiEngine.ts`，对接新的进程池
- [ ] 编写单元测试覆盖核心类

### Phase 2: 核心功能实现 (预计 3-4 天)
- [ ] 实现 `sendMessage()` 和事件流
- [ ] 实现 `abort()` 和中断逻辑
- [ ] 更新 `PiEventMapper` 以覆盖所有事件类型
- [ ] 编写集成测试：完整对话流程

### Phase 3: 高级功能 (预计 2-3 天)
- [ ] 实现会话管理（suspend/resume/switch/fork）
- [ ] 实现驱逐策略
- [ ] 实现 `updateThinkingLevel()` 和其他高级 RPC 命令
- [ ] 编写测试：多会话并发、驱逐策略

### Phase 4: 集成与优化 (预计 2 天)
- [ ] 与 claudeCodeIPC 集成测试
- [ ] 与 chat.ts (Vue Store) 集成测试
- [ ] 性能优化和错误处理完善
- [ ] 文档更新和代码审查

### Phase 5: 发布准备 (预计 1-2 天)
- [ ] 完整回归测试（包括 ClaudeCodeEngine）
- [ ] Beta 测试和用户反馈收集
- [ ] 最终修复和文档定稿
- [ ] 合并到主分支

**总预计时间**: 10-14 个工作日

---

## 12. 验收标准

### 必须满足 (Must Have):
- ✅ PiEngine 实现完整的 IEngine 接口
- ✅ 支持基本的对话功能（prompt, stream events, tool calls, result）
- ✅ 支持多会话并发（至少 3 个）
- ✅ 支持会话挂起/恢复
- ✅ 进程池驱逐策略正常工作
- ✅ 事件正确路由到 Renderer 并更新 UI
- ✅ ClaudeCodeEngine 功能不受影响
- ✅ 单元测试覆盖率 > 80%

### 应该满足 (Should Have):
- ✅ 支持高级功能（compaction, model cycling, thinking level）
- ✅ 支持 session switch/fork/clone
- ✅ 完整的 RPC 协议支持（30+ 命令）
- ✅ 错误处理完善，用户友好的错误提示
- ✅ 性能无明显退化（启动时间 < 2s）

### 可以有 (Nice to Have):
- ⚪ 会话持久化（跨重启恢复）
- ⚪ 自定义 extensions 支持
- ⚪ 详细的性能监控指标
- ⚪ 自动重试机制的精细控制

---

## 附录

### A. 参考资料

1. **pi-coding-agent 源码**:
   - `pi-engine/packages/coding-agent/src/modes/rpc/rpc-client.ts`
   - `pi-engine/packages/coding-agent/src/modes/rpc/rpc-mode.ts`
   - `pi-engine/packages/coding-agent/src/modes/rpc/rpc-types.ts`

2. **现有实现参考**:
   - `electron/engines/ClaudeCodeEngine.ts`
   - `electron/claudeCodeProcessPool.ts`
   - `electron/sessionProcess.ts`

3. **接口定义**:
   - `electron/engines/types.ts` (IEngine, EngineSessionConfig, UnifiedEngineEvent)

### B. 术语表

| 术语 | 定义 |
|------|------|
| **RpcClient** | pi-coding-agent 提供的 RPC 客户端库，用于与 RPC 模式的 agent 子进程通信 |
| **RPC 模式** | pi-coding-agent 的无头运行模式，通过 stdin/stdout JSON 协议通信 |
| **进程池** | 管理多个子进程实例的组件，负责生命周期、资源分配和驱逐策略 |
| **UnifiedEngineEvent** | 统一的事件格式，屏蔽底层引擎差异 |
| **驱逐策略** | 当并发会话数超过上限时，选择挂起哪个会话的策略 |

### C. 变更日志

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| 1.0 | 2026-05-06 | AI Assistant | 初始版本，完整设计规格 |

---

**文档结束**

*下一步：请审查此规格文档，确认后进入实现计划编写阶段。*
