import * as http from 'http'
import * as https from 'https'
import { URL } from 'url'
import { ProxyConfig, AdapterStatus } from './types'
import { anthropicToOpenAIRequest, openAIToAnthropicResponse } from './transformer'
import { OpenAIToAnthropicStreamTransformer } from './streamingTransformer'
import { buildUpstreamRequest } from './authHandler'
import { applyModelMapping } from './modelMapper'
import { SSEParser } from './sseParser'

export class ProxyServer {
  private config: ProxyConfig
  private server: http.Server | null = null
  private requestsProcessed = 0
  private errorsCount = 0
  private lastError: string | undefined
  private startTime: number | undefined

  constructor(config: ProxyConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    if (this.server) return

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res)
    })

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this.startTime = Date.now()
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null
        resolve()
      })
    })
  }

  getStatus(): AdapterStatus {
    return {
      running: this.server !== null,
      port: this.config.port,
      requestsProcessed: this.requestsProcessed,
      errorsCount: this.errorsCount,
      lastError: this.lastError,
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.setCORSHeaders(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const path = url.pathname

    switch (path) {
      case '/health':
        this.handleHealth(res)
        break
      case '/status':
        this.handleStatus(res)
        break
      case '/v1/messages':
        this.handleMessages(req, res)
        break
      case '/v1/chat/completions':
        this.handleChatCompletions(req, res)
        break
      case '/v1/models':
        this.handleModels(res)
        break
      default:
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
    }
  }

  private setCORSHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version')
  }

  private handleHealth(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
  }

  private handleStatus(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(this.getStatus()))
  }

  private handleModels(res: http.ServerResponse): void {
    const models = []
    const mapping = this.config.modelMapping
    if (mapping.defaultModel) models.push({ id: mapping.defaultModel, object: 'model', owned_by: 'spacecode-proxy' })
    if (mapping.haikuModel) models.push({ id: mapping.haikuModel, object: 'model', owned_by: 'spacecode-proxy' })
    if (mapping.sonnetModel) models.push({ id: mapping.sonnetModel, object: 'model', owned_by: 'spacecode-proxy' })
    if (mapping.opusModel) models.push({ id: mapping.opusModel, object: 'model', owned_by: 'spacecode-proxy' })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: models }))
  }

  private handleMessages(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'method_not_allowed', message: 'Method not allowed' } }))
      return
    }

    this.readBody(req).then(body => {
      const parsed = JSON.parse(body)
      this.requestsProcessed++

      if (this.config.upstreamProvider === 'anthropic') {
        this.forwardDirect(parsed, res)
      } else {
        this.forwardWithTransform(parsed, res)
      }
    }).catch(err => {
      this.sendError(err, res)
    })
  }

  private handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Method not allowed', type: 'invalid_request_error' } }))
      return
    }

    this.readBody(req).then(body => {
      const parsed = JSON.parse(body)
      applyModelMapping(parsed, this.config.modelMapping)
      this.requestsProcessed++

      const upstream = buildUpstreamRequest('/v1/chat/completions', parsed, this.config)
      const isStream = parsed.stream === true
      const bodyStr = JSON.stringify(parsed)

      if (isStream) {
        this.streamUpstream(upstream, bodyStr, res, false)
      } else {
        this.sendUpstream(upstream, bodyStr, res, false)
      }
    }).catch(err => {
      this.sendError(err, res)
    })
  }

  private forwardDirect(body: Record<string, any>, res: http.ServerResponse): void {
    applyModelMapping(body, this.config.modelMapping)
    const upstream = buildUpstreamRequest('/v1/messages', body, this.config)
    const isStream = body.stream === true
    const bodyStr = JSON.stringify(body)

    if (isStream) {
      this.streamUpstream(upstream, bodyStr, res, false)
    } else {
      this.sendUpstream(upstream, bodyStr, res, false)
    }
  }

  private forwardWithTransform(body: Record<string, any>, res: http.ServerResponse): void {
    applyModelMapping(body, this.config.modelMapping)
    const openaiBody = anthropicToOpenAIRequest(body)
    const upstream = buildUpstreamRequest('/v1/messages', openaiBody, this.config)
    const isStream = body.stream === true
    const bodyStr = JSON.stringify(openaiBody)

    if (isStream) {
      this.streamUpstream(upstream, bodyStr, res, true)
    } else {
      this.sendUpstream(upstream, bodyStr, res, true)
    }
  }

  private sendUpstream(
    upstream: { url: string; headers: Record<string, string> },
    body: string,
    clientRes: http.ServerResponse,
    transformResponse: boolean,
  ): void {
    const parsedUrl = new URL(upstream.url)
    const bodyBuffer = Buffer.from(body)
    const headers = { ...upstream.headers, 'Content-Length': String(bodyBuffer.length) }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80'),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers,
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http
    const req = transport.request(options, (upstreamRes) => {
      if (upstreamRes.statusCode !== 200) {
        this.forwardErrorResponse(upstreamRes, clientRes)
        return
      }

      let data = ''
      upstreamRes.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
      upstreamRes.on('end', () => {
        try {
          const response = JSON.parse(data)
          const finalResponse = transformResponse ? openAIToAnthropicResponse(response) : response
          clientRes.writeHead(200, { 'Content-Type': 'application/json' })
          clientRes.end(JSON.stringify(finalResponse))
        } catch (err) {
          this.sendError(err, clientRes)
        }
      })
    })

    req.on('error', (err) => {
      this.sendError(err, clientRes)
    })

    req.write(bodyBuffer)
    req.end()
  }

  private streamUpstream(
    upstream: { url: string; headers: Record<string, string> },
    body: string,
    clientRes: http.ServerResponse,
    transformStream: boolean,
  ): void {
    const parsedUrl = new URL(upstream.url)
    const bodyBuffer = Buffer.from(body)
    const headers = { ...upstream.headers, 'Content-Length': String(bodyBuffer.length) }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80'),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers,
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http
    const req = transport.request(options, (upstreamRes) => {
      if (upstreamRes.statusCode !== 200) {
        this.forwardErrorResponse(upstreamRes, clientRes)
        return
      }

      if (transformStream) {
        clientRes.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        })

        const parser = new SSEParser()
        const transformer = new OpenAIToAnthropicStreamTransformer()

        upstreamRes.on('data', (chunk: Buffer) => {
          const events = parser.feed(chunk.toString())
          for (const event of events) {
            const output = transformer.transform(event)
            for (const sse of output) {
              clientRes.write(sse)
            }
          }
        })

        upstreamRes.on('end', () => {
          const remaining = transformer.finish()
          for (const sse of remaining) {
            clientRes.write(sse)
          }
          clientRes.end()
        })

        upstreamRes.on('error', (err) => {
          this.sendError(err, clientRes)
        })
      } else {
        clientRes.writeHead(upstreamRes.statusCode!, upstreamRes.headers as Record<string, string>)
        upstreamRes.pipe(clientRes)
      }
    })

    req.on('error', (err) => {
      this.sendError(err, clientRes)
    })

    req.write(bodyBuffer)
    req.end()
  }

  private forwardErrorResponse(upstreamRes: http.IncomingMessage, clientRes: http.ServerResponse): void {
    this.errorsCount++
    let data = ''
    upstreamRes.on('data', (chunk: Buffer) => {
      data += chunk.toString()
    })
    upstreamRes.on('end', () => {
      this.lastError = `Upstream error: ${upstreamRes.statusCode}`
      clientRes.writeHead(upstreamRes.statusCode!, { 'Content-Type': 'application/json' })
      clientRes.end(data)
    })
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString()))
      req.on('error', reject)
    })
  }

  private sendError(err: any, res: http.ServerResponse): void {
    this.errorsCount++
    this.lastError = err?.message || String(err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
    }
    res.end(JSON.stringify({ type: 'error', error: { type: 'internal_error', message: this.lastError } }))
  }
}
