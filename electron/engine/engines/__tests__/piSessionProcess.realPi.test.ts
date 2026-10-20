// @vitest-environment node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * 真 pi 子进程核验（issue #42 第 3、4、6 项）。
 *
 * 单元层只能证明「我们把帧拼对了」，证明不了 pi 认不认这些帧。这里起真的
 * `pi --mode rpc`，把它的上游指到一个本地假 OpenAI 兼容接口上，然后看接口
 * 真正收到了什么：
 *  - 图片是不是作为 image_url 进了请求体（而不是 @"路径"）
 *  - 用户配的 32000 上下文窗口有没有被模型注册信息采用
 *  - 挂起再恢复之后，第二次请求体里还在不在第一轮的用户消息
 *  - 进程整个换掉（应用重启那条路）之后，只凭会话文件路径还接不接得上历史
 *
 * 不进 CI：需要本机装有 @earendil-works/pi-coding-agent，且会起子进程。显式跑：
 *   PI_REAL=1 npx vitest run electron/engine/engines/__tests__/piSessionProcess.realPi.test.ts
 * 全程用临时 HOME，不碰真实的 ~/.pi；假上游不含任何真实凭据。
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.join(REPO_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const ENABLED = process.env.PI_REAL === '1' && fs.existsSync(CLI)

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}))

// 日志模块自己会决定落盘位置；探针里只要能在失败时看见内容就够
vi.mock('../../../infra/logger', () => ({
  info: (...args: unknown[]) => console.log('[info]', ...args),
  warn: (...args: unknown[]) => console.warn('[warn]', ...args),
  error: (...args: unknown[]) => console.error('[error]', ...args),
  debug: () => {},
}))

import { PiSessionProcess } from '../PiSessionProcess'
import type { EngineSessionConfig, ImageAttachment } from '../types'

