# 官网 Claude Code 引擎切换 + API 转换桥 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 允许用户切换到本地安装的官网 Claude Code CLI，支持 CLI 检测/一键安装，并通过独立子进程代理实现 Anthropic ↔ OpenAI API 协议转换。

**架构：** 采用独立子进程代理模式。代理作为 Node.js 子进程运行，接收 Claude Code 发出的 Anthropic 格式请求，转换为 OpenAI 格式转发上游，再将响应转回 Anthropic 格式。主进程通过 ProxyManager 管理代理生命周期，通过 CliDetector 处理 CLI 检测和安装。

**技术栈：** Electron 29 + Vue 3 + TypeScript + Node.js http 模块

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `electron/proxy/types.ts` | 代理模块共享类型定义 |
| `electron/proxy/sseParser.ts` | SSE 事件流增量解析器 |
| `electron/proxy/modelMapper.ts` | 模型名映射 + [1M] 后缀剥离 |
| `electron/proxy/authHandler.ts` | 上游 Provider 认证头构建 |
| `electron/proxy/transformer.ts` | Anthropic ↔ OpenAI 请求/响应格式转换 |
| `electron/proxy/streamingTransformer.ts` | 流式 SSE 事件双向转换（状态机） |
| `electron/proxy/server.ts` | HTTP 代理服务器（路由 + 转发 + 流式管道） |
| `electron/proxy/index.ts` | 代理子进程入口（被 spawn 启动） |
| `electron/proxyManager.ts` | 主进程侧：代理子进程生命周期管理 |
| `electron/cliDetector.ts` | CLI 检测 + 环境检查 + 一键安装 |
| `src/components/settings/EngineSourceSettings.vue` | 引擎来源设置 UI 组件 |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `electron/sessionProcess.ts` | `resolveCliCommand()` 增加官网 CLI 路径；`buildEnv()` 注入代理 URL |
| `electron/claudeCodeIPC.ts` | 新增 IPC handlers |
| `electron/preload.ts` | 新增 preload API |
| `src/stores/settings.ts` | 新增 `engineSource` 字段 |
| `src/components/settings/GeneralSettings.vue` | 嵌入 EngineSourceSettings 组件 |
| `src/services/electronAPI.ts` | 新增前端 API 封装 |

---

## 任务 1：代理模块类型定义

**文件：**
- 创建：`electron/proxy/types.ts`

- [ ] **步骤 1：创建类型定义文件**

```typescript
export interface ProxyConfig {
  host: string
  port: number
  upstreamProvider: 'openai' | 'openai_compatible' | 'anthropic'
  upstreamBaseUrl: string
  upstreamApiKey: string
  modelMapping: ModelMappingConfig
}

export interface ModelMappingConfig {
  defaultModel?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

export interface AdapterStatus {
  running: boolean
  port: number
  requestsProcessed: number
  errorsCount: number
  lastError?: string
}

export interface CliDetectionResult {
  available: boolean
  path: string | null
  version: string | null
}

export interface EnvironmentCheck {
  node: EnvItemStatus
  npm: EnvItemStatus
  git: EnvItemStatus
}

export interface EnvItemStatus {
  available: boolean
  version: string | null
  path: string | null
}

export interface InstallProgress {
  stage: 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  message: string
  percent?: number
}

export type EngineSource = 'bundled' | 'installed'
```

- [ ] **步骤 2：Commit**

```bash
git add electron/proxy/types.ts
git commit -m "feat(proxy): add shared type definitions for proxy module"
```

---

## 任务 2：SSE 解析器

**文件：**
- 创建：`electron/proxy/sseParser.ts`

- [ ] **步骤 1：实现 SSE 解析器**

```typescript
export interface SSEEvent {
  event: string | null
  data: string
  id?: string
  retry?: number
}

export class SSEParser {
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

  reset(): void {
    this.buffer = ''
  }

  private parseSingleEvent(raw: string): SSEEvent | null {
    let event: string | null = null
    let data = ''
    let id: string | undefined
    let retry: number | undefined

    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data += (data ? '\n' : '') + line.slice(5).trim()
      } else if (line.startsWith('id:')) {
        id = line.slice(3).trim()
      } else if (line.startsWith('retry:')) {
        const val = parseInt(line.slice(6).trim(), 10)
        if (!isNaN(val)) retry = val
      }
    }

    if (!data) return null
    if (data === '[DONE]') return { event: 'done', data: '[DONE]' }

    const result: SSEEvent = { event, data }
    if (id !== undefined) result.id = id
    if (retry !== undefined) result.retry = retry
    return result
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/proxy/sseParser.ts
git commit -m "feat(proxy): implement SSE event stream parser"
```

---

## 任务 3：模型映射器

**文件：**
- 创建：`electron/proxy/modelMapper.ts`

- [ ] **步骤 1：实现模型映射器**

```typescript
import { ModelMappingConfig } from './types'

const ONE_M_MARKER = '[1M]'

export function stripOneMSuffix(model: string): string {
  const trimmed = model.trimEnd()
  if (trimmed.endsWith(ONE_M_MARKER)) {
    return trimmed.slice(0, -ONE_M_MARKER.length).trim()
  }
  if (trimmed.toLowerCase().endsWith(ONE_M_MARKER.toLowerCase())) {
    return trimmed.slice(0, -ONE_M_MARKER.length).trim()
  }
  return model
}

export function mapModel(model: string, mapping?: ModelMappingConfig): string {
  if (!mapping) return model

  const stripped = stripOneMSuffix(model)
  const lower = stripped.toLowerCase()

  if (lower.includes('haiku') && mapping.haikuModel) {
    return mapping.haikuModel
  }
  if (lower.includes('opus') && mapping.opusModel) {
    return mapping.opusModel
  }
  if (lower.includes('sonnet') && mapping.sonnetModel) {
    return mapping.sonnetModel
  }
  if (mapping.defaultModel) {
    return mapping.defaultModel
  }

  return stripped
}

export function applyModelMapping(
  body: Record<string, any>,
  mapping?: ModelMappingConfig
): { originalModel: string; mappedModel: string } {
  const originalModel = body.model || ''
  const mapped = mapModel(originalModel, mapping)
  body.model = mapped
  return { originalModel, mappedModel: mapped }
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/proxy/modelMapper.ts
git commit -m "feat(proxy): implement model name mapper with [1M] suffix stripping"
```

