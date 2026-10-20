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
 * issue #53 的验收项也放在这里：MCP 工具（`mcp__*`）在 plan 下能不能真的被挡住。
 * 那个闸是白名单式的（非 builtin 工具属 user-opt-in，默认策略只收 builtin 的安全工具），
 * 只有连上真 server、真把工具声明出来、真调一次，才分得清「被策略挡了」和「压根没这工具」。
 * 配一条对照组：同一个工具不在 plan 下确实能写文件，探针不是空转。
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

/** 探针 MCP server 的一个可变工具，pi 侧命名规则是 `mcp__<server>__<tool>` */
const MCP_SERVER = path.join(__dirname, 'fixtures', 'piMcpProbeServer.mjs')
const MCP_TOOL = 'mcp__probe__note'
const MCP_PROMPT = '用 mcp 的 note 工具把 hello 写进文件'
/** 两条用例各写各的文件：共用一个名字的话，对照组先跑就会把 plan 组的断言弄脏 */
const MCP_FILE_PLAN = 'mcp-plan.txt'
const MCP_FILE_OPEN = 'mcp-open.txt'

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

/** 第一轮：只回一个工具调用；调哪个由用例改 firstTurnStream */
function toolCallStream(name: string, args: Record<string, unknown>): string {
  return [
    chunk({ role: 'assistant', tool_calls: [{
      index: 0,
      id: 'call-write-1',
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    }] }, null),
    chunk({}, 'tool_calls'),
  ].join('')
}

const WRITE_CALL = toolCallStream('write', { path: TARGET, content: 'hello from plan mode' })

/** 当前这趟会话第一轮该回的工具调用；用例各自设置 */
let firstTurnStream = WRITE_CALL

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
        res.write(alreadyRanTool ? FINAL_STREAM : firstTurnStream)
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

/**
 * 等真 pi 发来的扩展对话框帧 (#54)。
 *
 * 订阅要在发命令之前挂上：pi 的 `/plan` 命令 handler 里就 await 着这张卡，
 * ack 更晚才到，事后追监听只会等到一个已经没人应答的帧。
 */
function waitForExtensionDialog(proc: PiSessionProcess, method: string, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      proc.off('message', onMessage)
      proc.off('exit', onExit)
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`真 pi 未在时限内发出 ${method} 对话框`)) }, timeoutMs)
    const onMessage = (event: any) => {
      if (event?.type === 'extension_ui_request' && event?.method === method) { cleanup(); resolve(event) }
    }
    const onExit = (code: unknown) => { cleanup(); reject(new Error(`pi 进程提前退出 | code=${String(code)}`)) }
    proc.on('message', onMessage)
    proc.on('exit', onExit)
  })
}

/**
 * 杀进程并等它真的退出。pi 的 MCP 子进程是随它一起收的，而 Windows 上目录要等
 * 那些句柄放开才删得掉 —— 不等的话 afterAll 会 EPERM，临时目录留在 %TEMP% 里。
 */
async function killAndWait(proc: PiSessionProcess, timeoutMs = 10_000): Promise<void> {
  const exited = new Promise<void>(resolve => proc.once('exit', () => resolve()))
  await proc.kill()
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, timeoutMs))])
}

function makeProcess(overrides: Partial<EngineSessionConfig> = {}, sessionId = 'pi-plan-real-1'): PiSessionProcess {
  const config: EngineSessionConfig = {
    cwd: workspace,
    provider: 'openai',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: MODEL,
    apiKey: 'probe-key-not-a-secret',
    thinkingEnabled: false,
    engineType: 'pi',
    permissionMode: 'plan',
    ...overrides,
  }
  const proc = new PiSessionProcess(sessionId, config)
  proc.on('error', () => {})
  return proc
}

/**
 * 往探针的 pi agent 目录放一个「用户自有」的 MCP server（不带 `_spacecode` 标记）。
 *
 * 故意不走面板那套投影：这条用例只该验一件事 —— pi 连上了 server、工具被声明出来、
 * plan 闸按白名单挡住了它。顺带也证明我们的投影不会动不属于它的条目（start 时会重算一次）。
 */
