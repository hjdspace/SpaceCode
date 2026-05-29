# Claude Code CLI 引擎切换方案

## 一、背景与目标

### 当前实现
当前前端使用的是内置的 Claude Code 源码版本，通过以下流程启动：
1. `settings.ts` 存储 `engineType` 配置
2. 前端调用 `electronAPI.claudeCode.startSession()`
3. IPC handler 转发到 `EngineFactory`
4. `ClaudeCodeEngine` → `ClaudeCodeProcessPool` → `SessionProcess`
5. `resolveCliCommand()` 解析 CLI 路径并 spawn 进程

### 目标
允许用户在以下两种模式间切换：
1. **内置模式（当前默认）**：使用打包的 engine 源码，支持 OpenAI 兼容 API
2. **官网模式（新功能）**：使用用户本地安装的 Claude Code CLI + API Adapter 层

### 核心挑战
官网 Claude Code CLI **原生不支持 OpenAI 兼容 API**，但内置版本源码支持。因此需要实现一个 **API Adapter（代理层）** 来进行协议转换。

---

## 二、架构分析

### 2.1 关键文件及职责

| 文件路径 | 职责 |
|---------|------|
| `src/stores/settings.ts` | 存储引擎类型配置 |
| `electron/claudeCodeIPC.ts` | IPC 通信层 |
| `electron/engines/EngineFactory.ts` | 引擎工厂 |
| `electron/engines/ClaudeCodeEngine.ts` | Claude Code 引擎封装 |
| `electron/claudeCodeProcessPool.ts` | 进程池管理 |
| `electron/sessionProcess.ts` | **核心：进程 spawn 和 CLI 解析** |
| `electron/claudeCodeProcessManager.ts` | CLI 命令解析（备用） |
| `electron/apiAdapter.ts` | **新增：API 协议转换适配器** |

### 2.2 核心逻辑位置
**`electron/sessionProcess.ts` 的 `resolveCliCommand()` 方法**（第 991-1062 行）是关键：

```typescript
private resolveCliCommand(): { command: string; args: string[]; launcherEnv?: Record<string, string> } {
  const isDev = !app.isPackaged

  if (isDev) {
    // 开发模式：使用 engine 源码
  }

  // 生产模式：优先使用构建产物
  const desktopCli = path.join(this.cliRoot, 'dist-desktop/cli.js')
  if (fs.existsSync(desktopCli)) {
    // 使用打包的 CLI
  }

  // 回退到全局 claude 命令
  return { command: 'claude', args: [] }
}
```

### 2.3 开源项目参考