---

## 任务 4：认证处理器

**文件：**
- 创建：`electron/proxy/authHandler.ts`

- [ ] **步骤 1：实现认证处理器**

```typescript
import { ProxyConfig } from './types'

export interface UpstreamRequestOptions {
  url: string
  headers: Record<string, string>
}

export function buildUpstreamRequest(
  path: string,
  body: Record<string, any>,
  config: ProxyConfig
): UpstreamRequestOptions {
  const baseUrl = config.upstreamBaseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'SpaceCode-Proxy/1.0',
  }

  switch (config.upstreamProvider) {
    case 'openai':
    case 'openai_compatible': {
      const targetUrl = `${baseUrl}/v1/chat/completions`
      headers['Authorization'] = `Bearer ${config.upstreamApiKey}`
      return { url: targetUrl, headers }
    }
    case 'anthropic': {
      const targetUrl = `${baseUrl}/v1/messages`
      headers['x-api-key'] = config.upstreamApiKey
      headers['anthropic-version'] = '2023-06-01'
      return { url: targetUrl, headers }
    }
    default: {
      const targetUrl = `${baseUrl}${path}`
      headers['Authorization'] = `Bearer ${config.upstreamApiKey}`
      return { url: targetUrl, headers }
    }
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/proxy/authHandler.ts
git commit -m "feat(proxy): implement upstream provider authentication handler"
```

---

## 任务 5：请求/响应格式转换器

**文件：**
- 创建：`electron/proxy/transformer.ts`

- [ ] **步骤 1：实现 Anthropic → OpenAI 请求转换**

```typescript
import { ModelMappingConfig } from './types'
import { mapModel } from './modelMapper'

export function anthropicToOpenAIRequest(
  body: Record<string, any>,
  modelMapping?: ModelMappingConfig
): Record<string, any> {
  const model = mapModel(body.model || '', modelMapping)

  const result: Record<string, any> = {
    model,
    stream: body.stream ?? false,
    messages: [],
  }

  if (body.system) {
    const systemContent = typeof body.system === 'string'
      ? body.system
      : (Array.isArray(body.system) ? body.system.map((b: any) => b.text).join('\n') : String(body.system))
    result.messages.push({ role: 'system', content: systemContent })
  }

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      result.messages.push(convertAnthropicMessage(msg))
    }
  }

  if (body.tools?.length) {
    result.tools = body.tools.map((t: any) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))
  }

  if (body.tool_choice) {
    result.tool_choice = convertToolChoice(body.tool_choice)
  }

  if (body.max_tokens) result.max_tokens = body.max_tokens
  if (body.temperature !== undefined) result.temperature = body.temperature
  if (body.top_p !== undefined) result.top_p = body.top_p
  if (body.stop_sequences) result.stop = body.stop_sequences

  return result
}

function convertAnthropicMessage(msg: Record<string, any>): Record<string, any> {
  if (msg.role === 'assistant') {
    return convertAssistantMessage(msg)
  }
  if (msg.role === 'user') {
    return convertUserMessage(msg)
  }
  return { role: msg.role, content: String(msg.content) }
}

function convertAssistantMessage(msg: Record<string, any>): Record<string, any> {
  const content = msg.content
  if (!Array.isArray(content)) {
    return { role: 'assistant', content: content ? String(content) : null }
  }

  const textParts = content.filter((b: any) => b.type === 'text')
  const toolUseParts = content.filter((b: any) => b.type === 'tool_use')

  const result: Record<string, any> = { role: 'assistant' }
  result.content = textParts.map((b: any) => b.text).join('') || null

  if (toolUseParts.length > 0) {
    result.tool_calls = toolUseParts.map((t: any, index: number) => ({
      id: `call_${t.id}`,
      type: 'function',
      index,
      function: {
        name: t.name,
        arguments: typeof t.input === 'string' ? t.input : JSON.stringify(t.input),
      },
    }))
  }

  return result
}

function convertUserMessage(msg: Record<string, any>): Record<string, any> {
  const content = msg.content
  if (typeof content === 'string') {
    return { role: 'user', content }
  }
  if (!Array.isArray(content)) {
    return { role: 'user', content: String(content) }
  }

  const toolResultParts = content.filter((b: any) => b.type === 'tool_result')
  if (toolResultParts.length > 0) {
    const results: Record<string, any>[] = []
    for (const tr of toolResultParts) {
      let trContent: string
      if (typeof tr.content === 'string') {
        trContent = tr.content
      } else if (Array.isArray(tr.content)) {
        trContent = tr.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('')
      } else {
        trContent = String(tr.content || '')
      }
      results.push({
        role: 'tool',
        tool_call_id: `call_${tr.tool_use_id}`,
        content: trContent,
      })
    }
    if (results.length === 1) return results[0]
    return { role: 'user', content: JSON.stringify(results) }
  }

  const anthropicContent: any[] = []
  for (const block of content) {
    if (block.type === 'text') {
      anthropicContent.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      if (block.source?.type === 'base64') {
        anthropicContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        })
      }
    }
  }

  if (anthropicContent.length === 1 && anthropicContent[0].type === 'text') {
    return { role: 'user', content: anthropicContent[0].text }
  }

  return { role: 'user', content: anthropicContent }
}

function convertToolChoice(tc: any): any {
  if (tc === 'auto' || tc?.type === 'auto') return 'auto'
  if (tc === 'any' || tc?.type === 'any') return 'required'
  if (tc?.type === 'tool' && tc?.name) {
    return { type: 'function', function: { name: tc.name } }
  }
  return 'auto'
}

export function openAIToAnthropicResponse(
  response: Record<string, any>,
  originalModel: string
): Record<string, any> {
  if (response.error) {
    return {
      type: 'error',
      error: { type: 'api_error', message: response.error.message || String(response.error) },
    }
  }

  const choice = response.choices?.[0]
  if (!choice) {
    return {
      type: 'error',
      error: { type: 'api_error', message: 'No choices in response' },
    }
  }

  const content: any[] = []

  if (choice.message?.content) {
    content.push({ type: 'text', text: choice.message.content })
  }

  if (choice.message?.tool_calls?.length) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: tc.id?.replace('call_', 'toolu_') || `toolu_${Math.random().toString(36).slice(2)}`,
        name: tc.function?.name || '',
        input: safeParseJSON(tc.function?.arguments || '{}'),
      })
    }
  }

  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: 'message',
    role: 'assistant',
    model: originalModel,
    content,
    stop_reason: mapFinishReason(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens || 0,
      output_tokens: response.usage?.completion_tokens || 0,
    },
  }
}

function mapFinishReason(reason: string | null): string {
  switch (reason) {
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    case 'tool_calls': return 'tool_use'
    default: return 'end_turn'
  }
}

function safeParseJSON(str: string): any {
  try {
    return JSON.parse(str)
  } catch {
    return {}
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/proxy/transformer.ts
git commit -m "feat(proxy): implement Anthropic ↔ OpenAI request/response transformer"
```

