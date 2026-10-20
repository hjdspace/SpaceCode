// @vitest-environment node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * issue #46 的验收项：真 pi 子进程 + 本地假上游，证明「选了 agent 之后，发出的请求里确实
 * 带了该定义」。
 *
 * 单元层只能证明 argv 拼对了。真正要定案的是两件只有跑一遍才知道的事：
 *   1. `@tintinweb/pi-subagents` 在真进程里装没装进来 —— 装进来的凭据是它的 `Agent` 工具
 *      出现在发给上游的工具清单里，而不是我们自己在 argv 里写了 --extension；
 *   2. persona 正文经 `--append-system-prompt <文件>` 之后，确实出现在上游收到的系统提示里，
 *      而不是被 pi 当成一个字面量路径塞进去。
 *
 * 全程用临时 HOME 与临时工作区，不碰真实的 ~/.pi，也不碰仓库。
 *
 * 不进 CI：需要本机装有 @earendil-works/pi-coding-agent 与 @tintinweb/pi-subagents，且会起子进程。
 * 显式跑：
 *   PI_REAL=1 npx vitest run electron/engine/engines/__tests__/piSessionProcess.agent.realPi.test.ts
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..')
const CLI = path.join(REPO_ROOT, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const EXTENSION = path.join(REPO_ROOT, 'node_modules', '@tintinweb', 'pi-subagents', 'src', 'index.ts')
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

const MODEL = 'agent-probe-model'
const AGENT_NAME = 'auditor'
/** 只可能来自那份定义文件的字符串：出现在上游请求里才说明人设真的进了提示 */
const MARKER = 'PI46-AGENT-PERSONA-MARKER'

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

const FINAL_STREAM = [
  chunk({ role: 'assistant', content: '收到。' }, null),
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
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        res.write(FINAL_STREAM)
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
    const onMessage = (event: { type?: string }) => {
      if (event?.type === 'agent_end') { cleanup(); resolve() }
    }
    const onExit = (code: unknown) => { cleanup(); reject(new Error(`pi 进程提前退出 | code=${String(code)}`)) }
    proc.on('message', onMessage)
    proc.on('exit', onExit)
  })
}

function makeProcess(agent?: string): PiSessionProcess {
  const config: EngineSessionConfig = {
    cwd: workspace,
    provider: 'openai',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: MODEL,
    apiKey: 'probe-key-not-a-secret',
    thinkingEnabled: false,
    engineType: 'pi',
    agent,
  }
  const proc = new PiSessionProcess(`pi-agent-real-${agent ?? 'none'}`, config)
  proc.on('error', () => {})
  return proc
}

function writeAgentDefinition(): void {
  const dir = path.join(workspace, '.claude', 'agents')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, `${AGENT_NAME}.md`),
    `---\nname: ${AGENT_NAME}\ndescription: Security auditor for the probe\n---\n\nYou are ${MARKER}. Report findings with file paths.\n`,
    'utf8',
  )
}

/** 某一条上游请求里的工具名 */
function toolNames(body: string): string[] {
  const parsed = JSON.parse(body) as { tools?: Array<{ function?: { name?: string }; name?: string }> }
  return (parsed.tools ?? []).map(t => t.function?.name ?? t.name ?? '')
}

describe.skipIf(!ENABLED)('真 pi 子进程核验：所选 agent 落到请求里 (#46)', () => {
  beforeAll(async () => {
    if (!ENABLED) return
    probeHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-home-')))
    workspace = path.join(probeHome, 'ws')
    fs.mkdirSync(workspace, { recursive: true })
    process.env.HOME = probeHome
    process.env.USERPROFILE = probeHome
    process.env.PI_CODING_AGENT_DIR = path.join(probeHome, '.pi', 'agent')
    process.env.PI_OFFLINE = '1'
    process.env.PI_TELEMETRY = '0'
    process.env.PI_SKIP_VERSION_CHECK = '1'
    captured = []
    writeAgentDefinition()
    await startFakeUpstream()
  }, 120_000)

  afterAll(() => {
    if (server) server.close()
    if (probeHome) fs.rmSync(probeHome, { recursive: true, force: true })
  })

  beforeEach(() => {
    captured = []
  })

  it('选了 agent → 上游系统提示里带该定义正文，工具清单里有扩展的 Agent', async () => {
    const proc = makeProcess(AGENT_NAME)
    await proc.start()

    // 1. 命令行侧的自我认知
    expect(proc.agentApplied, 'persona 没进命令行').toBe(true)
    expect(proc.subagentsExtensionLoaded, '子代理扩展没进命令行').toBe(true)

    // 2. 真跑一轮，看上游收到什么
    const turn = waitForAgentEnd(proc)
    await proc.sendMessage('随便说一句')
    await turn
    await proc.kill()

    expect(captured.length, '上游没收到任何请求').toBeGreaterThan(0)
    const first = captured[0]
    expect(first, '上游请求里没有 persona 正文').toContain(MARKER)
    // 只验「我们拼了 --extension」的话，测的是 argv，不是引擎能力 —— 装没装进来凭工具清单说话。
    expect(toolNames(first), '子代理扩展没把 Agent 工具注册进来').toContain('Agent')
  }, 240_000)

  it('没选 agent 时保持原样：没有 persona，也不带扩展', async () => {
    const proc = makeProcess()
    await proc.start()

    expect(proc.agentApplied).toBeNull()
    expect(proc.subagentsExtensionLoaded).toBe(false)

    const turn = waitForAgentEnd(proc)
    await proc.sendMessage('随便说一句')
    await turn
    await proc.kill()

    expect(captured[0]).not.toContain(MARKER)
    expect(toolNames(captured[0])).not.toContain('Agent')
  }, 240_000)
})
