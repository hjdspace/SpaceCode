// @vitest-environment node
/**
 * Docker 沙箱：命令构造、镜像缓存、容器生命周期与凭据注入。
 *
 * 所有 Docker 调用都由注入的 runner 记录，测试只断言「发给 Docker 的参数」，
 * 不依赖本机是否装了 Docker。挂载与凭据是安全边界，必须逐条钉住：
 * 家目录/SSH/项目外路径不得出现，密钥只以环境变量键出现、值不进命令行。
 */
import { describe, it, expect } from 'vitest'
import { join, resolve } from 'path'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import {
  buildCredentialEnv,
  buildDockerRunArgs,
  buildMountPlan,
  containerProxyUrl,
  createDockerSandboxProvider,
  createSandboxAgentPort,
  createSandboxVerify,
  ensureDockerImage,
  parseAgentOutput,
  type DockerRunner,
} from '../dockerSandbox'

interface Recorded {
  args: string[]
  options?: { cwd?: string; timeoutMs?: number; env?: Record<string, string>; stdin?: string }
}

function fakeDocker(
  respond: (args: string[]) => { code?: number; stdout?: string; stderr?: string; timedOut?: boolean } = () => ({}),
): { docker: DockerRunner; calls: Recorded[] } {
  const calls: Recorded[] = []
  const docker: DockerRunner = async (args, options) => {
    calls.push({ args, ...(options ? { options } : {}) })
    const result = respond(args)
    return {
      code: result.code ?? 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      timedOut: result.timedOut ?? false,
      aborted: false,
    }
  }
  return { docker, calls }
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'factory-docker-'))
  mkdirSync(join(dir, '.spacecode/factory/docker'), { recursive: true })
  writeFileSync(join(dir, '.spacecode/factory/docker/Dockerfile'), 'FROM node:22\n', 'utf-8')
  return dir
}

describe('buildMountPlan', () => {
  it('mounts the task worktree and repository metadata read-write and the package cache read-only', () => {
    const repoRoot = resolve('/repo')
    const worktree = join(repoRoot, '.spacecode/worktrees/bl-1')
    const result = buildMountPlan({ repoRoot, worktreeAbsolute: worktree })
    if (!result.ok) throw new Error(result.error)
    const sources = result.mounts.map((mount) => mount.source)
    expect(sources).toContain(worktree)
    expect(sources).toContain(join(repoRoot, '.git'))
    expect(sources).toContain(join(repoRoot, '.spacecode/factory/cache'))
    expect(result.mounts.find((m) => m.source === worktree)?.readOnly).not.toBe(true)
    expect(result.mounts.find((m) => m.source === join(repoRoot, '.spacecode/factory/cache'))?.readOnly).toBe(true)
  })

  it('rejects worktrees outside the repository, home directories and SSH keys', () => {
    const repoRoot = '/repo'
    const outside = buildMountPlan({ repoRoot, worktreeAbsolute: '/etc/worktree' })
    expect(outside).toEqual({ ok: false, error: 'outside-project' })

    // 仓库位于家目录下是正常场景；被拒绝的是「把家目录本身当挂载源」。
    const home = buildMountPlan({
      repoRoot: '/home/me/repo',
      worktreeAbsolute: '/home/me/repo/.spacecode/worktrees/x',
      cacheDir: '/home/me',
      homeDir: '/home/me',
    })
    expect(home).toEqual({ ok: false, error: 'home' })

    const ssh = buildMountPlan({ repoRoot: '/repo', worktreeAbsolute: '/repo/.ssh/task' })
    expect(ssh).toEqual({ ok: false, error: 'ssh' })
  })
})

describe('containerProxyUrl', () => {
  it('rewrites loopback hosts to host.docker.internal and leaves remote hosts alone', () => {
    expect(containerProxyUrl('http://127.0.0.1:8787')).toBe('http://host.docker.internal:8787')
    expect(containerProxyUrl('http://localhost:8080')).toBe('http://host.docker.internal:8080')
    expect(containerProxyUrl('https://proxy.example.com:3128')).toBe('https://proxy.example.com:3128')
    expect(containerProxyUrl('http://[::1]:8787')).toBe('http://host.docker.internal:8787')
  })
})