const MODEL = 'audit-model'
const TURN1 = '第一轮：请记住关键词 banana'
const TURN2 = '第二轮：我刚才让你记住的关键词是什么'
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let probeHome: string
let workspace: string
let server: Server
let port = 0
/** 上游收到的每一个请求体（原文），顺序即到达顺序 */
let captured: string[] = []

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({
    id: 'probe-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: MODEL,
    choices: [{ index: 0, delta: content === null ? {} : { role: 'assistant', content }, finish_reason: content === null ? 'stop' : null }],
  })}\n\n`
}

function startFakeUpstream(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.includes('chat/completions')) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end('{}')
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        captured.push(raw)
        const wantsStream = /"stream"\s*:\s*true/.test(raw)
        if (wantsStream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
          res.write(sseChunk('收到'))
          res.write(sseChunk(null as unknown as string))
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: 'probe-1',
          object: 'chat.completion',
          created: 1,
          model: MODEL,
          choices: [{ index: 0, message: { role: 'assistant', content: '收到' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  })
}

/** sendMessage 只在"帧被接受"时返回，一轮真正跑完要看 agent_end */
function waitForTurnEnd(proc: PiSessionProcess, timeoutMs = 90_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('真 pi 一轮未在时限内结束'))
    }, timeoutMs)
    const onMessage = (event: any) => {
      if (event?.type === 'agent_end') {
        cleanup()
        resolve()
      }
    }
    const onExit = (code: unknown) => {
      cleanup()
      reject(new Error(`pi 进程提前退出 | code=${String(code)}`))
    }
    const cleanup = () => {
      clearTimeout(timer)
      proc.off('message', onMessage)
      proc.off('exit', onExit)
    }
    proc.on('message', onMessage)
    proc.on('exit', onExit)
  })
}

function makeProcess(sessionId: string, resumeSessionFile?: string): PiSessionProcess {
  const config: EngineSessionConfig = {
    cwd: workspace,
    provider: 'openai',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: MODEL,
    apiKey: 'probe-key-not-a-secret',
    thinkingEnabled: false,
    engineType: 'pi',
    modelContextWindows: { [MODEL]: 32000 },
  }
  const proc = new PiSessionProcess(sessionId, config, resumeSessionFile)
  proc.on('error', () => {})
  return proc
}

function pngAttachment(): ImageAttachment {
  return {
    id: 'img-1',
    name: 'pixel.png',
    type: 'image',
    mimeType: 'image/png',
    previewUrl: '',
    data: `data:image/png;base64,${PNG_B64}`,
  }
}

describe.skipIf(!ENABLED)('真 pi 子进程核验', () => {
  beforeAll(async () => {
    if (!ENABLED) return
    probeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-probe-home-')))
    workspace = path.join(probeHome, 'ws')
    fs.mkdirSync(workspace, { recursive: true })
    // PiSessionProcess 用 os.homedir() 定位 ~/.pi/agent/models.json，pi 也按同一个 HOME 取配置目录
    process.env.HOME = probeHome
    process.env.USERPROFILE = probeHome
    process.env.PI_CODING_AGENT_DIR = path.join(probeHome, '.pi', 'agent')
    process.env.PI_OFFLINE = '1'
    process.env.PI_TELEMETRY = '0'
    process.env.PI_SKIP_VERSION_CHECK = '1'
    captured = []
    await startFakeUpstream()
  }, 120_000)

  afterAll(() => {
    if (!server) return
    server.close()
    if (probeHome) fs.rmSync(probeHome, { recursive: true, force: true })
  })

  it('图片进得了请求体、用户配的窗口进得了模型注册、挂起恢复后历史还在', async () => {
    const proc = makeProcess('pi-probe-1')
    await proc.start()

    // 第 4 项：图片必须作为图像内容送到上游（而不是 @"路径"）
    const firstTurn = waitForTurnEnd(proc)
    await proc.sendMessage(TURN1, [pngAttachment()])
    await firstTurn
    const withImage = captured.find((body) => body.includes('image_url') && body.includes(PNG_B64))
    expect(withImage, '上游请求体里没有 image_url 载荷').toBeTruthy()
    expect(withImage).toContain('banana')
    expect(withImage).not.toContain('@\\\\"')

    // 第 6 项：注册给 pi 的模型带上用户配置的上下文窗口
    const models = await (proc as any).rpcRequest(
      (proc as any)._process,
      { type: 'get_available_models' },
      10_000,
      'Timeout waiting for models',
    )
    const registered = (models?.data?.models ?? []).find((m: any) => m.id === MODEL)
    expect(registered?.contextWindow).toBe(32000)

    // 第 3 项：挂起→恢复之后，上游要还能看见第一轮的用户消息
    await proc.suspend()
    expect(proc.getPiSessionFile()).toMatch(/\.jsonl$/)

    const beforeResume = captured.length
    await proc.resume()
    const secondTurn = waitForTurnEnd(proc)
    await proc.sendMessage(TURN2)
    await secondTurn

    expect(captured.length).toBeGreaterThan(beforeResume)
    const resumedRequests = captured.slice(beforeResume)
    const lastRequest = resumedRequests[resumedRequests.length - 1]
    // 历史连着图片一起带回来：第二轮的请求体里既有第一轮的消息，也有第一轮的图
    expect(lastRequest).toContain(TURN2)
    expect(lastRequest).toContain('banana')
    expect(lastRequest).toContain(PNG_B64)

    await proc.kill()
  }, 240_000)

  it('进程被丢掉重建（应用重启那条路）后，带 --session 的新进程还接得上第一轮', async () => {
    const proc = makeProcess('pi-probe-restart')
    await proc.start()

    const firstTurn = waitForTurnEnd(proc)
    await proc.sendMessage(TURN1)
    await firstTurn
    expect(captured[captured.length - 1]).toContain('banana')

    // 不问一次 get_state 就没人知道这份历史写在哪个文件上 —— 这个动作原先只有挂起路径有
    await proc.captureSessionFile(30_000)
    const sessionFile = proc.getPiSessionFile()
    expect(sessionFile, '没问到 pi 的会话文件').toMatch(/\.jsonl$/)

    await proc.kill() // 模拟应用退出：进程连同它内存里那份路径一起没了

    const beforeRespawn = captured.length
    const respawned = makeProcess('pi-probe-restart', sessionFile!)
    await respawned.start()
    const secondTurn = waitForTurnEnd(respawned)
    await respawned.sendMessage(TURN2)
    await secondTurn

    const respawnRequests = captured.slice(beforeRespawn)
    const lastRequest = respawnRequests[respawnRequests.length - 1]
    expect(lastRequest).toContain(TURN2)
    expect(lastRequest, '重建的进程没把第一轮历史带进去').toContain('banana')

    await respawned.kill()
  }, 240_000)
})
