/**
 * Factory IPC 编排层：把预检、配置合成、初始化落盘与凭据存储串起来。
 *
 * 依赖全部注入（`createFactoryService`），因此阻断路径可以在单测里
 * 用临时目录与假端口验证，而不需要真的启动 Electron。
 */
import { execFile } from 'child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow, app, ipcMain, safeStorage, shell } from 'electron'
import { registerHandlers } from '@/shared/handlerRegistry'
import { eventChannels } from '@/shared/channelMap'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import { factoryNamespace } from '@/shared/channels/factory'
import type {
  FactoryConfig,
  FactoryConfigSaveResult,
  FactoryEngineOption,
  FactoryEngineType,
  FactoryGithubAuthResult,
  FactoryGhLoginResult,
  FactoryGithubReposResult,
  FactoryModelOptions,
  FactoryPreflightResult,
  FactoryPrReadyResult,
  FactoryRepoInfo,
  FactorySaveResult,
  FactorySecretSaveResult,
  FactorySetupContext,
  FactorySetupDraft,
  FactoryState,
  FactoryStorageState,
  FactoryTakeoverSession,
} from '@/shared/factory'
import type { H5RemoteUserMessagePayload } from '../h5/h5Types'
import {
  buildFactoryConfig,
  factoryConfigPath,
  readFactoryConfig,
  writeFactoryConfigAtomic,
} from './config'
import {
  ensureFactoryGitignore,
  ensureFactoryLayout,
  writeDockerfileSkeleton,
  writePromptSkeletons,
} from './init'
import { runFactoryPreflight } from './preflight'
import { checkGhAuth as defaultCheckGhAuth, checkGhWriteAccess, listGithubRepos, startGhWebLogin, verifyGithubToken } from './github'
import { createFactorySecretStore, type FactorySecretStore } from './secrets'
import {
  createBacklogItem,
  deleteBacklogItem,
  moveBacklogItem,
  readBacklog,
  updateBacklogItem,
} from './backlog'
import { createFactoryRun, listRecentRuns, readLatestRun, readRunSnapshot } from './runs'
import { createFactoryRunner } from './factoryRunner'
import { acquireRunLock, releaseRunLock } from './lock'
import { recoverRuns } from './recovery'
import { updateFactoryConfig } from './configUpdate'
import { createGithubTrackerService } from './githubTrackerService'
import { loadEngineSessionConfig, loadModelTiers, resolveEngineModelAlias } from '../engine/engineSessionConfig'
import { createDockerSandboxProvider, probeProxyReachable } from './dockerSandbox'
import { info, warn } from '../infra/logger'

const FACTORY_EVENTS = eventChannels(factoryNamespace.events, 'factory:')
const ENGINE_EVENTS = eventChannels(claudeCodeNamespace.events, 'claude-code:')

/** 事件推送广播到所有窗口；窗口刷新/切换项目都不会中断主进程里的运行。 */
function broadcastFactoryEvent(push: import('@/shared/factory').FactoryEventPush): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(FACTORY_EVENTS.onEvent, push)
  }
}

/**
 * 接管会话走 cron/H5 同一条远程消息通道：渲染层据此在聊天列表里
 * 创建/选择会话并直接开始回合，工具与权限确认都由现有聊天链路处理。
 */
function pushFactorySession(session: FactoryTakeoverSession): void {
  const payload: H5RemoteUserMessagePayload = {
    __h5RemoteUserMessage: true,
    messageId: null,
    content: session.content,
    projectPath: session.projectPath,
    title: session.title,
    timestamp: Date.now(),
    activate: session.activate,
    ...(session.model ? { model: session.model } : {}),
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(ENGINE_EVENTS.onUser, { sessionId: session.sessionId, data: payload })
    }
  }
}

/** Docker 沙箱预检事实；镜像/挂载/代理任一失败都会阻断保存。 */
export interface FactoryDockerPreflight {
  available: boolean
  imageOk: boolean
  imageDetail?: string
  mountable: boolean
  proxyOk?: boolean
}