describe('buildCredentialEnv', () => {
  it('maps provider keys into container env without leaking values into argv', () => {
    const env = buildCredentialEnv({
      engineConfig: { provider: 'anthropic', apiKey: 'sk-secret', baseUrl: 'http://127.0.0.1:8787/v1' },
      proxyUrl: 'http://127.0.0.1:3128',
    })
    expect(env.ANTHROPIC_API_KEY).toBe('sk-secret')
    expect(env.ANTHROPIC_BASE_URL).toBe('http://host.docker.internal:8787/v1')
    expect(env.HTTP_PROXY).toBe('http://host.docker.internal:3128')
    expect(env.NO_PROXY).toContain('host.docker.internal')

    const openai = buildCredentialEnv({ engineConfig: { provider: 'openai', apiKey: 'k' } })
    expect(openai.OPENAI_API_KEY).toBe('k')
    expect(openai.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('omits empty credentials entirely', () => {
    expect(buildCredentialEnv({})).toEqual({})
  })
})

describe('buildDockerRunArgs', () => {
  it('runs as the current uid/gid, mounts only planned paths and passes credentials by key', () => {
    const repoRoot = resolve('/repo')
    const worktree = join(repoRoot, '.spacecode/worktrees/bl-1')
    const plan = buildMountPlan({ repoRoot, worktreeAbsolute: worktree })
    if (!plan.ok) throw new Error(plan.error)

    const args = buildDockerRunArgs({
      containerName: 'spacecode-fac-bl-1',
      imageName: 'factory:latest',
      mounts: plan.mounts,
      worktreeAbsolute: worktree,
      uid: 1000,
      gid: 1000,
      envKeys: ['ANTHROPIC_API_KEY', 'HTTPS_PROXY'],
      labels: { 'spacecode.factory.task': 'bl-1' },
    })
    const text = args.join(' ')
    expect(text).toContain('--user 1000:1000')
    expect(text).toContain(`--workdir ${worktree}`)
    expect(text).toContain('--add-host host.docker.internal:host-gateway')
    expect(text).toContain('--label spacecode.factory=1')
    expect(text).toContain('--label spacecode.factory.task=bl-1')
    expect(text).toContain(`-v ${worktree}:${worktree}`)
    expect(text).toContain(`-v ${join(repoRoot, '.spacecode/factory/cache')}:${join(repoRoot, '.spacecode/factory/cache')}:ro`)
    expect(text).toContain('-e ANTHROPIC_API_KEY')
    expect(text).toContain('-e HTTPS_PROXY')
    expect(text).not.toContain('sk-secret')
    expect(text).not.toContain('/home')
    expect(args).toContain('-d')
  })

  it('skips --user on platforms without a uid', () => {
    const args = buildDockerRunArgs({
      containerName: 'c',
      imageName: 'img',
      mounts: [{ source: '/repo/.spacecode/worktrees/t', target: '/repo/.spacecode/worktrees/t' }],
      worktreeAbsolute: '/repo/.spacecode/worktrees/t',
      envKeys: [],
    })
    expect(args.join(' ')).not.toContain('--user')
  })
})

describe('ensureDockerImage', () => {
  it('builds from the fixed Dockerfile entry when the image is missing, then reuses the labelled image', async () => {
    const repoRoot = tempRepo()
    const inspectMissing = fakeDocker((args) => (args[0] === 'image' ? { code: 1, stderr: 'no such image' } : {}))
    const first = await ensureDockerImage(inspectMissing.docker, { repoRoot, imageName: 'factory:latest' })
    expect(first.ok).toBe(true)
    const build = inspectMissing.calls.find((call) => call.args[0] === 'build')
    expect(build?.args).toContain('-f')
    expect(build?.args).toContain(join(repoRoot, '.spacecode/factory/docker/Dockerfile'))
    expect(build?.args).toContain('-t')
    expect(build?.args).toContain('factory:latest')
    expect(build?.args).toContain(`--label`)
    expect(build?.args.join(' ')).toContain('spacecode.dockerfile.sha=')

    const sha = build?.args.find((arg) => arg.startsWith('spacecode.dockerfile.sha='))?.split('=')[1]
    const inspectHit = fakeDocker((args) =>
      args[0] === 'image' ? { code: 0, stdout: `${sha}\n` } : {},
    )
    const second = await ensureDockerImage(inspectHit.docker, { repoRoot, imageName: 'factory:latest' })
    expect(second).toMatchObject({ ok: true, built: false })
    expect(inspectHit.calls.some((call) => call.args[0] === 'build')).toBe(false)
  })

  it('returns the redacted log tail when the build fails', async () => {
    const repoRoot = tempRepo()
    const fail = fakeDocker((args) =>
      args[0] === 'image'
        ? { code: 1 }
        : { code: 1, stdout: Array.from({ length: 60 }, (_, i) => `line-${i}`).join('\n'), stderr: 'token sk-abcdefghijklmnop failed' },
    )
    const result = await ensureDockerImage(fail.docker, { repoRoot, imageName: 'factory:latest' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.tail).toContain('line-59')
    expect(result.tail).not.toContain('line-0\n')
    expect(result.tail).not.toContain('sk-abcdefghijklmnop')
    expect(result.tail).toContain('sk-***')
  })

  it('fails clearly when the Dockerfile is missing', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'factory-docker-nofile-'))
    const { docker } = fakeDocker()
    const result = await ensureDockerImage(docker, { repoRoot, imageName: 'factory:latest' })
    expect(result).toEqual({ ok: false, reason: 'dockerfile-missing' })
    rmSync(repoRoot, { recursive: true, force: true })
  })
})

const baseInput = (repoRoot: string) => ({
  repoRoot,
  taskId: 'bl-1',
  branch: 'agent/task-bl-1',
  imageName: 'factory:latest',
  engineConfig: { cwd: repoRoot, provider: 'anthropic', apiKey: 'sk-live-secret', baseUrl: 'http://127.0.0.1:8787' },
  proxyUrl: 'http://127.0.0.1:3128',
  uid: 1000,
  gid: 1000,
})

describe('DockerSandboxProvider', () => {
  it('creates a labelled, detached container with credentials injected by key only', async () => {
    const repoRoot = tempRepo()
    const { docker, calls } = fakeDocker()
    const provider = createDockerSandboxProvider({ docker })
    const created = await provider.create(baseInput(repoRoot))
    if (!created.ok) throw new Error(created.detail)

    const run = calls.find((call) => call.args[0] === 'run')
    expect(run).toBeDefined()
    expect(run?.args).toContain('-d')
    expect(run?.args.join(' ')).toContain('sleep')
    expect(run?.options?.env?.ANTHROPIC_API_KEY).toBe('sk-live-secret')
    expect(run?.args.join(' ')).not.toContain('sk-live-secret')
    expect(run?.args.join(' ')).toContain('-e ANTHROPIC_API_KEY')
    expect(created.sandbox.worktreePath.replace(/\\/g, '/')).toContain('.spacecode/worktrees/bl-1')
    expect(created.sandbox.branch).toBe('agent/task-bl-1')
  })

  it('does not create a container when the image cannot be built', async () => {
    const repoRoot = tempRepo()
    const { docker, calls } = fakeDocker((args) => (args[0] === 'image' ? { code: 1 } : { code: 1, stderr: 'boom' }))
    const provider = createDockerSandboxProvider({ docker })
    const created = await provider.create(baseInput(repoRoot))
    expect(created).toMatchObject({ ok: false, error: 'sandbox-unavailable' })
    expect(calls.some((call) => call.args[0] === 'run')).toBe(false)
  })

  it('executes commands in the container workdir and forwards timeouts', async () => {
    const repoRoot = tempRepo()
    const { docker, calls } = fakeDocker((args) =>
      args[0] === 'exec' ? { code: 7, stdout: 'out', timedOut: true } : {},
    )
    const provider = createDockerSandboxProvider({ docker })
    const created = await provider.create(baseInput(repoRoot))
    if (!created.ok) throw new Error(created.detail)

    const result = await created.sandbox.exec(['npm', 'run', 'test'], {
      cwd: created.sandbox.worktreePath,
      timeoutMs: 1000,
    })
    const exec = calls.find((call) => call.args[0] === 'exec')
    const args = exec?.args ?? []
    const commandIndex = args.indexOf(created.sandbox.id) + 1
    // 凭据键以空值覆盖，命令本身不携带密钥。
    expect(args.slice(0, 2)).toEqual(['exec', '-e'])
    expect(args).toContain('ANTHROPIC_API_KEY=')
    expect(args).not.toContain('sk-live-secret')
    expect(args.slice(commandIndex)).toEqual(['npm', 'run', 'test'])
    expect(args[commandIndex - 2]).toBe(created.sandbox.worktreePath)
    expect(exec?.options?.timeoutMs).toBe(1000)
    expect(result.code).toBe(7)
    expect(result.timedOut).toBe(true)
  })

  it('runs the agent CLI with the prompt on stdin and emits projected stream events', async () => {
    const repoRoot = tempRepo()
    const { docker, calls } = fakeDocker((args) =>
      args[0] === 'exec'
        ? {
            stdout: [
              JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }] } }),
              JSON.stringify({ type: 'result', result: 'done', usage: { input_tokens: 2, output_tokens: 3 } }),
            ].join('\n'),
          }
        : {},
    )
    const provider = createDockerSandboxProvider({ docker })
    const created = await provider.create({ ...baseInput(repoRoot), agentCommand: ['claude', '-p'] })
    if (!created.ok) throw new Error(created.detail)

    const events: Array<{ type: string; data: unknown }> = []
    created.sandbox.events((type, data) => events.push({ type, data }))
    const turn = await created.sandbox.runAgent('do it', {
      cwd: created.sandbox.worktreePath,
      permissionMode: 'acceptEdits',
    })

    const execs = calls.filter((call) => call.args[0] === 'exec')
    const exec = execs[execs.length - 1]
    expect(exec?.args).toContain('claude')
    expect(exec?.args.join(' ')).toContain('--permission-mode acceptEdits')
    expect(exec?.options?.stdin).toBe('do it')
    expect(turn.text).toBe('done')
    expect(turn.inputTokens).toBe(2)
    expect(turn.outputTokens).toBe(3)
    expect(events.some((event) => event.type === 'tool_use')).toBe(true)
  })

  it('stop kills the container and close removes it while preserving the worktree', async () => {
    const repoRoot = tempRepo()
    const { docker, calls } = fakeDocker()
    const provider = createDockerSandboxProvider({ docker })
    const created = await provider.create(baseInput(repoRoot))
    if (!created.ok) throw new Error(created.detail)

    await created.sandbox.stop()
    await created.sandbox.stop()
    const closed = await created.sandbox.close()
    await created.sandbox.close()

    expect(calls.filter((call) => call.args[0] === 'kill')).toHaveLength(1)
    expect(calls.filter((call) => call.args[0] === 'rm')).toHaveLength(1)
    expect(closed.preservedPath).toBe(created.sandbox.worktreePath)
  })

  it('reclaims stale containers while leaving active ones alone', async () => {
    const { docker, calls } = fakeDocker((args) => {
      if (args[0] === 'ps') return { stdout: 'spacecode-fac-bl-1\nspacecode-fac-old\nunrelated\n' }
      return {}
    })
    const provider = createDockerSandboxProvider({ docker })
    const removed = await provider.reclaim(['spacecode-fac-bl-1'])
    expect(removed).toEqual(['spacecode-fac-old'])
    expect(
      calls.filter((call) => call.args[0] === 'rm').map((call) => call.args[call.args.length - 1]),
    ).toEqual(['spacecode-fac-old'])
  })

  it('preflight reports docker availability, image buildability, mountability and proxy reachability', async () => {
    const repoRoot = tempRepo()
    const { docker } = fakeDocker((args) => (args[0] === 'image' ? { code: 0, stdout: '' } : {}))
    const provider = createDockerSandboxProvider({ docker, probeProxy: async () => false })
    const facts = await provider.preflight({
      repoRoot,
      imageName: 'factory:latest',
      proxyUrl: 'http://127.0.0.1:3128',
    })
    expect(facts.dockerAvailable).toBe(true)
    expect(facts.image.ok).toBe(true) // 无 sha 标签触发重建，假构建成功
    expect(facts.mountable).toBe(true)
    expect(facts.proxy).toEqual({ ok: false, reason: 'unreachable' })
  })
})