#### cc-switch 项目分析
[cc-switch](https://github.com/farion1231/cc-switch) 是一个成熟的 AI CLI 管理工具，提供了完整的代理实现参考。其 proxy 模块包含：

| 核心文件 | 职责 |
|---------|------|
| `model_mapper.rs` | 模型名称映射（Haiku/Sonnet/Opus → 自定义模型） |
| `handlers.rs` | HTTP 请求处理器 |
| `request_rectifier.rs` | 请求修正/规范化 |
| `response_processor.rs` | 响应处理 |
| `circuit_breaker.rs` | 断路器模式 |
| `failover_switch.rs` | 故障转移切换 |
| `provider_router.rs` | Provider 路由选择 |

#### CCProxy 项目分析
[CCProxy](https://ccproxy.orchestre.dev/) 专门为 Claude Code 设计，提供了格式转换的参考实现：

- **格式转换**：OpenAI ↔ Anthropic ↔ Gemini
- **流式支持**：SSE (Server-Sent Events)
- **Provider 支持**：OpenAI、Gemini、DeepSeek、OpenRouter

---

## 三、问题分析：内置 vs 官网版本的 API 差异

### 3.1 API 协议对比

| 特性 | 内置版本源码 | 官网 Claude Code CLI |
|------|-------------|---------------------|
| **OpenAI 兼容 API** | ✅ 原生支持 | ❌ 不支持 |
| **Anthropic API** | ✅ 原生支持 | ✅ 原生支持 |
| **请求格式** | 支持 stream-json | 仅支持 stream-json |
| **响应格式** | Anthropic 格式 | Anthropic 格式 |
| **会话存储** | 内置配置目录 | `~/.claude` |
| **Tool Calling** | ✅ 支持 | ✅ 支持 |
| **MCP 支持** | ✅ 支持 | ✅ 支持 |

### 3.2 需要解决的问题

**问题 1：官网 CLI 不识别 OpenAI 兼容 API**
- 内置版本：支持 `--api-provider openai` 参数
- 官网版本：仅支持 `--api-provider anthropic`

**问题 2：模型名称不匹配**
- 内置版本：支持 `openai/gpt-4` 等模型名称
- 官网版本：仅识别 Claude 系列模型

**问题 3：参数格式差异**
- OpenAI API 使用 `/v1/chat/completions`
- Anthropic API 使用 `/v1/messages`

---

## 四、实现方案

### 方案概述

采用 **本地代理模式**（参考 cc-switch 的 Proxy 架构）：

```
┌─────────────────────────────────────────────────────────────┐
│                     前端应用                                 │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │  内置模式    │    │  官网模式    │                        │
│  │  engine.ts  │    │  CLI + Proxy│                        │
│  └─────────────┘    └──────┬──────┘                        │
│         │                  │                                │
└─────────┼──────────────────┼────────────────────────────────┘
          │                  │
          ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   API Provider (用户配置)                    │
│  - Anthropic API (原生)                                     │
│  - OpenAI 兼容 API (需要转换)                                │
│  - 其他兼容 API (需要转换)                                    │
└─────────────────────────────────────────────────────────────┘
```

**核心思路**：
1. 当用户使用「官网模式 + OpenAI 兼容 API」时，启动本地代理服务器
2. 代理服务器接收 OpenAI 格式请求，转换为 Anthropic 格式
3. Claude Code CLI 通过 `ANTHROPIC_BASE_URL` 指向本地代理

### 4.1 架构设计

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Electron 主进程                               │
│                                                                      │
│  ┌────────────────────┐         ┌──────────────────────────────┐    │
│  │   API Adapter      │         │   SessionProcess             │    │
│  │   (apiAdapter.ts)  │◄────────│   (CLI spawn & 管理)        │    │
│  └────────┬───────────┘         └──────────────────────────────┘    │
│           │                                                          │
│           │ 启动本地 HTTP 服务器                                        │
│           │ (端口: 34567)                                            │
│           ▼                                                          │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                    API Adapter Server                        │    │
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐  │    │
│  │  │ Request      │  │ Response      │  │ Model          │  │    │
│  │  │ Rectifier    │──│ Processor     │──│ Mapper         │  │    │
│  │  │ (请求修正)    │  │ (响应处理)     │  │ (模型映射)      │  │    │
│  │  └──────────────┘  └───────────────┘  └────────────────┘  │    │
│  └────────────────────────────────────────────────────────────┘    │
│           │                                                          │
└───────────┼──────────────────────────────────────────────────────────┘
            │
            │ HTTP (OpenAI 格式)
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Claude Code CLI (官网版)                         │
│  - 通过 ANTHROPIC_BASE_URL=http://localhost:34567 连接                │
│  - 发送 Anthropic 格式请求                                            │
└──────────────────────────────────────────────────────────────────────┘
            │
            │ HTTP (Anthropic/转换后的格式)
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      用户配置的 API Provider                          │
│  - Anthropic API                                                    │
│  - OpenAI 兼容 API                                                   │
│  - Azure OpenAI                                                     │
│  - 其他兼容 API                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 详细实现

#### 4.2.1 API Adapter 类型定义

**新增文件：`electron/apiAdapter/types.ts`**

```typescript
/**
 * API 适配器类型定义
 */

export interface ApiAdapterConfig {
  // 适配器服务器配置
  enabled: boolean
  port: number
  host: string

  // 用户配置的 API 端点
  apiProvider: ApiProvider
  apiKey: string
  baseUrl: string

  // 模型映射配置
  modelMapping?: ModelMappingConfig
}

export type ApiProvider = 'anthropic' | 'openai' | 'azure' | 'openrouter' | 'other'

export interface ModelMappingConfig {
  defaultModel?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

/**
 * 模型映射结果
 */
export interface ModelMappingResult {
  originalModel: string | null
  mappedModel: string | null
  provider: string
}

/**
 * 请求上下文
 */
export interface RequestContext {
  appType: 'claude-code' | 'claude-desktop'
  provider: ApiProvider
  requestModel: string
  sessionId?: string
  timestamp: number
}

/**
 * 适配器状态
 */
export interface AdapterStatus {
  running: boolean
  port: number
  requestsProcessed: number
  errorsCount: number
  lastError?: string
}
```

#### 4.2.2 API Adapter 核心实现

**新增文件：`electron/apiAdapter/server.ts`**

```typescript
/**
 * API Adapter HTTP 服务器
 * 
 * 参考 cc-switch 的 proxy/server.rs 实现
 */

import * as http from 'http'
import { URL } from 'url'
import { AdapterStatus, ApiAdapterConfig, ModelMappingResult } from './types'
import { transformOpenAIRequest, transformAnthropicResponse } from './transformer'
import { mapModel, stripOneMSuffix } from './modelMapper'
import { logForDebugging } from '../logger'

export class ApiAdapterServer {
  private server: http.Server | null = null
  private config: ApiAdapterConfig
  private status: AdapterStatus
  private requestCount = 0

  constructor(config: ApiAdapterConfig) {
    this.config = config
    this.status = {
      running: false,
      port: config.port,
      requestsProcessed: 0,
      errorsCount: 0,
    }
  }

  /**
   * 启动适配器服务器
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error('Adapter server already running')
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res)
        } catch (error) {
          this.status.errorsCount++
          this.status.lastError = String(error)
          logForDebugging('[ApiAdapter] Request error:', error)
          this.sendError(res, 500, 'Internal Server Error')
        }
      })

      this.server.on('error', (error) => {
        this.status.running = false
        reject(error)
      })

      this.server.listen(this.config.port, this.config.host, () => {
        this.status.running = true
        logForDebugging(`[ApiAdapter] Server started on ${this.config.host}:${this.config.port}`)
        resolve()
      })
    })
  }

  /**
   * 停止适配器服务器
   */
  async stop(): Promise<void> {
    if (!this.server) {
      return
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null
        this.status.running = false
        logForDebugging('[ApiAdapter] Server stopped')
        resolve()
      })
    })
  }

  /**
   * 获取适配器状态
   */
  getStatus(): AdapterStatus {
    return { ...this.status }
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.requestCount++
    const startTime = Date.now()

    // 解析 URL
    const url = new URL(req.url || '/', `http://${this.config.host}:${this.config.port}`)
    const pathname = url.pathname

    // 记录请求
    logForDebugging(`[ApiAdapter] ${req.method} ${pathname}`)

    // CORS 头
    this.setCorsHeaders(res)

    // 健康检查端点
    if (pathname === '/health') {
      this.sendJson(res, { status: 'healthy', timestamp: new Date().toISOString() })
      return
    }

    // 状态端点
    if (pathname === '/status') {
      this.sendJson(res, this.status)
      return
    }

    // 读取请求体
    const body = await this.readBody(req)

    try {
      // 根据端点路由
      if (pathname === '/v1/messages' || pathname === '/v1/messages/stream') {
        await this.handleMessages(req, res, body, pathname.includes('stream'))
      } else if (pathname === '/v1/chat/completions') {
        await this.handleChatCompletions(req, res, body)
      } else if (pathname.startsWith('/v1/models')) {
        await this.handleModels(req, res)
      } else {
        this.sendError(res, 404, 'Not Found')
      }

      this.status.requestsProcessed++
    } catch (error) {
      this.status.errorsCount++
      this.status.lastError = String(error)
      logForDebugging(`[ApiAdapter] Error handling request:`, error)
      this.sendError(res, 500, String(error))
    }
  }

  /**
   * 处理 /v1/messages 请求（Anthropic 格式）
   */
  private async handleMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string,
    isStream: boolean
  ): Promise<void> {
    // 如果是 OpenAI 兼容模式，需要转换
    if (this.config.apiProvider === 'openai' || this.config.apiProvider === 'other') {
      return this.handleOpenAIProxy(req, res, body, isStream)
    }

    // Anthropic 原生模式：直接透传
    await this.forwardRequest(req, res, body)
  }

  /**
   * 处理 /v1/chat/completions 请求（OpenAI 格式）
   * 需要转换为 Anthropic 格式
   */
  private async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string
  ): Promise<void> {
    // OpenAI → Anthropic 转换
    const transformed = transformOpenAIRequest(body, this.config.modelMapping)

    // 添加 streaming 头（Claude Code 需要 stream-json 格式）
    const headers = {
      ...this.getBaseHeaders(),
      'Content-Type': 'application/json',
    }

    // 转发到上游 API
    await this.forwardWithBody(req, res, transformed, headers)
  }

  /**
   * 处理 OpenAI 兼容 API 的代理请求
   */
  private async handleOpenAIProxy(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string,
    isStream: boolean
  ): Promise<void> {
    // 1. 转换请求格式
    const transformed = transformOpenAIRequest(body, this.config.modelMapping)

    // 2. 确定目标端点
    const targetPath = isStream ? '/v1/messages' : '/v1/messages'
    const targetUrl = new URL(targetPath, this.config.baseUrl)

    // 3. 构建请求头
    const headers = {
      ...this.getBaseHeaders(),
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
    }

    // 4. 转发请求
    const upstreamResponse = await this.fetch(targetUrl.toString(), {
      method: 'POST',
      headers,
      body: transformed,
    })

    // 5. 处理响应
    if (isStream) {
      // 流式响应：直接转发 SSE
      this.forwardStream(res, upstreamResponse)
    } else {
      // 非流式响应：可能需要转换
      const responseBody = await this.readBodyFromResponse(upstreamResponse)
      
      // 如果需要格式转换
      if (this.needsResponseTransform()) {
        const transformedResponse = transformAnthropicResponse(responseBody)
        this.sendJson(res, transformedResponse)
      } else {
        this.forwardResponse(res, upstreamResponse, responseBody)
      }
    }
  }

  /**
   * 处理 /v1/models 请求
   */
  private async handleModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 返回兼容的模型列表
    const models = this.getCompatibleModels()
    this.sendJson(res, models)
  }

  /**
   * 转发请求到上游 API
   */
  private async forwardRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string
  ): Promise<void> {
    const targetUrl = new URL(req.url || '/', this.config.baseUrl)
    const headers = this.getBaseHeaders()
    
    // 添加必要的认证头
    if (this.config.apiProvider === 'anthropic') {
      headers['x-api-key'] = this.config.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    }

    await this.forwardWithBody(req, res, body, headers)
  }

  /**
   * 带请求体转发
   */
  private async forwardWithBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string,
    headers: Record<string, string>
  ): Promise<void> {
    const targetUrl = new URL(req.url || '/', this.config.baseUrl)

    try {
      const response = await this.fetch(targetUrl.toString(), {
        method: 'POST',
        headers,
        body,
      })

      const responseBody = await this.readBodyFromResponse(response)

      // 转发响应头
      this.forwardResponse(res, response, responseBody)
    } catch (error) {
      logForDebugging('[ApiAdapter] Forward error:', error)
      this.sendError(res, 502, `Upstream error: ${error}`)
    }
  }

  /**
   * 获取基础请求头
   */
  private getBaseHeaders(): Record<string, string> {
    return {
      'User-Agent': 'Claude-Desktop/1.0',
      'Accept': '*/*',
    }
  }

  /**
   * 是否需要响应转换
   */
  private needsResponseTransform(): boolean {
    return this.config.apiProvider !== 'anthropic'
  }

  /**
   * 获取兼容的模型列表
   */
  private getCompatibleModels(): any {
    return {
      object: 'list',
      data: [
        { id: 'claude-sonnet-4-20250514', object: 'model', created: 1715728400, permission: [], root: 'claude-sonnet-4-20250514' },
        { id: 'claude-opus-4-20250514', object: 'model', created: 1715728400, permission: [], root: 'claude-opus-4-20250514' },
        { id: 'claude-haiku-3-20250514', object: 'model', created: 1715728400, permission: [], root: 'claude-haiku-3-20250514' },
      ]
    }
  }

  // ==================== HTTP 工具方法 ====================

  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => resolve(body))
      req.on('error', reject)
    })
  }

  private async readBodyFromResponse(res: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve(body))
      res.on('error', reject)
    })
  }

  private async fetch(url: string, options: http.RequestOptions): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      const req = http.request(url, options, resolve)
      req.on('error', reject)
      if (options.body) {
        req.write(options.body)
      }
      req.end()
    })
  }

  private setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', '*')
  }

  private sendJson(res: http.ServerResponse, data: any, statusCode = 200): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  private sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message, type: 'api_error' } }))
  }

  private forwardResponse(
    res: http.ServerResponse,
    upstream: http.IncomingMessage,
    body: string
  ): void {
    // 复制响应头
    Object.entries(upstream.headers).forEach(([key, value]) => {
      if (value) {
        res.setHeader(key, value)
      }
    })

    res.writeHead(upstream.statusCode || 200)
    res.end(body)
  }

  private forwardStream(res: http.ServerResponse, upstream: http.IncomingMessage): void {
    // 复制响应头
    Object.entries(upstream.headers).forEach(([key, value]) => {
      if (value) {
        res.setHeader(key, value)
      }
    })

    res.writeHead(upstream.statusCode || 200)
    upstream.pipe(res)
  }
}
```

#### 4.2.3 请求转换器

**新增文件：`electron/apiAdapter/transformer.ts`**

```typescript
/**
 * API 请求和响应转换器
 * 
 * 参考 cc-switch 的 transform 模块实现
 */

