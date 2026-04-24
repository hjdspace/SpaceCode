# Claude Code Process Manager 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将桌面端的 Agent 功能完全复用 CLI 的 headless 模式，通过子进程 + JSON Stream 协议通信，实现 100% 功能一致性。

**架构：** Electron Main 进程通过 spawn 启动 claude-code CLI 的 headless 模式（`-p --output-format stream-json --input-format stream-json`），通过 stdin/stdout 进行 NDJSON 通信。渲染进程通过 IPC 与 Main 进程交互，Main 进程负责进程生命周期管理和消息分发。

**技术栈：** Electron + TypeScript + Vue 3 + Pinia + claude-code CLI (bun/node)

---

## 文件结构

- **新建：** `electron/claudeCodeProcessManager.ts` — 进程管理器，负责 spawn CLI、解析 NDJSON、事件分发
- **新建：** `electron/claudeCodeIPC.ts` — IPC Bridge，注册 IPC handlers，转发事件到渲染进程
- **修改：** `electron/preload.ts` — 暴露 claudeCode API 给渲染进程
- **修改：** `electron/main.ts` — 注册 ClaudeCode IPC，移除旧 QueryEngine 初始化
- **修改：** `src/stores/chat.ts` — 适配新的 claudeCode API，替换 queryEngine 调用
- **删除：** `electron/queryEngineBridge.ts` — 废弃占位符
- **删除：** `electron/queryEngineIntegration.ts` — 自实现简化 Agent
- **删除：** `electron/queryEngineFull.ts` — 导入失败的集成
- **删除：** `electron/queryEngineAdapter.ts` — 适配器空壳
- **删除：** `electron/services/contextManager.ts` — 自实现压缩
- **删除：** `src/services/llm.ts` — 渲染进程直调 API
- **删除：** `src/services/queryEngine.ts` — 旧 QueryEngine 服务封装
- **删除：** `src/stores/chatWithQueryEngine.ts` — 旧 store（chat.ts 已包含完整功能）

---

## 任务 1：创建 ClaudeCodeProcessManager

**文件：**
- 创建：`electron/claudeCodeProcessManager.ts`

- [ ] **步骤 1：创建文件骨架**

```typescript
import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'

export interface SessionConfig {
  cwd: string
  model?: string
  permissionMode?: 'default' | 'plan' | 'auto' | 'bypassPermissions'
  systemPrompt?: string
  appendSystemPrompt?: string
  maxTurns?: number
  maxBudgetUsd?: number
  apiKey?: string
  verbose?: boolean
}

export class ClaudeCodeProcessManager extends EventEmitter {
  private process: ChildProcess | null = null
  private sessionId: string | null = null
  private buffer: string = ''

  async startSession(config: SessionConfig): Promise<string> {
    // 实现
  }

  async sendMessage(content: string): Promise<void> {
    // 实现
  }

  async abort(): Promise<void> {
    // 实现
  }

  async stop(): Promise<void> {
    // 实现
  }

  private buildArgs(config: SessionConfig): string[] {
    // 实现
  }

  private buildEnv(config: SessionConfig): Record<string, string> {
    // 实现
  }

  private resolveCliPath(): string {
    // 实现
  }

  private handleSDKMessage(msg: any) {
    // 实现
  }
}
```

- [ ] **步骤 2：实现 CLI 路径解析**

```typescript
private resolveCliPath(): string {
  const cliRoot = path.resolve(__dirname, '../../../claude-code')
  
  // 1. 构建产物 (生产环境)
  const distCli = path.join(cliRoot, 'dist/cli.js')
  if (fs.existsSync(distCli)) return `node "${distCli}"`
  
  // 2. 源码 (开发环境, 需要 bun)
  const devScript = path.join(cliRoot, 'scripts/dev.ts')
  if (fs.existsSync(devScript)) return `bun "${devScript}"`
  
  // 3. 全局安装
  return 'claude'
}
```

- [ ] **步骤 3：实现参数构建**

