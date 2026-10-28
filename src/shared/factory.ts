/**
 * Factory（AI 流水线）跨主进程/渲染进程共享的领域契约。
 *
 * 配置写在项目内 `.spacecode/factory/config.json`，密钥只由主进程的
 * safeStorage 保存，因此这里的类型不含任何凭据字段。
 */
/** 主进程 engines/types.ts 的 EngineType 子集；shared 不能反向依赖 electron。 */
export type FactoryEngineType = 'claude-code' | 'pi'

export type FactoryStageKey = 'plan' | 'implement' | 'verify' | 'review' | 'merge'

/** 初始化会生成的五份 prompt 骨架（与 sandcastle 模板语义对齐）。 */
export type FactoryPromptKey = 'plan' | 'implement' | 'review' | 'fix' | 'merge-conflict'

export const FACTORY_PROMPT_KEYS: readonly FactoryPromptKey[] = [
  'plan',
  'implement',
  'review',
  'fix',
  'merge-conflict',
]

export const FACTORY_SANDBOX_WORKTREE_ROOT = '.spacecode/worktrees' as const
export const FACTORY_BACKLOG_PATH = '.spacecode/factory/backlog.json' as const
export const FACTORY_RUNS_PATH = '.spacecode/factory/runs' as const
export const FACTORY_IGNORE_ENTRIES = [
  '.spacecode/worktrees/',
  '.spacecode/factory/runs/',
  '.spacecode/factory/logs/',
] as const

export type FactoryPermissionMode = 'default' | 'plan' | 'acceptEdits'

export interface FactoryRepoConfig {
  /** 恒为相对仓库根的 '.'；运行时再与项目根拼接。 */
  root: '.'
  remote?: string
  baseBranch: string
}

export interface FactoryAgentConfig {
  engineType: FactoryEngineType
  model?: string
  maxIterations: number
  maxConcurrency: number
}

export type FactorySandboxConfig =
  | { type: 'worktree'; root: typeof FACTORY_SANDBOX_WORKTREE_ROOT }
  | {
      type: 'docker'
      imageName: string
      worktreeRoot: typeof FACTORY_SANDBOX_WORKTREE_ROOT
      mounts?: Array<{ source: string; target: string }>
    }
  | {
      type: 'podman'
      imageName: string
      worktreeRoot: typeof FACTORY_SANDBOX_WORKTREE_ROOT
    }

export type FactoryTrackerConfig =
  | {
      type: 'github-issues'
      repo: string
      label: string
      auth: 'gh' | 'token'
      mergeMode: 'local' | 'pr'
      commentIssue: boolean
      closeIssue: boolean
    }
  | { type: 'local'; backlogPath: typeof FACTORY_BACKLOG_PATH; mergeMode: 'local' }

export interface FactoryStageConfig {
  enabled: boolean
  model?: string
  permissionMode: FactoryPermissionMode
  humanGate: boolean
  maxIterations?: number
}

export interface FactoryCommandsConfig {
  verify: string
  install?: string
}

export interface FactoryLimitsConfig {
  taskTimeoutSec: number
  idleTimeoutSec: number
  keepDoneRuns: number
}

export interface FactoryConfig {
  version: 1
  repo: FactoryRepoConfig
  template: 'parallel-planner-with-review'
  agent: FactoryAgentConfig
  sandbox: FactorySandboxConfig
  tracker: FactoryTrackerConfig
  stages: Record<FactoryStageKey, FactoryStageConfig>
  commands: FactoryCommandsConfig
  prompts: Record<FactoryPromptKey, string>
  limits: FactoryLimitsConfig
}

/**
 * 向导的可序列化草稿。字段全部可选，方便渲染层逐步填写；
 * 主进程负责合并默认值并做严格校验。
 */
export interface FactorySetupDraft {
  agent?: {
    engineType?: FactoryEngineType
    model?: string
  }
  sandbox?: {
    type?: 'worktree' | 'docker' | 'podman'
    imageName?: string
  }
  tracker?: {
    type?: 'github-issues' | 'local'
    repo?: string
    label?: string
    auth?: 'gh' | 'token'
    mergeMode?: 'local' | 'pr'
    commentIssue?: boolean
    closeIssue?: boolean
  }
  commands?: {
    verify?: string
    install?: string
  }
}

export type FactoryPreflightLevel = 'ok' | 'warn' | 'error'

/** 预检结果只存码 + 参数，渲染层用 i18n 格式化。 */
export interface FactoryPreflightItem {
  id:
    | 'gitRepo'
    | 'gitDirty'
    | 'gitVersion'
    | 'configWritable'
    | 'engine'
    | 'modelProfile'
    | 'trackerAuth'
    | 'trackerLabel'
    | 'verifyCommand'
    | 'sandbox'
  level: FactoryPreflightLevel
  params?: Record<string, string | number>
}

