# 官网 Claude Code 引擎切换 + API 转换桥设计

## 一、背景与目标

### 当前状态

SpaceCode 使用内置的 `claude-code-best`（逆向 Claude Code CLI）作为引擎，通过 `spawn` 启动子进程，使用 JSONL 流式协议通信。内置版本原生支持 OpenAI 兼容 API。

### 目标

1. 允许用户切换到本地安装的官网 Claude Code CLI
2. 支持检测用户电脑是否安装 claude-code，未安装时提供一键自动安装（含 Node.js、Git 等依赖）
3. 当官网 CLI + 非 Anthropic API 时，通过本地代理实现 API 协议转换

### 核心挑战

官网 Claude Code CLI **原生不支持 OpenAI 兼容 API**，需要 API 转换桥（代理层）进行 Anthropic ↔ OpenAI 格式转换。

---

## 二、方案选型

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| A. 主进程内代理 | 在 Electron 主进程中运行 HTTP 代理 | 实现最简单 | 阻塞 UI，崩溃影响全局 |
| **B. 独立子进程代理** ✅ | 代理作为独立 Node.js 子进程运行 | 进程隔离，崩溃可恢复，主进程零负载 | 额外进程管理 |
| C. 完整 cc-switch 架构 | 含断路器/故障转移/Provider 路由 | 生产级可靠性 | 过度设计，开发周期长 |

**选择方案 B**：平衡复杂度和可靠性，桌面单用户场景不需要断路器，但进程隔离收益显著。

---

## 三、整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Vue 3 Renderer                                  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  GeneralSettings.vue (引擎选择)                                │  │
│  │  ModelSettings.vue (API 配置)                                  │  │
│  │  EngineSourceSettings.vue (新增：官网引擎 + 安装检测 + 适配器)   │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │ IPC                                  │
│  ┌───────────────────────────┴───────────────────────────────────┐  │
│  │                    Electron Main Process                       │  │
│  │                                                               │  │
│  │  ┌──────────────────┐  ┌──────────────────┐                   │  │
│  │  │  EngineFactory   │  │  CliDetector     │ ← 新增            │  │
│  │  │  (现有，扩展)     │  │  (CLI检测+安装)  │                   │  │
│  │  └────────┬─────────┘  └──────────────────┘                   │  │
│  │           │                                                    │  │
│  │  ┌────────┴─────────┐  ┌──────────────────────────────────┐   │  │
│  │  │ ClaudeCodeEngine │  │  ProxyManager                    │   │  │
│  │  │ (现有，扩展)      │  │  (代理进程管理，启停+健康检查)    │   │  │
│  │  └────────┬─────────┘  └──────────┬───────────────────────┘   │  │
│  │           │                       │ spawn                       │  │
│  │  ┌────────┴──────────┐  ┌────────┴────────────────────────┐   │  │
│  │  │ SessionProcess    │  │  Proxy 子进程                    │   │  │
│  │  │ (现有，扩展env)   │  │  (独立 Node 进程运行代理服务器)   │   │  │
│  │  │                   │  │                                  │   │  │
│  │  │  ANTHROPIC_BASE_  │  │  ┌────────────┐ ┌────────────┐ │   │  │
│  │  │  URL=localhost:   │  │  │SSE Parser  │ │Transformer │ │   │  │
│  │  │  34567            │→ │  │(SSE解析器) │ │(格式转换)  │ │   │  │
│  │  │                   │  │  └────────────┘ └────────────┘ │   │  │
│  │  └───────────────────┘  │  ┌────────────┐ ┌────────────┐ │   │  │
│  │                         │  │ModelMapper │ │AuthProvider│ │   │  │
│  │                         │  │(模型映射)  │ │(认证处理)  │ │   │  │
│  │                         │  └────────────┘ └────────────┘ │   │  │
│  │                         └─────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 四、文件清单

### 新增文件

