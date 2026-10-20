// @vitest-environment node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * issue #45 的验收项：真 pi 子进程 + 本地假 OpenAI 兼容上游。
 *
 * 单元层只能证明「帧拼对了、回执判定对了」。plan 下到底写不写得进文件，取决于
 * `@narumitw/pi-plan-mode` 在真进程里装没装进来、它认不认我们发的 `/plan start`、
 * 以及它拦不拦得住 `write` —— 这三件事只有真的跑一遍才知道。
 *
 * 上游第一轮只回一个 write 工具调用（写 workspace 里的 out.txt），第二轮收尾。
 * 断言的是：目标文件没出现、宿主收到了扩展「plan active」的回执、而工具结果是失败而非成功。
 *
 * 不进 CI：需要本机装有 @earendil-works/pi-coding-agent 与 @narumitw/pi-plan-mode，且会起子进程。
 * 显式跑：
 *   PI_REAL=1 npx vitest run electron/engine/engines/__tests__/piSessionProcess.planMode.realPi.test.ts
 * 全程用临时 HOME 与临时工作区，不碰真实的 ~/.pi，也不碰仓库。
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.join(REPO_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const EXTENSION = path.join(REPO_ROOT, 'node_modules', '@narumitw', 'pi-plan-mode', 'dist', 'index.ts')
const ENABLED = process.env.PI_REAL === '1' && fs.existsSync(CLI) && fs.existsSync(EXTENSION)

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}))

vi.mock('../../../infra/logger', () => ({
  info: (...args: unknown[]) => console.log('[info]', ...args),
  warn: (...args: unknown[]) => console.warn('[warn]', ...args),
  error: (...args: unknown[]) => console.error('[error]', ...args),
  debug: () => {},
}))

import { PiSessionProcess } from '../PiSessionProcess'
import type { EngineSessionConfig } from '../types'

const MODEL = 'plan-probe-model'
const TARGET = 'out.txt'
const PROMPT = '把 hello 写进 out.txt，直接用 write 工具'

let probeHome: string
let workspace: string
let server: Server
let port = 0
/** 上游收到的请求体，顺序即到达顺序 */
let captured: string[] = []

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function chunk(delta: Record<string, unknown>, finish: string | null): string {
  return sse({
    id: 'probe-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
}

/** 第一轮：只回一个 write 工具调用 */
const TOOL_CALL_STREAM = [
  chunk({ role: 'assistant', tool_calls: [{
    index: 0,
    id: 'call-write-1',
    type: 'function',
    function: { name: 'write', arguments: JSON.stringify({ path: TARGET, content: 'hello from plan mode' }) },
  }] }, null),
  chunk({}, 'tool_calls'),
].join('')

/** 其余轮：收尾 */
const FINAL_STREAM = [
  chunk({ role: 'assistant', content: '好。' }, null),
  chunk({}, 'stop'),
].join('')

function startFakeUpstream(): Promise<void> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.includes('chat/completions')) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end('{}')
        return
      }
      const parts: Buffer[] = []
      req.on('data', (c: Buffer) => parts.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(parts).toString('utf8')
        captured.push(raw)
        const body = JSON.parse(raw) as { messages: Array<{ role: string; tool_calls?: unknown[] }> }
        const alreadyRanTool = body.messages.some(m => m.role === 'tool' || (Array.isArray(m.tool_calls) && m.tool_calls.length > 0))

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        res.write(alreadyRanTool ? FINAL_STREAM : TOOL_CALL_STREAM)
        res.write('data: [DONE]\n\n')
        res.end()
      })
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  })
}

function waitForAgentEnd(proc: PiSessionProcess, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      proc.off('message', onMessage)
      proc.off('exit', onExit)
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error('真 pi 一轮未在时限内结束')) }, timeoutMs)
    const onMessage = (event: any) => {
      if (event?.type === 'agent_end') { cleanup(); resolve() }
    }
    const onExit = (code: unknown) => { cleanup(); reject(new Error(`pi 进程提前退出 | code=${String(code)}`)) }
    proc.on('message', onMessage)
    proc.on('exit', onExit)
  })
}

function makeProcess(): PiSessionProcess {
  const config: EngineSessionConfig = {
    cwd: workspace,
    provider: 'openai',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: MODEL,
    apiKey: 'probe-key-not-a-secret',
    thinkingEnabled: false,
    engineType: 'pi',
    permissionMode: 'plan',
  }
  const proc = new PiSessionProcess('pi-plan-real-1', config)
  proc.on('error', () => {})
  return proc
}

/**
 * 上游收到的每一条 tool 结果。模型就是看着这句话决定「写不进去」的，
 * 而它也是「write 真的进过执行流程」的唯一凭据 —— 没有它，文件不存在只说明上游没调工具。
 */
function toolResults(): string[] {
  return captured.flatMap(body => {
    const parsed = JSON.parse(body) as { messages?: Array<{ role: string; content?: unknown }> }
    return (parsed.messages ?? []).filter(m => m.role === 'tool').map(m => String(m.content))
  })
}

describe.skipIf(!ENABLED)('真 pi 子进程核验：plan 模式写不进文件 (#45)', () => {
  beforeAll(async () => {
    if (!ENABLED) return
    probeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-plan-home-')))
    workspace = path.join(probeHome, 'ws')
    fs.mkdirSync(workspace, { recursive: true })
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
    if (server) server.close()
    if (probeHome) fs.rmSync(probeHome, { recursive: true, force: true })
  })

  // 两条用例各自只看自己那趟上游请求
  beforeEach(() => {
    captured = []
  })

  it('带上扩展起进程 → /plan start 拿到回执 → write 被拦且文件没出现', async () => {
    const proc = makeProcess()
    await proc.start()

    // 1. 扩展真的随 spawn 装进来了
    expect(proc.planModeExtensionLoaded, '命令行没带上权限闸扩展').toBe(true)

    // 2. 宿主发的命令帧拿到了扩展的模式回执，而不只是 pi 的 ack
    await expect(proc.setPlanMode(true)).resolves.toBe(true)
    expect(proc.planModeActive).toBe(true)

    // 3. 上游按要求调 write
    const turn = waitForAgentEnd(proc)
    await proc.sendMessage(PROMPT)
    await turn

    const results = toolResults()

    expect(fs.existsSync(path.join(workspace, TARGET)), `plan 模式下 ${TARGET} 还是被写出来了`).toBe(false)
    // 没有这条就说明 write 压根没进执行流程 —— 那测的是「上游没调工具」，不是「闸拦住了」。
    // 实测扩展回给模型的原文：Plan mode blocks mutating tool 'write'.
    expect(results, '上游没收到工具结果，write 没被执行流程受理').toContainEqual(
      expect.stringMatching(/blocks mutating tool 'write'/i),
    )
  }, 240_000)

  it('扩展的菜单对话框不会把会话挂死：/plan 弹出的 select 被宿主取消后命令才有 ack', async () => {
    const proc = makeProcess()
    await proc.start()
    await expect(proc.setPlanMode(true)).resolves.toBe(true)

    // pi 要等命令 handler 跑完才发这条 ack，而 handler 里 await 着扩展的 select ——
    // 宿主不回 extension_ui_response 的话，这一趟就是 30s 超时（#45 里最坏的失效形态）。
    await expect(proc.sendMessage('/plan')).resolves.toBeUndefined()

    await proc.kill()
  }, 240_000)
})
