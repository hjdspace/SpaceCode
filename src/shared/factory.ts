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

export interface FactoryDiffFile {
  path: string
  additions: number
  deletions: number
}

export interface FactoryTaskDiff {
  additions: number
  deletions: number
  files?: FactoryDiffFile[]
}

export interface FactoryCommit {
  sha: string
  message: string
}

export interface FactoryTaskUsage {
  inputTokens: number
  outputTokens: number
  /** 只有配置了单价时才有；本票只累计 token。 */
  costUsd?: number
}

/** 验证结果：只保留尾部关键行作为失败详情，完整日志在 logs/ 下。 */
export interface FactoryTestRun {
  status: 'pass' | 'fail' | 'timeout' | 'stopped'
  command: string
  at: string
  exitCode?: number
  detail?: string
}

export type FactoryReviewVerdict = 'approved' | 'needs_changes'
export type FactoryReviewSeverity = 'blocker' | 'suggestion'
/** open=待处理；accepted=已加入修复清单；ignored=人工忽略；resolved=后续审查不再出现。 */
export type FactoryReviewCommentStatus = 'open' | 'accepted' | 'ignored' | 'resolved'

export interface FactoryReviewComment {
  id: string
  /** 坏路径或越界行号会被降级掉，只保留纯文本意见。 */
  file?: string
  line?: number
  body: string
  severity: FactoryReviewSeverity
  status: FactoryReviewCommentStatus
}

export interface FactoryReview {
  verdict: FactoryReviewVerdict
  summary: string
  comments: FactoryReviewComment[]
  at: string
  /** 连续解析失败时保留原始输出，便于人工排查。 */
  raw?: string
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
  /** 工作分支；领取时生成，启动后即工作树实际检出的分支。 */
  branch: string
  /** 相对仓库根的工作树路径（如 `.spacecode/worktrees/<taskId>`）。 */
  worktree: string | null
  model: string
  iteration: number
  maxIterations: number
  diff: FactoryTaskDiff
  commits?: FactoryCommit[]
  usage?: FactoryTaskUsage
  tests?: FactoryTestRun
  review?: FactoryReview
  cancelled?: boolean
  attention?: { reason: string; action: 'fix' | 'merge' | 'retry' }
  /** 合并成功后记录：带入目标分支的提交数。 */
  mergedCommits?: number
  /** 合并成功后记录：目标分支（通常为配置的 baseBranch）。 */
  targetBranch?: string
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

// ── 事件流、实现阶段与工作树 ────────────────────────────────────

export type FactoryEventLevel = 'info' | 'ok' | 'warn' | 'error'

/** 事件只存「码 + 参数 + 级别」，渲染层按 `factory.events.<code>` 格式化。 */
export interface FactoryEvent {
  seq: number
  at: string
  runId: string
  taskId: string | null
  stage?: FactoryStageKey
  code: string
  level: FactoryEventLevel
  params?: Record<string, string | number>
}

/** 主进程推送：事件 + 最新投影，渲染层按 seq 去重后增量更新看板。 */
export interface FactoryEventPush {
  event: FactoryEvent
  snapshot: FactoryRunSnapshot
}

export type FactoryTaskStartError =
  | 'task-not-found'
  | 'not-queued'
  | 'already-running'
  | 'config-missing'
  | 'not-git-repo'
  | 'dirty-worktree'
  | 'base-branch-missing'
  | 'branch-in-use'
  | 'worktree-mismatch'
  | 'invalid-task-id'
  | 'path-too-long'
  | 'permission'
  | 'git-error'
  | 'prompt-error'
  | 'agent-error'
  | 'not-eligible'
  | 'confirm-required'
  | 'not-fixable'
  | 'no-worktree'

export interface FactoryTaskStartInput {
  /** 基础仓库有未提交改动时，用户确认后仍可继续。 */
  confirmDirty?: boolean
}

export type FactoryTaskStartResult =
  | { ok: true; snapshot: FactoryRunSnapshot }
  | { ok: false; error: FactoryTaskStartError; detail?: string }

export type FactoryTaskActionError =
  | FactoryTaskStartError
  | 'not-running'
  | 'stop-failed'
  | 'write-failed'

export type FactoryTaskActionResult =
  | { ok: true; snapshot: FactoryRunSnapshot }
  | { ok: false; error: FactoryTaskActionError; detail?: string }

export interface FactoryReviewCommentInput {
  commentId: string
  action: 'accept' | 'ignore'
  /** 忽略 blocker 级意见必须显式确认。 */
  confirm?: boolean
}

export type FactoryRunStopResult = FactoryTaskActionResult | { ok: false; error: 'run-not-found' }

export type FactoryWorktreeRevealResult =
  | { ok: true }
  | { ok: false; error: 'task-not-found' | 'no-worktree' | 'reveal-failed' }

// ── 合并闸门与本地合并 ─────────────────────────────────────────

/** 允许的合并方式；禁止 force 与合并到非配置分支。 */
export const FACTORY_MERGE_MODES = ['merge', 'squash', 'rebase'] as const

export type FactoryMergeMode = (typeof FACTORY_MERGE_MODES)[number]

/** 预检致命项；任意一项存在都禁用合并按钮。 */
export type FactoryMergeBlocker =
  | 'not-mergeable'
  | 'tests-missing'
  | 'tests-failed'
  | 'review-missing'
  | 'review-needs-changes'
  | 'open-blockers'
  | 'no-commits'
  | 'worktree-missing'
  | 'worktree-dirty'
  | 'workspace-dirty'
  | 'base-missing'
  | 'base-advanced'
  | 'conflict'
  | 'verify-failed'
  | 'git-error'

/** 合并弹窗的预检投影：事实字段 + 致命项，不修改任务状态。 */
export interface FactoryMergePreflight {
  taskId: string
  branch: string
  targetBranch: string
  commits: number
  diff: FactoryTaskDiff
  tests?: FactoryTestRun
  review?: FactoryReview
  worktreeClean: boolean
  /** 主仓库工作区是否干净（仅在目标分支被检出时检查）。 */
  workspaceClean: boolean
  baseAdvanced: boolean
  conflicts: boolean
  conflictFiles: string[]
  /** 复跑验证的结果。 */
  verify?: FactoryTestRun
  blockers: FactoryMergeBlocker[]
  detail?: string
  checkedAt: string
}

export type FactoryMergePreflightResult =
  | { ok: true; preflight: FactoryMergePreflight }
  | { ok: false; error: 'task-not-found' | 'config-missing' | 'git-error'; detail?: string }

export interface FactoryMergeExecuteInput {
  mode: FactoryMergeMode
  /** 「我已审查 diff」复选框。 */
  confirmed: boolean
}

export type FactoryMergeError =
  | 'task-not-found'
  | 'config-missing'
  | 'not-eligible'
  | 'confirm-required'
  | 'invalid-mode'
  | 'base-advanced'
  | 'conflict'
  | 'verify-failed'
  | 'workspace-dirty'
  | 'dirty-worktree'
  | 'no-worktree'
  | 'git-error'
  | 'merge-failed'
  | 'write-failed'

export type FactoryMergeResult =
  | {
      ok: true
      snapshot: FactoryRunSnapshot
      mergedCommits: number
      targetBranch: string
      cleanup: 'removed' | 'kept'
    }
  | {
      ok: false
      error: FactoryMergeError
      detail?: string
      preflight?: FactoryMergePreflight
    }