export interface FactoryServiceDeps {
  getRepoInfo(root: string): Promise<FactoryRepoInfo>
  getEngineAvailability(engineType: 'claude-code' | 'pi'): Promise<{ available: boolean; reason: string; version: string | null }>
  getModelProfile(root: string): { configured: boolean; model?: string; provider?: string }
  /** 可选：桌面设置里可切换的模型；缺省时向导只能沿用默认模型。 */
  getModelOptions?(root: string): FactoryModelOptions
  /** 可选：列出当前凭据可访问的 GitHub 仓库（向导仓库下拉）。 */
  listRepos?(source: 'gh' | 'token', token: string | null): Promise<FactoryGithubReposResult>
  /** 可选：发起 gh 浏览器登录（`gh auth login --web`）。 */
  startGhLogin?(): Promise<FactoryGhLoginResult>
  isConfigWritable(root: string): boolean
  isDockerAvailable(): Promise<boolean>
  /** 可选：完整的 Docker 沙箱预检；缺省时只检查 docker 是否可用。 */
  dockerPreflight?(root: string, imageName: string): Promise<FactoryDockerPreflight>
  checkGhAuth(): Promise<FactoryGithubAuthResult>
  /** PR 模式：gh 凭据对目标仓库的写权限；缺省时预检按未知处理。 */
  checkGhRepoWrite?(repo: string): Promise<FactoryPrReadyResult>
  verifyToken(token: string, repo: string): Promise<FactoryGithubAuthResult>
  verifyScriptMissing(root: string, command: string): boolean
  secrets: FactorySecretStore
  now?: () => Date
}

export interface FactoryService {
  getState(root: string): FactoryState
  getContext(root: string): Promise<FactorySetupContext>
  runPreflight(root: string, draft: FactorySetupDraft): Promise<FactoryPreflightResult>
  save(root: string, draft: FactorySetupDraft): Promise<FactorySaveResult>
  testGithubToken(root: string, token: string, repo: string): Promise<FactoryGithubAuthResult>
  checkGhAuth(): Promise<FactoryGithubAuthResult>
  startGhLogin(): Promise<FactoryGhLoginResult>
  githubRepos(source: 'gh' | 'token', token?: string): Promise<FactoryGithubReposResult>
  saveGithubToken(token: string): FactorySecretSaveResult
  clearGithubToken(): { ok: boolean }
}

/**
 * 每个仓库根只做一次恢复：先抢运行目录写锁，再按是否持锁决定能否修复/清理。
 * 拿不到锁的窗口保持只读，但照样能读快照与事件。
 */
const storageByRoot = new Map<string, FactoryStorageState>()

function ensureStorage(root: string): FactoryStorageState {
  const cached = storageByRoot.get(root)
  if (cached) return cached

  const lock = acquireRunLock(root)
  if (!lock.ok) {
    warn('Factory', `Run storage locked by pid ${lock.pid}; opening read-only | root=${root}`)
  }
  const recovered = recoverRuns(root, { writable: lock.ok })
  if (recovered.corrupt.length > 0) {
    warn('Factory', `Quarantined corrupt factory data: ${recovered.corrupt.join(', ')}`)
  }
  if (recovered.recovered.length > 0) {
    info('Factory', `Recovered unfinished runs: ${recovered.recovered.join(', ')}`)
  }
  const state: FactoryStorageState = { writable: lock.ok, corrupt: recovered.corrupt }
  storageByRoot.set(root, state)
  return state
}

function isWritable(root: string): boolean {
  return ensureStorage(root).writable
}

function blockingInvalidDraft(): FactoryPreflightResult {
  return {
    items: [{ id: 'gitRepo', level: 'error', params: { reason: 'invalid-draft' } }],
    blocking: true,
  }
}

/** 把 token 认证失败映射成预检可消费的事实；缺失 token 直接视为无效。 */
async function resolveGithubAuth(
  config: FactoryConfig,
  deps: FactoryServiceDeps,
): Promise<FactoryGithubAuthResult | null> {
  if (config.tracker.type === 'local') return null
  if (config.tracker.auth === 'gh') {
    const auth = await deps.checkGhAuth()
    if (auth.ok && config.tracker.mergeMode === 'pr' && deps.checkGhRepoWrite) {
      const ready = await deps.checkGhRepoWrite(config.tracker.repo)
      return { ...auth, canPush: ready.ok }
    }
    return auth
  }
  const token = deps.secrets.readGithubToken()
  if (!token) return { ok: false, reason: 'invalid-token' }
  return deps.verifyToken(token, config.tracker.repo)
}

