/**
 * Docker 沙箱（§7）：任务工作树仍在宿主 Git 上创建，实现、验证与审查在容器内执行，
 * 合并留在宿主。容器只挂载任务工作树、仓库 Git 元数据与只读包缓存；模型凭据与
 * 代理只通过 `-e <KEY>` 注入（值放在 docker 客户端的进程环境里），不进入命令行、
 * 不进入事件日志，容器销毁即失效。
 *
 * 所有 Docker 调用都经过注入的 `DockerRunner`，因此挂载、uid、超时、停止、
 * 回收与凭据注入都能在单测里被逐条断言，不需要本机安装 Docker。
 */
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { connect } from 'net'
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { AgentPort, AgentRunOptions, AgentTurn } from './agentEngineGateway'
import type { EngineSessionConfig } from '../engine/engines/types'
import { redactSecrets } from './events'
import { parseVerifyCommand, tailOutput, type VerifyInput, type VerifyResult } from './verify'
import { worktreeAbsolutePath } from './worktree'

export const FACTORY_DOCKER_DIR = '.spacecode/factory/docker'
export const FACTORY_DOCKERFILE = `${FACTORY_DOCKER_DIR}/Dockerfile`
export const FACTORY_PACKAGE_CACHE = '.spacecode/factory/cache'
export const FACTORY_DOCKER_LABEL = 'spacecode.factory'
export const FACTORY_DOCKER_PREFIX = 'spacecode-fac-'

const DEFAULT_AGENT_COMMAND = ['claude', '-p', '--output-format', 'stream-json', '--verbose']
const BUILD_TAIL_LINES = 30
const BUILD_TAIL_CHARS = 4000

// ── 执行器端口 ──────────────────────────────────────────────────

export interface DockerRunOptions {
  cwd?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** 只放凭据值；argv 里只有键。 */
  env?: Record<string, string>
  /** 传给容器的标准输入（Agent 提示词）。 */
  stdin?: string
}

export interface DockerRunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
}

export type DockerRunner = (args: string[], options?: DockerRunOptions) => Promise<DockerRunResult>

const DOCKER_BINARY = process.platform === 'win32' ? 'docker.exe' : 'docker'

/** 用 spawn 而不是 execFile：Agent 提示词通过 stdin 传入，不经命令行参数。 */
export const defaultDockerRunner: DockerRunner = (args, options = {}) =>
  new Promise((resolveResult) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let settled = false

    const child = spawn(DOCKER_BINARY, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: { ...process.env, ...(options.env ?? {}) },
      windowsHide: true,
    })

    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolveResult({ code, stdout, stderr, timedOut, aborted })
    }

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, options.timeoutMs)
      : null
    const onAbort = (): void => {
      aborted = true
      child.kill()
    }
    if (options.signal) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      stderr += String(error.message)
      finish(null)
    })
    child.on('close', (code) => finish(code))
    if (options.stdin !== undefined) child.stdin?.end(options.stdin)
    else child.stdin?.end()
  })

// ── 挂载计划（安全边界） ────────────────────────────────────────

export interface DockerMount {
  source: string
  target: string
  readOnly?: boolean
}

export interface MountPlanInput {
  repoRoot: string
  worktreeAbsolute: string
  cacheDir?: string
  homeDir?: string
}

