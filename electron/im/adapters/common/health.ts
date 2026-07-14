/**
 * Health — Adapter health check endpoint
 *
 * Exposes a lightweight HTTP endpoint for the server to monitor adapter health.
 * The server polls /health every 30s and restarts the adapter after 3 consecutive 'down' responses.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'

export type HealthStatus = 'ok' | 'degraded' | 'down'

export interface HealthReport {
  status: HealthStatus
  platform: string
  wsConnected: boolean
  activeChatIds: number
  uptime: number
  lastError?: string
}

export interface HealthServerOptions {
  port: number
  platform: string
  getReport: () => HealthReport
}

export class HealthServer {
  private server: ReturnType<typeof createServer> | null = null
  private readonly port: number
  private readonly platform: string
  private readonly getReport: () => HealthReport
  private startTime: number = Date.now()

  constructor(opts: HealthServerOptions) {
    this.port = opts.port
    this.platform = opts.platform
    this.getReport = opts.getReport
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res))

    return new Promise((resolve) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        resolve()
      })
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  get uptime(): number {
    return Date.now() - this.startTime
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === '/health' && req.method === 'GET') {
      const report = this.getReport()
      const statusCode = report.status === 'down' ? 503 : 200

      res.writeHead(statusCode, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(report))
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  }
}