---

## 任务 6：流式转换器

**文件：**
- 创建：`electron/proxy/streamingTransformer.ts`

- [ ] **步骤 1：实现 OpenAI SSE → Anthropic SSE 流式转换器**

```typescript
enum StreamPhase {
  Init = 'init',
  MessageStarted = 'message_started',
  TextBlockOpen = 'text_block_open',
  ToolUseBlockOpen = 'tool_use_block_open',
  Finished = 'finished',
}

export class OpenAIToAnthropicStreamTransformer {
  private phase = StreamPhase.Init
  private contentBlockIndex = 0
  private currentToolId: string = ''
  private currentToolName: string = ''
  private model: string = ''
  private msgId: string = ''

  transform(chunk: Record<string, any>): string[] {
    const events: string[] = []
    const choice = chunk.choices?.[0]
    if (!choice) return events

    if (this.phase === StreamPhase.Init) {
      this.model = chunk.model || 'claude-sonnet-4-20250514'
      this.msgId = `msg_${Math.random().toString(36).slice(2)}`
      events.push(this.makeSSE('message_start', {
        type: 'message_start',
        message: {
          id: this.msgId,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }))

      if (choice.delta?.role === 'assistant' && !choice.delta.content && !choice.delta?.tool_calls) {
        this.phase = StreamPhase.MessageStarted
        return events
      }
      this.phase = StreamPhase.MessageStarted
    }

    if (this.phase === StreamPhase.MessageStarted || this.phase === StreamPhase.TextBlockOpen || this.phase === StreamPhase.ToolUseBlockOpen) {
      if (choice.delta?.content) {
        if (this.phase !== StreamPhase.TextBlockOpen) {
          if (this.phase === StreamPhase.ToolUseBlockOpen) {
            events.push(this.makeSSE('content_block_stop', {
              type: 'content_block_stop',
              index: this.contentBlockIndex,
            }))
            this.contentBlockIndex++
          }
          events.push(this.makeSSE('content_block_start', {
            type: 'content_block_start',
            index: this.contentBlockIndex,
            content_block: { type: 'text', text: '' },
          }))
          this.phase = StreamPhase.TextBlockOpen
        }
        events.push(this.makeSSE('content_block_delta', {
          type: 'content_block_delta',
          index: this.contentBlockIndex,
          delta: { type: 'text_delta', text: choice.delta.content },
        }))
      }

      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          if (tc.function?.name) {
            if (this.phase === StreamPhase.TextBlockOpen) {
              events.push(this.makeSSE('content_block_stop', {
                type: 'content_block_stop',
                index: this.contentBlockIndex,
              }))
              this.contentBlockIndex++
            } else if (this.phase === StreamPhase.ToolUseBlockOpen) {
              events.push(this.makeSSE('content_block_stop', {
                type: 'content_block_stop',
                index: this.contentBlockIndex,
              }))
              this.contentBlockIndex++
            }

            this.currentToolId = tc.id || `toolu_${Math.random().toString(36).slice(2)}`
            this.currentToolName = tc.function.name
            events.push(this.makeSSE('content_block_start', {
              type: 'content_block_start',
              index: this.contentBlockIndex,
              content_block: {
                type: 'tool_use',
                id: this.currentToolId,
                name: this.currentToolName,
                input: {},
              },
            }))
            this.phase = StreamPhase.ToolUseBlockOpen
          }

          if (tc.function?.arguments) {
            events.push(this.makeSSE('content_block_delta', {
              type: 'content_block_delta',
              index: this.contentBlockIndex,
              delta: {
                type: 'input_json_delta',
                partial_json: tc.function.arguments,
              },
            }))
          }
        }
      }

      if (choice.finish_reason) {
        if (this.phase === StreamPhase.TextBlockOpen || this.phase === StreamPhase.ToolUseBlockOpen) {
          events.push(this.makeSSE('content_block_stop', {
            type: 'content_block_stop',
            index: this.contentBlockIndex,
          }))
        }

        const stopReason = mapFinishReasonToAnthropic(choice.finish_reason)
        events.push(this.makeSSE('message_delta', {
          type: 'message_delta',
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { output_tokens: 0 },
        }))
        events.push(this.makeSSE('message_stop', {
          type: 'message_stop',
        }))
        this.phase = StreamPhase.Finished
      }
    }

    return events
  }

  private makeSSE(event: string, data: any): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  }
}

function mapFinishReasonToAnthropic(reason: string): string {
  switch (reason) {
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    case 'tool_calls': return 'tool_use'
    default: return 'end_turn'
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/proxy/streamingTransformer.ts
git commit -m "feat(proxy): implement OpenAI SSE to Anthropic SSE streaming transformer"
```

---

## 任务 7：代理 HTTP 服务器

**文件：**
- 创建：`electron/proxy/server.ts`

- [ ] **步骤 1：实现代理 HTTP 服务器**

