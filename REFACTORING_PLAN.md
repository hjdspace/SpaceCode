Claude Code 源码分析 & 桌面端完全复用方案
一、Claude Code 源码架构分析
1.1 核心调用链
cli.tsx (入口)
  └→ main.tsx (Commander CLI 框架, ~6970行)
       ├→ Interactive 模式: REPL (React/Ink TUI)
       │    └→ 用户输入 → ask() → query() → API
       └→ Headless/Print 模式 (-p): print.ts (~5613行)
            └→ runHeadless() → ask() → QueryEngine.submitMessage()
                 └→ query() → claude.ts (API调用)
1.2 关键模块职责
模块	路径	职责
CLI入口	@/src/entrypoints/cli.tsx:74	参数解析、快速路径分发
初始化	@/src/entrypoints/init.ts:59	配置加载、OAuth、代理、遥测、mTLS
主函数	@/src/main.tsx:885	Commander命令定义、交互/非交互分支
Headless运行器	@/src/cli/print.ts:449	runHeadless() - 非交互模式主循环
QueryEngine	@/src/QueryEngine.ts:186	会话状态管理、系统提示词构建、消息处理
ask()	@/src/QueryEngine.ts:1211	一次性QueryEngine包装，yield SDKMessage
query()	@/src/query.ts:222	核心查询循环：API调用→工具执行→自动压缩
API客户端	@/src/services/api/claude.ts	Anthropic API流式/非流式调用
工具注册	@/src/tools.ts	45+工具(Bash, FileRead/Edit/Write, Grep, Glob, Agent等)
命令系统	@/src/commands.ts	60+斜杠命令(/compact, /model, /clear等)
权限系统	@/src/utils/permissions/	canUseTool回调、权限模式(auto/ask/bypass)
MCP客户端	@/src/services/mcp/client.ts	MCP服务器连接、工具发现
压缩服务	@/src/services/compact/	上下文自动压缩、token管理
1.3 CLI入口到LLM交互的完整配置过程
Step 1: cli.tsx → main.tsx

解析CLI参数（--model, --permission-mode, -p等）
设置全局宏 MACRO.VERSION
调用 cliMain() → main()
Step 2: main() 初始化

init() → enableConfigs(), applySafeConfigEnvironmentVariables(), setupGracefulShutdown(), configureGlobalMTLS(), configureGlobalAgents(), initSentry(), preconnectAnthropicApi()
认证：getClaudeAIOAuthTokens(), validateForceLoginOrg()
GrowthBook特性标志：initializeGrowthBook()
模型解析：parseUserSpecifiedModel(), getMainLoopModel()
工具权限：initializeToolPermissionContext(), getTools(toolPermissionContext)
MCP连接：getMcpToolsCommandsAndResources()
插件/技能：initBuiltinPlugins(), initBundledSkills()
Step 3: Headless分支 (-p模式)

构建 AppState → createStore(headlessInitialState)
调用 runHeadless(inputPrompt, getAppState, setAppState, commands, tools, ...)
Step 4: runHeadless() 主循环

消息队列管理，支持stdin输入
每轮调用 ask() → 创建 QueryEngine 实例
Step 5: QueryEngine.submitMessage()

processUserInput() - 处理斜杠命令、附件
fetchSystemPromptParts() - 构建系统提示词
调用 query() 进入核心循环
Step 6: query() 核心循环

queryModelWithStreaming() → Anthropic API流式调用
解析工具调用 → runTools() → 工具执行
自动压缩检查 → autoCompact()
循环直到 stop_reason === 'end_turn' 或达到限制
二、桌面端现状分析
2.1 当前问题
桌面端有 3个失败的集成尝试，全部是自己实现简化版Agent：