export function createFactoryService(deps: FactoryServiceDeps): FactoryService {
  async function collectDockerFacts(
    root: string,
    config: FactoryConfig,
  ): Promise<FactoryDockerPreflight | null> {
    if (config.sandbox.type !== 'docker') return null
    if (deps.dockerPreflight) return deps.dockerPreflight(root, config.sandbox.imageName)
    return {
      available: await deps.isDockerAvailable(),
      imageOk: true,
      mountable: true,
    }
  }

  /** Docker 沙箱依赖固定路径的 Dockerfile；预检前先补骨架，用户改写的内容保持不动。 */
  function ensureDockerScaffold(root: string, config: FactoryConfig): void {
    if (config.sandbox.type !== 'docker') return
    try {
      writeDockerfileSkeleton(root)
    } catch (error) {
      warn('Factory', `Failed to write Dockerfile skeleton: ${String(error)}`)
    }
  }

  async function collectPreflight(root: string, config: FactoryConfig): Promise<FactoryPreflightResult> {
    const [repo, engine, githubAuth, docker] = await Promise.all([
      deps.getRepoInfo(root),
      deps.getEngineAvailability(config.agent.engineType),
      resolveGithubAuth(config, deps),
      collectDockerFacts(root, config),
    ])
    const modelProfile = deps.getModelProfile(root)
    return runFactoryPreflight(config, {
      repo,
      configWritable: deps.isConfigWritable(root),
      engineAvailable: engine.available,
      modelProfileConfigured: modelProfile.configured,
      githubAuth,
      dockerAvailable: docker?.available ?? false,
      ...(docker
        ? {
            dockerImageOk: docker.imageOk,
            ...(docker.imageDetail ? { dockerImageDetail: docker.imageDetail } : {}),
            dockerMountable: docker.mountable,
            ...(docker.proxyOk === undefined ? {} : { dockerProxyOk: docker.proxyOk }),
          }
        : {}),
      verifyScriptMissing: deps.verifyScriptMissing(root, config.commands.verify),
    })
  }

  function getState(root: string): FactoryState {
    const config = readFactoryConfig(root)
    return {
      configured: config !== null,
      config,
      configPath: factoryConfigPath(root),
      storage: ensureStorage(root),
    }
  }

  async function getContext(root: string): Promise<FactorySetupContext> {
    const repo = await deps.getRepoInfo(root)
    const [claude, pi, dockerAvailable, gh] = await Promise.all([
      deps.getEngineAvailability('claude-code'),
      deps.getEngineAvailability('pi'),
      deps.isDockerAvailable(),
      deps.checkGhAuth(),
    ])
    const engines: FactoryEngineOption[] = [
      { engineType: 'claude-code', ...claude, exposed: true },
      { engineType: 'pi', ...pi, exposed: true },
    ]
    const profile = deps.getModelProfile(root)
    const options = deps.getModelOptions?.(root) ?? { selectable: [] }
    const defaultModel = options.default ?? profile.model
    return {
      repo,
      engines,
      modelProfile: {
        configured: profile.configured,
        ...(profile.model ? { model: profile.model } : {}),
        ...(profile.provider ? { provider: profile.provider } : {}),
      },
      models: {
        selectable: options.selectable,
        ...(defaultModel ? { default: defaultModel } : {}),
        ...(options.tiers ? { tiers: options.tiers } : {}),
      },
      dockerAvailable,
      encryptionAvailable: deps.secrets.encryptionAvailable,
      ghLoggedIn: gh.ok,
      existingConfig: readFactoryConfig(root),
    }
  }

  async function runPreflight(root: string, draft: FactorySetupDraft): Promise<FactoryPreflightResult> {
    const repoInfo = await deps.getRepoInfo(root)
    const built = buildFactoryConfig(draft, {
      ...(repoInfo.remote ? { remote: repoInfo.remote } : {}),
      baseBranch: repoInfo.baseBranch,
    })
    if (!built.ok) return blockingInvalidDraft()
    ensureDockerScaffold(root, built.config)
    return collectPreflight(root, built.config)
  }

  async function save(root: string, draft: FactorySetupDraft): Promise<FactorySaveResult> {
    const repoInfo = await deps.getRepoInfo(root)
    const built = buildFactoryConfig(draft, {
      ...(repoInfo.remote ? { remote: repoInfo.remote } : {}),
      baseBranch: repoInfo.baseBranch,
    })
    if (!built.ok) return { ok: false, error: 'invalid-draft' }

    // 主进程是最后一道闸门：预检不通过绝不落盘。
    ensureDockerScaffold(root, built.config)
    const preflight = await collectPreflight(root, built.config)
    if (preflight.blocking) return { ok: false, error: 'preflight-failed', preflight }

    try {
      const configPath = writeFactoryConfigAtomic(root, built.config)
      ensureFactoryLayout(root, { tracker: built.config.tracker.type })
      writePromptSkeletons(root)
      ensureFactoryGitignore(root)
      info('Factory', `Configuration saved | root=${root}`)
      return { ok: true, configPath }
    } catch (err) {
      warn('Factory', `Failed to save configuration: ${String(err)}`)
      return { ok: false, error: 'write-failed' }
    }
  }

  return {
    getState,
    getContext,
    runPreflight,
    save,
    testGithubToken: (_root, token, repo) => deps.verifyToken(token, repo),
    checkGhAuth: () => deps.checkGhAuth(),
    startGhLogin: () => deps.startGhLogin?.() ?? Promise.resolve({ ok: false, reason: 'unsupported' }),
    githubRepos: (source, token) =>
      deps.listRepos?.(source, token ?? null) ?? Promise.resolve({ ok: false, reason: 'unsupported' }),
    saveGithubToken: (token) => deps.secrets.saveGithubToken(token),
    clearGithubToken: () => {
      deps.secrets.clearGithubToken()
      return { ok: true }
    },
  }
}