```typescript
import * as http from 'http'
import { ProxyConfig, AdapterStatus } from './types'
import { anthropicToOpenAIRequest, openAIToAnthropicResponse } from './transformer'
import { OpenAIToAnthropicStreamTransformer } from './streamingTransformer'
import { buildUpstreamRequest } from './authHandler'
import { applyModelMapping } from './modelMapper'

export class ProxyServer {
  private server: http.Server | null = null
  private config: ProxyConfig
  private status: AdapterStatus
  private requestCount = 0

  constructor(config: ProxyConfig) {
    this.config = config
    this.status = {
      running: false,
      port: config.port,
      requestsProcessed: 0,
      errorsCount: 0,
    }
  }

  async start(): Promise<void> {
    if (this.server) throw new Error('Proxy server already running')

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res)
        } catch (err) {
          this.status.errorsCount++
          this.status.lastError = String(err)
          this.sendError(res, 500, 'Internal Server Error')
        }
      })

      this.server.on('error', (err) => {
        this.status.running = false
        reject(err)
      })

      this.server.listen(this.config.port, this.config.host, () => {
        this.status.running = true
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null
        this.status.running = false
        resolve()
      })
    })
  }

  getStatus(): AdapterStatus {
    return { ...this.status, requestsProcessed: this.requestCount }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.setCorsHeaders(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${this.config.host}:${this.config.port}`)
    const pathname = url.pathname

    if (pathname === '/health') {
      this.sendJson(res, { status: 'healthy', timestamp: new Date().toISOString() })
      return
    }

    if (pathname === '/status') {
      this.sendJson(res, this.getStatus())
      return
    }

    const body = await this.readBody(req)

    if (pathname === '/v1/messages') {
      await this.handleMessages(req, res, body)
    } else if (pathname === '/v1/chat/completions') {
      await this.handleChatCompletions(req, res, body)
    } else if (pathname.startsWith('/v1/models')) {
      this.sendJson(res, this.getCompatibleModels())
    } else {
      this.sendError(res, 404, 'Not Found')
    }
  }

  private async handleMessages(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string
  ): Promise<void> {
    this.requestCount++

    if (this.config.upstreamProvider === 'anthropic') {
      await this.forwardDirect(req, res, body)
      return
    }

    const parsed = safeParseBody(body)
    const { originalModel } = applyModelMapping(parsed, this.config.modelMapping)
    const isStream = parsed.stream === true

    const openaiReq = anthropicToOpenAIRequest(parsed, this.config.modelMapping)
    const upstream = buildUpstreamRequest('/v1/messages', openaiReq, this.config)

    if (isStream) {
      await this.forwardStream(res, upstream, JSON.stringify(openaiReq), originalModel)
    } else {
      await this.forwardNonStream(res, upstream, JSON.stringify(openaiReq), originalModel)
    }
  }

  private async handleChatCompletions(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string
  ): Promise<void> {
    this.requestCount++
    const upstream = buildUpstreamRequest('/v1/chat/completions', safeParseBody(body), this.config)
    await this.forwardDirect(req, res, body, upstream)
  }

  private async forwardDirect(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string,
    upstreamOverride?: { url: string; headers: Record<string, string> }
  ): Promise<void> {
    const targetUrl = upstreamOverride?.url || new URL(_req.url || '/', this.config.upstreamBaseUrl).toString()
    const headers = upstreamOverride?.headers || this.getDefaultHeaders()

    try {
      const response = await this.httpPost(targetUrl, headers, body)
      const responseBody = await this.readNodeStream(response)

      const resHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(response.headers)) {
        if (value && !['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          resHeaders[key] = Array.isArray(value) ? value.join(', ') : value
        }
      }

      res.writeHead(response.statusCode || 200, resHeaders)
      res.end(responseBody)
      this.status.requestsProcessed++
    } catch (err) {
      this.status.errorsCount++
      this.status.lastError = String(err)
      this.sendError(res, 502, `Upstream error: ${err}`)
    }
  }

  private async forwardNonStream(
    res: http.ServerResponse,
    upstream: { url: string; headers: Record<string, string> },
    body: string,
    originalModel: string
  ): Promise<void> {
    try {
      const response = await this.httpPost(upstream.url, upstream.headers, body)
      const responseBody = await this.readNodeStream(response)

      if (response.statusCode && response.statusCode >= 400) {
        res.writeHead(response.statusCode, { 'Content-Type': 'application/json' })
        res.end(responseBody)
        return
      }

      const parsed = safeParseBody(responseBody)
      const anthropicResponse = openAIToAnthropicResponse(parsed, originalModel)
      this.sendJson(res, anthropicResponse)
      this.status.requestsProcessed++
    } catch (err) {
      this.status.errorsCount++
      this.status.lastError = String(err)
      this.sendError(res, 502, `Upstream error: ${err}`)
    }
  }

  private async forwardStream(
    res: http.ServerResponse,
    upstream: { url: string; headers: Record<string, string> },
    body: string,
    originalModel: string
  ): Promise<void> {
    try {
      const response = await this.httpPost(upstream.url, {
        ...upstream.headers,
      }, body)

      if (response.statusCode && response.statusCode >= 400) {
        const errBody = await this.readNodeStream(response)
        res.writeHead(response.statusCode, { 'Content-Type': 'application/json' })
        res.end(errBody)
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      const transformer = new OpenAIToAnthropicStreamTransformer()
      let buffer = ''

      response.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          if (trimmed === 'data: [DONE]') {
            res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n')
            continue
          }
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6)
            const parsed = safeParseBody(jsonStr)
            if (parsed && parsed.choices) {
              const events = transformer.transform(parsed)
              for (const event of events) {
                res.write(event)
              }
            }
          }
        }
      })

      response.on('end', () => {
        res.end()
        this.status.requestsProcessed++
      })

      response.on('error', (err) => {
        this.status.errorsCount++
        this.status.lastError = String(err)
        res.end()
      })
    } catch (err) {
      this.status.errorsCount++
      this.status.lastError = String(err)
      this.sendError(res, 502, `Upstream error: ${err}`)
    }
  }

  private httpPost(
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url)
      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers,
      }

      const httpModule = parsedUrl.protocol === 'https:' ? require('https') : http
      const req = httpModule.request(options, resolve)
      req.on('error', reject)
      req.setTimeout(120000, () => {
        req.destroy(new Error('Upstream request timeout'))
      })
      req.write(body)
      req.end()
    })
  }

  private getDefaultHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'User-Agent': 'SpaceCode-Proxy/1.0',
    }
  }

  private getCompatibleModels(): Record<string, any> {
    return {
      object: 'list',
      data: [
        { id: 'claude-sonnet-4-20250514', object: 'model', created: 1715728400, permission: [], root: 'claude-sonnet-4-20250514' },
        { id: 'claude-opus-4-20250514', object: 'model', created: 1715728400, permission: [], root: 'claude-opus-4-20250514' },
        { id: 'claude-haiku-3-20250514', object: 'model', created: 1715728400, permission: [], root: 'claude-haiku-3-20250514' },
      ],
    }
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => resolve(body))
      req.on('error', reject)
    })
  }

  private readNodeStream(stream: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      stream.on('data', (chunk) => { body += chunk })
      stream.on('end', () => resolve(body))
      stream.on('error', reject)
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
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message } }))
  }
}