describe('parseAgentOutput', () => {
  it('reads the last result event and falls back to plain text', () => {
    const parsed = parseAgentOutput(
      [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
        JSON.stringify({ type: 'result', result: 'all done', usage: { input_tokens: 1, output_tokens: 2 } }),
      ].join('\n'),
    )
    expect(parsed.turn).toEqual({ text: 'all done', isError: false, inputTokens: 1, outputTokens: 2 })
    expect(parsed.events.map((event) => event.type)).toEqual(['tool_use', 'result'])

    expect(parseAgentOutput('plain output').turn.text).toBe('plain output')
  })
})

describe('createSandboxVerify', () => {
  it('maps container exec results into verify statuses without exposing credentials to the command', async () => {
    const repoRoot = tempRepo()
    const { docker, calls } = fakeDocker((args) =>
      args[0] === 'exec'
        ? { code: args[args.length - 1] === 'fail' ? 1 : 0, stdout: 'detail' }
        : {},
    )
    const provider = createDockerSandboxProvider({ docker })
    const created = await provider.create({
      repoRoot,
      taskId: 'bl-1',
      branch: 'agent/task-bl-1',
      imageName: 'factory:latest',
      engineConfig: { provider: 'anthropic', apiKey: 'sk-x' },
    })
    if (!created.ok) throw new Error(created.detail)

    const verify = createSandboxVerify(created.sandbox)
    const pass = await verify({ command: 'npm run test', cwd: created.sandbox.worktreePath })
    const execArgv = calls.filter((call) => call.args[0] === 'exec')[0]?.args ?? []
    expect(execArgv).toContain('ANTHROPIC_API_KEY=')
    expect(pass.status).toBe('pass')
    const fail = await verify({ command: 'npm run fail', cwd: created.sandbox.worktreePath })
    expect(fail.status).toBe('fail')
    expect(fail.exitCode).toBe(1)

    const rejected = await verify({ command: 'npm run test && rm -rf /', cwd: created.sandbox.worktreePath })
    expect(rejected.status).toBe('fail')
    expect(rejected.detail).toContain('Command rejected')
  })
})

describe('createSandboxAgentPort', () => {
  it('adapts the container handle to the AgentPort contract', async () => {
    const repoRoot = tempRepo()
    const { docker } = fakeDocker((args) =>
      args[0] === 'exec'
        ? { stdout: JSON.stringify({ type: 'result', result: 'ok', usage: { input_tokens: 4, output_tokens: 5 } }) }
        : {},
    )
    const provider = createDockerSandboxProvider({ docker })
    const created = await provider.create(baseInput(repoRoot))
    if (!created.ok) throw new Error(created.detail)

    const port = createSandboxAgentPort(created.sandbox)
    const seen: string[] = []
    const off = port.onEvent((sessionId, type) => seen.push(`${sessionId}:${type}`))
    const turn = await port.run('s1', 'hello', { cwd: created.sandbox.worktreePath, permissionMode: 'acceptEdits' })
    off()
    await port.stop('s1')

    expect(turn).toMatchObject({ text: 'ok', isError: false, inputTokens: 4, outputTokens: 5 })
    expect(seen).toContain('s1:result')
  })
})