export type MountPlanResult =
  | { ok: true; mounts: DockerMount[] }
  | { ok: false; error: 'home' | 'ssh' | 'outside-project' }

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function samePath(a: string, b: string): boolean {
  const left = resolve(a)
  const right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function checkSource(source: string, input: MountPlanInput): MountPlanResult | null {
  if (input.homeDir && samePath(source, input.homeDir)) return { ok: false, error: 'home' }
  if (input.homeDir && isInside(join(input.homeDir, '.ssh'), source)) return { ok: false, error: 'ssh' }
  if (/[\\/]\.ssh([\\/]|$)/i.test(source)) return { ok: false, error: 'ssh' }
  if (!isInside(input.repoRoot, source)) return { ok: false, error: 'outside-project' }
  return null
}

/**
 * 只允许三类来源：任务工作树、仓库 Git 元数据（worktree 的 .git 文件指向它，
 * 不挂载就无法在容器里产生与宿主一致的提交）、项目内只读包缓存。
 */
export function buildMountPlan(input: MountPlanInput): MountPlanResult {
  const worktree = resolve(input.worktreeAbsolute)
  const cacheDir = resolve(input.cacheDir ?? join(input.repoRoot, FACTORY_PACKAGE_CACHE))
  const gitDir = join(resolve(input.repoRoot), '.git')

  for (const source of [worktree, cacheDir, gitDir]) {
    const rejected = checkSource(source, input)
    if (rejected) return rejected
  }

  return {
    ok: true,
    mounts: [
      { source: worktree, target: worktree },
      { source: gitDir, target: gitDir },
      { source: cacheDir, target: cacheDir, readOnly: true },
    ],
  }
}

// ── 代理与凭据 ──────────────────────────────────────────────────

/** 容器内访问宿主回环服务必须换成 host.docker.internal；远端地址保持不变。 */
export function containerProxyUrl(value: string): string {
  return value.replace(
    /^(\w+:\/\/)(?:127\.0\.0\.1|localhost|\[::1\])(?=[:/]|$)/i,
    '$1host.docker.internal',
  )
}

/** 预检用：从宿主侧 TCP 探测代理端口是否可达；容器侧地址由 `containerProxyUrl` 改写。 */
export function probeProxyReachable(url: string, timeoutMs = 1500): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return Promise.resolve(false)
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

export interface CredentialEnvInput {
  engineConfig?: Pick<EngineSessionConfig, 'provider' | 'apiKey' | 'baseUrl'>
  proxyUrl?: string
}

/** 凭据只以环境变量形式交给容器；返回值不应写入任何日志或任务投影。 */
export function buildCredentialEnv(input: CredentialEnvInput): Record<string, string> {
  const env: Record<string, string> = {}
  const config = input.engineConfig
  const openai = config?.provider === 'openai'
  if (config?.apiKey) env[openai ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'] = config.apiKey
  if (config?.baseUrl) env[openai ? 'OPENAI_BASE_URL' : 'ANTHROPIC_BASE_URL'] = containerProxyUrl(config.baseUrl)
  if (input.proxyUrl) {
    const proxy = containerProxyUrl(input.proxyUrl)
    env.HTTP_PROXY = proxy
    env.HTTPS_PROXY = proxy
    env.NO_PROXY = 'localhost,127.0.0.1,host.docker.internal'
  }
  return env
}

// ── 命令行构造 ──────────────────────────────────────────────────

export interface RunArgsInput {
  containerName: string
  imageName: string
  mounts: DockerMount[]
  worktreeAbsolute: string
  envKeys: string[]
  uid?: number
  gid?: number
  labels?: Record<string, string>
}

export function buildDockerRunArgs(input: RunArgsInput): string[] {
  const args = ['run', '-d', '--name', input.containerName]
  args.push('--label', `${FACTORY_DOCKER_LABEL}=1`)
  for (const [key, value] of Object.entries(input.labels ?? {})) args.push('--label', `${key}=${value}`)
  // Linux 上宿主的 host.docker.internal 需要显式映射；Docker Desktop 自带同名条目。
  args.push('--add-host', 'host.docker.internal:host-gateway')
  if (input.uid !== undefined && input.gid !== undefined) {
    args.push('--user', `${input.uid}:${input.gid}`)
  }
  args.push('--workdir', input.worktreeAbsolute)
  for (const mount of input.mounts) {
    args.push('-v', `${mount.source}:${mount.target}${mount.readOnly ? ':ro' : ''}`)
  }
  for (const key of input.envKeys) args.push('-e', key)
  args.push(input.imageName, 'sleep', 'infinity')
  return args
}

// ── 镜像构建与缓存 ──────────────────────────────────────────────

export type ImageBuildResult =
  | { ok: true; built: boolean }
  | { ok: false; reason: 'dockerfile-missing' | 'build-failed' | 'docker-unavailable'; tail?: string }

export interface EnsureImageInput {
  repoRoot: string
  imageName: string
  dockerfilePath?: string
}

function dockerfileHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** 固定入口 `.spacecode/factory/docker/Dockerfile`；用 Dockerfile 哈希标签做构建缓存。 */
export async function ensureDockerImage(
  docker: DockerRunner,
  input: EnsureImageInput,
): Promise<ImageBuildResult> {
  const dockerfilePath = input.dockerfilePath ?? join(input.repoRoot, FACTORY_DOCKERFILE)
  if (!existsSync(dockerfilePath)) return { ok: false, reason: 'dockerfile-missing' }
  const sha = dockerfileHash(readFileSync(dockerfilePath, 'utf-8'))

  const inspect = await docker([
    'image',
    'inspect',
    '--format',
    '{{index .Config.Labels "spacecode.dockerfile.sha"}}',
    input.imageName,
  ])
  if (inspect.code === 0 && inspect.stdout.trim() === sha) return { ok: true, built: false }

  const build = await docker([
    'build',
    '-f',
    dockerfilePath,
    '-t',
    input.imageName,
    '--label',
    `spacecode.dockerfile.sha=${sha}`,
    '--label',
    `${FACTORY_DOCKER_LABEL}=1`,
    dirname(dockerfilePath),
  ])
  if (build.code !== 0) {
    return {
      ok: false,
      reason: 'build-failed',
      tail: redactSecrets(tailOutput(build.stdout, build.stderr, BUILD_TAIL_LINES, BUILD_TAIL_CHARS)),
    }
  }
  return { ok: true, built: true }
}

// ── Agent 输出解析 ──────────────────────────────────────────────

export interface ParsedAgentEvent {
  type: string
  data: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenCount(usage: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (typeof usage[key] === 'number') return usage[key] as number
  }
  return 0
}

/**
 * `stream-json` 逐行解析：tool_use 投影成事件，`result` 提供最终文本与 token；
 * 非 JSON 行落日志。没有 result 行时按纯文本输出处理。
 */
export function parseAgentOutput(stdout: string): { events: ParsedAgentEvent[]; turn: AgentTurn } {
  const events: ParsedAgentEvent[] = []
  let resultText: string | undefined
  let isError = false
  let inputTokens = 0
  let outputTokens = 0
  let sawResult = false

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      events.push({ type: 'log', data: line })
      continue
    }
    if (!isRecord(record)) continue

    if (record.type === 'assistant') {
      const message = isRecord(record.message) ? record.message : {}
      const content = Array.isArray(message.content) ? message.content : []
      for (const item of content) {
        if (!isRecord(item) || item.type !== 'tool_use') continue
        events.push({
          type: 'tool_use',
          data: { name: String(item.name ?? ''), input: isRecord(item.input) ? item.input : {} },
        })
      }
      continue
    }

    if (record.type === 'result') {
      sawResult = true
      resultText = typeof record.result === 'string' ? record.result : ''
      isError = record.is_error === true
      const usage = isRecord(record.usage) ? record.usage : {}
      inputTokens = tokenCount(usage, 'input_tokens', 'input', 'prompt_tokens')
      outputTokens = tokenCount(usage, 'output_tokens', 'output', 'completion_tokens')
      events.push({ type: 'result', data: record })
      continue
    }

    events.push({ type: 'log', data: line })
  }

  return {
    events,
    turn: {
      text: sawResult ? (resultText ?? '') : stdout.trim(),
      isError,
      inputTokens,
      outputTokens,
    },
  }
}