function safeParseBody(body: string): Record<string, any> {
  try {
    return JSON.parse(body)
  } catch {
    return {}
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/proxy/server.ts
git commit -m "feat(proxy): implement HTTP proxy server with streaming support"
```

---

## 任务 8：代理子进程入口

**文件：**
- 创建：`electron/proxy/index.ts`

- [ ] **步骤 1：实现代理子进程入口**

```typescript
import { ProxyServer } from './server'
import { ProxyConfig } from './types'

function parseArgs(): ProxyConfig {
  const args = process.argv.slice(2)
  let port = 34567
  let configB64 = ''

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--config' && args[i + 1]) {
      configB64 = args[i + 1]
      i++
    }
  }

  if (!configB64) {
    process.stderr.write('Missing --config argument\n')
    process.exit(1)
  }

  const configJson = Buffer.from(configB64, 'base64').toString('utf8')
  const config: ProxyConfig = JSON.parse(configJson)
  config.port = port
  config.host = config.host || '127.0.0.1'

  return config
}

async function main() {
  const config = parseArgs()
  const server = new ProxyServer(config)

  try {
    await server.start()
    process.stdout.write(JSON.stringify({ type: 'ready', port: config.port }) + '\n')
  } catch (err) {
    process.stderr.write(`Failed to start proxy: ${err}\n`)
    process.exit(1)
  }

  process.on('SIGTERM', async () => {
    await server.stop()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    await server.stop()
    process.exit(0)
  })
}

main()
```

- [ ] **步骤 2：Commit**

```bash
git add electron/proxy/index.ts
git commit -m "feat(proxy): add proxy subprocess entry point"
```

---

## 任务 9：代理进程管理器

**文件：**
- 创建：`electron/proxyManager.ts`

- [ ] **步骤 1：实现 ProxyManager**

```typescript
import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import { ProxyConfig, AdapterStatus } from './proxy/types'
import { info, warn, error, debug } from './logger'

class ProxyManager extends EventEmitter {
  private process: ChildProcess | null = null
  private config: ProxyConfig | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private _proxyUrl: string = ''
  private retryCount = 0
  private readonly MAX_RETRIES = 1

  async start(config: ProxyConfig): Promise<string> {
    if (this.process) {
      if (this._proxyUrl) return this._proxyUrl
      throw new Error('Proxy is starting')
    }

    this.config = config
    this.retryCount = 0

    return this.doStart(config)
  }

  private async doStart(config: ProxyConfig): Promise<string> {
    const proxyScript = this.resolveProxyScript()
    if (!proxyScript) {
      throw new Error('Proxy script not found')
    }

    info('ProxyManager', `Starting proxy on ${config.host}:${config.port}`)

    this.process = spawn(process.execPath, [
      proxyScript,
      '--port', String(config.port),
      '--config', Buffer.from(JSON.stringify(config)).toString('base64'),
    ], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      debug('ProxyManager', `Proxy stderr: ${data.toString().trim()}`)
    })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Proxy start timeout (10s)'))
        this.cleanup()
      }, 10000)

      let readyDetected = false

      this.process!.stdout!.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        for (const line of msg.split('\n')) {
          try {
            const parsed = JSON.parse(line)
            if (parsed.type === 'ready' && !readyDetected) {
              readyDetected = true
              clearTimeout(timeout)
              this._proxyUrl = `http://${config.host}:${config.port}`
              this.startHealthCheck()
              info('ProxyManager', `Proxy ready at ${this._proxyUrl}`)
              this.emit('started', this._proxyUrl)
              resolve(this._proxyUrl)
            }
          } catch {}
        }
      })

      this.process!.on('exit', (code, signal) => {
        clearTimeout(timeout)
        if (!readyDetected) {
          reject(new Error(`Proxy exited before ready with code ${code}`))
        } else {
          warn('ProxyManager', `Proxy exited with code ${code} signal ${signal}`)
          this.emit('exited', code)
          this._proxyUrl = ''
          this.process = null
        }
      })

      this.process!.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
        this.cleanup()
      })
    })
  }

  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }

    if (!this.process) return

    info('ProxyManager', 'Stopping proxy')

    return new Promise((resolve) => {
      const forceKill = setTimeout(() => {
        this.process?.kill('SIGKILL')
        this.cleanup()
        resolve()
      }, 5000)

      this.process!.on('exit', () => {
        clearTimeout(forceKill)
        this.cleanup()
        resolve()
      })

      this.process!.kill('SIGTERM')
    })
  }

  getProxyUrl(): string {
    return this._proxyUrl
  }

  isRunning(): boolean {
    return this.process !== null && this._proxyUrl !== ''
  }

  async getStatus(): Promise<AdapterStatus | null> {
    if (!this._proxyUrl) return null
    try {
      const response = await fetch(`${this._proxyUrl}/status`)
      return await response.json() as AdapterStatus
    } catch {
      return null
    }
  }

  private resolveProxyScript(): string | null {
    const isPackaged = app.isPackaged
    let proxyDir: string

    if (isPackaged) {
      proxyDir = path.join(process.resourcesPath, 'electron', 'proxy')
    } else {
      proxyDir = path.resolve(__dirname, 'proxy')
    }

    const indexPath = path.join(proxyDir, 'index.js')
    if (fs.existsSync(indexPath)) return indexPath

    const tsPath = path.join(proxyDir, 'index.ts')
    if (fs.existsSync(tsPath)) return tsPath

    error('ProxyManager', `Proxy script not found at ${proxyDir}`)
    return null
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval)

    this.healthCheckInterval = setInterval(async () => {
      if (!this._proxyUrl || !this.config) return

      try {
        const res = await fetch(`${this._proxyUrl}/health`)
        if (!res.ok) {
          warn('ProxyManager', 'Proxy health check failed (non-200)')
          this.emit('unhealthy')
        }
      } catch {
        warn('ProxyManager', 'Proxy health check failed (connection error)')
        this.emit('unhealthy')

        if (this.retryCount < this.MAX_RETRIES && this.config) {
          this.retryCount++
          info('ProxyManager', `Attempting proxy restart (retry ${this.retryCount})`)
          try {
            await this.stop()
            await this.doStart(this.config)
          } catch (err) {
            error('ProxyManager', `Proxy restart failed: ${err}`)
          }
        }
      }
    }, 30000)
  }

  private cleanup(): void {
    this.process = null
    this._proxyUrl = ''
  }
}