// ── Electron 默认依赖 ───────────────────────────────────────────

function runCommand(binary: string, args: string[], cwd?: string): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      { cwd, timeout: 10000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (error, stdout) => {
        const code = error ? 1 : 0
        resolve({ stdout: stdout ?? '', code })
      },
    )
  })
}

async function getRepoInfo(root: string): Promise<FactoryRepoInfo> {
  const top = await runCommand('git', ['rev-parse', '--show-toplevel'], root)
  if (top.code !== 0 || !top.stdout.trim()) {
    return { isGitRepo: false, root, baseBranch: 'main', dirty: false, gitVersion: null }
  }
  const [remote, branch, status, version] = await Promise.all([
    runCommand('git', ['config', '--get', 'remote.origin.url'], root),
    runCommand('git', ['symbolic-ref', '--short', 'HEAD'], root),
    runCommand('git', ['status', '--porcelain'], root),
    runCommand('git', ['--version'], root),
  ])
  const gitVersion = version.stdout.match(/(\d+\.\d+(?:\.\d+)?)/)?.[1] ?? null
  // 与启动/合并闸门同口径：流水线自己写的 .spacecode/ 不算用户脏改动。
  const dirtyFiles = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .filter((line) => !line.slice(3).trim().startsWith('.spacecode/')).length
  return {
    isGitRepo: true,
    root,
    ...(remote.stdout.trim() ? { remote: remote.stdout.trim() } : {}),
    baseBranch: branch.stdout.trim() || 'main',
    dirty: dirtyFiles > 0,
    ...(dirtyFiles > 0 ? { dirtyFiles } : {}),
    gitVersion,
  }
}

function isConfigWritable(root: string): boolean {
  try {
    accessSync(root, constants.W_OK)
    mkdirSync(join(root, '.spacecode', 'factory'), { recursive: true })
    return true
  } catch {
    return false
  }
}

function isDockerAvailable(): Promise<boolean> {
  return runCommand('docker', ['version', '--format', '{{.Server.Version}}']).then((r) => r.code === 0)
}

/** 预检一次性检查：Docker 可用、固定镜像可构建、工作树/缓存可挂载、代理可达。 */
async function dockerPreflight(root: string, imageName: string): Promise<FactoryDockerPreflight> {
  const provider = createDockerSandboxProvider({ probeProxy: (url) => probeProxyReachable(url) })
  const facts = await provider.preflight({ repoRoot: root, imageName })
  return {
    available: facts.dockerAvailable,
    imageOk: facts.image.ok,
    ...(facts.image.ok ? {} : { imageDetail: facts.image.tail ?? facts.image.reason }),
    mountable: facts.mountable,
    ...(facts.proxy ? { proxyOk: facts.proxy.ok } : {}),
  }
}