文件	问题
@/electron/queryEngineBridge.ts	纯占位符 - sendMessageToLLM() 返回硬编码字符串
@/electron/queryEngineIntegration.ts	自实现Agent - 自己解析<tool<tool_use>XML、自己执行9个简化工具、自己调OpenAI/Anthropic/Gemini，无权限系统、无压缩、无MCP、无斜杠命令
@/electron/queryEngineFull.ts	导入失败 - 尝试import cli.js但无法解析，所有handler返回placeholder
@/electron/queryEngineAdapter.ts	适配器空壳 - tryLoadQueryEngine() 找不到模块，fallback到minimal实现
@/src/services/llm.ts	渲染进程直接调API - dangerouslyAllowBrowser: true，无工具、无Agent循环
2.2 核心差距
功能	CLI (claude-code)	桌面端 (当前)
工具数量	45+	9个简化版
权限系统	完整(auto/ask/bypass)	无
上下文压缩	自动compact + snip	简单截断
MCP支持	完整连接器	无
斜杠命令	60+	无
子Agent	AgentTool	无
会话持久化	transcript存储	无
思考模式	adaptive thinking	无
文件历史	快照+回滚	无
认证	OAuth + API Key	仅API Key
三、完全复用方案
核心思路：以子进程方式运行 claude-code CLI，通过 JSON Stream 协议通信
直接在 Electron Main 进程中 import QueryEngine 不可行，原因：

claude-code 依赖 bun:bundle（feature flags）、@anthropic/ink（React终端UI）等 Bun/Node 特定模块
模块初始化链极深（init.ts → config → auth → GrowthBook → MCP → proxy → mTLS），在 Electron 环境中 mock 成本极高
工具执行依赖 child_process、文件系统等 Node API，与 Electron 的安全限制冲突
正确方案：将 claude-code CLI 作为 headless 子进程运行，通过 stdin/stdout 的 JSON stream 协议通信。 这正是 claude-code 的 SDK/-p 模式设计目标。

3.1 方案架构
┌─────────────────────────────────────────────┐
│           Electron Renderer (Vue 3)          │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
│  │ ChatView │  │ ToolView │  │ Settings   │  │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       │              │              │         │
│       └──────────────┼──────────────┘         │
│                      │ IPC                    │
├──────────────────────┼────────────────────────┤
│           Electron Main Process               │
│                      │                        │
│  ┌───────────────────▼────────────────────┐   │
│  │        ClaudeCodeProcessManager         │   │
│  │  ┌─────────────────────────────────┐   │   │
│  │  │  Spawn: bun cli.tsx             │   │   │
│  │  │    --output-format stream-json   │   │   │
│  │  │    --input-format stream-json    │   │   │
│  │  │    -p                            │   │   │
│  │  │    --model <model>               │   │   │
│  │  │    --permission-mode <mode>      │   │   │
│  │  │                                  │   │   │
│  │  │  stdin  ← user messages          │   │   │
│  │  │  stdout → SDKMessage stream      │   │   │
│  │  │  stderr → debug/log output       │   │   │
│  │  └─────────────────────────────────┘   │   │
│  │                                        │   │
│  │  - 进程生命周期管理                      │   │
│  │  - SDKMessage 解析 & 事件分发           │   │
│  │  - 会话恢复 (--continue/--resume)       │   │
│  │  - 权限请求代理到 UI                    │   │
│  └────────────────────────────────────────┘   │
└───────────────────────────────────────────────┘
3.2 具体实现步骤
Step 1: 创建 ClaudeCodeProcessManager
替换所有 queryEngine*.ts 文件，新建一个进程管理器：

typescript
// electron/claudeCodeProcessManager.ts
import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
 
interface SessionConfig {
  cwd: string
  model?: string
  permissionMode?: 'default' | 'plan' | 'auto' | 'bypassPermissions'
  systemPrompt?: string
  appendSystemPrompt?: string
  maxTurns?: number
  maxBudgetUsd?: number
  apiKey?: string   // 传入环境变量
  verbose?: boolean
}
 
class ClaudeCodeProcessManager extends EventEmitter {
  private process: ChildProcess | null = null
  private sessionId: string | null = null
  private buffer: string = ''
  