export const proxyManager = new ProxyManager()
```

- [ ] **步骤 2：Commit**

```bash
git add electron/proxyManager.ts
git commit -m "feat: implement ProxyManager for proxy subprocess lifecycle"
```

---

## 任务 10：CLI 检测器

**文件：**
- 创建：`electron/cliDetector.ts`

- [ ] **步骤 1：实现 CLI 检测器**

```typescript
import { execFile } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { CliDetectionResult, EnvironmentCheck, EnvItemStatus, InstallProgress } from './proxy/types'
import { info, warn, debug } from './logger'

function execCommand(cmd: string, args: string[] = []): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10000 }, (err, stdout) => {
      if (err) {
        resolve('')
        return
      }
      resolve(stdout.trim())
    })
  })
}

export async function detectInstalledCli(): Promise<CliDetectionResult> {
  const platform = process.platform

  const whichCmd = platform === 'win32' ? 'where' : 'which'
  const whichResult = await execCommand(whichCmd, ['claude'])
  if (whichResult) {
    const cliPath = whichResult.split(/\r?\n/)[0].trim()
    const version = await getCliVersion(cliPath)
    info('CliDetector', `Found CLI at ${cliPath} version ${version}`)
    return { available: true, path: cliPath, version }
  }

  const npmRoot = await execCommand('npm', ['root', '-g'])
  if (npmRoot) {
    const cliDir = path.join(npmRoot, '@anthropic-ai', 'claude-code')
    if (fs.existsSync(cliDir)) {
      const binPath = platform === 'win32'
        ? path.join(npmRoot, 'claude.cmd')
        : path.join(npmRoot, '.bin', 'claude')
      if (fs.existsSync(binPath)) {
        const version = await getCliVersion(binPath)
        info('CliDetector', `Found CLI via npm at ${binPath} version ${version}`)
        return { available: true, path: binPath, version }
      }
    }
  }

  const candidates = getCandidatePaths()
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const version = await getCliVersion(candidate)
      info('CliDetector', `Found CLI at candidate path ${candidate} version ${version}`)
      return { available: true, path: candidate, version }
    }
  }

  info('CliDetector', 'Claude Code CLI not found')
  return { available: false, path: null, version: null }
}

async function getCliVersion(cliPath: string): Promise<string | null> {
  try {
    const output = await execCommand(cliPath, ['--version'])
    const match = output.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : output.slice(0, 50) || null
  } catch {
    return null
  }
}

function getCandidatePaths(): string[] {
  const platform = process.platform
  const home = os.homedir()
  const paths: string[] = []

  if (platform === 'win32') {
    paths.push(
      path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      path.join(home, 'AppData', 'Roaming', 'npm', 'claude.ps1'),
    )
  } else {
    paths.push(
      path.join(home, '.local', 'bin', 'claude'),
      path.join(home, '.npm-global', 'bin', 'claude'),
      '/usr/local/bin/claude',
    )
  }

  return paths
}

export async function checkEnvironment(): Promise<EnvironmentCheck> {
  const [nodeVersion, nodePath] = await getNodeInfo()
  const [npmVersion, npmPath] = await getNpmInfo()
  const [gitVersion, gitPath] = await getGitInfo()

  return {
    node: { available: !!nodeVersion, version: nodeVersion, path: nodePath },
    npm: { available: !!npmVersion, version: npmVersion, path: npmPath },
    git: { available: !!gitVersion, version: gitVersion, path: gitPath },
  }
}

async function getNodeInfo(): Promise<[string | null, string | null]> {
  const version = await execCommand('node', ['--version'])
  const nodePath = await execCommand(process.platform === 'win32' ? 'where' : 'which', ['node'])
  return [version || null, nodePath || null]
}

async function getNpmInfo(): Promise<[string | null, string | null]> {
  const version = await execCommand('npm', ['--version'])
  const npmPath = await execCommand(process.platform === 'win32' ? 'where' : 'which', ['npm'])
  return [version || null, npmPath || null]
}

async function getGitInfo(): Promise<[string | null, string | null]> {
  const version = await execCommand('git', ['--version'])
  const gitPath = await execCommand(process.platform === 'win32' ? 'where' : 'which', ['git'])
  return [version ? version.replace('git version ', '') : null, gitPath || null]
}