```
electron/
├── cliDetector.ts              # CLI 检测 + 环境检查 + 自动安装
├── proxyManager.ts             # 代理子进程生命周期管理
└── proxy/                      # 代理子进程代码（独立运行）
    ├── index.ts                # 代理入口（被 spawn 为独立进程）
    ├── server.ts               # HTTP 服务器
    ├── sseParser.ts            # SSE 事件流解析器
    ├── transformer.ts          # Anthropic ↔ OpenAI 格式转换
    ├── streamingTransformer.ts # 流式 SSE 事件转换（双向）
    ├── modelMapper.ts          # 模型名映射 + [1M] 剥离
    └── authHandler.ts          # 认证头处理（不同 Provider 差异）

src/
├── components/settings/
│   └── EngineSourceSettings.vue  # 引擎来源设置（内置/官网 + 安装检测 + 适配器状态）
```

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `electron/sessionProcess.ts` | `resolveCliCommand()` 增加官网 CLI 路径解析；`buildEnv()` 注入代理 URL |
| `electron/claudeCodeIPC.ts` | 新增 IPC handlers（检测、安装、代理状态） |
| `electron/preload.ts` | 新增 `claudeCode.detectInstalledCli()` 等 API |
| `src/stores/settings.ts` | 新增 `engineSource: 'bundled' \| 'installed'` 字段 |
| `src/components/settings/GeneralSettings.vue` | 引擎选择区域增加「内置/官网」切换 |
| `src/services/electronAPI.ts` | 新增前端 API 封装 |

---

## 五、CLI 检测与自动安装（cliDetector.ts）

### 检测流程

```
用户选择「官网模式」
    │
    ▼
1. 检测 claude-code CLI
   ├── which/where claude     (全局 PATH)
   ├── npm list -g @anthropic-ai/claude-code
   └── 常见安装路径扫描
    │
    ▼
2. 检测运行环境
   ├── Node.js (node --version)
   ├── npm (npm --version)
   ├── Git (git --version)
   └── 磁盘空间检查
    │
    ▼
3. 根据检测结果决定下一步
   ├── 全部就绪 → 显示 ✅ 已检测到 CLI v1.x.x
   ├── CLI 未安装但环境就绪 → 显示「一键安装」按钮
   └── 环境缺失 → 显示缺失项 + 各项安装引导
```

### 类型定义

```typescript
interface CliDetectionResult {
  available: boolean
  path: string | null
  version: string | null
}

interface EnvironmentCheck {
  node: { available: boolean; version: string | null; path: string | null }
  npm: { available: boolean; version: string | null; path: string | null }
  git: { available: boolean; version: string | null; path: string | null }
}

interface InstallProgress {
  stage: 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  message: string
  percent?: number
}
```

### CLI 检测逻辑

```typescript
async function detectInstalledCli(): Promise<CliDetectionResult> {
  // 1. PATH 查找
  const whichResult = await execCommand(
    process.platform === 'win32' ? 'where claude' : 'which claude'
  )
  if (whichResult) {
    const version = await getCliVersion(whichResult)
    return { available: true, path: whichResult, version }
  }

  // 2. npm 全局安装检查
  const npmGlobalPath = await execCommand('npm root -g')
  if (npmGlobalPath) {
    const cliPath = path.join(npmGlobalPath, '@anthropic-ai', 'claude-code')
    if (fs.existsSync(cliPath)) {
      const version = await getCliVersion(cliPath)
      return { available: true, path: cliPath, version }
    }
  }

  // 3. 常见路径扫描
  const candidates = getCandidatePaths()
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const version = await getCliVersion(candidate)
      return { available: true, path: candidate, version }
    }
  }

  return { available: false, path: null, version: null }
}
```

### 一键安装逻辑

```typescript
async function installCli(
  onProgress: (progress: InstallProgress) => void
): Promise<{ success: boolean; error?: string }> {
  const env = await checkEnvironment()

  if (!env.node.available) {
    onProgress({ stage: 'downloading', message: '正在下载 Node.js...' })
    await installNodeJs()
    onProgress({ stage: 'installing', message: '正在安装 Node.js...' })
  }

  if (!env.git.available) {
    onProgress({ stage: 'downloading', message: '正在下载 Git...' })
    await installGit()
    onProgress({ stage: 'installing', message: '正在安装 Git...' })
  }

  onProgress({ stage: 'downloading', message: '正在安装 Claude Code CLI...' })
  await execCommand('npm install -g @anthropic-ai/claude-code')

  onProgress({ stage: 'verifying', message: '正在验证安装...' })
  const detection = await detectInstalledCli()

  if (detection.available) {
    onProgress({ stage: 'done', message: '安装完成！' })
    return { success: true }
  }

  return { success: false, error: '安装后未检测到 CLI' }
}
```