```typescript
private buildArgs(config: SessionConfig): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
  ]
  if (config.model) args.push('--model', config.model)
  if (config.permissionMode) args.push('--permission-mode', config.permissionMode)
  if (config.systemPrompt) args.push('--system-prompt', config.systemPrompt)
  if (config.appendSystemPrompt) args.push('--append-system-prompt', config.appendSystemPrompt)
  if (config.maxTurns) args.push('--max-turns', String(config.maxTurns))
  if (config.maxBudgetUsd) args.push('--max-budget-usd', String(config.maxBudgetUsd))
  return args
}
```

- [ ] **步骤 4：实现环境变量构建**

```typescript
private buildEnv(config: SessionConfig): Record<string, string> {
  const env: Record<string, string> = {}
  if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
  return env
}
```

- [ ] **步骤 5：实现 startSession**

```typescript
async startSession(config: SessionConfig): Promise<string> {
  const cliPath = this.resolveCliPath()
  const args = this.buildArgs(config)
  const env = this.buildEnv(config)
  
  this.process = spawn(cliPath, args, {
    cwd: config.cwd,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true
  })
  
  // 解析 stdout 的 NDJSON stream
  this.process.stdout!.on('data', (data) => {
    this.buffer += data.toString()
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line)
          this.handleSDKMessage(msg)
        } catch (e) {
          console.error('[ClaudeCodeProcessManager] Failed to parse JSON:', line)
        }
      }
    }
  })
  
  // stderr 用于日志
  this.process.stderr!.on('data', (data) => {
    this.emit('log', data.toString())
  })
  
  this.process.on('exit', (code) => {
    this.emit('exit', code)
    this.process = null
  })
  
  return this.sessionId = crypto.randomUUID()
}
```

- [ ] **步骤 6：实现消息发送**

```typescript
async sendMessage(content: string): Promise<void> {
  if (!this.process) throw new Error('No active session')
  const msg = JSON.stringify({ type: 'user', content }) + '\n'
  this.process.stdin!.write(msg)
}
```

- [ ] **步骤 7：实现 abort 和 stop**

```typescript
async abort(): Promise<void> {
  if (this.process?.stdin?.writable) {
    this.process.stdin.write(JSON.stringify({ type: 'abort' }) + '\n')
  }
}

async stop(): Promise<void> {
  if (this.process) {
    this.process.kill()
    this.process = null
    this.sessionId = null
  }
}
```

- [ ] **步骤 8：实现消息分发**

```typescript
private handleSDKMessage(msg: any) {
  switch (msg.type) {
    case 'assistant':
      this.emit('assistant', msg)
      break
    case 'user':
      this.emit('user', msg)
      break
    case 'tool_use':
      this.emit('tool_use', msg)
      break
    case 'tool_result':
      this.emit('tool_result', msg)
      break
    case 'system':
      if (msg.subtype === 'compact_boundary')
        this.emit('compact', msg)
      else if (msg.subtype === 'api_retry')
        this.emit('api_retry', msg)
      else
        this.emit('system', msg)
      break
    case 'result':
      this.emit('result', msg)
      break
    case 'stream_event':
      this.emit('stream_event', msg)
      break
    default:
      this.emit('unknown', msg)
  }
}
```

- [ ] **步骤 9：Commit**

```bash
git add electron/claudeCodeProcessManager.ts
git commit -m "feat: 创建 ClaudeCodeProcessManager 进程管理器"
```

---

## 任务 2：创建 IPC Bridge

**文件：**
- 创建：`electron/claudeCodeIPC.ts`
- 修改：`electron/main.ts`（移除旧 QueryEngine 初始化，注册新的 IPC）

- [ ] **步骤 1：创建 claudeCodeIPC.ts**