export async function installCli(
  mainWindow: Electron.BrowserWindow | null,
  onProgress: (progress: InstallProgress) => void
): Promise<{ success: boolean; error?: string }> {
  const env = await checkEnvironment()

  if (!env.node.available) {
    onProgress({ stage: 'downloading', message: '正在安装 Node.js...' })
    const nodeResult = await installDependency('node')
    if (!nodeResult) {
      openDownloadPage('https://nodejs.org/en/download/')
      return { success: false, error: 'Node.js 安装失败，请手动安装后重试' }
    }
  }

  if (!env.git.available) {
    onProgress({ stage: 'downloading', message: '正在安装 Git...' })
    const gitResult = await installDependency('git')
    if (!gitResult) {
      openDownloadPage('https://git-scm.com/downloads')
      return { success: false, error: 'Git 安装失败，请手动安装后重试' }
    }
  }

  onProgress({ stage: 'installing', message: '正在安装 Claude Code CLI...' })

  return new Promise((resolve) => {
    const child = execFile('npm', ['install', '-g', '@anthropic-ai/claude-code'], {
      timeout: 300000,
    }, async (err, stdout, stderr) => {
      if (err) {
        onProgress({ stage: 'error', message: `安装失败: ${err.message}` })
        resolve({ success: false, error: err.message })
        return
      }

      onProgress({ stage: 'verifying', message: '正在验证安装...' })
      const detection = await detectInstalledCli()

      if (detection.available) {
        onProgress({ stage: 'done', message: `安装完成！版本: ${detection.version}` })
        resolve({ success: true })
      } else {
        onProgress({ stage: 'error', message: '安装后未检测到 CLI' })
        resolve({ success: false, error: '安装后未检测到 CLI' })
      }
    })

    if (mainWindow && child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        debug('CliDetector', `npm install: ${data.toString().trim()}`)
      })
    }
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        debug('CliDetector', `npm stderr: ${data.toString().trim()}`)
      })
    }
  })
}

async function installDependency(dep: 'node' | 'git'): Promise<boolean> {
  const platform = process.platform

  if (platform === 'win32') {
    try {
      const cmd = dep === 'node'
        ? 'winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements'
        : 'winget install Git.Git --accept-source-agreements --accept-package-agreements'
      await execCommand('cmd', ['/c', cmd])
      return true
    } catch {
      return false
    }
  }

  if (platform === 'darwin') {
    try {
      const cmd = dep === 'node' ? 'brew install node@lts' : 'brew install git'
      await execCommand('sh', ['-c', cmd])
      return true
    } catch {
      return false
    }
  }

  return false
}

function openDownloadPage(url: string): void {
  const { shell } = require('electron')
  shell.openExternal(url)
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/cliDetector.ts
git commit -m "feat: implement CLI detector with environment check and auto-install"
```

---

## 任务 11：Settings Store 扩展

**文件：**
- 修改：`src/stores/settings.ts`

- [ ] **步骤 1：在 settings.ts 中添加 EngineSource 类型**

在文件顶部 `AuthMethod` 类型定义附近添加：

```typescript
export type EngineSource = 'bundled' | 'installed'
```

在 `AuthSettings` 接口中添加两个字段：

```typescript
export interface AuthSettings {
  // ... 现有字段 ...
  engineSource?: EngineSource
  installedCliPath?: string
}
```

- [ ] **步骤 2：在 Store 中添加 engineSource 的 getter/setter**

在 `useSettingsStore` 中添加：

```typescript
const engineSource = ref<EngineSource>(savedSettings.engineSource || 'bundled')
const installedCliPath = ref<string | null>(savedSettings.installedCliPath || null)

function setEngineSource(source: EngineSource) {
  engineSource.value = source
  saveSettings()
}

function setInstalledCliPath(cliPath: string | null) {
  installedCliPath.value = cliPath
  saveSettings()
}
```

在 return 对象中导出 `engineSource`, `installedCliPath`, `setEngineSource`, `setInstalledCliPath`。

- [ ] **步骤 3：Commit**

```bash
git add src/stores/settings.ts
git commit -m "feat(settings): add engineSource and installedCliPath fields"
```

---

## 任务 12：IPC Handlers + Preload API

**文件：**
- 修改：`electron/claudeCodeIPC.ts`
- 修改：`electron/preload.ts`
- 修改：`src/services/electronAPI.ts`

- [ ] **步骤 1：在 claudeCodeIPC.ts 中添加新的 IPC handlers**

在 `registerClaudeCodeIPC()` 函数末尾添加：

```typescript
import { detectInstalledCli, checkEnvironment, installCli } from './cliDetector'
import { proxyManager } from './proxyManager'

ipcMain.handle('claude-code:detectInstalledCli', async () => {
  return detectInstalledCli()
})

ipcMain.handle('claude-code:checkEnvironment', async () => {
  return checkEnvironment()
})

ipcMain.handle('claude-code:installCli', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  return installCli(win, (progress) => {
    win?.webContents.send('claude-code:installProgress', progress)
  })
})

ipcMain.handle('claude-code:getProxyStatus', async () => {
  return proxyManager.getStatus()
})

ipcMain.handle('claude-code:isProxyRunning', async () => {
  return proxyManager.isRunning()
})
```

- [ ] **步骤 2：在 preload.ts 中添加新的 API**

在 `claudeCode` 对象中添加：

```typescript
detectInstalledCli: () =>
  ipcRenderer.invoke('claude-code:detectInstalledCli'),
checkEnvironment: () =>
  ipcRenderer.invoke('claude-code:checkEnvironment'),
installCli: () =>
  ipcRenderer.invoke('claude-code:installCli'),
onInstallProgress: (callback: (progress: any) => void) => {
  const wrapper = (_: any, data: any) => callback(data)
  ipcRenderer.on('claude-code:installProgress', wrapper)
  return () => ipcRenderer.removeListener('claude-code:installProgress', wrapper)
},
getProxyStatus: () =>
  ipcRenderer.invoke('claude-code:getProxyStatus'),
isProxyRunning: () =>
  ipcRenderer.invoke('claude-code:isProxyRunning'),