### 各平台安装策略

| 依赖 | Windows | macOS | Linux |
|------|---------|-------|-------|
| **Node.js** | `winget install OpenJS.NodeJS.LTS` | `brew install node@lts` | `curl -fsSL https://deb.nodesource.com/setup_lts.x \| sudo -E bash -` |
| **Git** | `winget install Git.Git` | `brew install git` | `sudo apt install git` |
| **claude-code** | `npm install -g @anthropic-ai/claude-code` | 同左 | 同左 |

降级策略：如果 `winget`/`brew` 不可用，则打开官方下载页面让用户手动下载。

### IPC 通道

| 通道 | 方向 | 用途 |
|------|------|------|
| `claude-code:detectInstalledCli` | Renderer → Main | 检测 CLI |
| `claude-code:checkEnvironment` | Renderer → Main | 检查运行环境 |
| `claude-code:installCli` | Renderer → Main | 一键安装 |
| `claude-code:installProgress` | Main → Renderer | 安装进度通知 |

---

## 六、API 转换桥（Proxy 子进程）

### 6.1 代理工作原理

```
Claude Code CLI (官网版)
    │ POST /v1/messages
    │ { model: "claude-sonnet-4-20250514", messages: [...], stream: true }
    ▼
┌─────────────────────────────────────────────────────┐
│  Proxy (localhost:34567)                             │
│                                                     │
│  ① ModelMapper: "claude-sonnet-4-20250514[1M]"     │
│     → 剥离 [1M] → "claude-sonnet-4-20250514"       │
│     → 映射为用户配置的模型 → "gpt-4o"               │
│                                                     │
│  ② Transformer (请求): Anthropic → OpenAI           │
│     system 字段 → system message                    │
│     content 数组 → string / multimodal              │
│     tool_use → tool_calls                           │
│     tool_result → tool message                      │
│                                                     │
│  ③ AuthHandler: 注入上游认证头                       │
│     x-api-key → Authorization: Bearer xxx           │
│                                                     │
│  ④ 转发到上游: POST https://api.openai.com/v1/      │
│     chat/completions                                 │
│                                                     │
│  ⑤ StreamingTransformer (响应): OpenAI SSE →        │
│     Anthropic SSE                                   │
│     chat.completion.chunk → content_block_delta      │
│     finish_reason: "stop" → stop_reason: "end_turn" │
│     [DONE] → message_stop                           │
└─────────────────────────────────────────────────────┘
```

### 6.2 代理子进程入口（proxy/index.ts）

代理作为独立 Node.js 子进程运行，通过 stdin/stdout 与主进程通信（JSONL 协议），同时启动 HTTP 服务器监听本地端口。

```typescript
interface ProxyConfig {
  host: string              // 默认 '127.0.0.1'
  port: number              // 默认 34567
  upstreamProvider: 'openai' | 'openai_compatible' | 'anthropic'
  upstreamBaseUrl: string
  upstreamApiKey: string
  modelMapping: {
    defaultModel?: string
    haikuModel?: string
    sonnetModel?: string
    opusModel?: string
  }
}
```

启动方式: `node proxy/index.ts --port 34567 --config <base64-encoded-json>`

启动流程:
1. 解析命令行参数获取 ProxyConfig
2. 创建 HTTP 服务器
3. 注册路由处理器
4. 开始监听
5. 通过 stdout 通知主进程就绪: `{ "type": "ready", "port": 34567 }`

### 6.3 SSE 解析器（sseParser.ts）

```typescript
interface SSEEvent {
  event: string | null
  data: string
  id?: string
  retry?: number
}

class SSEParser {
  private buffer = ''

  feed(chunk: string): SSEEvent[] {
    this.buffer += chunk
    const events: SSEEvent[] = []

    while (true) {
      const eventEnd = this.buffer.indexOf('\n\n')
      if (eventEnd === -1) break

      const rawEvent = this.buffer.slice(0, eventEnd)
      this.buffer = this.buffer.slice(eventEnd + 2)

      const event = this.parseSingleEvent(rawEvent)
      if (event) events.push(event)
    }

    return events
  }

  private parseSingleEvent(raw: string): SSEEvent | null {
    let event: string | null = null
    let data = ''

    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice(5).trim()
      }
    }

    if (!data) return null
    if (data === '[DONE]') return { event: 'done', data: '[DONE]' }

    return { event, data }
  }
}
```