  async startSession(config: SessionConfig): Promise<string> {
    const cliPath = this.resolveCliPath()
    const args = this.buildArgs(config)
    const env = this.buildEnv(config)
    
    this.process = spawn(cliPath, args, {
      cwd: config.cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
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
          } catch {}
        }
      }
    })
    
    // stderr 用于日志
    this.process.stderr!.on('data', (data) => {
      this.emit('log', data.toString())
    })
    
    return this.sessionId = crypto.randomUUID()
  }
  
  private buildArgs(config: SessionConfig): string[] {
    const args = [
      '-p',                           // headless/print 模式
      '--output-format', 'stream-json', // SDK JSON stream 输出
      '--input-format', 'stream-json',  // SDK JSON stream 输入
      '--verbose',                     // 详细输出含工具调用
    ]
    if (config.model) args.push('--model', config.model)
    if (config.permissionMode) args.push('--permission-mode', config.permissionMode)
    if (config.systemPrompt) args.push('--system-prompt', config.systemPrompt)
    if (config.appendSystemPrompt) args.push('--append-system-prompt', config.appendSystemPrompt)
    if (config.maxTurns) args.push('--max-turns', String(config.maxTurns))
    if (config.maxBudgetUsd) args.push('--max-budget-usd', String(config.maxBudgetUsd))
    return args
  }
  
  private buildEnv(config: SessionConfig): Record<string, string> {
    const env: Record<string, string> = {}
    if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
    return env
  }
  
  private resolveCliPath(): string {
    // 优先使用构建后的 CLI
    // 1. dist/cli.js (node运行)
    // 2. scripts/dev.ts (bun运行)
    // 3. 全局安装的 ccb/claude
  }
  
  async sendMessage(content: string): Promise<void> {
    if (!this.process) throw new Error('No active session')
    // stream-json input format: 写入 JSON 到 stdin
    const msg = JSON.stringify({ type: 'user', content }) + '\n'
    this.process.stdin!.write(msg)
  }
  
  private handleSDKMessage(msg: any) {
    // 根据 SDKMessage.type 分发事件
    switch (msg.type) {
      case 'assistant':
        this.emit('assistant', msg)     // 文本内容
        break
      case 'user':
        this.emit('user', msg)          // 工具结果回显
        break
      case 'tool_use':
        this.emit('tool_use', msg)      // 工具调用
        break
      case 'tool_result':
        this.emit('tool_result', msg)   // 工具结果
        break
      case 'system':
        if (msg.subtype === 'compact_boundary')
          this.emit('compact', msg)
        else if (msg.subtype === 'api_retry')
          this.emit('api_retry', msg)
        break
      case 'result':
        this.emit('result', msg)        // 最终结果
        break
      case 'stream_event':
        this.emit('stream_event', msg)  // 实时流事件
        break
    }
  }
  
  async abort(): Promise<void> {
    // 发送 abort 控制消息
    this.process?.stdin?.write(JSON.stringify({ type: 'abort' }) + '\n')
  }
  
  async stop(): Promise<void> {
    this.process?.kill()
    this.process = null
  }
}
Step 2: IPC Bridge 层
typescript
// electron/claudeCodeIPC.ts - 注册 IPC handlers
export function registerClaudeCodeIPC() {
  const manager = new ClaudeCodeProcessManager()
  
  ipcMain.handle('claude-code:startSession', async (_, config) => {
    return manager.startSession(config)
  })
  
  ipcMain.handle('claude-code:sendMessage', async (_, content) => {
    return manager.sendMessage(content)
  })
  
  ipcMain.handle('claude-code:abort', async () => {
    return manager.abort()
  })
  
  ipcMain.handle('claude-code:stop', async () => {
    return manager.stop()
  })
  
  // 转发 manager 事件到 renderer
  const forwardEvents = ['assistant', 'tool_use', 'tool_result', 'result', 'compact', 'stream_event', 'log']
  for (const event of forwardEvents) {
    manager.on(event, (data) => {
      mainWindow?.webContents.send(`claude-code:${event}`, data)
    })
  }
}
Step 3: Preload 暴露 API
typescript
// electron/preload.ts - 添加 claude-code API
contextBridge.exposeInMainWorld('claudeCode', {
  startSession: (config) => ipcRenderer.invoke('claude-code:startSession', config),
  sendMessage: (content) => ipcRenderer.invoke('claude-code:sendMessage', content),
  abort: () => ipcRenderer.invoke('claude-code:abort'),
  stop: () => ipcRenderer.invoke('claude-code:stop'),
  onAssistant: (cb) => ipcRenderer.on('claude-code:assistant', (_, d) => cb(d)),
  onToolUse: (cb) => ipcRenderer.on('claude-code:tool_use', (_, d) => cb(d)),
  onToolResult: (cb) => ipcRenderer.on('claude-code:tool_result', (_, d) => cb(d)),
  onResult: (cb) => ipcRenderer.on('claude-code:result', (_, d) => cb(d)),
  onStreamEvent: (cb) => ipcRenderer.on('claude-code:stream_event', (_, d) => cb(d)),
  onLog: (cb) => ipcRenderer.on('claude-code:log', (_, d) => cb(d)),
})
Step 4: Vue Store 适配
typescript
// src/stores/chatStore.ts - 替换 chatWithQueryEngine.ts
export const useChatStore = defineStore('chat', () => {
  const claudeCode = (window as any).claudeCode
  
  async function sendMessage(content: string) {
    // 创建 assistant 消息占位
    const assistantId = crypto.randomUUID()
    addMessage({ id: assistantId, role: 'assistant', content: '' })
    
    // 监听流式事件更新消息
    claudeCode.onStreamEvent((event) => {
      if (event.type === 'content_block_delta') {
        // 增量更新 assistant 消息内容
        updateMessage(assistantId, { content: accumulatedContent })
      }
    })
    
    claudeCode.onToolUse((toolUse) => {
      // 在 UI 中展示工具调用
      addToolCall(assistantId, toolUse)
    })
    
    await claudeCode.sendMessage(content)
  }
})
Step 5: 删除废弃文件
electron/queryEngineBridge.ts - 删除
electron/queryEngineIntegration.ts - 删除
electron/queryEngineFull.ts - 删除
electron/queryEngineAdapter.ts - 删除
electron/services/contextManager.ts - 删除（自实现的压缩）
src/services/llm.ts - 删除（渲染进程直调API）
3.3 关键技术细节
CLI 路径解析
typescript
private resolveCliPath(): string {
  const cliRoot = path.resolve(__dirname, '../../claude-code')
  
  // 1. 构建产物 (生产环境)
  const distCli = path.join(cliRoot, 'dist/cli.js')
  if (fs.existsSync(distCli)) return `node "${distCli}"`
  
  // 2. 源码 (开发环境, 需要 bun)
  const devScript = path.join(cliRoot, 'scripts/dev.ts')
  if (fs.existsSync(devScript)) return `bun "${devScript}"`
  
  // 3. 全局安装
  return 'claude'  // 或 'ccb'
}
权限请求代理
当 CLI 在 ask 权限模式下需要用户确认时，通过 SDK 的 permission prompt 机制处理：