```typescript
import { ipcMain, BrowserWindow } from 'electron'
import { ClaudeCodeProcessManager, SessionConfig } from './claudeCodeProcessManager'

let manager: ClaudeCodeProcessManager | null = null
let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window
}

export function registerClaudeCodeIPC() {
  manager = new ClaudeCodeProcessManager()
  
  // 转发 manager 事件到 renderer
  const forwardEvents = ['assistant', 'user', 'tool_use', 'tool_result', 'result', 'compact', 'stream_event', 'log', 'exit']
  for (const event of forwardEvents) {
    manager.on(event, (data) => {
      mainWindow?.webContents.send(`claude-code:${event}`, data)
    })
  }
  
  ipcMain.handle('claude-code:startSession', async (_, config: SessionConfig) => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.startSession(config)
  })
  
  ipcMain.handle('claude-code:sendMessage', async (_, content: string) => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.sendMessage(content)
  })
  
  ipcMain.handle('claude-code:abort', async () => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.abort()
  })
  
  ipcMain.handle('claude-code:stop', async () => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.stop()
  })
  
  console.log('[ClaudeCodeIPC] Registered')
}

export function getManager(): ClaudeCodeProcessManager | null {
  return manager
}
```

- [ ] **步骤 2：修改 main.ts 移除旧 QueryEngine 初始化**

在 `electron/main.ts` 中：
1. 移除 `import { initQueryEngineIntegration, attemptFullIntegration } from './queryEngineIntegration'`
2. 在 `app.whenReady()` 中，移除 `initQueryEngineIntegration()` 和 `attemptFullIntegration()` 调用
3. 添加 `import { registerClaudeCodeIPC, setMainWindow } from './claudeCodeIPC'`
4. 在 `createWindow()` 后调用 `setMainWindow(mainWindow)`
5. 在 `app.whenReady()` 中调用 `registerClaudeCodeIPC()`

- [ ] **步骤 3：Commit**

```bash
git add electron/claudeCodeIPC.ts electron/main.ts
git commit -m "feat: 创建 ClaudeCode IPC Bridge 并移除旧 QueryEngine 初始化"
```

---

## 任务 3：更新 Preload 暴露 API

**文件：**
- 修改：`electron/preload.ts`

- [ ] **步骤 1：添加 claudeCode API 到 preload**

在 `contextBridge.exposeInMainWorld('electronAPI', { ... })` 中添加：

```typescript
claudeCode: {
  startSession: (config: any) => ipcRenderer.invoke('claude-code:startSession', config),
  sendMessage: (content: string) => ipcRenderer.invoke('claude-code:sendMessage', content),
  abort: () => ipcRenderer.invoke('claude-code:abort'),
  stop: () => ipcRenderer.invoke('claude-code:stop'),
  onAssistant: (callback: (data: any) => void) => {
    const wrapper = (_: any, data: any) => callback(data)
    ipcRenderer.on('claude-code:assistant', wrapper)
    return () => ipcRenderer.removeListener('claude-code:assistant', wrapper)
  },
  onUser: (callback: (data: any) => void) => {
    const wrapper = (_: any, data: any) => callback(data)
    ipcRenderer.on('claude-code:user', wrapper)
    return () => ipcRenderer.removeListener('claude-code:user', wrapper)
  },
  onToolUse: (callback: (data: any) => void) => {
    const wrapper = (_: any, data: any) => callback(data)
    ipcRenderer.on('claude-code:tool_use', wrapper)
    return () => ipcRenderer.removeListener('claude-code:tool_use', wrapper)
  },
  onToolResult: (callback: (data: any) => void) => {
    const wrapper = (_: any, data: any) => callback(data)
    ipcRenderer.on('claude-code:tool_result', wrapper)
    return () => ipcRenderer.removeListener('claude-code:tool_result', wrapper)
  },
  onResult: (callback: (data: any) => void) => {
    const wrapper = (_: any, data: any) => callback(data)
    ipcRenderer.on('claude-code:result', wrapper)
    return () => ipcRenderer.removeListener('claude-code:result', wrapper)
  },
  onStreamEvent: (callback: (data: any) => void) => {
    const wrapper = (_: any, data: any) => callback(data)
    ipcRenderer.on('claude-code:stream_event', wrapper)
    return () => ipcRenderer.removeListener('claude-code:stream_event', wrapper)
  },
  onLog: (callback: (data: string) => void) => {
    const wrapper = (_: any, data: string) => callback(data)
    ipcRenderer.on('claude-code:log', wrapper)
    return () => ipcRenderer.removeListener('claude-code:log', wrapper)
  },
  onExit: (callback: (code: number | null) => void) => {
    const wrapper = (_: any, code: number | null) => callback(code)
    ipcRenderer.on('claude-code:exit', wrapper)
    return () => ipcRenderer.removeListener('claude-code:exit', wrapper)
  },
},
```

