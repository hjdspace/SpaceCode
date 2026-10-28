/**
 * Factory IPC 编排层：把预检、配置合成、初始化落盘与凭据存储串起来。
 *
 * 依赖全部注入（`createFactoryService`），因此阻断路径可以在单测里
 * 用临时目录与假端口验证，而不需要真的启动 Electron。
 */
import { execFile } from 'child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { BrowserWindow, app, ipcMain, safeStorage } from 'electron'
import { registerHandlers } from '@/shared/handlerRegistry'
import { eventChannels } from '@/shared/channelMap'
import { factoryNamespace } from '@/shared/channels/factory'
import type {
  FactoryConfig,
  FactoryEngineOption,
  FactoryGithubAuthResult,
  FactoryPreflightResult,
  FactoryRepoInfo,
  FactorySaveResult,
  FactorySecretSaveResult,
  FactorySetupContext,
  FactorySetupDraft,
  FactoryState,
} from '@/shared/factory'
import {
  buildFactoryConfig,
  factoryConfigPath,
  readFactoryConfig,
  writeFactoryConfigAtomic,
} from './config'
import { ensureFactoryGitignore, ensureFactoryLayout, writePromptSkeletons } from './init'
import { runFactoryPreflight } from './preflight'
import { checkGhAuth as defaultCheckGhAuth, verifyGithubToken } from './github'
import { createFactorySecretStore, type FactorySecretStore } from './secrets'
import {
  createBacklogItem,
  deleteBacklogItem,
  moveBacklogItem,
  readBacklog,
  updateBacklogItem,
} from './backlog'
import { createFactoryRun, readLatestRun, readRunSnapshot } from './runs'
import { createFactoryRunner } from './factoryRunner'
import { loadEngineSessionConfig } from '../engine/engineSessionConfig'
import { info, warn } from '../infra/logger'

const FACTORY_EVENTS = eventChannels(factoryNamespace.events, 'factory:')

/** 事件推送广播到所有窗口；窗口刷新/切换项目都不会中断主进程里的运行。 */
function broadcastFactoryEvent(push: import('@/shared/factory').FactoryEventPush): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(FACTORY_EVENTS.onEvent, push)
  }
}

export interface FactoryServiceDeps {
  getRepoInfo(root: string): Promise<FactoryRepoInfo>
  getEngineAvailability(engineType: 'claude-code' | 'pi'): Promise<{ available: boolean; reason: string; version: string | null }>
  getModelProfile(root: string): { configured: boolean; model?: string; provider?: string }
  isConfigWritable(root: string): boolean
  isDockerAvailable(): Promise<boolean>
  checkGhAuth(): Promise<FactoryGithubAuthResult>
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
  saveGithubToken(token: string): FactorySecretSaveResult
  clearGithubToken(): { ok: boolean }
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
  if (config.tracker.auth === 'gh') return deps.checkGhAuth()
  const token = deps.secrets.readGithubToken()
  if (!token) return { ok: false, reason: 'invalid-token' }
  return deps.verifyToken(token, config.tracker.repo)
}

export function createFactoryService(deps: FactoryServiceDeps): FactoryService {
  async function collectPreflight(root: string, config: FactoryConfig): Promise<FactoryPreflightResult> {
    const [repo, engine, githubAuth, dockerAvailable] = await Promise.all([
      deps.getRepoInfo(root),
      deps.getEngineAvailability(config.agent.engineType),
      resolveGithubAuth(config, deps),
      config.sandbox.type === 'docker' ? deps.isDockerAvailable() : Promise.resolve(false),
    ])
    const modelProfile = deps.getModelProfile(root)
    return runFactoryPreflight(config, {
      repo,
      configWritable: deps.isConfigWritable(root),
      engineAvailable: engine.available,
      modelProfileConfigured: modelProfile.configured,
      githubAuth,
      dockerAvailable,
      verifyScriptMissing: deps.verifyScriptMissing(root, config.commands.verify),
    })
  }

  function getState(root: string): FactoryState {
    const config = readFactoryConfig(root)
    return {
      configured: config !== null,
      config,
      configPath: factoryConfigPath(root),
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
    return {
      repo,
      engines,
      modelProfile: {
        configured: profile.configured,
        ...(profile.model ? { model: profile.model } : {}),
        ...(profile.provider ? { provider: profile.provider } : {}),
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
  return {
    isGitRepo: true,
    root,
    ...(remote.stdout.trim() ? { remote: remote.stdout.trim() } : {}),
    baseBranch: branch.stdout.trim() || 'main',
    dirty: status.stdout.trim() !== '',
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

function getModelProfile(root: string): { configured: boolean; model?: string; provider?: string } {
  // 复用桌面设置解析（gui-settings.json），不再要求用户粘贴第二份模型密钥。
  const config = loadEngineSessionConfig(root)
  return {
    configured: Boolean(config.model || config.apiKey || config.baseUrl),
    ...(config.model ? { model: config.model } : {}),
    ...(config.provider ? { provider: config.provider } : {}),
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
    isConfigWritable,
    isDockerAvailable,
    checkGhAuth: () => defaultCheckGhAuth(),
    verifyToken: (token, repo) => verifyGithubToken(token, repo),
    verifyScriptMissing,
    secrets,
  })

  const runner = createFactoryRunner()
  runner.onPush(broadcastFactoryEvent)

  registerHandlers(ipcMain, factoryNamespace.channels, 'factory:', {
    state: (root) => service.getState(root),
    context: (root) => service.getContext(root),
    preflight: (root, draft) => service.runPreflight(root, draft),
    save: (root, draft) => service.save(root, draft),
    testGithubToken: (root, token, repo) => service.testGithubToken(root, token, repo),
    checkGhAuth: () => service.checkGhAuth(),
    saveGithubToken: (token) => service.saveGithubToken(token),
    clearGithubToken: () => service.clearGithubToken(),
    backlogList: (root) => readBacklog(root),
    backlogCreate: (root, input) => createBacklogItem(root, input),
    backlogUpdate: (root, input) => updateBacklogItem(root, input),
    backlogDelete: (root, id) => deleteBacklogItem(root, id),
    backlogMove: (root, id, direction) => moveBacklogItem(root, id, direction),
    runCreate: (root, input) => createFactoryRun(root, input),
    runGet: (root, runId) => readRunSnapshot(root, runId),
    runLatest: (root) => readLatestRun(root),
    taskStart: (root, runId, taskId, input) => runner.startTask(root, runId, taskId, input),
    taskStop: (root, runId, taskId) => runner.stopTask(root, runId, taskId),
    taskApprove: (root, runId, taskId) => runner.approveTask(root, runId, taskId),
    taskRequestChanges: (root, runId, taskId) => runner.requestChanges(root, runId, taskId),
    taskFix: (root, runId, taskId) => runner.fixTask(root, runId, taskId),
    taskCommentUpdate: (root, runId, taskId, input) =>
      runner.updateComment(root, runId, taskId, input),
    mergePreflight: (root, runId, taskId) => runner.mergePreflight(root, runId, taskId),
    mergeExecute: (root, runId, taskId, input) => runner.mergeTask(root, runId, taskId, input),
    runStop: (root, runId) => runner.stopRun(root, runId),
    taskEvents: (root, runId, taskId) => runner.readEvents(root, runId, taskId),
    worktreeReveal: (root, runId, taskId) => runner.revealWorktree(root, runId, taskId),
  })
  info('Factory', 'Factory IPC handlers registered')
}