typescript
// CLI 启动时添加 --permission-prompt-tool 参数
args.push('--permission-prompt-tool', 'desktop_permission_prompt')
 
// 在 IPC 中拦截该工具调用，弹出 UI 对话框
ipcMain.handle('claude-code:permissionRequest', async (_, toolName, input) => {
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    title: 'Permission Request',
    message: `Allow ${toolName} to execute?`,
    detail: JSON.stringify(input, null, 2),
    buttons: ['Allow', 'Deny', 'Allow Always'],
  })
  return ['allow', 'deny', 'allow_always'][result.response]
})
会话恢复
typescript
// 使用 --continue 或 --resume 恢复会话
async resumeSession(sessionId: string): Promise<void> {
  const args = ['--resume', sessionId, '-p', '--output-format', 'stream-json']
  // 重新启动 CLI 进程
}
3.4 方案优势
维度	子进程方案	直接import方案
功能完整性	✅ 100%复用CLI所有功能	❌ 需mock大量依赖
维护成本	✅ CLI更新即生效	❌ 每次CLI变更需适配
工具系统	✅ 全部45+工具	❌ 需逐一适配
权限系统	✅ 完整权限流程	❌ 需重新实现
MCP支持	✅ 自动继承	❌ 需移植连接器
压缩/上下文	✅ 自动继承	❌ 需移植
认证	✅ OAuth+API Key	❌ 仅API Key
稳定性	✅ 进程隔离，CLI崩溃不影响UI	❌ 共享进程，错误传播
调试	✅ 可独立运行CLI验证	❌ 需在Electron中调试
3.5 实施优先级
P0: ClaudeCodeProcessManager + IPC Bridge + 基础消息收发
P1: Vue Store 适配 + Chat UI 流式渲染
P2: 工具调用 UI 展示 + 权限请求代理
P3: 会话恢复 + 设置同步 + MCP 配置传递
P4: 删除废弃代码 + 清理依赖
总结：当前桌面端的3个 queryEngine*.ts 都是自实现的简化Agent，功能远不如CLI。完全复用的正确方式是以子进程运行 claude-code CLI 的 headless 模式，通过 stream-json 协议通信。这样桌面端只需实现 UI 层和 IPC 桥接，所有 Agent 逻辑（工具、权限、压缩、MCP、命令）完全复用 CLI 源码，功能与 CLI 100%一致。