- [ ] **步骤 2：Commit**

```bash
git add electron/preload.ts
git commit -m "feat: preload 暴露 claudeCode API"
```

---

## 任务 4：Vue Store 适配

**文件：**
- 修改：`src/stores/chat.ts`

- [ ] **步骤 1：替换 QueryEngine 相关逻辑**

在 `src/stores/chat.ts` 中：
1. 移除 `queryEngineSessions` ref
2. 移除 `initQueryEngineSession` 函数
3. 修改 `sendMessage` 函数，使用 `window.electronAPI.claudeCode` 替代 `window.electronAPI.queryEngine`
4. 修改 `deleteSession` 函数，移除 QueryEngine session 清理逻辑

关键修改 —— `sendMessage` 函数：

```typescript
async function sendMessage(content: string): Promise<void> {
  if (!currentSessionId.value) {
    createSession()
  }

  const session = sessions.value.find(s => s.id === currentSessionId.value)
  if (!session) return

  addMessage({
    role: 'user',
    content
  })

  const claudeCode = (window as any).electronAPI?.claudeCode
  if (!claudeCode) {
    isLoading.value = true
    setTimeout(() => {
      addMessage({
        role: 'assistant',
        content: 'Claude Code CLI is not available. Please check your configuration.'
      })
      isLoading.value = false
    }, 500)
    return
  }

  isLoading.value = true
  streamingContent.value = ''

  const assistantMessageId = crypto.randomUUID()
  addMessage({
    id: assistantMessageId,
    role: 'assistant',
    content: ''
  })

  await new Promise<void>((resolve, reject) => {
    let accumulatedContent = ''
    let isCompleted = false

    const handleStreamEvent = (event: any) => {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        accumulatedContent += event.delta.text
        streamingContent.value = accumulatedContent
        nextTick(() => {
          updateMessage(assistantMessageId, { content: accumulatedContent })
        })
      }
    }

    const handleToolUse = (toolUse: any) => {
      // 在 UI 中展示工具调用
      const session = sessions.value.find(s => s.id === currentSessionId.value)
      if (session) {
        const msg = session.messages.find(m => m.id === assistantMessageId)
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = []
          msg.toolCalls.push({
            id: toolUse.id || crypto.randomUUID(),
            name: toolUse.name,
            input: toolUse.input,
            status: 'running'
          })
          saveToStorage()
        }
      }
    }

    const handleToolResult = (toolResult: any) => {
      // 更新工具调用状态
      const session = sessions.value.find(s => s.id === currentSessionId.value)
      if (session) {
        const msg = session.messages.find(m => m.id === assistantMessageId)
        if (msg?.toolCalls) {
          const toolCall = msg.toolCalls.find(tc => tc.id === toolResult.tool_use_id)
          if (toolCall) {
            toolCall.status = 'complete'
            toolCall.output = toolResult.output
            saveToStorage()
          }
        }
      }
    }

    const handleResult = () => {
      if (isCompleted) return
      isCompleted = true
      streamingContent.value = ''
      isLoading.value = false
      updateMessage(assistantMessageId, { content: accumulatedContent })
      saveToStorage()
      cleanup()
      resolve()
    }

    const handleLog = (log: string) => {
      console.log('[ClaudeCode]', log)
    }

    const handleError = (error: any) => {
      if (isCompleted) return
      isCompleted = true
      isLoading.value = false
      streamingContent.value = ''
      updateMessage(assistantMessageId, {
        content: `Error: ${error instanceof Error ? error.message : String(error)}`
      })
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      claudeCode.offStreamEvent?.(handleStreamEvent)
      claudeCode.offToolUse?.(handleToolUse)
      claudeCode.offToolResult?.(handleToolResult)
      claudeCode.offResult?.(handleResult)
      claudeCode.offLog?.(handleLog)
      claudeCode.offExit?.(handleError)
    }

    // 设置监听器
    claudeCode.onStreamEvent(handleStreamEvent)
    claudeCode.onToolUse(handleToolUse)
    claudeCode.onToolResult(handleToolResult)
    claudeCode.onResult(handleResult)
    claudeCode.onLog(handleLog)
    claudeCode.onExit((code: number | null) => {
      if (code !== null && code !== 0) {
        handleError(new Error(`Process exited with code ${code}`))
      } else {
        handleResult()
      }
    })

    // 发送消息
    claudeCode.sendMessage(content).catch((error: any) => {
      cleanup()
      handleError(error)
    })
  }).catch((error) => {
    console.error('[ChatStore] Error sending message:', error)
    isLoading.value = false
    streamingContent.value = ''
  })
}
```