// ── 沙箱句柄与提供者 ────────────────────────────────────────────

export type DockerEventListener = (eventType: string, data: unknown) => void

export interface DockerSandbox {
  id: string
  branch: string
  worktreePath: string
  exec(argv: string[], options?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<DockerRunResult>
  runAgent(prompt: string, options: AgentRunOptions & { signal?: AbortSignal }): Promise<AgentTurn>
  events(listener: DockerEventListener): () => void
  stop(): Promise<void>
  close(options?: { preserve?: boolean }): Promise<{ preservedPath?: string }>
}

export interface DockerSandboxCreateInput {
  repoRoot: string
  taskId: string
  branch: string
  imageName: string
  engineConfig?: Pick<EngineSessionConfig, 'provider' | 'apiKey' | 'baseUrl'>
  proxyUrl?: string
  uid?: number
  gid?: number
  homeDir?: string
  containerName?: string
  agentCommand?: string[]
  dockerfilePath?: string
  cacheDir?: string
}

export type CreateSandboxResult =
  | { ok: true; sandbox: DockerSandbox }
  | { ok: false; error: 'sandbox-unavailable'; detail?: string }

export interface DockerPreflightFacts {
  dockerAvailable: boolean
  image: ImageBuildResult
  mountable: boolean
  proxy?: { ok: boolean; reason?: 'unreachable' }
}

export interface DockerPreflightInput {
  repoRoot: string
  imageName: string
  proxyUrl?: string
  dockerfilePath?: string
}

export interface DockerSandboxProvider {
  ensureImage(input: EnsureImageInput): Promise<ImageBuildResult>
  create(input: DockerSandboxCreateInput): Promise<CreateSandboxResult>
  reclaim(activeNames?: string[]): Promise<string[]>
  preflight(input: DockerPreflightInput): Promise<DockerPreflightFacts>
}

export interface DockerSandboxProviderDeps {
  docker?: DockerRunner
  env?: NodeJS.ProcessEnv
  homeDir?: string
  uid?: number
  gid?: number
  /** 预检里探测代理端口是否可从宿主访问；默认视为可达。 */
  probeProxy?: (url: string) => Promise<boolean>
}

function defaultProxyUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy
  return value && value.trim() ? value.trim() : undefined
}