import { ModelMappingConfig } from './types'

/**
 * OpenAI Chat Completions 请求 → Anthropic Messages 请求
 */
export function transformOpenAIRequest(
  openaiRequest: string,
  modelMapping?: ModelMappingConfig
): string {
  const request = JSON.parse(openaiRequest)

  // 提取模型名并应用映射
  let model = request.model || 'claude-sonnet-4-20250514'
  if (modelMapping) {
    model = mapModel(model, modelMapping)
  }

  // 去除 1M 后缀（Claude Code 本地标记）
  model = stripOneMSuffix(model)

  // 提取消息
  const messages = request.messages || []

  // 构建 Anthropic 格式
  const anthropicRequest: any = {
    model,
    max_tokens: request.max_tokens || 4096,
    stream: request.stream || false,
  }

  // 处理 system prompt
  const systemMessages = messages.filter((m: any) => m.role === 'system')
  if (systemMessages.length > 0) {
    anthropicRequest.system = systemMessages.map((m: any) => m.content).join('\n')
  }

  // 处理 conversation messages
  const conversationMessages = messages.filter((m: any) => m.role !== 'system')
  anthropicRequest.messages = conversationMessages.map((m: any) => {
    // 处理 content 格式
    let content = m.content
    if (typeof content === 'string') {
      // 文本内容
      return { role: m.role, content }
    } else if (Array.isArray(content)) {
      // 多模态内容（图像等）
      const textParts = content.filter((c: any) => c.type === 'text')
      const imageParts = content.filter((c: any) => c.type === 'image_url')
      
      if (imageParts.length > 0) {
        // Anthropic 的图像格式
        const anthropicContent: any[] = []
        
        imageParts.forEach((img: any) => {
          const base64 = img.image_url?.url?.split(',')[1]
          if (base64) {
            anthropicContent.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.image_url?.detail === 'low' ? 'image/jpeg' : 'image/jpeg',
                data: base64,
              }
            })
          }
        })
        
        textParts.forEach((txt: any) => {
          anthropicContent.push({ type: 'text', text: txt.text })
        })
        
        return { role: m.role, content: anthropicContent }
      }
    }
    
    return { role: m.role, content: String(content) }
  })

  // 处理 tool_use（如果支持）
  if (request.tools && request.tools.length > 0) {
    anthropicRequest.tools = request.tools.map((tool: any) => ({
      name: tool.function?.name || tool.name,
      description: tool.function?.description || tool.description,
      input_schema: tool.function?.parameters || tool.input_schema,
    }))
  }

  // 处理 tool_choice
  if (request.tool_choice) {
    if (request.tool_choice === 'auto') {
      anthropicRequest.tool_choice = { type: 'auto' }
    } else if (typeof request.tool_choice === 'object') {
      anthropicRequest.tool_choice = {
        type: 'tool',
        name: request.tool_choice.function?.name || request.tool_choice.name,
      }
    }
  }

  // 处理 temperature
  if (request.temperature !== undefined) {
    anthropicRequest.temperature = request.temperature
  }

  // 处理 top_p
  if (request.top_p !== undefined) {
    anthropicRequest.top_p = request.top_p
  }

  return JSON.stringify(anthropicRequest)
}

