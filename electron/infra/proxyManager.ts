import { EventEmitter } from 'events'
import { spawn, type ChildProcess } from 'child_process'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as http from 'http'
import * as net from 'net'
import { pathToFileURL } from 'url'
import type { ProxyConfig, AdapterStatus } from '../proxy/types'
import { info, warn, error, debug } from './logger'

const STARTUP_TIMEOUT_MS = 10000
const SHUTDOWN_TIMEOUT_MS = 5000
const HEALTH_CHECK_INTERVAL_MS = 30000
const MAX_HEALTH_RETRIES = 3
const PROXY_PORT_START = 34567
const PROXY_PORT_END = 34667

/**
 * 从 gui-settings.json 的解析结果构建代理配置。
 *
 * modelMapping 取各 provider 槽位配置的实际模型名（haikuModel/sonnetModel/
 * opusModel），代理按子串把引擎请求中的路由 ID（如 claude-sonnet-4-20250514）
 * 映射到这些实际模型。启动自启、engineSource 切换、设置保存对齐
 * （main.ts reconcileProxyWithSettings）与 sessionProcess 的按需兜底启动
 * 共用此函数，保证各路径的映射一致。
 */
export function buildProxyConfigFromSettings(guiSettings: Record<string, any>): ProxyConfig | null {
  const authMethod = guiSettings.authMethod
  if (!authMethod) return null

  let upstreamProvider: ProxyConfig['upstreamProvider']
  let upstreamBaseUrl = ''
  let upstreamApiKey = ''
  const modelMapping: ProxyConfig['modelMapping'] = {}

  if (authMethod === 'openai_compatible' && guiSettings.openaiConfig) {
    const cfg = guiSettings.openaiConfig
    upstreamProvider = 'openai_compatible'
    upstreamBaseUrl = (cfg.baseUrl || '').trim()
    upstreamApiKey = (cfg.apiKey || '').trim()
    if (cfg.haikuModel) modelMapping.haikuModel = cfg.haikuModel.trim()
    if (cfg.sonnetModel) modelMapping.sonnetModel = cfg.sonnetModel.trim()
    if (cfg.opusModel) modelMapping.opusModel = cfg.opusModel.trim()
    if (cfg.sonnetModel) modelMapping.defaultModel = cfg.sonnetModel.trim()
  } else if (authMethod === 'gemini_api' && guiSettings.geminiConfig) {
    const cfg = guiSettings.geminiConfig
    upstreamProvider = 'openai_compatible'
    upstreamBaseUrl = (cfg.baseUrl || '').trim()
    upstreamApiKey = (cfg.apiKey || '').trim()
    if (cfg.haikuModel) modelMapping.haikuModel = cfg.haikuModel.trim()
    if (cfg.sonnetModel) modelMapping.sonnetModel = cfg.sonnetModel.trim()
    if (cfg.opusModel) modelMapping.opusModel = cfg.opusModel.trim()
    if (cfg.sonnetModel) modelMapping.defaultModel = cfg.sonnetModel.trim()
  } else if ((authMethod === 'anthropic_compatible' || authMethod === 'claudeai' || authMethod === 'console') && guiSettings.anthropicConfig) {
    const cfg = guiSettings.anthropicConfig
    upstreamProvider = 'anthropic'
    upstreamBaseUrl = (cfg.baseUrl || '').trim()
    upstreamApiKey = (cfg.apiKey || '').trim()
    if (cfg.haikuModel) modelMapping.haikuModel = cfg.haikuModel.trim()
    if (cfg.sonnetModel) modelMapping.sonnetModel = cfg.sonnetModel.trim()
    if (cfg.opusModel) modelMapping.opusModel = cfg.opusModel.trim()
    if (cfg.sonnetModel) modelMapping.defaultModel = cfg.sonnetModel.trim()
  } else {
    return null
  }

  if (!upstreamBaseUrl || !upstreamApiKey) return null

  return {
    host: '127.0.0.1',
    port: 34567,
    upstreamProvider,
    upstreamBaseUrl,
    upstreamApiKey,
    modelMapping,
  }
}

/**
 * 影响代理路由的配置字段是否一致（端口不算：它由代理自己占位决定，换个端口不是换套上游）。
 * 保存后的对齐与 `ensureRunning` 的"要不要重启"共用这个判据。
 */
export function isSameProxyConfig(a: ProxyConfig, b: ProxyConfig): boolean {
  return a.upstreamProvider === b.upstreamProvider
    && a.upstreamBaseUrl === b.upstreamBaseUrl
    && a.upstreamApiKey === b.upstreamApiKey
    && a.modelMapping.haikuModel === b.modelMapping.haikuModel
    && a.modelMapping.sonnetModel === b.modelMapping.sonnetModel
    && a.modelMapping.opusModel === b.modelMapping.opusModel
    && a.modelMapping.defaultModel === b.modelMapping.defaultModel
}

