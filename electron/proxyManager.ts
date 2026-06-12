import { EventEmitter } from 'events'
import { spawn, type ChildProcess } from 'child_process'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as http from 'http'
import * as net from 'net'
import { pathToFileURL } from 'url'
import type { ProxyConfig, AdapterStatus } from './proxy/types'
import { info, warn, error, debug } from './logger'

const STARTUP_TIMEOUT_MS = 10000
const SHUTDOWN_TIMEOUT_MS = 5000
const HEALTH_CHECK_INTERVAL_MS = 30000
const MAX_HEALTH_RETRIES = 3
const PROXY_PORT_START = 34567
const PROXY_PORT_END = 34667

export class ProxyManager extends EventEmitter {
  private process: ChildProcess | null = null
  private proxyUrl: string = ''
  private config: ProxyConfig | null = null
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private healthRetryCount: number = 0
  private restarting: boolean = false

  async start(config: ProxyConfig): Promise<string> {
    if (this.process) {
      await this.stop()
    }

    const port = await this.findAvailablePort(config.port || PROXY_PORT_START)
    config.port = port
    this.config = config
    this.healthRetryCount = 0

    const proxyScript = this.resolveProxyScript()

    info('ProxyManager', 'Starting proxy subprocess', { port: config.port })

    const spawnArgs = this.buildSpawnArgs(proxyScript)
    const child = spawn(process.execPath, spawnArgs, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process = child

    child.on('error', (err) => {
      error('ProxyManager', 'Proxy subprocess error', { error: err.message })
      this.emit('error', err)
    })

    child.on('exit', (code, signal) => {
      info('ProxyManager', 'Proxy subprocess exited', { code, signal })
      this.process = null
      this.stopHealthCheck()
      this.emit('exit', { code, signal })
    })

    child.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) {
        warn('ProxyManager', `Proxy stderr: ${msg}`)
      }
    })

    const proxyUrl = await this.waitForReady(child)

    this.proxyUrl = proxyUrl
    this.startHealthCheck()

    info('ProxyManager', 'Proxy subprocess ready', { proxyUrl })

    return proxyUrl
  }

  async stop(): Promise<void> {
    this.stopHealthCheck()

    if (!this.process) {
      return
    }

    const child = this.process
    this.process = null

    info('ProxyManager', 'Stopping proxy subprocess')

    return new Promise<void>((resolve) => {
      let resolved = false

      const finish = () => {
        if (!resolved) {
          resolved = true
          resolve()
        }
      }

      child.on('exit', () => {
        finish()
      })

      try {
        child.kill('SIGTERM')
      } catch {
        finish()
        return
      }

      const forceKillTimer = setTimeout(() => {
        warn('ProxyManager', 'Proxy did not exit gracefully, sending SIGKILL')
        try {
          child.kill('SIGKILL')
        } catch {}
        finish()
      }, SHUTDOWN_TIMEOUT_MS)

      child.on('exit', () => {
        clearTimeout(forceKillTimer)
        finish()
      })
    })
  }

  getProxyUrl(): string {
    return this.proxyUrl
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  async getStatus(): Promise<AdapterStatus | null> {
    if (!this.isRunning() || !this.config) {
      return null
    }

    return new Promise<AdapterStatus | null>((resolve) => {
      const url = `http://127.0.0.1:${this.config!.port}/status`

      const req = http.get(url, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString()
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as AdapterStatus)
          } catch {
            resolve(null)
          }
        })
      })

      req.on('error', () => {
        resolve(null)
      })

      req.setTimeout(5000, () => {
        req.destroy()
        resolve(null)
      })
    })
  }

  private waitForReady(child: ChildProcess): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let buffer = ''
      let settled = false

      const finish = (err?: Error, url?: string) => {
        if (settled) return
        settled = true
        if (err) {
          reject(err)
        } else {
          resolve(url!)
        }
      }

      const timeout = setTimeout(() => {
        finish(new Error('Proxy startup timed out'))
      }, STARTUP_TIMEOUT_MS)

      child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          try {
            const msg = JSON.parse(trimmed)
            if (msg.type === 'ready' && typeof msg.port === 'number') {
              clearTimeout(timeout)
              const url = `http://127.0.0.1:${msg.port}`
              finish(undefined, url)
              return
            }
          } catch {}
        }
      })

      child.on('exit', (code) => {
        clearTimeout(timeout)
        finish(new Error(`Proxy process exited before ready with code ${code}`))
      })

      child.on('error', (err) => {
        clearTimeout(timeout)
        finish(err)
      })
    })
  }

  private resolveProxyScript(): string {
    if (app.isPackaged) {
      // 打包后，main.js 位于 app.asar/dist-electron/main.js，
      // proxy 脚本由 build:proxy 编译到 dist-electron/proxy/index.js。
      // 由于 dist-electron/proxy 被配置为 asarUnpack，文件实际存在于
      // app.asar.unpacked/dist-electron/proxy/index.js。
      // 主进程中 __dirname 指向 asar 内路径，Electron fs 会自动重定向；
      // 但代理子进程使用 ELECTRON_RUN_AS_NODE=1，不支持 asar 路径重定向，
      // 因此需要显式解析到 app.asar.unpacked 路径。
      const asarPath = path.join(__dirname, 'proxy', 'index.js')
      const unpackedPath = asarPath.replace(/\.asar([\\/])/, '.asar.unpacked$1')
      // 优先使用 unpacked 路径（子进程需要），如果不存在则回退到 asar 路径
      if (fs.existsSync(unpackedPath)) {
        return unpackedPath
      }
      return asarPath
    }
    const compiledPath = path.join(__dirname, 'proxy', 'index.js')
    if (fs.existsSync(compiledPath)) {
      return compiledPath
    }
    const proxyDir = path.resolve(__dirname, '..', 'electron', 'proxy')
    const sourcePath = path.join(proxyDir, 'index.ts')
    if (fs.existsSync(sourcePath)) {
      return sourcePath
    }
    return compiledPath
  }

  private buildSpawnArgs(proxyScript: string): string[] {
    const portArg = '--port'
    const configArg = '--config'
    const base64Config = Buffer.from(JSON.stringify(this.config)).toString('base64')

    if (!app.isPackaged && proxyScript.endsWith('.ts')) {
      const tsxPath = this.resolveTsxPath()
      if (tsxPath) {
        return ['--import', pathToFileURL(tsxPath).href, proxyScript, portArg, String(this.config!.port), configArg, base64Config]
      }
    }

    return [proxyScript, portArg, String(this.config!.port), configArg, base64Config]
  }

  private resolveTsxPath(): string | null {
    const candidates = [
      path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'loader.mjs'),
      path.join(process.cwd(), 'node_modules', '.bin', 'tsx'),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) return p
    }
    return null
  }

  private startHealthCheck(): void {
    this.stopHealthCheck()
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck()
    }, HEALTH_CHECK_INTERVAL_MS)
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  private async performHealthCheck(): Promise<void> {
    if (!this.isRunning() || !this.config) {
      return
    }

    try {
      const healthy = await this.checkHealth()
      if (healthy) {
        this.healthRetryCount = 0
        debug('ProxyManager', 'Health check passed')
      } else {
        this.handleHealthCheckFailure()
      }
    } catch {
      this.handleHealthCheckFailure()
    }
  }

  private checkHealth(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this.config) {
        resolve(false)
        return
      }

      const url = `http://127.0.0.1:${this.config.port}/health`

      const req = http.get(url, (res) => {
        resolve(res.statusCode === 200)
      })

      req.on('error', () => {
        resolve(false)
      })

      req.setTimeout(5000, () => {
        req.destroy()
        resolve(false)
      })
    })
  }

  private async handleHealthCheckFailure(): Promise<void> {
    this.healthRetryCount++
    warn('ProxyManager', `Health check failed (retry ${this.healthRetryCount}/${MAX_HEALTH_RETRIES})`)

    if (this.healthRetryCount > MAX_HEALTH_RETRIES) {
      error('ProxyManager', 'Max health check retries exceeded, restarting proxy')
      await this.restartProxy()
    }
  }

  private async restartProxy(): Promise<void> {
    if (this.restarting || !this.config) {
      return
    }

    this.restarting = true
    this.emit('restarting')

    try {
      await this.stop()
      await this.start(this.config)
      info('ProxyManager', 'Proxy restarted successfully')
    } catch (err) {
      error('ProxyManager', 'Failed to restart proxy', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      this.restarting = false
    }
  }

  private findAvailablePort(startPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let port = startPort
      const tryPort = () => {
        if (port > PROXY_PORT_END) {
          reject(new Error(`No available port in range ${PROXY_PORT_START}-${PROXY_PORT_END}`))
          return
        }
        const server = net.createServer()
        server.listen(port, '127.0.0.1', () => {
          server.close(() => resolve(port))
        })
        server.on('error', () => {
          port++
          tryPort()
        })
      }
      tryPort()
    })
  }
}

export const proxyManager = new ProxyManager()