### 6.4 请求转换（transformer.ts — Anthropic → OpenAI）

核心转换函数：

```typescript
function anthropicToOpenAI(anthropicReq: AnthropicMessagesRequest): OpenAIChatRequest {
  const result: OpenAIChatRequest = {
    model: anthropicReq.model,
    stream: anthropicReq.stream ?? false,
    messages: [],
  }

  // ① system → system message
  if (anthropicReq.system) {
    const systemContent = typeof anthropicReq.system === 'string'
      ? anthropicReq.system
      : anthropicReq.system.map(b => b.text).join('\n')
    result.messages.push({ role: 'system', content: systemContent })
  }

  // ② 逐条转换 messages
  for (const msg of anthropicReq.messages) {
    result.messages.push(convertMessage(msg))
  }

  // ③ tools → function tools
  if (anthropicReq.tools?.length) {
    result.tools = anthropicReq.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      }
    }))
  }

  // ④ tool_choice 映射
  if (anthropicReq.tool_choice) {
    result.tool_choice = convertToolChoice(anthropicReq.tool_choice)
  }

  // ⑤ 参数映射
  if (anthropicReq.max_tokens) result.max_tokens = anthropicReq.max_tokens
  if (anthropicReq.temperature !== undefined) result.temperature = anthropicReq.temperature
  if (anthropicReq.top_p !== undefined) result.top_p = anthropicReq.top_p
  if (anthropicReq.stop_sequences) result.stop = anthropicReq.stop_sequences

  return result
}
```

关键转换点 — tool_use / tool_result：

```typescript
// Anthropic assistant tool_use → OpenAI tool_calls
function convertAssistantMessage(msg: AnthropicMessage): OpenAIMessage {
  const content = msg.content
  const textParts = content.filter(b => b.type === 'text')
  const toolUseParts = content.filter(b => b.type === 'tool_use')
  const thinkingParts = content.filter(b => b.type === 'thinking')

  // thinking block: 丢弃（大多数上游不支持）

  const result: OpenAIMessage = { role: 'assistant' }
  result.content = textParts.map(b => b.text).join('') || null

  if (toolUseParts.length > 0) {
    result.tool_calls = toolUseParts.map((t, index) => ({
      id: `call_${t.id}`,
      type: 'function',
      index,
      function: {
        name: t.name,
        arguments: typeof t.input === 'string' ? t.input : JSON.stringify(t.input),
      }
    }))
  }

  return result
}

// Anthropic user tool_result → OpenAI tool message
function convertToolResult(toolResult: ToolResultBlock): OpenAIMessage {
  let content: string
  if (typeof toolResult.content === 'string') {
    content = toolResult.content
  } else {
    content = toolResult.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
  }

  return {
    role: 'tool',
    tool_call_id: `call_${toolResult.tool_use_id}`,
    content,
  }
}
```

### 6.5 流式响应转换（streamingTransformer.ts — OpenAI SSE → Anthropic SSE）