/**
 * Anthropic 响应 → OpenAI 格式响应
 */
export function transformAnthropicResponse(anthropicResponse: string): string {
  const response = JSON.parse(anthropicResponse)

  // 检查是否是错误响应
  if (response.error) {
    return JSON.stringify({
      error: {
        message: response.error.message,
        type: 'api_error',
        code: response.error.type,
      }
    })
  }

  // 处理流式响应
  if (response.type === 'message_start' || response.type === 'content_block_start') {
    return transformAnthropicStreamEvent(response)
  }

  // 非流式响应转换
  const openaiResponse: any = {
    id: `chatcmpl-${generateId()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: extractTextContent(response.content),
        },
        finish_reason: mapStopReason(response.stop_reason),
      }
    ],
    usage: {
      prompt_tokens: response.usage?.input_tokens || 0,
      completion_tokens: response.usage?.output_tokens || 0,
      total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    }
  }

  return JSON.stringify(openaiResponse)
}

/**
 * Anthropic 流式事件 → OpenAI 格式
 */
export function transformAnthropicStreamEvent(event: any): string {
  switch (event.type) {
    case 'message_start':
      return JSON.stringify({
        id: `chatcmpl-${generateId()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: event.message.model,
        choices: [{
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null,
        }]
      })

    case 'content_block_start':
      if (event.content_block.type === 'text') {
        return JSON.stringify({
          id: `chatcmpl-${generateId()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: event.model,
          choices: [{
            index: 0,
            delta: { content: '' },
            finish_reason: null,
          }]
        })
      } else if (event.content_block.type === 'tool_use') {
        return JSON.stringify({
          id: `chatcmpl-${generateId()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: event.model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: event.index,
                id: `call_${generateId()}`,
                type: 'function',
                function: {
                  name: event.content_block.name,
                  arguments: '',
                }
              }]
            },
            finish_reason: null,
          }]
        })
      }
      return ''

    case 'content_block_delta':
      if (event.delta.type === 'text_delta') {
        return JSON.stringify({
          id: `chatcmpl-${generateId()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: event.model,
          choices: [{
            index: 0,
            delta: { content: event.delta.text },
            finish_reason: null,
          }]
        })
      } else if (event.delta.type === 'input_json_delta') {
        return JSON.stringify({
          id: `chatcmpl-${generateId()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: event.model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: event.index,
                id: `call_${generateId()}`,
                type: 'function',
                function: {
                  name: '',
                  arguments: event.delta.partial_json,
                }
              }]
            },
            finish_reason: null,
          }]
        })
      }
      return ''

    case 'message_delta':
      return JSON.stringify({
        id: `chatcmpl-${generateId()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: event.model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: mapStopReason(event.usage?.stop_sequence ? 'stop' : null),
        }]
      })

    case 'message_stop':
      return '[DONE]'

    default:
      return ''
  }
}

/**
 * 提取 Anthropic 响应的文本内容
 */
function extractTextContent(content: any): string {
  if (!content) return ''
  
  if (typeof content === 'string') {
    return content
  }
  
  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
  }
  
  if (content.type === 'text') {
    return content.text
  }
  
  return ''
}

/**
 * 映射停止原因
 */
function mapStopReason(reason: string | null): string {
  switch (reason) {
    case 'end_turn':
    case 'stop':
      return 'stop'
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    default:
      return 'stop'
  }
}

/**
 * 生成随机 ID
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

/**
 * 去除 1M 后缀
 */
function stripOneMSuffix(model: string): string {
  return model.replace(/\[1M\]\s*$/i, '').trim()
}

/**
 * 模型名称映射
 */
export function mapModel(model: string, mapping?: ModelMappingConfig): string {
  if (!mapping) return model

  const modelLower = model.toLowerCase()

  if (modelLower.includes('haiku')) {
    return mapping.haikuModel || model
  }
  if (modelLower.includes('opus')) {
    return mapping.opusModel || model
  }
  if (modelLower.includes('sonnet')) {
    return mapping.sonnetModel || model
  }

  return mapping.defaultModel || model
}
```

#### 4.2.4 模型映射器

**新增文件：`electron/apiAdapter/modelMapper.ts`**

```typescript
/**
 * 模型映射模块
 * 
 * 参考 cc-switch 的 model_mapper.rs 实现
 * 
 * Claude Code 通过 [1M] 后缀声明 100 万上下文能力
 * 上游 API 通常不接受这个本地能力标记，需要剥离
 */

import { ModelMappingConfig, ModelMappingResult } from './types'

// Claude Code 1M 上下文标记
const ONE_M_CONTEXT_MARKER = '[1M]'

/**
 * 映射模型名称
 */
export function mapModel(
  originalModel: string,
  mapping?: ModelMappingConfig
): string {
  if (!mapping) {
    return originalModel
  }

  const modelLower = originalModel.toLowerCase()

  // 1. 按模型类型匹配
  if (modelLower.includes('haiku')) {
    if (mapping.haikuModel) {
      return mapping.haikuModel
    }
  }

  if (modelLower.includes('opus')) {
    if (mapping.opusModel) {
      return mapping.opusModel
    }
  }

  if (modelLower.includes('sonnet')) {
    if (mapping.sonnetModel) {
      return mapping.sonnetModel
    }
  }

  // 2. 默认模型
  if (mapping.defaultModel) {
    return mapping.defaultModel
  }

  // 3. 无映射，保持原样
  return originalModel
}

/**
 * 剥离 1M 后缀（用于上游 API）
 */
export function stripOneMSuffix(model: string): string {
  const trimmed = model.trimEnd()
  const marker = ONE_M_CONTEXT_MARKER

  if (trimmed.endsWith(marker)) {
    return trimmed.slice(0, -marker.length).trim()
  }

  // 忽略大小写检查
  if (trimmed.toLowerCase().endsWith(marker.toLowerCase())) {
    return trimmed.slice(0, -marker.length).trim()
  }

  return model
}

/**
 * 应用模型映射到请求体
 */
export function applyModelMapping(
  body: any,
  mapping?: ModelMappingConfig
): ModelMappingResult {
  // 如果没有配置映射，直接返回
  if (!mapping) {
    return {
      originalModel: body.model || null,
      mappedModel: null,
      provider: 'original',
    }
  }

  const originalModel = body.model || ''
  const mappedModel = mapModel(originalModel, mapping)
  const strippedModel = stripOneMSuffix(mappedModel)

  // 更新请求体
  if (strippedModel !== originalModel) {
    body.model = strippedModel
  }

  return {
    originalModel,
    mappedModel: strippedModel !== originalModel ? strippedModel : null,
    provider: strippedModel !== originalModel ? mappedModel : 'original',
  }
}

/**
 * 从环境变量构建模型映射配置
 */
export function buildModelMappingFromEnv(env: Record<string, string>): ModelMappingConfig | undefined {
  const haikuModel = env['ANTHROPIC_DEFAULT_HAIKU_MODEL']
  const sonnetModel = env['ANTHROPIC_DEFAULT_SONNET_MODEL']
  const opusModel = env['ANTHROPIC_DEFAULT_OPUS_MODEL']
  const defaultModel = env['ANTHROPIC_MODEL']

  if (!haikuModel && !sonnetModel && !opusModel && !defaultModel) {
    return undefined
  }

  return {
    haikuModel: haikuModel || undefined,
    sonnetModel: sonnetModel || undefined,
    opusModel: opusModel || undefined,
    defaultModel: defaultModel || undefined,
  }
}
```

#### 4.2.5 API Adapter 管理器

**新增文件：`electron/apiAdapter/manager.ts`**

```typescript
/**
 * API Adapter 管理器
 * 
 * 统一管理适配器实例，与 SessionProcess 集成
 */

import { EventEmitter } from 'events'
import { ApiAdapterServer } from './server'
import { ApiAdapterConfig, AdapterStatus } from './types'
import { logForDebugging } from '../logger'

export class ApiAdapterManager extends EventEmitter {
  private adapter: ApiAdapterServer | null = null
  private config: ApiAdapterConfig | null = null
  private isInstalledMode = false

  /**
   * 检查是否需要启动适配器
   */
  needsAdapter(apiProvider: string, engineSource: string): boolean {
    // 仅在官网模式 + 非 Anthropic provider 时需要适配器
    return engineSource === 'installed' && apiProvider !== 'anthropic'
  }

  /**
   * 初始化适配器配置
   */
  initialize(config: ApiAdapterConfig): void {
    this.config = config
    logForDebugging('[ApiAdapterManager] Initialized with config:', config)
  }

  /**
   * 启动适配器
   */
  async start(): Promise<string> {
    if (!this.config) {
      throw new Error('Adapter not initialized')
    }

    if (this.adapter) {
      logForDebugging('[ApiAdapterManager] Adapter already running')
      return this.getProxyUrl()
    }

    logForDebugging('[ApiAdapterManager] Starting adapter...')
    this.adapter = new ApiAdapterServer(this.config)
    await this.adapter.start()
    this.isInstalledMode = true

    logForDebugging('[ApiAdapterManager] Adapter started on', this.getProxyUrl())
    this.emit('adapterStarted', this.getProxyUrl())

    return this.getProxyUrl()
  }

  /**
   * 停止适配器
   */
  async stop(): Promise<void> {
    if (!this.adapter) {
      return
    }

    logForDebugging('[ApiAdapterManager] Stopping adapter...')
    await this.adapter.stop()
    this.adapter = null
    this.isInstalledMode = false

    logForDebugging('[ApiAdapterManager] Adapter stopped')
    this.emit('adapterStopped')
  }

  /**
   * 获取代理服务器 URL
   */
  getProxyUrl(): string {
    if (!this.config) {
      return ''
    }
    return `http://${this.config.host}:${this.config.port}`
  }

  /**
   * 获取适配器状态
   */
  getStatus(): AdapterStatus | null {
    return this.adapter?.getStatus() || null
  }

  /**
   * 检查适配器是否正在运行
   */
  isRunning(): boolean {
    return this.adapter !== null
  }

  /**
   * 检查是否为安装模式
   */
  isModeInstalled(): boolean {
    return this.isInstalledMode
  }
}