function verifyScriptMissing(root: string, command: string): boolean {
  const match = command.match(/^(?:npm|pnpm|yarn|bun)\s+run\s+([^\s]+)/)
  if (!match) return false
  try {
    const pkgPath = join(root, 'package.json')
    if (!existsSync(pkgPath)) return true
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> }
    return !pkg.scripts?.[match[1]]
  } catch {
    return false
  }
}

const CLAUDE_CODE_ALIASES = new Set(['haiku', 'sonnet', 'opus'])

/**
 * 保存前按引擎解析模型别名：claude-code 只认三个内置别名或设置里的槽位真名，
 * pi 只认真实模型 id。设置里完全没有模型信息时无法校验，按原值放行。
 */
function resolveFactoryModel(
  root: string,
  model: string,
  engineType: FactoryEngineType,
): string | null {
  const session = loadEngineSessionConfig(root)
  const known = [...(session.selectableModels ?? []), ...(session.model ? [session.model] : [])]
  if (known.length === 0) return model
  if (engineType === 'claude-code') {
    if (CLAUDE_CODE_ALIASES.has(model)) return model
    return known.includes(model) ? resolveEngineModelAlias(model, 'claude-code') : null
  }
  return known.includes(model) ? model : null
}

function getModelProfile(root: string): { configured: boolean; model?: string; provider?: string } {
  // 复用桌面设置解析（gui-settings.json），不再要求用户粘贴第二份模型密钥。
  const config = loadEngineSessionConfig(root)
  return {
    configured: Boolean(config.model || config.apiKey || config.baseUrl),
    ...(config.model ? { model: config.model } : {}),
    ...(config.provider ? { provider: config.provider } : {}),
  }
}

function getModelOptions(root: string): FactoryModelOptions {
  const config = loadEngineSessionConfig(root)
  const tiers = loadModelTiers()
  return {
    selectable: config.selectableModels ?? [],
    ...(config.model ? { default: config.model } : {}),
    ...(Object.keys(tiers).length > 0 ? { tiers } : {}),
  }
}

let registered = false

