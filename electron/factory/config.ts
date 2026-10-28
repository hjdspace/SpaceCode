/**
 * Factory 配置：草稿 → 配置合成、严格校验、版本迁移与原子写。
 *
 * 配置固定落在项目内 `.spacecode/factory/config.json`。所有路径字段只允许
 * 相对仓库根的安全路径（无盘符、无 `..`），保证配置可随仓库迁移。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, normalize } from 'path'
import {
  FACTORY_BACKLOG_PATH,
  FACTORY_PROMPT_KEYS,
  FACTORY_SANDBOX_WORKTREE_ROOT,
  type FactoryConfig,
  type FactoryPromptKey,
  type FactorySandboxConfig,
  type FactorySetupDraft,
  type FactoryStageConfig,
  type FactoryStageKey,
  type FactoryTrackerConfig,
} from '@/shared/factory'

export const FACTORY_CONFIG_RELATIVE_PATH = '.spacecode/factory/config.json'

export type FactoryConfigValidationResult =
  | { ok: true; config: FactoryConfig }
  | { ok: false; errors: string[] }

export interface FactoryRepoMeta {
  remote?: string
  baseBranch: string
}

const STAGE_KEYS: readonly FactoryStageKey[] = ['plan', 'implement', 'verify', 'review', 'merge']

const DEFAULT_STAGES: Record<FactoryStageKey, FactoryStageConfig> = {
  plan: { enabled: true, permissionMode: 'plan', humanGate: false },
  implement: { enabled: true, permissionMode: 'acceptEdits', humanGate: false },
  verify: { enabled: true, permissionMode: 'default', humanGate: false },
  review: { enabled: true, permissionMode: 'acceptEdits', humanGate: true },
  merge: { enabled: true, permissionMode: 'default', humanGate: true },
}

const DEFAULT_LIMITS = {
  taskTimeoutSec: 3600,
  idleTimeoutSec: 600,
  keepDoneRuns: 20,
}

/** 只允许仓库内相对路径；拒绝绝对路径、盘符与上跳。 */
export function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false
  if (isAbsolute(value)) return false
  // Windows 盘符形式（C:/ 或 C:\）即使 isAbsolute 在别的平台上也应拒绝
  if (/^[a-zA-Z]:/.test(value)) return false
  const normalized = normalize(value).split(/[\\/]/)
  return !normalized.includes('..')
}

function defaultPrompts(): Record<FactoryPromptKey, string> {
  const prompts = {} as Record<FactoryPromptKey, string>
  for (const key of FACTORY_PROMPT_KEYS) {
    prompts[key] = `.spacecode/factory/prompts/${key}.md`
  }
  return prompts
}

function buildSandbox(draft: FactorySetupDraft['sandbox']): FactorySandboxConfig | { error: string } {
  const type = draft?.type ?? 'worktree'
  if (type === 'worktree') return { type: 'worktree', root: FACTORY_SANDBOX_WORKTREE_ROOT }
  if (type === 'docker') {
    const imageName = (draft?.imageName ?? '').trim()
    if (!imageName) return { error: 'sandbox.imageName' }
    return { type: 'docker', imageName, worktreeRoot: FACTORY_SANDBOX_WORKTREE_ROOT }
  }
  if (type === 'podman') return { error: 'sandbox.unsupported' }
  return { error: 'sandbox.type' }
}

function buildTracker(draft: FactorySetupDraft['tracker']): FactoryTrackerConfig | { error: string } {
  const type = draft?.type ?? 'local'
  if (type === 'local') {
    return { type: 'local', backlogPath: FACTORY_BACKLOG_PATH, mergeMode: 'local' }
  }
  if (type !== 'github-issues') return { error: 'tracker.type' }
  const repo = (draft?.repo ?? '').trim()
  const label = (draft?.label ?? '').trim()
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return { error: 'tracker.repo' }
  if (!label) return { error: 'tracker.label' }
  const auth = draft?.auth ?? 'gh'
  if (auth !== 'gh' && auth !== 'token') return { error: 'tracker.auth' }
  return {
    type: 'github-issues',
    repo,
    label,
    auth,
    mergeMode: draft?.mergeMode === 'pr' ? 'pr' : 'local',
    commentIssue: draft?.commentIssue ?? true,
    closeIssue: draft?.closeIssue ?? true,
  }
}