// 导出单例实例
export const apiAdapterManager = new ApiAdapterManager()
```

#### 4.2.6 与 SessionProcess 集成

**修改文件：`electron/sessionProcess.ts`**

```typescript
import { apiAdapterManager } from './apiAdapter/manager'

// 在构造函数或 start() 方法中
async start(): Promise<void> {
  // ... 现有逻辑

  // 如果使用官网模式 + OpenAI 兼容 API，启动适配器
  if (this.config.engineSource === 'installed' && 
      this.config.apiProvider !== 'anthropic') {
    
    // 初始化适配器
    apiAdapterManager.initialize({
      enabled: true,
      port: 34567,
      host: '127.0.0.1',
      apiProvider: this.config.apiProvider,
      apiKey: this.config.apiKey,
      baseUrl: this.config.apiBaseUrl,
      modelMapping: this.config.modelMapping,
    })

    // 启动适配器
    const proxyUrl = await apiAdapterManager.start()

    // 修改环境变量，让 Claude Code 使用本地代理
    this.launcherEnv = {
      ...this.launcherEnv,
      ANTHROPIC_BASE_URL: proxyUrl,
      // 不需要 API Key，因为代理会处理
    }

    logForDebugging('[SessionProcess] Using API adapter:', proxyUrl)
  }
}