export function registerFactoryIPCHandlers(): void {
  if (registered) return
  registered = true

  const secrets = createFactorySecretStore({
    filePath: join(app.getPath('userData'), 'factory-secrets.json'),
    crypto: safeStorage,
    log: (message, err) => warn('Factory', `${message}: ${String(err ?? '')}`),
  })

  const service = createFactoryService({
    getRepoInfo,
    getEngineAvailability: async (type) => {
      const { EngineFactory } = await import('../engine/engines/EngineFactory')
      const availability = await EngineFactory.getEngineAvailability(type)
      return { available: availability.available, reason: availability.reason, version: availability.version }
    },
    getModelProfile,
    getModelOptions,
    listRepos: (source, token) =>
      listGithubRepos(source, source === 'token' ? token ?? secrets.readGithubToken() : null),
    startGhLogin: async () => {
      const result = await startGhWebLogin()
      // 无 TTY 时 gh 只打印授权 URL，不会自己拉起浏览器。
      if (result.ok && result.code) {
        void shell.openExternal(result.url ?? 'https://github.com/login/device').catch(() => {})
      }
      return result
    },
    isConfigWritable,
    isDockerAvailable,
    dockerPreflight,
    checkGhAuth: () => defaultCheckGhAuth(),
    checkGhRepoWrite: (repo) => checkGhWriteAccess(repo),
    verifyToken: (token, repo) => verifyGithubToken(token, repo),
    verifyScriptMissing,
    secrets,
  })

  // GitHub 任务源：gh 与 REST 共用一个 trackerService；合并回写也走它。
  const githubTracker = createGithubTrackerService({
    secrets,
    checkGh: () => defaultCheckGhAuth(),
  })

  const runner = createFactoryRunner({
    mergeWriteBack: (payload) => githubTracker.writeBackMerge(payload),
    checkPrReady: (root) => githubTracker.checkPrReady(root),
    pushSession: pushFactorySession,
  })
  runner.onPush(broadcastFactoryEvent)

  app.once('will-quit', () => {
    for (const root of storageByRoot.keys()) releaseRunLock(root)
  })

  registerHandlers(ipcMain, factoryNamespace.channels, 'factory:', {
    state: (root) => service.getState(root),
    context: (root) => service.getContext(root),
    preflight: (root, draft) => service.runPreflight(root, draft),
    save: (root, draft) => service.save(root, draft),
    testGithubToken: (root, token, repo) => service.testGithubToken(root, token, repo),
    checkGhAuth: () => service.checkGhAuth(),
    startGhLogin: () => service.startGhLogin(),
    githubRepos: (source, token) => service.githubRepos(source, token),
    saveGithubToken: (token) => service.saveGithubToken(token),
    clearGithubToken: () => service.clearGithubToken(),
    githubIssues: (root, input) => githubTracker.listIssues(root, input),
    githubClaim: (root, input) => githubTracker.claimIssues(root, input),
    githubRetryWriteback: (root, runId, taskId) =>
      githubTracker.retryWriteback(root, runId, taskId),
    backlogList: (root) => readBacklog(root),
    backlogCreate: (root, input) => createBacklogItem(root, input),
    backlogUpdate: (root, input) => updateBacklogItem(root, input),
    backlogDelete: (root, id) => deleteBacklogItem(root, id),
    backlogMove: (root, id, direction) => moveBacklogItem(root, id, direction),
    runCreate: (root, input) =>
      isWritable(root) ? createFactoryRun(root, input) : { ok: false, error: 'run-locked' },
    runGet: (root, runId) => readRunSnapshot(root, runId),
    runList: (root) => listRecentRuns(root),
    runLatest: (root) => readLatestRun(root),
    taskStart: (root, runId, taskId, input) =>
      isWritable(root)
        ? runner.startTask(root, runId, taskId, input)
        : { ok: false, error: 'run-locked' },
    taskStop: (root, runId, taskId) =>
      isWritable(root) ? runner.stopTask(root, runId, taskId) : { ok: false, error: 'run-locked' },
    taskCancel: (root, runId, taskId) =>
      isWritable(root) ? runner.cancelTask(root, runId, taskId) : { ok: false, error: 'run-locked' },
    taskApprove: (root, runId, taskId) =>
      isWritable(root) ? runner.approveTask(root, runId, taskId) : { ok: false, error: 'run-locked' },
    taskRequestChanges: (root, runId, taskId) =>
      isWritable(root)
        ? runner.requestChanges(root, runId, taskId)
        : { ok: false, error: 'run-locked' },
    taskFix: (root, runId, taskId) =>
      isWritable(root) ? runner.fixTask(root, runId, taskId) : { ok: false, error: 'run-locked' },
    taskTakeover: (root, runId, taskId) =>
      isWritable(root)
        ? runner.takeoverTask(root, runId, taskId)
        : { ok: false, error: 'run-locked' },
    taskReturn: (root, runId, taskId) =>
      isWritable(root) ? runner.returnTask(root, runId, taskId) : { ok: false, error: 'run-locked' },
    taskRetry: (root, runId, taskId, input) =>
      isWritable(root)
        ? runner.retryTask(root, runId, taskId, input)
        : { ok: false, error: 'run-locked' },
    taskCommentUpdate: (root, runId, taskId, input) =>
      isWritable(root)
        ? runner.updateComment(root, runId, taskId, input)
        : { ok: false, error: 'run-locked' },
    mergePreflight: (root, runId, taskId) => runner.mergePreflight(root, runId, taskId),
    mergeExecute: (root, runId, taskId, input) =>
      isWritable(root)
        ? runner.mergeTask(root, runId, taskId, input)
        : { ok: false, error: 'run-locked' },
    runStop: (root, runId) =>
      isWritable(root) ? runner.stopRun(root, runId) : { ok: false, error: 'run-locked' },
    runPause: (root, runId) =>
      isWritable(root) ? runner.pauseRun(root, runId) : { ok: false, error: 'run-locked' },
    runResume: (root, runId) =>
      isWritable(root) ? runner.resumeRun(root, runId) : { ok: false, error: 'run-locked' },
    configSave: (root, input): FactoryConfigSaveResult => {
      const result = updateFactoryConfig(root, input, {
        resolveModel: (model, engineType) => resolveFactoryModel(root, model, engineType),
      })
      if (result.ok && isWritable(root)) {
        runner.recordConfigChange(root, result.config.revision, {
          maxConcurrency: result.config.agent.maxConcurrency,
        })
      }
      return result
    },
    taskEvents: (root, runId, taskId) => runner.readEvents(root, runId, taskId),
    worktreeReveal: (root, runId, taskId) => runner.revealWorktree(root, runId, taskId),
  })
  info('Factory', 'Factory IPC handlers registered')
}