function seedProbeMcpServer(): void {
  const dir = path.join(probeHome, '.pi', 'agent')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        probe: {
          command: process.execPath,
          args: [MCP_SERVER],
          env: { PI_MCP_PROBE_DIR: workspace },
          // 不写的话 pi 默认 codemode，工具压根不会声明给模型，
          // 于是「被挡住」和「没这个东西」就分不开了。
          exposure: 'direct',
        },
      },
    }, null, 2),
    'utf8',
  )
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

  afterAll(async () => {
    if (server) server.close()
    if (!probeHome) return
    // Windows：pi 的 MCP 子进程刚被杀时，它对 workspace 目录的句柄可能还没放开，
    // rmSync 会 EPERM。句柄放开是毫秒级的事，重试几次就干净了；清临时目录失败
    // 不该把这组用例判成不过。
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.rmSync(probeHome, { recursive: true, force: true })
        return
      } catch (err) {
        if (attempt === 5) console.warn('[probe] failed to clean', probeHome, String(err))
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
  })

  // 两条用例各自只看自己那趟上游请求
  beforeEach(() => {
    captured = []
    firstTurnStream = WRITE_CALL
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
    await killAndWait(proc)

    expect(fs.existsSync(path.join(workspace, TARGET)), `plan 模式下 ${TARGET} 还是被写出来了`).toBe(false)
    // 没有这条就说明 write 压根没进执行流程 —— 那测的是「上游没调工具」，不是「闸拦住了」。
    // 实测扩展回给模型的原文：Plan mode blocks mutating tool 'write'.
    expect(results, '上游没收到工具结果，write 没被执行流程受理').toContainEqual(
      expect.stringMatching(/blocks mutating tool 'write'/i),
    )
  }, 240_000)

  it('真 pi 探针：/plan 弹出的 select 宿主收得到、也答得回去，答完命令才有 ack (#54)', async () => {
    const proc = makeProcess()
    await proc.start()
    await expect(proc.setPlanMode(true)).resolves.toBe(true)

    // 监听先挂上再发命令：pi 要等命令 handler 跑完才发 ack，而 handler 里 await 着这张卡。
    // #45 时代这里靠宿主抢答 cancelled 才不挂死；#54 之后要验的是真往返。
    const dialog = waitForExtensionDialog(proc, 'select')
    const sending = proc.sendMessage('/plan')

    const frame = await dialog
    // 界面要拿得出可点的行：选项是扩展给的原文，宿主不替它编
    expect(frame.id, '对话框帧没带 id，宿主无从应答').toBeTruthy()
    expect(Array.isArray(frame.options) && frame.options.length >= 2, `select 只给了 ${JSON.stringify(frame.options)}`).toBe(true)

    // 用「关闭」收场而不是选一项：菜单收到 undefined 即退回，不触发任何副作用，
    // 又能证明 pi 真的把这一帧解开了 —— 卡在这里不解锁的话下面这句就是 30s 超时。
    proc.respondExtensionDialog(frame.id, { kind: 'cancel' })
    await expect(sending).resolves.toBeUndefined()

    await killAndWait(proc)
  }, 240_000)

  it('plan 挡得住 MCP 工具：白名单不含非 builtin 工具，调用被 block 且没落盘 (#53)', async () => {
    seedProbeMcpServer()
    firstTurnStream = toolCallStream(MCP_TOOL, { file: MCP_FILE_PLAN, text: 'hello via mcp' })

    const proc = makeProcess({ permissionMode: 'plan' }, 'pi-plan-real-mcp')
    await proc.start()
    await expect(proc.setPlanMode(true)).resolves.toBe(true)

    const turn = waitForAgentEnd(proc)
    await proc.sendMessage(MCP_PROMPT)
    await turn
    const results = toolResults()
    await killAndWait(proc)

    // 这句回执同时证明两件独立的事：工具确实注册上了（server 连上了），
    // 以及挡住它的是 plan 的工具白名单 —— 而不是「压根没这个工具」。
    expect(results, `${MCP_TOOL} 没进执行流程，等于测的是上游没调工具`).toContainEqual(
      expect.stringMatching(/blocks tool 'mcp__probe__note'[\s\S]*not selected by the Plan policy/i),
    )
    expect(fs.existsSync(path.join(workspace, MCP_FILE_PLAN)), 'plan 模式下 MCP 还是写出了文件').toBe(false)
  }, 240_000)

  it('对照：不开 plan 时同一个 MCP 工具真能写文件（证明探针不是空转）', async () => {
    seedProbeMcpServer()
    firstTurnStream = toolCallStream(MCP_TOOL, { file: MCP_FILE_OPEN, text: 'hello via mcp' })

    const proc = makeProcess({ permissionMode: 'default' }, 'pi-plan-real-mcp-open')
    await proc.start()

    const turn = waitForAgentEnd(proc)
    await proc.sendMessage(MCP_PROMPT)
    await turn
    await killAndWait(proc)

    expect(fs.existsSync(path.join(workspace, MCP_FILE_OPEN)), '探针 MCP server 没跑起来，上一条的「没写出来」就无从解释').toBe(true)
  }, 240_000)
})