export function buildFactoryConfig(
  draft: FactorySetupDraft,
  repo: FactoryRepoMeta,
): FactoryConfigValidationResult {
  const errors: string[] = []
  const baseBranch = (repo.baseBranch || 'main').trim() || 'main'

  const engineType = draft.agent?.engineType ?? 'claude-code'
  if (engineType !== 'claude-code' && engineType !== 'pi') errors.push('agent.engineType')

  const verify = (draft.commands?.verify ?? '').trim()
  if (!verify) errors.push('commands.verify')

  const sandbox = buildSandbox(draft.sandbox)
  if ('error' in sandbox) errors.push(sandbox.error)

  const tracker = buildTracker(draft.tracker)
  if ('error' in tracker) errors.push(tracker.error)

  if (errors.length > 0) return { ok: false, errors }

  const config: FactoryConfig = {
    version: 1,
    revision: 1,
    repo: { root: '.', ...(repo.remote ? { remote: repo.remote } : {}), baseBranch },
    template: 'parallel-planner-with-review',
    agent: {
      engineType,
      ...(draft.agent?.model?.trim() ? { model: draft.agent.model.trim() } : {}),
      maxIterations: 5,
      maxConcurrency: 4,
    },
    sandbox: sandbox as FactorySandboxConfig,
    tracker: tracker as FactoryTrackerConfig,
    stages: DEFAULT_STAGES,
    commands: { verify, ...(draft.commands?.install?.trim() ? { install: draft.commands.install.trim() } : {}) },
    prompts: defaultPrompts(),
    limits: DEFAULT_LIMITS,
  }
  return validateFactoryConfig(config)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkSandbox(raw: unknown, errors: string[]): FactorySandboxConfig | null {
  if (!isPlainObject(raw)) {
    errors.push('sandbox')
    return null
  }
  const type = raw.type
  if (type === 'worktree') {
    if (!isSafeRelativePath(raw.root)) errors.push('sandbox.root')
    return { type: 'worktree', root: FACTORY_SANDBOX_WORKTREE_ROOT }
  }
  if (type === 'docker') {
    if (typeof raw.imageName !== 'string' || !raw.imageName.trim()) errors.push('sandbox.imageName')
    if (!isSafeRelativePath(raw.worktreeRoot)) errors.push('sandbox.worktreeRoot')
    return { type: 'docker', imageName: String(raw.imageName ?? '').trim(), worktreeRoot: FACTORY_SANDBOX_WORKTREE_ROOT }
  }
  if (type === 'podman') {
    if (typeof raw.imageName !== 'string' || !raw.imageName.trim()) errors.push('sandbox.imageName')
    return { type: 'podman', imageName: String(raw.imageName ?? '').trim(), worktreeRoot: FACTORY_SANDBOX_WORKTREE_ROOT }
  }
  errors.push('sandbox.type')
  return null
}

function checkTracker(raw: unknown, errors: string[]): FactoryTrackerConfig | null {
  if (!isPlainObject(raw)) {
    errors.push('tracker')
    return null
  }
  if (raw.type === 'local') {
    if (raw.mergeMode !== undefined && raw.mergeMode !== 'local') errors.push('tracker.mergeMode')
    return { type: 'local', backlogPath: FACTORY_BACKLOG_PATH, mergeMode: 'local' }
  }
  if (raw.type !== 'github-issues') {
    errors.push('tracker.type')
    return null
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(String(raw.repo ?? ''))) errors.push('tracker.repo')
  if (typeof raw.label !== 'string' || !raw.label.trim()) errors.push('tracker.label')
  if (raw.auth !== 'gh' && raw.auth !== 'token') errors.push('tracker.auth')
  if (raw.mergeMode !== 'local' && raw.mergeMode !== 'pr') errors.push('tracker.mergeMode')
  return {
    type: 'github-issues',
    repo: String(raw.repo ?? '').trim(),
    label: String(raw.label ?? '').trim(),
    auth: raw.auth === 'token' ? 'token' : 'gh',
    mergeMode: raw.mergeMode === 'pr' ? 'pr' : 'local',
    commentIssue: raw.commentIssue !== false,
    closeIssue: raw.closeIssue !== false,
  }
}

function checkStages(raw: unknown, errors: string[]): Record<FactoryStageKey, FactoryStageConfig> {
  const source = isPlainObject(raw) ? raw : {}
  const stages = {} as Record<FactoryStageKey, FactoryStageConfig>
  for (const key of STAGE_KEYS) {
    const item = isPlainObject(source[key]) ? (source[key] as Record<string, unknown>) : {}
    const fallback = DEFAULT_STAGES[key]
    const mode = item.permissionMode
    if (mode !== undefined && mode !== 'default' && mode !== 'plan' && mode !== 'acceptEdits') {
      errors.push(`stages.${key}.permissionMode`)
    }
    stages[key] = {
      enabled: item.enabled !== false,
      ...(typeof item.model === 'string' && item.model.trim() ? { model: item.model.trim() } : {}),
      permissionMode: mode === 'plan' || mode === 'default' || mode === 'acceptEdits' ? mode : fallback.permissionMode,
      humanGate: item.humanGate === true || (item.humanGate === undefined && fallback.humanGate),
      ...(typeof item.maxIterations === 'number' ? { maxIterations: item.maxIterations } : {}),
    }
  }
  return stages
}

function checkPrompts(raw: unknown, errors: string[]): Record<FactoryPromptKey, string> {
  const source = isPlainObject(raw) ? raw : {}
  const prompts = {} as Record<FactoryPromptKey, string>
  for (const key of FACTORY_PROMPT_KEYS) {
    const value = source[key]
    const fallback = `.spacecode/factory/prompts/${key}.md`
    if (value === undefined) {
      prompts[key] = fallback
      continue
    }
    if (!isSafeRelativePath(value) || !value.toLowerCase().endsWith('.md')) {
      errors.push(`prompts.${key}`)
      prompts[key] = fallback
      continue
    }
    prompts[key] = value
  }
  return prompts
}

/** 对任何来源（磁盘、测试、旧版本）的配置做完整校验并返回可运行的配置。 */
export function validateFactoryConfig(raw: unknown): FactoryConfigValidationResult {
  const errors: string[] = []
  if (!isPlainObject(raw)) return { ok: false, errors: ['config'] }
  if (raw.version !== 1) return { ok: false, errors: ['version'] }

  if (!isPlainObject(raw.repo)) errors.push('repo')
  const repo = isPlainObject(raw.repo) ? raw.repo : {}
  if (repo.root !== '.') errors.push('repo.root')
  if (typeof repo.baseBranch !== 'string' || !repo.baseBranch.trim()) errors.push('repo.baseBranch')
  if (repo.remote !== undefined && typeof repo.remote !== 'string') errors.push('repo.remote')

  if (raw.template !== 'parallel-planner-with-review') errors.push('template')

  if (!isPlainObject(raw.agent)) errors.push('agent')
  const agent = isPlainObject(raw.agent) ? raw.agent : {}
  if (agent.engineType !== 'claude-code' && agent.engineType !== 'pi') errors.push('agent.engineType')
  if (agent.model !== undefined && typeof agent.model !== 'string') errors.push('agent.model')
  if (typeof agent.maxIterations !== 'number' || agent.maxIterations < 1 || agent.maxIterations > 20) {
    errors.push('agent.maxIterations')
  }
  if (typeof agent.maxConcurrency !== 'number' || agent.maxConcurrency < 1 || agent.maxConcurrency > 20) {
    errors.push('agent.maxConcurrency')
  }

  const sandbox = checkSandbox(raw.sandbox, errors)
  const tracker = checkTracker(raw.tracker, errors)
  const stages = checkStages(raw.stages, errors)
  const prompts = checkPrompts(raw.prompts, errors)

  if (!isPlainObject(raw.commands)) errors.push('commands')
  const commands = isPlainObject(raw.commands) ? raw.commands : {}
  if (typeof commands.verify !== 'string' || !commands.verify.trim()) errors.push('commands.verify')

  if (!isPlainObject(raw.limits)) errors.push('limits')
  const limits = isPlainObject(raw.limits) ? raw.limits : {}
  for (const key of ['taskTimeoutSec', 'idleTimeoutSec', 'keepDoneRuns'] as const) {
    if (typeof limits[key] !== 'number' || (limits[key] as number) <= 0) errors.push(`limits.${key}`)
  }

  if (errors.length > 0 || !sandbox || !tracker) return { ok: false, errors }

  const config: FactoryConfig = {
    version: 1,
    revision:
      typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision > 0
        ? raw.revision
        : 1,
    repo: {
      root: '.',
      ...(typeof repo.remote === 'string' && repo.remote.trim() ? { remote: repo.remote.trim() } : {}),
      baseBranch: String(repo.baseBranch).trim(),
    },
    template: 'parallel-planner-with-review',
    agent: {
      engineType: agent.engineType as FactoryConfig['agent']['engineType'],
      ...(typeof agent.model === 'string' && agent.model.trim() ? { model: agent.model.trim() } : {}),
      maxIterations: agent.maxIterations as number,
      maxConcurrency: agent.maxConcurrency as number,
    },
    sandbox,
    tracker,
    stages,
    commands: {
      verify: String(commands.verify).trim(),
      ...(typeof commands.install === 'string' && commands.install.trim() ? { install: commands.install.trim() } : {}),
    },
    prompts,
    limits: {
      taskTimeoutSec: limits.taskTimeoutSec as number,
      idleTimeoutSec: limits.idleTimeoutSec as number,
      keepDoneRuns: limits.keepDoneRuns as number,
    },
  }
  return { ok: true, config }
}

/**
 * 版本迁移入口。当前只有 v1；缺 version 的历史/手写文件按 v0 处理，
 * 用默认值补齐后升级到 v1。更高的版本一律拒绝，避免运行时读到未知字段语义。
 */
export function migrateFactoryConfig(raw: unknown): FactoryConfigValidationResult {
  if (!isPlainObject(raw)) return { ok: false, errors: ['config'] }
  const version = raw.version
  if (version !== undefined && version !== 1) return { ok: false, errors: ['version'] }
  if (version === 1) return validateFactoryConfig(raw)

  const draft: FactorySetupDraft = {
    agent: {
      engineType: (raw.agent as FactorySetupDraft['agent'])?.engineType ?? 'claude-code',
      model: (raw.agent as FactorySetupDraft['agent'])?.model,
    },
    sandbox: isPlainObject(raw.sandbox)
      ? { type: raw.sandbox.type === 'docker' ? 'docker' : 'worktree', imageName: String(raw.sandbox.imageName ?? '') }
      : { type: 'worktree' },
    tracker:
      isPlainObject(raw.tracker) && raw.tracker.type === 'github-issues'
        ? {
            type: 'github-issues',
            repo: String(raw.tracker.repo ?? ''),
            label: String(raw.tracker.label ?? 'ready-for-agent'),
            auth: raw.tracker.auth === 'token' ? 'token' : 'gh',
            mergeMode: 'local',
            commentIssue: raw.tracker.commentIssue !== false,
            closeIssue: raw.tracker.closeIssue !== false,
          }
        : { type: 'local', mergeMode: 'local' },
    commands: {
      verify:
        isPlainObject(raw.commands) && typeof raw.commands.verify === 'string' && raw.commands.verify.trim()
          ? raw.commands.verify
          : 'npm run test:changed',
      install: isPlainObject(raw.commands) ? (raw.commands.install as string | undefined) : undefined,
    },
  }
  const repo = isPlainObject(raw.repo) ? raw.repo : {}
  const base = buildFactoryConfig(draft, {
    remote: typeof repo.remote === 'string' ? repo.remote : undefined,
    baseBranch: typeof repo.baseBranch === 'string' ? repo.baseBranch : 'main',
  })
  if (!base.ok) return base

  // 保留 v0 里合法的高级字段（阶段开关、自定义 prompt 路径、limits）
  return validateFactoryConfig({
    ...base.config,
    ...(isPlainObject(raw.stages) ? { stages: raw.stages } : {}),
    ...(isPlainObject(raw.limits) ? { limits: raw.limits } : {}),
    prompts: isPlainObject(raw.prompts) ? raw.prompts : base.config.prompts,
  })
}

export function factoryConfigPath(repoRoot: string): string {
  return join(repoRoot, FACTORY_CONFIG_RELATIVE_PATH)
}

export function readFactoryConfig(repoRoot: string): FactoryConfig | null {
  try {
    const path = factoryConfigPath(repoRoot)
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    const migrated = migrateFactoryConfig(parsed)
    return migrated.ok ? migrated.config : null
  } catch {
    return null
  }
}

/**
 * 原子写：临时文件 + rename。目录已存在或文件已存在都只是覆盖，不报错
 * （向导必须可重复进入）。
 */
export function writeFactoryConfigAtomic(repoRoot: string, config: FactoryConfig): string {
  const path = factoryConfigPath(repoRoot)
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
    renameSync(tmpPath, path)
  } catch (err) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw err
  }
  return path
}

export { DEFAULT_STAGES, DEFAULT_LIMITS, STAGE_KEYS }