```

- [ ] **步骤 3：在 electronAPI.ts 中添加前端 API 封装**

在 `api` 对象中添加对应的封装方法，调用 `electronAPI?.claudeCode?.xxx()`。

- [ ] **步骤 4：Commit**

```bash
git add electron/claudeCodeIPC.ts electron/preload.ts src/services/electronAPI.ts
git commit -m "feat: add IPC handlers and preload API for CLI detection and proxy"
```

---

## 任务 13：SessionProcess 集成

**文件：**
- 修改：`electron/sessionProcess.ts`

- [ ] **步骤 1：修改 resolveCliCommand() 支持官网 CLI**

在 `resolveCliCommand()` 方法开头添加官网模式判断：

```typescript
private resolveCliCommand(): { command: string; args: string[]; launcherEnv?: Record<string, string> } {
  if (this.config.engineSource === 'installed' && this.config.installedCliPath) {
    debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (installed): ${this.config.installedCliPath}`)
    return { command: this.config.installedCliPath, args: [] }
  }

  // ... 现有的内置模式逻辑 ...
}
```

- [ ] **步骤 2：修改 buildEnv() 注入代理 URL**

在 `buildEnv()` 方法中，在现有逻辑之后添加代理注入：

```typescript
private buildEnv(config: SessionConfig): Record<string, string> {
  const env: Record<string, string> = {}
  // ... 现有逻辑保持不变 ...

  if (config.engineSource === 'installed' && config.provider !== 'anthropic') {
    const { proxyManager } = require('./proxyManager')
    const proxyUrl = proxyManager.getProxyUrl()
    if (proxyUrl) {
      env.ANTHROPIC_BASE_URL = proxyUrl
      delete env.OPENAI_BASE_URL
      delete env.OPENAI_API_KEY
      delete env.GEMINI_BASE_URL
      delete env.GEMINI_API_KEY
      delete env.CLAUDE_CODE_USE_OPENAI
      delete env.CLAUDE_CODE_USE_GEMINI
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using proxy: ${proxyUrl}`)
    }
  }

  // ... 其余现有逻辑 ...
}
```

- [ ] **步骤 3：在 SessionConfig 中添加新字段**

在 `electron/claudeCodeProcessManager.ts` 的 `SessionConfig` 接口中添加：

```typescript
engineSource?: 'bundled' | 'installed'
installedCliPath?: string
```

- [ ] **步骤 4：在 EngineSessionConfig 中添加新字段**

在 `electron/engines/types.ts` 的 `EngineSessionConfig` 接口中添加：

```typescript
engineSource?: 'bundled' | 'installed'
installedCliPath?: string
```

- [ ] **步骤 5：在 ClaudeCodeEngine 中传递新字段**

在 `electron/engines/ClaudeCodeEngine.ts` 的 `startSession()` 方法中，将新字段传入 `SessionConfig`：

```typescript
engineSource: config.engineSource as SessionConfig['engineSource'],
installedCliPath: config.installedCliPath,
```

- [ ] **步骤 6：Commit**

```bash
git add electron/sessionProcess.ts electron/claudeCodeProcessManager.ts electron/engines/types.ts electron/engines/ClaudeCodeEngine.ts
git commit -m "feat: integrate engine source and proxy into SessionProcess"
```

---

## 任务 14：EngineSourceSettings.vue 前端组件

**文件：**
- 创建：`src/components/settings/EngineSourceSettings.vue`

- [ ] **步骤 1：实现 EngineSourceSettings 组件**

创建组件，包含以下功能区域：
1. 引擎来源单选（内置/官网）
2. CLI 检测状态显示
3. 环境检查状态（Node.js/npm/Git）
4. 一键安装按钮 + 进度条
5. API 适配器状态（官网模式 + 非 Anthropic API 时）

组件通过 `useSettingsStore()` 读取和保存 `engineSource`，通过 `electronAPI.claudeCode.*` 调用检测和安装 IPC。

- [ ] **步骤 2：Commit**

```bash
git add src/components/settings/EngineSourceSettings.vue
git commit -m "feat(ui): add EngineSourceSettings component"
```

---

## 任务 15：GeneralSettings.vue 集成

**文件：**
- 修改：`src/components/settings/GeneralSettings.vue`

- [ ] **步骤 1：在引擎选择区域下方嵌入 EngineSourceSettings**

在 GeneralSettings.vue 的引擎选择区域之后，添加条件渲染：

```vue
<EngineSourceSettings v-if="config.engineType === 'claude-code'" />
```

导入组件并注册。

- [ ] **步骤 2：Commit**

```bash
git add src/components/settings/GeneralSettings.vue
git commit -m "feat(ui): integrate EngineSourceSettings into GeneralSettings"
```

---

## 任务 16：代理启动集成 + 应用生命周期

**文件：**
- 修改：`electron/main.ts`

- [ ] **步骤 1：在应用启动时根据设置自动启动代理**

在 `main.ts` 的应用就绪回调中，读取设置并按需启动代理：

```typescript
import { proxyManager } from './proxyManager'

app.on('ready', async () => {
  // ... 现有初始化逻辑 ...

  const guiSettings = await loadGuiSettings()
  if (guiSettings?.engineSource === 'installed' && guiSettings?.authMethod !== 'anthropic_compatible') {
    const proxyConfig = buildProxyConfigFromSettings(guiSettings)
    if (proxyConfig) {
      try {
        await proxyManager.start(proxyConfig)
      } catch (err) {
        warn('Main', `Auto-start proxy failed: ${err}`)
      }
    }
  }
})
```

- [ ] **步骤 2：在应用退出时停止代理**

在 `app.on('before-quit')` 中添加：

```typescript
app.on('before-quit', async () => {
  await proxyManager.stop()
})
```

- [ ] **步骤 3：Commit**

```bash
git add electron/main.ts
git commit -m "feat: integrate proxy lifecycle into app startup and shutdown"
```

---

## 任务 17：端到端验证

- [ ] **步骤 1：验证内置模式不受影响**

启动应用，选择内置引擎，确认功能正常。

- [ ] **步骤 2：验证官网模式 + Anthropic API**

1. 选择官网模式
2. 确认 CLI 检测正常
3. 选择 Anthropic API
4. 启动会话，确认直连正常

- [ ] **步骤 3：验证官网模式 + OpenAI 兼容 API**

1. 选择官网模式
2. 选择 OpenAI 兼容 API
3. 确认代理自动启动
4. 启动会话，确认代理转换正常
5. 验证流式响应正常

- [ ] **步骤 4：验证一键安装**

1. 在未安装 CLI 的环境中
2. 选择官网模式
3. 确认环境检测正常
4. 点击一键安装
5. 确认安装进度显示
6. 确认安装后检测正常

- [ ] **步骤 5：Commit**

```bash
git commit --allow-empty -m "test: end-to-end verification of engine switch and API proxy"
```