function failureDetail(tail: string | undefined, fallback: string): string {
  return tail && tail.trim() ? tail : fallback
}

export function createDockerSandboxProvider(deps: DockerSandboxProviderDeps = {}): DockerSandboxProvider {
  const docker = deps.docker ?? defaultDockerRunner
  const env = deps.env ?? process.env
  const homeDir = deps.homeDir ?? homedir()
  const uid = deps.uid ?? process.getuid?.()
  const gid = deps.gid ?? process.getgid?.()
  const probeProxy = deps.probeProxy ?? (async () => true)

  async function ensureImage(input: EnsureImageInput): Promise<ImageBuildResult> {
    return ensureDockerImage(docker, input)
  }

  async function create(input: DockerSandboxCreateInput): Promise<CreateSandboxResult> {
    const image = await ensureImage({
      repoRoot: input.repoRoot,
      imageName: input.imageName,
      ...(input.dockerfilePath ? { dockerfilePath: input.dockerfilePath } : {}),
    })
    if (!image.ok) {
      return {
        ok: false,
        error: 'sandbox-unavailable',
        detail: failureDetail(image.tail, image.reason),
      }
    }

    const worktreePath = worktreeAbsolutePath(input.repoRoot, input.taskId)
    const plan = buildMountPlan({
      repoRoot: input.repoRoot,
      worktreeAbsolute: worktreePath,
      ...(input.cacheDir ? { cacheDir: input.cacheDir } : {}),
      homeDir: input.homeDir ?? homeDir,
    })
    if (!plan.ok) {
      return { ok: false, error: 'sandbox-unavailable', detail: `mount-rejected:${plan.error}` }
    }

    const cache = plan.mounts.find((mount) => mount.readOnly)
    if (cache) {
      try {
        mkdirSync(cache.source, { recursive: true })
      } catch {
        return { ok: false, error: 'sandbox-unavailable', detail: 'cache-unwritable' }
      }
    }

    const credentialEnv = buildCredentialEnv({
      ...(input.engineConfig ? { engineConfig: input.engineConfig } : {}),
      ...(input.proxyUrl ?? defaultProxyUrl(env) ? { proxyUrl: input.proxyUrl ?? defaultProxyUrl(env) } : {}),
    })
    const containerName = input.containerName ?? `${FACTORY_DOCKER_PREFIX}${input.taskId}`
    const args = buildDockerRunArgs({
      containerName,
      imageName: input.imageName,
      mounts: plan.mounts,
      worktreeAbsolute: worktreePath,
      envKeys: Object.keys(credentialEnv),
      ...(uid !== undefined ? { uid } : {}),
      ...(gid !== undefined ? { gid } : {}),
      labels: { [`${FACTORY_DOCKER_LABEL}.task`]: input.taskId },
    })

    const started = await docker(args, { env: credentialEnv })
    if (started.code !== 0) {
      return {
        ok: false,
        error: 'sandbox-unavailable',
        detail: redactSecrets(tailOutput(started.stdout, started.stderr, BUILD_TAIL_LINES, BUILD_TAIL_CHARS)),
      }
    }

    const listeners = new Set<DockerEventListener>()
    const agentCommand = input.agentCommand ?? DEFAULT_AGENT_COMMAND
    let stopping = false
    let closed = false

    const sandbox: DockerSandbox = {
      id: containerName,
      branch: input.branch,
      worktreePath,

      async exec(argv, options = {}) {
        // 验证命令不该看到模型凭据：逐键注入空值覆盖容器里的环境变量。
        const cleared = Object.keys(credentialEnv).flatMap((key) => ['-e', `${key}=`])
        return docker(
          ['exec', ...cleared, '-w', options.cwd ?? worktreePath, containerName, ...argv],
          {
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
          },
        )
      },

      async runAgent(prompt, options) {
        const argv = [...agentCommand]
        if (options.permissionMode) argv.push('--permission-mode', options.permissionMode)
        // 与宿主 buildArgs 同口径：bypass 只能由这个 flag 打开，只传 --permission-mode
        // 会让容器内的 CLI 拒绝该模式并退回逐次审批。
        if (options.permissionMode === 'bypassPermissions') argv.push('--dangerously-skip-permissions')
        if (options.model) argv.push('--model', options.model)
        const result = await docker(
          ['exec', '-i', '-w', options.cwd ?? worktreePath, containerName, ...argv],
          {
            stdin: prompt,
            ...(options.signal ? { signal: options.signal } : {}),
          },
        )
        const parsed = parseAgentOutput(result.stdout)
        for (const event of parsed.events) {
          for (const listener of listeners) listener(event.type, event.data)
        }
        if (result.code !== 0 && !parsed.turn.text) {
          return {
            text: result.stderr.trim() || `Container agent exited with code ${result.code ?? 'null'}`,
            isError: true,
            inputTokens: parsed.turn.inputTokens,
            outputTokens: parsed.turn.outputTokens,
          }
        }
        return parsed.turn
      },

      events(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },

      async stop() {
        if (stopping || closed) return
        stopping = true
        await docker(['kill', containerName])
      },

      async close(options = {}) {
        if (closed) return options.preserve === false ? {} : { preservedPath: worktreePath }
        closed = true
        stopping = true
        await docker(['rm', '-f', containerName])
        return options.preserve === false ? {} : { preservedPath: worktreePath }
      },
    }

    return { ok: true, sandbox }
  }

  async function reclaim(activeNames: string[] = []): Promise<string[]> {
    const listed = await docker([
      'ps',
      '-a',
      '--filter',
      `label=${FACTORY_DOCKER_LABEL}=1`,
      '--format',
      '{{.Names}}',
    ])
    if (listed.code !== 0) return []
    const active = new Set(activeNames)
    const removed: string[] = []
    for (const raw of listed.stdout.split(/\r?\n/)) {
      const name = raw.trim()
      if (!name || !name.startsWith(FACTORY_DOCKER_PREFIX)) continue
      if (active.has(name)) continue
      await docker(['rm', '-f', name])
      removed.push(name)
    }
    return removed
  }

  async function preflight(input: DockerPreflightInput): Promise<DockerPreflightFacts> {
    const version = await docker(['version', '--format', '{{.Server.Version}}'])
    const dockerAvailable = version.code === 0

    const image = dockerAvailable
      ? await ensureImage({
          repoRoot: input.repoRoot,
          imageName: input.imageName,
          ...(input.dockerfilePath ? { dockerfilePath: input.dockerfilePath } : {}),
        })
      : ({ ok: false, reason: 'docker-unavailable' } as ImageBuildResult)

    let mountable = false
    try {
      const worktreeRoot = join(input.repoRoot, '.spacecode', 'worktrees')
      const cacheRoot = join(input.repoRoot, FACTORY_PACKAGE_CACHE)
      mkdirSync(worktreeRoot, { recursive: true })
      mkdirSync(cacheRoot, { recursive: true })
      accessSync(worktreeRoot, constants.W_OK)
      accessSync(cacheRoot, constants.W_OK)
      mountable = true
    } catch {
      mountable = false
    }

    const proxyUrl = input.proxyUrl ?? defaultProxyUrl(env)
    // 探测宿主侧原始地址；容器内改用 host.docker.internal 是确定性改写，不参与探测。
    const proxy = proxyUrl
      ? { ok: await probeProxy(proxyUrl), reason: 'unreachable' as const }
      : undefined

    return {
      dockerAvailable,
      image,
      mountable,
      ...(proxy ? { proxy: proxy.ok ? { ok: true } : proxy } : {}),
    }
  }

  return { ensureImage, create, reclaim, preflight }
}