export interface FactoryPreflightResult {
  items: FactoryPreflightItem[]
  blocking: boolean
}

export type FactoryGithubAuthReason = 'ok' | 'invalid-token' | 'repo-permission' | 'network' | 'gh-not-logged-in'

export interface FactoryGithubAuthResult {
  ok: boolean
  reason: FactoryGithubAuthReason
  login?: string
  repo?: string
  private?: boolean
  issueCount?: number
  labelCount?: number
}

export interface FactoryRepoInfo {
  isGitRepo: boolean
  root: string
  remote?: string
  baseBranch: string
  dirty: boolean
  gitVersion: string | null
}

export interface FactoryEngineOption {
  engineType: FactoryEngineType
  available: boolean
  reason: string
  version: string | null
  /** 首版只暴露 Claude Code 与 Pi。 */
  exposed: boolean
}

export interface FactorySetupContext {
  repo: FactoryRepoInfo
  engines: FactoryEngineOption[]
  modelProfile: { configured: boolean; model?: string; provider?: string }
  dockerAvailable: boolean
  encryptionAvailable: boolean
  ghLoggedIn: boolean
  existingConfig: FactoryConfig | null
}

export type FactorySecretSaveResult =
  | { ok: true }
  | { ok: false; reason: 'encryption-unavailable' | 'invalid-token' | 'write-failed' }

export interface FactoryState {
  configured: boolean
  config: FactoryConfig | null
  configPath: string
}

export interface FactorySaveResult {
  ok: boolean
  /** 主进程侧的稳定错误码，渲染层用 factory.errors.* 翻译。 */
  error?: 'preflight-failed' | 'invalid-draft' | 'write-failed' | 'secrets-failed'
  preflight?: FactoryPreflightResult
  configPath?: string
}

// ── 本地待办与运行（看板投影） ──────────────────────────────────

/** 六条泳道。`blocked` 是横向异常态，保留卡住时的 stageIdx。 */
export type FactoryLane = 'queued' | 'implementing' | 'reviewing' | 'mergeable' | 'blocked' | 'done'

/** `.spacecode/factory/backlog.json` 的单条记录；order 决定看板与领取顺序。 */
export interface FactoryBacklogItem {
  id: string
  title: string
  goal: string
  createdAt: string
  order: number
}

export type FactoryBacklogError = 'title-required' | 'not-found'

/** 变更类操作统一返回最新列表，失败时也带上当前列表以免 UI 丢数据。 */
export type FactoryBacklogResult =
  | { ok: true; items: FactoryBacklogItem[] }
  | { ok: false; error: FactoryBacklogError; items: FactoryBacklogItem[] }

export interface FactoryBacklogInput {
  title: string
  goal?: string
}

export interface FactoryBacklogUpdate {
  id: string
  title?: string
  goal?: string
}

export interface FactoryTaskDiff {
  additions: number
  deletions: number
}

/** 任务投影。渲染层只读，所有迁移由主进程写入。 */
export interface FactoryTask {
  id: string
  runId: string
  source: 'local' | 'github-issues'
  issueNumber?: number
  title: string
  goal: string
  lane: FactoryLane
  /** 0 领取 … 6 完成，对应六步进度条。 */
  stageIdx: number
  /** 领取时生成的分支占位；本票不真正创建分支。 */
  branch: string
  worktree: string | null
  model: string
  iteration: number
  maxIterations: number
  diff: FactoryTaskDiff
  cancelled?: boolean
  attention?: { reason: string; action: 'fix' | 'merge' | 'retry' }
  timestamps: {
    claimedAt?: string
    startedAt?: string
    endedAt?: string
    mergedAt?: string
  }
}

export type FactoryRunStatus = 'pending' | 'running' | 'paused' | 'stopped'

export interface FactoryRun {
  id: string
  status: FactoryRunStatus
  paused: boolean
  createdAt: string
  startedAt?: string
  endedAt?: string
  maxConcurrency: number
  /** 展示位；真实成本由后续阶段的 usage 累计。 */
  spendUsd: number
  elapsedMs: number
}

export interface FactoryRunSnapshot {
  run: FactoryRun
  tasks: FactoryTask[]
}

export interface FactoryRunCreateInput {
  taskIds: string[]
  concurrency?: number
}

export type FactoryRunCreateError = 'empty-tasks' | 'missing-tasks' | 'duplicate-tasks'

export type FactoryRunCreateResult =
  | { ok: true; snapshot: FactoryRunSnapshot }
  | { ok: false; error: FactoryRunCreateError; duplicates?: string[]; missing?: string[] }