export class ProxyManager extends EventEmitter {
  private process: ChildProcess | null = null
  private proxyUrl: string = ''
  private config: ProxyConfig | null = null
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private healthRetryCount: number = 0
  private restarting: boolean = false
  /** 正在跑的启动队列；并发的 start() 挂在同一个 Promise 上等最终结果。 */
  private startPromise: Promise<string> | null = null
  /** 队列最新收到的配置 —— 后到的覆盖先到的，最后一次请求赢。 */
  private desiredConfig: ProxyConfig | null = null
  private lastHealthStatus: 'unknown' | 'healthy' | 'unhealthy' = 'unknown'

  /**
   * 启动代理子进程。如果代理已经在运行，会先停止再重启。
   *
   * 已有 start() 在飞时，把新配置记下来挂进同一个队列，等当前这次落地后再起一次 ——
   * 直接返回在飞那次的 Promise 会把后来的配置丢掉（启动自启、设置保存对齐、
   * engineSourceChanged 都可能与另一次保存撞在一起）。等待方拿到的是队列排空后的
   * 最终 URL，所以"启动完成"意味着跑的就是最后一次请求带来的配置。
   */
  async start(config: ProxyConfig): Promise<string> {
    // 队列已经在趋奔同一份上游配置，重复请求不必再起一个子进程。
    if (this.startPromise && this.desiredConfig && isSameProxyConfig(this.desiredConfig, config)) {
      debug('ProxyManager', 'start() already queued for the same config, reusing it')
      return this.startPromise
    }

    this.desiredConfig = config
    if (this.startPromise) {
      debug('ProxyManager', 'start() queued behind an in-flight start')
      return this.startPromise
    }

    this.startPromise = this.drainStartQueue()
    return this.startPromise
  }

  private async drainStartQueue(): Promise<string> {
    try {
      let url = this.proxyUrl
      // `handled` 按对象身份比对：只有"最新请求还没整个跑过"时才再起一次。
      let handled: ProxyConfig | null = null
      while (this.desiredConfig !== handled) {
        const config: ProxyConfig = this.desiredConfig!
        url = await this.doStart(config)
        handled = config
      }
      return url
    } finally {
      this.startPromise = null
    }
  }

  /**
   * 确保代理正在运行。如果已经在运行且上游配置一致则不重启，避免不必要的 stop+start 循环。
   *
   * 引擎来源切换时调用此方法而非 start()，因为代理配置取决于 authMethod
   * 和 API 设置，与 engineSource 无关。
   */
  async ensureRunning(config: ProxyConfig): Promise<string> {
    if (this.startPromise) {
      // 先让在飞的那次落地再判 —— 拿别人的结果当答案会丢掉本次带来的配置。
      const settledUrl = await this.startPromise.catch(() => null)
      if (settledUrl === null) return this.start(config)
      if (this.config && isSameProxyConfig(this.config, config)) return settledUrl
      debug('ProxyManager', 'ensureRunning: running proxy uses a different config, aligning')
      return this.start(config)
    }
    if (this.isRunning()) {
      debug('ProxyManager', 'ensureRunning: proxy already running, skipping restart')
      return this.proxyUrl
    }
    return this.start(config)
  }

  private async doStart(config: ProxyConfig): Promise<string> {
    if (this.process) {
      await this.stop()
    }

    const port = await this.findAvailablePort(config.port || PROXY_PORT_START)
    config.port = port
    this.config = config
    this.healthRetryCount = 0
    this.lastHealthStatus = 'unknown'

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

  /** 当前运行中代理的配置快照（未启动时为 null），用于对比配置是否变化 */
  getConfig(): ProxyConfig | null {
    return this.config
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
      const packagedCandidates = [
        path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'proxy', 'index.js'),
        path.join(__dirname, 'proxy', 'index.js').replace(/\.asar([\\/])/, '.asar.unpacked$1'),
        path.join(__dirname, 'proxy', 'index.js'),
      ]
      for (const candidate of packagedCandidates) {
        if (fs.existsSync(candidate)) return candidate
      }
      return packagedCandidates[0]
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
        // 仅在状态变化时打印（首次成功 / 从故障恢复），避免每 30s 刷屏
        if (this.lastHealthStatus !== 'healthy') {
          if (this.lastHealthStatus === 'unhealthy') {
            info('ProxyManager', 'Health check passed (recovered)')
          } else {
            debug('ProxyManager', 'Health check passed')
          }
          this.lastHealthStatus = 'healthy'
        }
      } else {
        this.lastHealthStatus = 'unhealthy'
        this.handleHealthCheckFailure()
      }
    } catch {
      this.lastHealthStatus = 'unhealthy'
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
    if (this.restarting || !this.config || this.startPromise) {
      return
    }

    this.restarting = true
    this.emit('restarting')

    try {
      // 走 start() 那把锁：直接 doStart 会和外部一次保存触发的启动并发，起两个子进程。
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