// ── 适配到流水线的 AgentPort / Verify ───────────────────────────

/** 让 04 的实现/审查循环直接复用容器执行，上层状态机完全不变。 */
export function createSandboxAgentPort(sandbox: DockerSandbox): AgentPort {
  const listeners = new Set<(sessionId: string, eventType: string, data: unknown) => void>()
  let currentSessionId = ''

  sandbox.events((eventType, data) => {
    for (const listener of listeners) listener(currentSessionId, eventType, data)
  })

  return {
    async run(sessionId, prompt, options) {
      currentSessionId = sessionId
      return sandbox.runAgent(prompt, options)
    },
    async stop(sessionId) {
      if (sessionId !== currentSessionId) return
      await sandbox.stop()
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function createSandboxVerify(
  sandbox: DockerSandbox,
  deps: { now?: () => Date; maxLines?: number; maxChars?: number } = {},
): (input: VerifyInput) => Promise<VerifyResult> {
  const now = deps.now ?? (() => new Date())
  return async (input) => {
    const at = now().toISOString()
    const argv = parseVerifyCommand(input.command)
    if (!argv) {
      return {
        status: 'fail',
        command: input.command,
        at,
        detail: 'Command rejected: only a single command without shell operators is allowed.',
      }
    }
    if (input.signal?.aborted) return { status: 'stopped', command: input.command, at, detail: '' }

    const result = await sandbox.exec(argv, {
      cwd: input.cwd,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
    const detail = tailOutput(result.stdout, result.stderr, deps.maxLines, deps.maxChars)
    if (result.aborted) return { status: 'stopped', command: input.command, at, detail }
    if (result.timedOut) return { status: 'timeout', command: input.command, at, detail }
    if (result.code === 0) return { status: 'pass', command: input.command, at, exitCode: 0, detail }
    return {
      status: 'fail',
      command: input.command,
      at,
      ...(result.code !== null ? { exitCode: result.code } : {}),
      detail,
    }
  }
}