```typescript
enum StreamPhase {
  Init,
  MessageStarted,
  TextBlockOpen,
  ToolUseBlockOpen,
  Finished,
}

class OpenAIToAnthropicStreamTransformer {
  private phase = StreamPhase.Init
  private contentBlockIndex = 0
  private currentToolId: string | null = null
  private currentToolName: string | null = null
  private model: string

  transform(chunk: OpenAIStreamChunk): AnthropicSSEEvent[] {
    const events: AnthropicSSEEvent[] = []
    const choice = chunk.choices?.[0]
    if (!choice) return events

    switch (this.phase) {
      case StreamPhase.Init: {
        this.model = chunk.model || 'claude-sonnet-4-20250514'
        events.push(this.messageStart())

        if (choice.delta?.role === 'assistant' && !choice.delta.content && !choice.delta.tool_calls) {
          this.phase = StreamPhase.MessageStarted
          break
        }
        this.phase = StreamPhase.MessageStarted
      }

      case StreamPhase.MessageStarted: {
        if (choice.delta?.content) {
          if (this.phase !== StreamPhase.TextBlockOpen) {
            events.push(this.textBlockStart(this.contentBlockIndex))
            this.phase = StreamPhase.TextBlockOpen
          }
          events.push(this.textDelta(this.contentBlockIndex, choice.delta.content))
        }

        if (choice.delta?.tool_calls) {
          if (this.phase === StreamPhase.TextBlockOpen) {
            events.push(this.contentBlockStop(this.contentBlockIndex))
            this.contentBlockIndex++
          }

          for (const tc of choice.delta.tool_calls) {
            if (tc.function?.name) {
              this.currentToolId = tc.id || `toolu_${generateId()}`
              this.currentToolName = tc.function.name
              events.push(this.toolUseBlockStart(this.contentBlockIndex, this.currentToolId, this.currentToolName))
              this.phase = StreamPhase.ToolUseBlockOpen
            }
            if (tc.function?.arguments) {
              events.push(this.inputJsonDelta(this.contentBlockIndex, tc.function.arguments))
            }
          }
        }

        if (choice.finish_reason) {
          if (this.phase === StreamPhase.TextBlockOpen || this.phase === StreamPhase.ToolUseBlockOpen) {
            events.push(this.contentBlockStop(this.contentBlockIndex))
          }
          events.push(this.messageDelta(choice.finish_reason))
          events.push(this.messageStop())
          this.phase = StreamPhase.Finished
        }
        break
      }
    }

    return events
  }
}
```

### 6.6 认证处理（authHandler.ts）

| Provider | 认证头 | 特殊头 |
|----------|--------|--------|
| OpenAI | `Authorization: Bearer <key>` | 无 |
| DeepSeek | `Authorization: Bearer <key>` | 无 |
| OpenRouter | `Authorization: Bearer <key>` | `HTTP-Referer`, `X-Title` |
| Azure OpenAI | `api-key: <key>` | URL 格式不同 |
| Anthropic (直连) | `x-api-key: <key>` | `anthropic-version` |

### 6.7 代理进程管理（proxyManager.ts）

```typescript
class ProxyManager {
  private process: ChildProcess | null = null
  private config: ProxyConfig | null = null
  private healthCheckInterval: NodeJS.Timer | null = null

  async start(config: ProxyConfig): Promise<string> {
    if (this.process) await this.stop()

    this.config = config

    const proxyScript = path.join(__dirname, 'proxy', 'index.js')
    this.process = spawn(process.execPath, [
      proxyScript,
      '--port', String(config.port),
      '--config', Buffer.from(JSON.stringify(config)).toString('base64'),
    ], {
      env: { ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Proxy start timeout')), 10000)

      this.process!.stdout!.on('data', (data) => {
        const msg = data.toString().trim()
        try {
          const parsed = JSON.parse(msg)
          if (parsed.type === 'ready') {
            clearTimeout(timeout)
            this.startHealthCheck()
            resolve(`http://${config.host}:${config.port}`)
          }
        } catch {}
      })

      this.process!.on('exit', (code) => {
        clearTimeout(timeout)
        if (code !== 0) reject(new Error(`Proxy exited with code ${code}`))
      })
    })
  }

  async stop(): Promise<void> {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval)
    if (this.process) {
      this.process.kill('SIGTERM')
      setTimeout(() => this.process?.kill('SIGKILL'), 5000)
      this.process = null
    }
  }

  private startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const res = await fetch(`http://${this.config!.host}:${this.config!.port}/health`)
        if (!res.ok) this.emit('unhealthy')
      } catch {
        this.emit('unhealthy')
        if (this.config) await this.start(this.config)
      }
    }, 30000)
  }
}
```

### 6.8 与 SessionProcess 的集成点

```typescript
// sessionProcess.ts 修改
private resolveCliCommand() {
  // 新增: 如果是官网模式，使用检测到的 CLI 路径
  if (this.config.engineSource === 'installed') {
    const cliPath = this.config.installedCliPath
    if (cliPath) {
      return { command: cliPath, args: [] }
    }
  }
  // ... 原有的内置模式逻辑 ...
}