// 在 stop() 方法中添加
async stop(): Promise<void> {
  // ... 现有清理逻辑

  // 停止适配器
  if (apiAdapterManager.isRunning()) {
    await apiAdapterManager.stop()
  }
}
```

#### 4.2.7 IPC handlers

**修改文件：`electron/claudeCodeIPC.ts`**

```typescript
import { ipcMain } from 'electron'
import { apiAdapterManager } from './apiAdapter/manager'

// 在 registerClaudeCodeIPC() 函数中添加：

// 获取适配器状态
ipcMain.handle('claude-code:getAdapterStatus', async () => {
  return apiAdapterManager.getStatus()
})

// 检查是否需要适配器
ipcMain.handle('claude-code:checkNeedsAdapter', async (_, apiProvider: string, engineSource: string) => {
  return apiAdapterManager.needsAdapter(apiProvider, engineSource)
})

// 手动启动/停止适配器（用于调试）
ipcMain.handle('claude-code:toggleAdapter', async (_, enable: boolean) => {
  if (enable) {
    const url = await apiAdapterManager.start()
    return { success: true, url }
  } else {
    await apiAdapterManager.stop()
    return { success: true }
  }
})
```

### 4.3 模型映射配置

#### 4.3.1 常用 Provider 的模型映射

| Provider | 模型类型 | 映射配置 |
|----------|---------|---------|
| **OpenAI** | GPT-4 | `defaultModel: 'claude-sonnet-4-20250514'` |
| **OpenAI** | GPT-4o | `defaultModel: 'claude-sonnet-4-20250514'` |
| **OpenAI** | GPT-4o-mini | `defaultModel: 'claude-haiku-3-20250514'` |
| **Azure OpenAI** | gpt-4 | `defaultModel: 'claude-sonnet-4-20250514'` |
| **OpenRouter** | 任意 | 使用 provider 的自动路由 |

#### 4.3.2 模型映射环境变量

```bash
# Claude Code 支持的环境变量
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_DEFAULT_SONNET_MODEL=gpt-4o
ANTHROPIC_DEFAULT_HAIKU_MODEL=gpt-4o-mini
ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-20250514
```

---

## 五、设置界面设计

### 5.1 引擎设置组件

**新增文件：`src/components/settings/EngineSettings.vue`**

```vue
<template>
  <div class="engine-settings">
    <div class="setting-group">
      <h3>Claude Code 引擎设置</h3>

      <!-- 引擎类型选择 -->
      <div class="radio-group">
        <label class="radio-option">
          <input
            type="radio"
            v-model="engineSource"
            value="bundled"
            @change="onEngineSourceChange"
          />
          <div class="radio-content">
            <span class="radio-title">内置引擎（推荐）</span>
            <span class="radio-desc">
              使用应用内置的 Claude Code 源码版本
              <br/>
              ✅ 支持 OpenAI 兼容 API
            </span>
          </div>
        </label>

        <label class="radio-option">
          <input
            type="radio"
            v-model="engineSource"
            value="installed"
            @change="onEngineSourceChange"
          />
          <div class="radio-content">
            <span class="radio-title">官网版本</span>
            <span class="radio-desc">
              使用本地安装的 Claude Code CLI
              <template v-if="selectedApiProvider !== 'anthropic'">
                <br/>
                <span class="warning-text">⚠️ 需要启用 API 适配器</span>
              </template>
            </span>
          </div>
        </label>
      </div>

      <!-- API 适配器设置（仅官网模式 + 非 Anthropic 时显示） -->
      <div 
        v-if="engineSource === 'installed' && selectedApiProvider !== 'anthropic'" 
        class="adapter-section"
      >
        <div class="section-title">
          <span>🔄 API 适配器</span>
          <span class="badge">自动</span>
        </div>
        
        <div class="adapter-info">
          <p>
            官网 Claude Code CLI 原生仅支持 Anthropic API。
            系统将自动启动本地适配器，将您的 
            <strong>{{ selectedApiProviderLabel }}</strong> 
            API 转换为 Claude Code 可识别的格式。
          </p>
        </div>

        <!-- 适配器状态 -->
        <div v-if="adapterStatus" class="adapter-status">
          <div class="status-indicator" :class="{ running: adapterStatus.running }">
            {{ adapterStatus.running ? '● 运行中' : '○ 已停止' }}
          </div>
          <div class="status-details">
            <span>端口: {{ adapterStatus.port }}</span>
            <span>请求: {{ adapterStatus.requestsProcessed }}</span>
            <span v-if="adapterStatus.errorsCount > 0" class="error-count">
              错误: {{ adapterStatus.errorsCount }}
            </span>
          </div>
        </div>

        <!-- 模型映射配置 -->
        <div class="model-mapping">
          <h4>模型映射</h4>
          <p class="mapping-hint">
            将 Claude Code 的默认模型映射到您的 API 支持的模型
          </p>
          
          <div class="mapping-inputs">
            <div class="input-group">
              <label>默认模型</label>
              <select v-model="modelMapping.defaultModel">
                <option value="">保持原样</option>
                <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
                <option value="claude-opus-4-20250514">Claude Opus 4</option>
                <option value="claude-haiku-3-20250514">Claude Haiku 3</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- 已安装版本检测 -->
      <div v-if="engineSource === 'installed'" class="installed-section">
        <div class="detection-status">
          <div v-if="isDetecting" class="status-detecting">
            <span class="spinner"></span>
            正在检测...
          </div>

          <div v-else-if="!detectionResult.available" class="status-not-found">
            <div class="warning-message">
              <span class="icon">⚠️</span>
              未检测到 Claude Code CLI
            </div>

            <!-- 环境检测 -->
            <div class="env-check">
              <div class="env-item" :class="{ ok: envCheck.node.available }">
                Node.js: {{ envCheck.node.version || '未安装' }}
              </div>
              <div class="env-item" :class="{ ok: envCheck.git.available }">
                Git: {{ envCheck.git.version || '未安装' }}
              </div>
              <div class="env-item" :class="{ ok: envCheck.npm.available }">
                npm: {{ envCheck.npm.version || '未安装' }}
              </div>
            </div>

            <!-- 安装按钮 -->
            <div v-if="canInstall" class="install-section">
              <button
                @click="installCli"
                :disabled="isInstalling"
                class="btn-primary"
              >
                {{ isInstalling ? '正在安装...' : '一键安装 Claude Code CLI' }}
              </button>
              <div v-if="installError" class="error-message">
                安装失败: {{ installError }}
              </div>
            </div>

            <div v-else class="missing-deps">
              请先安装所需的依赖（Node.js, Git, npm）
            </div>
          </div>

          <div v-else class="status-found">
            <span class="icon">✅</span>
            <span>
              已检测到 Claude Code CLI
              <span class="version">{{ detectionResult.version }}</span>
            </span>
            <span class="path">{{ detectionResult.path }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { api } from '@/services/electronAPI'

const settingsStore = useSettingsStore()

const engineSource = ref(settingsStore.engineSource || 'bundled')
const isDetecting = ref(false)
const detectionResult = ref({ available: false, path: null as string | null, version: null as string | null })
const envCheck = ref({
  node: { available: false, version: null as string | null },
  git: { available: false, version: null as string | null },
  npm: { available: false, version: null as string | null },
})
const isInstalling = ref(false)
const installError = ref<string | null>(null)
const adapterStatus = ref<any>(null)
const modelMapping = ref({
  defaultModel: '',
  sonnetModel: '',
  haikuModel: '',
  opusModel: '',
})

const selectedApiProvider = computed(() => settingsStore.config.apiProvider || 'anthropic')
const selectedApiProviderLabel = computed(() => {
  const labels: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    azure: 'Azure OpenAI',
    openrouter: 'OpenRouter',
    other: 'OpenAI 兼容',
  }
  return labels[selectedApiProvider.value] || selectedApiProvider.value
})