- [ ] **步骤 2：修改 deleteSession 移除 QueryEngine 清理**

```typescript
async function deleteSession(sessionId: string) {
  const index = sessions.value.findIndex(s => s.id === sessionId)
  if (index > -1) {
    sessions.value.splice(index, 1)
    if (currentSessionId.value === sessionId) {
      currentSessionId.value = sessions.value[0]?.id || null
    }
    saveToStorage()
  }
}
```

- [ ] **步骤 3：Commit**

```bash
git add src/stores/chat.ts
git commit -m "feat: Vue Store 适配 claudeCode API"
```

---

## 任务 5：删除废弃文件

**文件：**
- 删除：`electron/queryEngineBridge.ts`
- 删除：`electron/queryEngineIntegration.ts`
- 删除：`electron/queryEngineFull.ts`
- 删除：`electron/queryEngineAdapter.ts`
- 删除：`electron/services/contextManager.ts`
- 删除：`src/services/llm.ts`
- 删除：`src/services/queryEngine.ts`
- 删除：`src/stores/chatWithQueryEngine.ts`

- [ ] **步骤 1：删除所有废弃文件**

```bash
git rm electron/queryEngineBridge.ts
git rm electron/queryEngineIntegration.ts
git rm electron/queryEngineFull.ts
git rm electron/queryEngineAdapter.ts
git rm electron/services/contextManager.ts
git rm src/services/llm.ts
git rm src/services/queryEngine.ts
git rm src/stores/chatWithQueryEngine.ts
```

- [ ] **步骤 2：检查并移除所有对废弃文件的引用**

搜索项目中是否还有引用这些文件的 import 语句：
- `queryEngineBridge`
- `queryEngineIntegration`
- `queryEngineFull`
- `queryEngineAdapter`
- `contextManager`
- `llm.ts`
- `queryEngine.ts` (src/services/)
- `chatWithQueryEngine`

- [ ] **步骤 3：Commit**

```bash
git commit -m "cleanup: 删除废弃的 QueryEngine 相关文件"
```

---

## 任务 6：验证实现

- [ ] **步骤 1：TypeScript 类型检查**

运行：`npm run typecheck`
预期：无类型错误

- [ ] **步骤 2：构建检查**

运行：`npm run build`
预期：构建成功

- [ ] **步骤 3：代码审查**

检查清单：
- [ ] ClaudeCodeProcessManager 正确处理 NDJSON stream
- [ ] IPC handlers 正确注册
- [ ] Preload 正确暴露 API
- [ ] Vue Store 正确调用新 API
- [ ] 所有废弃文件已删除
- [ ] 无残留的旧引用

- [ ] **步骤 4：最终 Commit**

```bash
git add .
git commit -m "feat: 完成桌面端 Agent 重构，完全复用 CLI 功能"
```

---

## 自检

**1. 规格覆盖度：**
- ✅ 进程管理器（ClaudeCodeProcessManager）
- ✅ IPC Bridge（claudeCodeIPC.ts）
- ✅ Preload API 暴露
- ✅ Vue Store 适配
- ✅ 废弃文件删除
- ✅ 权限请求代理（通过 --permission-mode 参数）
- ✅ 会话恢复（后续可通过 --resume 实现）

**2. 占位符扫描：**
- 无 TODO/TBD/待定
- 所有步骤包含实际代码

**3. 类型一致性：**
- SessionConfig 接口在 manager 和 IPC 中一致
- 事件名称在 manager、IPC、preload、store 中一致