private buildEnv(config: SessionConfig): Record<string, string> {
  const env = { /* 现有环境变量构建逻辑 */ }

  // 新增: 如果使用官网模式 + 非 Anthropic API，注入代理 URL
  if (config.engineSource === 'installed' && config.provider !== 'anthropic_compatible') {
    const proxyUrl = proxyManager.getProxyUrl()
    if (proxyUrl) {
      env.ANTHROPIC_BASE_URL = proxyUrl
      delete env.ANTHROPIC_API_KEY
      delete env.OPENAI_API_KEY
    }
  }

  return env
}
```

---

## 七、前端设置界面

### 7.1 设置 Store 扩展（settings.ts）

```typescript
export type EngineSource = 'bundled' | 'installed'

export interface AuthSettings {
  // ... 现有字段 ...
  engineSource?: EngineSource
  installedCliPath?: string
}
```

### 7.2 EngineSourceSettings.vue

此组件嵌入到 GeneralSettings.vue 的引擎选择区域下方，当用户选择 claude-code 引擎时显示。

包含以下区域：
- 引擎来源选择（内置/官网 单选）
- CLI 检测状态（已安装/未安装 + 版本和路径）
- 环境检查（Node.js/npm/Git 状态）
- 一键安装按钮 + 安装进度
- API 适配器状态（官网模式 + 非 Anthropic API 时显示）

### 7.3 完整数据流

**场景 A：内置模式（默认，无变化）**

```
前端 → settings.engineSource = 'bundled'
     → SessionProcess.resolveCliCommand() → 使用 engine/ 目录的 CLI
     → buildEnv() → 注入现有环境变量
     → CLI 直接连接上游 API
```

**场景 B：官网模式 + Anthropic API（无需代理）**

```
前端 → settings.engineSource = 'installed'
     → cliDetector.detectInstalledCli() → 获取 CLI 路径
     → SessionProcess.resolveCliCommand() → 使用检测到的 CLI 路径
     → buildEnv() → 注入 ANTHROPIC_API_KEY（直连）
     → CLI 直接连接 Anthropic API
```

**场景 C：官网模式 + OpenAI 兼容 API（需要代理）**

```
前端 → settings.engineSource = 'installed'
     → settings.authMethod = 'openai_compatible'
     → cliDetector.detectInstalledCli() → 获取 CLI 路径
     → proxyManager.start(config) → 启动代理子进程
     → SessionProcess.resolveCliCommand() → 使用检测到的 CLI 路径
     → buildEnv() → ANTHROPIC_BASE_URL=http://127.0.0.1:34567
     → CLI 发送 Anthropic 格式请求到本地代理
     → 代理转换 + 转发到上游 OpenAI 兼容 API
     → 代理转换响应 + 返回给 CLI
```

### 7.4 生命周期管理

```
应用启动
  ├── engineSource === 'installed' && authMethod !== 'anthropic_compatible'
  │   → proxyManager.start()
  └── 其他情况 → 不启动代理

切换引擎来源
  ├── bundled → installed
  │   → cliDetector.detectInstalledCli()
  │   → 如果需要代理 → proxyManager.start()
  └── installed → bundled
      → proxyManager.stop()

切换 API 类型
  ├── anthropic → openai
  │   → 如果 engineSource === 'installed' → proxyManager.start()
  └── openai → anthropic
      → proxyManager.stop()

应用退出
  → proxyManager.stop()
```

---

## 八、错误处理

| 场景 | 处理方式 |
|------|---------|
| CLI 未安装 | 显示检测状态 + 安装引导 |
| 代理启动失败 | 自动重试 1 次，仍失败则回退到内置模式并提示用户 |
| 代理运行中崩溃 | 健康检查检测到后自动重启，通知前端状态变更 |
| 上游 API 返回错误 | 代理透传错误响应，前端按现有逻辑处理 |
| 安装 Node.js/Git 失败 | 降级为打开下载页面，提示用户手动安装 |

---

## 九、参考资源

1. **cc-switch** - https://github.com/farion1231/cc-switch — 完整代理实现参考
2. **CCProxy** - https://ccproxy.orchestre.dev/ — Claude Code API 代理参考
3. **Anthropic API** - https://docs.anthropic.com/
4. **OpenAI API** - https://platform.openai.com/docs/api-reference/
5. **现有方案文档** - `docs/CLAUDE_CODE_ENGINE_SWITCH_PLAN.md`