const canInstall = computed(() => {
  return envCheck.value.node.available &&
         envCheck.value.git.available &&
         envCheck.value.npm.available
})

onMounted(async () => {
  if (engineSource.value === 'installed') {
    await detectInstalled()
  }
  await refreshAdapterStatus()
})

async function detectInstalled() {
  isDetecting.value = true
  try {
    const [detection, env] = await Promise.all([
      api.claudeCode.detectInstalledCli(),
      api.claudeCode.checkEnvironment(),
    ])
    detectionResult.value = detection
    envCheck.value = env
  } finally {
    isDetecting.value = false
  }
}

async function installCli() {
  isInstalling.value = true
  installError.value = null
  try {
    const result = await api.claudeCode.installCli()
    if (result.success) {
      await detectInstalled()
    } else {
      installError.value = result.error || '未知错误'
    }
  } finally {
    isInstalling.value = false
  }
}

async function refreshAdapterStatus() {
  try {
    adapterStatus.value = await api.claudeCode.getAdapterStatus()
  } catch (e) {
    adapterStatus.value = null
  }
}

function onEngineSourceChange() {
  settingsStore.setEngineSource(engineSource.value as 'bundled' | 'installed')
  if (engineSource.value === 'installed') {
    detectInstalled()
  }
}
</script>

<style scoped>
.engine-settings {
  padding: 16px;
}

.setting-group h3 {
  margin-bottom: 16px;
  font-size: 16px;
  font-weight: 600;
}

.radio-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.radio-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.radio-option:hover {
  border-color: var(--primary-color);
}

.radio-option input {
  margin-top: 4px;
}

.radio-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.radio-title {
  font-weight: 500;
}

.radio-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.warning-text {
  color: #856404;
  font-size: 11px;
}

/* 适配器部分样式 */
.adapter-section {
  margin-top: 20px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-weight: 600;
}

.badge {
  padding: 2px 8px;
  background: var(--primary-color);
  color: white;
  border-radius: 12px;
  font-size: 11px;
  font-weight: normal;
}

.adapter-info {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.adapter-status {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: var(--bg-primary);
  border-radius: 6px;
  margin-bottom: 16px;
}

.status-indicator {
  font-weight: 600;
  color: var(--text-secondary);
}

.status-indicator.running {
  color: #28a745;
}

.status-details {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.error-count {
  color: #dc3545;
}

.model-mapping h4 {
  margin-bottom: 8px;
  font-size: 14px;
}

.mapping-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.mapping-inputs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-group label {
  font-size: 12px;
  font-weight: 500;
}

.input-group select {
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 13px;
}

/* 已安装部分样式 */
.installed-section {
  margin-top: 16px;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: 8px;
}

.status-found {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-found .path {
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}

.warning-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #fff3cd;
  border-radius: 4px;
  margin-bottom: 12px;
}

.env-check {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.env-item {
  padding: 4px 8px;
  background: #f8d7da;
  border-radius: 4px;
  font-size: 12px;
}

.env-item.ok {
  background: #d4edda;
}

.install-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn-primary {
  padding: 8px 16px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-message {
  color: var(--error-color);
  font-size: 12px;
}
</style>
```

---

## 六、兼容性与注意事项

### 6.1 支持的 API Provider

| Provider | 支持状态 | 需要适配器 | 备注 |
|----------|---------|-----------|------|
| **Anthropic** | ✅ 完全支持 | ❌ 不需要 | 原生支持 |
| **OpenAI** | ✅ 支持 | ✅ 需要 | 通过适配器转换 |
| **Azure OpenAI** | ✅ 支持 | ✅ 需要 | 通过适配器转换 |
| **OpenRouter** | ✅ 支持 | ✅ 需要 | 格式兼容 |
| **Claude API 兼容** | ✅ 支持 | ❌ 不需要 | 使用官方 SDK |

### 6.2 功能限制

| 功能 | 内置模式 | 官网模式 |
|------|---------|---------|
| Anthropic API | ✅ | ✅ |
| OpenAI 兼容 API | ✅ | ✅ (需适配器) |
| 会话历史 | ✅ | ✅ |
| MCP 支持 | ✅ | ✅ |
| Tool Calling | ✅ | ✅ |
| Streaming | ✅ | ✅ |
| 多会话管理 | ✅ | 部分支持 |

### 6.3 已知问题

1. **会话目录差异**
   - 内置版本：使用应用配置目录
   - 官网版本：使用 `~/.claude`
   - 影响：会话历史不共享

2. **模型名称限制**
   - 某些自定义模型名称可能无法正确映射
   - 需要用户手动配置映射规则

3. **API 兼容性**
   - 部分 Provider 的特殊参数可能不被支持
   - 需要用户测试验证

---

## 七、测试计划

### 7.1 单元测试

- CLI 检测逻辑
- 环境检查逻辑
- 安装脚本验证
- 请求转换器 (OpenAI ↔ Anthropic)
- 模型映射逻辑
- 适配器状态管理

### 7.2 集成测试

**内置模式测试**：
1. 验证默认启动正常
2. 验证 OpenAI API 配置正常
3. 验证消息发送和接收
4. 验证工具调用
5. 验证会话历史

**官网模式测试**：
1. 检测已安装的 CLI
2. 切换到官网模式
3. 验证适配器自动启动
4. 验证 Anthropic API 工作
5. 验证 OpenAI API + 适配器工作
6. 验证模型映射生效
7. 验证会话历史

### 7.3 兼容性测试

- Windows / macOS / Linux
- 不同安装路径
- 不同 API Provider
- 不同模型配置

---

## 八、实施步骤

### Phase 1: 基础设施（2-3 天）
1. 创建 `electron/apiAdapter/types.ts`
2. 创建 `electron/apiAdapter/transformer.ts`
3. 创建 `electron/apiAdapter/modelMapper.ts`
4. 创建 `electron/apiAdapter/server.ts`
5. 创建 `electron/apiAdapter/manager.ts`

### Phase 2: 核心集成（2-3 天）
1. 修改 `sessionProcess.ts` 集成适配器
2. 添加 IPC handlers
3. 更新 preload API
4. 更新前端 API 封装

### Phase 3: UI/UX（1-2 天）
1. 创建 `EngineSettings.vue` 组件
2. 实现交互逻辑
3. 添加适配器状态显示
4. 添加模型映射配置

### Phase 4: 测试与修复（2-3 天）
1. 单元测试
2. 集成测试
3. 兼容性测试
4. Bug 修复

### 总工期：约 7-11 个工作日

---

## 九、参考资源

### 9.1 开源项目

1. **cc-switch** - https://github.com/farion1231/cc-switch
   - 完整的代理实现参考
   - 模型映射实现
   - Provider 路由

2. **CCProxy** - https://ccproxy.orchestre.dev/
   - Claude Code API 代理参考
   - 格式转换示例
   - 多 Provider 支持

### 9.2 API 文档

1. **Anthropic API** - https://docs.anthropic.com/
2. **OpenAI API** - https://platform.openai.com/docs/api-reference/
3. **Azure OpenAI** - https://learn.microsoft.com/azure/ai-services/openai/

### 9.3 Claude Code CLI

1. **官方文档** - https://docs.anthropic.com/en/docs/claude-code
2. **GitHub** - https://github.com/anthropics/claude-code
