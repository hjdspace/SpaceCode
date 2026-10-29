/**
 * 六泳道看板的纯投影逻辑：泳道元数据、分组计数、阶段进度与卡片状态。
 *
 * 六条泳道是投影，不是六份存储；任务只存 `lane + stageIdx`。
 * 组件只渲染这里的结果，i18n key 也由这里给出，避免文案散落在模板里。
 */
import type {
  FactoryLane,
  FactoryPermissionMode,
  FactoryRun,
  FactoryTask,
  FactoryTaskDiff,
} from '@/shared/factory'
import { pendingComments } from '@/shared/factoryReview'

export interface FactoryLaneMeta {
  key: FactoryLane
  labelKey: string
  color: string
}

/** 顺序与原型 `LANES` 一致：队列 → 实现中 → 审查中 → 待合并 → 阻塞 → 已完成。 */
export const FACTORY_LANES: readonly FactoryLaneMeta[] = [
  { key: 'queued', labelKey: 'factory.lanes.queued', color: 'var(--text-muted)' },
  { key: 'implementing', labelKey: 'factory.lanes.implementing', color: 'var(--accent-primary)' },
  { key: 'reviewing', labelKey: 'factory.lanes.reviewing', color: 'var(--info)' },
  { key: 'mergeable', labelKey: 'factory.lanes.mergeable', color: 'var(--success)' },
  { key: 'blocked', labelKey: 'factory.lanes.blocked', color: 'var(--warning)' },
  { key: 'done', labelKey: 'factory.lanes.done', color: 'var(--success)' },
]

/** 运行头部的分段条；文案与原型 `SEGMENTS` 一致。 */
export const FACTORY_SEGMENTS: readonly FactoryLaneMeta[] = [
  { key: 'queued', labelKey: 'factory.segments.claim', color: 'var(--text-muted)' },
  { key: 'implementing', labelKey: 'factory.segments.implement', color: 'var(--accent-primary)' },
  { key: 'reviewing', labelKey: 'factory.segments.review', color: 'var(--info)' },
  { key: 'mergeable', labelKey: 'factory.segments.mergeable', color: 'var(--success)' },
  { key: 'blocked', labelKey: 'factory.segments.blocked', color: 'var(--warning)' },
  { key: 'done', labelKey: 'factory.segments.done', color: 'var(--success)' },
]

/** 检查器六阶段进度条，对应 stageIdx 0…6。 */
export const FACTORY_STEPS = ['claim', 'worktree', 'implement', 'verify', 'review', 'merge'] as const

export type FactoryStepKey = (typeof FACTORY_STEPS)[number]
export type FactoryStepVisualState = 'done' | 'active' | 'blocked' | 'pending'

export type FactoryInspectorTab = 'overview' | 'events' | 'diff' | 'review'

export const FACTORY_INSPECTOR_TABS: readonly { key: FactoryInspectorTab; labelKey: string }[] = [
  { key: 'overview', labelKey: 'factory.tabs.overview' },
  { key: 'events', labelKey: 'factory.tabs.events' },
  { key: 'diff', labelKey: 'factory.tabs.diff' },
  { key: 'review', labelKey: 'factory.tabs.review' },
]

export function tasksByLane(tasks: readonly FactoryTask[], lane: FactoryLane): FactoryTask[] {
  return tasks.filter((task) => task.lane === lane)
}

export function laneCounts(tasks: readonly FactoryTask[]): Record<FactoryLane, number> {
  const counts: Record<FactoryLane, number> = {
    queued: 0,
    implementing: 0,
    reviewing: 0,
    mergeable: 0,
    blocked: 0,
    done: 0,
  }
  for (const task of tasks) counts[task.lane] += 1
  return counts
}

/** 运行头部的 token/花费汇总；`hasCost` 为 false 时只展示 token。 */
export interface FactoryRunUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  hasCost: boolean
}

export function runUsage(tasks: readonly FactoryTask[]): FactoryRunUsage {
  let inputTokens = 0
  let outputTokens = 0
  let costUsd = 0
  let hasCost = false
  for (const task of tasks) {
    const usage = task.usage
    if (!usage) continue
    inputTokens += usage.inputTokens
    outputTokens += usage.outputTokens
    if (typeof usage.costUsd === 'number') {
      costUsd += usage.costUsd
      hasCost = true
    }
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd,
    hasCost,
  }
}

export function findTask(tasks: readonly FactoryTask[], id: string | null): FactoryTask | null {
  if (!id) return null
  return tasks.find((task) => task.id === id) ?? null
}

export interface FactoryTaskStatus {
  key: string
  params?: Record<string, string | number>
}

/** 接管只在实现中/审查中有意义；标记存在时后台不再推进该任务。 */
export function isTakenOver(task: FactoryTask): boolean {
  return task.takeover !== undefined && (task.lane === 'implementing' || task.lane === 'reviewing')
}

/** 可以发起接管：实现中/审查中、尚未接管、工作树仍在。 */
export function canTakeOver(task: FactoryTask): boolean {
  return (
    (task.lane === 'implementing' || task.lane === 'reviewing') &&
    !isTakenOver(task) &&
    Boolean(task.worktree)
  )
}

/** 可以交回：必须处于接管中。 */
export function canReturnTask(task: FactoryTask): boolean {
  return isTakenOver(task)
}

export type FactoryAttentionKind = 'merge' | 'review'

export interface FactoryAttentionStatus {
  kind: FactoryAttentionKind
  labelKey: string
}

/** 「需你处理」口径：阻塞任务，以及审查结论为需要修改的任务。 */
export function isAttentionTask(task: FactoryTask): boolean {
  return (
    task.lane === 'blocked' ||
    (task.lane === 'reviewing' && task.review?.verdict === 'needs_changes')
  )
}

export function attentionTasks(tasks: readonly FactoryTask[]): FactoryTask[] {
  return tasks.filter(isAttentionTask)
}

/** chip 文案按介入类型区分：阻塞是合并/冲突，审查中是审查意见。只对需处理任务调用。 */
export function attentionStatus(task: FactoryTask): FactoryAttentionStatus {
  return task.lane === 'blocked'
    ? { kind: 'merge', labelKey: 'factory.run.attentionMerge' }
    : { kind: 'review', labelKey: 'factory.run.attentionReview' }
}

/** 可以从当前阶段重试：阻塞且有工作树，复用分支继续跑。 */
export function canRetryTask(task: FactoryTask): boolean {
  return task.lane === 'blocked' && task.cancelled !== true && Boolean(task.worktree)
}

/** 未决意见：accepted / ignored / resolved 都已表过态，不再计入卡片上的条数。 */
export function openReviewComments(task: FactoryTask): number {
  if (!task.review) return 0
  return task.review.comments.filter((comment) => comment.status === 'open').length
}

export function taskStatus(task: FactoryTask): FactoryTaskStatus {
  if (isTakenOver(task)) return { key: 'factory.cardStatus.takeover' }
  switch (task.lane) {
    case 'queued':
      return { key: 'factory.cardStatus.queued' }
    case 'implementing':
      return {
        key: 'factory.cardStatus.implementing',
        params: { iteration: task.iteration, max: task.maxIterations },
      }
    case 'reviewing': {
      // 只数还欠着的意见：审查通过且零意见时写「0 条意见」反而是噪声。
      const pending = openReviewComments(task)
      return pending > 0
        ? { key: 'factory.cardStatus.reviewingComments', params: { count: pending } }
        : { key: 'factory.cardStatus.reviewing' }
    }
    case 'mergeable':
      return { key: 'factory.cardStatus.mergeable' }
    case 'blocked':
      return { key: 'factory.cardStatus.blocked' }
    case 'done':
      return { key: task.cancelled ? 'factory.cardStatus.cancelled' : 'factory.cardStatus.done' }
  }
}

/** 进度条只在跑动中的两个阶段有意义：实现中看迭代，审查中即已到终点。 */
export function showsTaskProgress(task: FactoryTask): boolean {
  if (task.cancelled) return false
  return task.lane === 'implementing' || task.lane === 'reviewing'
}

/** 实现中按迭代推进（与卡片 chip 的 {iteration}/{max} 同一口径），审查中拉满。 */
export function taskProgressPercent(task: FactoryTask): number {
  if (task.lane === 'reviewing') return 100
  if (task.maxIterations <= 0) return 0
  return Math.min(100, Math.round((task.iteration / task.maxIterations) * 100))
}

/**
 * 运行推进条件与调度器一致（status==='running' 且未 paused）；被接管或已取消的
 * 实现中任务后台已经不再跑它，脉冲必须跟着停，否则卡片在谎称自己还在动。
 */
export function isCardPulsing(task: FactoryTask, run: FactoryRun | null | undefined): boolean {
  if (!run || run.status !== 'running' || run.paused) return false
  if (task.cancelled === true || isTakenOver(task)) return false
  return task.lane === 'implementing'
}

export function stepStates(task: FactoryTask): FactoryStepVisualState[] {
  return FACTORY_STEPS.map((_, index) => {
    if (task.lane === 'done') return 'done'
    if (task.lane === 'blocked' && index === task.stageIdx) return 'blocked'
    if (index < task.stageIdx) return 'done'
    if (index === task.stageIdx) return 'active'
    return 'pending'
  })
}

/**
 * 任务实跑用的权限模式：领取时固化在快照的实现阶段，之后保存的配置只影响新任务。
 * 快照出现前的历史任务返回 null，界面据此不显示这一行，而不是猜当前配置值。
 */
export function taskPermissionMode(task: FactoryTask): FactoryPermissionMode | null {
  return task.configSnapshot?.stages?.implement?.permissionMode ?? null
}

/**
 * 页签后面的数量：Diff 数变更文件，审查数意见条数。零也照样给出，
 * 概览与事件流没有计数，所以按页签取用可能拿到 undefined。
 */
export type FactoryInspectorBadges = Partial<Record<FactoryInspectorTab, number>>

export function inspectorTabBadges(task: FactoryTask): FactoryInspectorBadges {
  return {
    diff: task.diff.files?.length ?? 0,
    review: task.review?.comments.length ?? 0,
  }
}

export function taskElapsedMs(task: FactoryTask, nowMs: number): number {
  if (!task.timestamps.startedAt) return 0
  const end = task.timestamps.endedAt ? Date.parse(task.timestamps.endedAt) : nowMs
  return Math.max(0, end - Date.parse(task.timestamps.startedAt))
}

/** 原型用 mm:ss 展示用时；超过一小时继续累计分钟（62:03）而不是进位到小时。 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  return `${pad2(Math.floor(totalSeconds / 60))}:${pad2(totalSeconds % 60)}`
}

/** 检查器里的时间戳用本地时区的 MM-DD HH:MM；缺失或非法返回空串。 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 卡片脚的合并时间只到分钟（HH:mm）；缺失或非法返回空串。 */
export function formatTimeOfDay(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 卡片脚的变更量；一条都没改时返回 null，由界面占位而不是写「+0 −0」。 */
export function cardDiffstat(task: FactoryTask): FactoryTaskDiff | null {
  if (!task.diff.additions && !task.diff.deletions) return null
  return task.diff
}

/**
 * 已完成卡片的脚注：合并时间 + 带入目标分支的提交数。
 * 提交数沿用回写给 GitHub 的口径（mergedCommits 优先，退回分支提交数）。
 */
export function doneTaskMeta(task: FactoryTask): FactoryTaskStatus | null {
  if (task.lane !== 'done' || task.cancelled) return null
  const commits = task.mergedCommits ?? task.commits?.length ?? 0
  const time = formatTimeOfDay(task.timestamps.mergedAt)
  return time
    ? { key: 'factory.cardMeta.merged', params: { time, commits } }
    : { key: 'factory.cardMeta.finished', params: { commits } }
}

/** 卡片快捷动作的意图；渲染层把它映射到与检查器底部同一个 store 动作。 */
export type FactoryCardActionKind =
  | 'start'
  | 'cancel'
  | 'takeover'
  | 'return'
  | 'review'
  | 'merge'
  | 'fix'
  | 'retry'
  | 'view'

export interface FactoryCardAction {
  kind: FactoryCardActionKind
  labelKey: string
  /** primary 是泳道的推进方向，danger 是放弃方向，其余并列；样式由卡片决定。 */
  variant: 'primary' | 'danger' | 'ghost'
}

/** 可以放弃/移除：只有还没在跑的队列与阻塞任务，且尚未取消。 */
export function canCancelTask(task: FactoryTask): boolean {
  if (task.cancelled === true) return false
  return task.lane === 'queued' || task.lane === 'blocked'
}

/** 队列里叫「移除」，阻塞里叫「放弃」：同一条动作两种说法，卡片与检查器共用这一处。 */
export function cancelLabelKey(task: FactoryTask): string {
  return task.lane === 'queued' ? 'factory.actions.remove' : 'factory.actions.abandon'
}

/** 可以把未决意见交回 Agent：与检查器的「让 Agent 修」同一资格。 */
export function canFixTask(task: FactoryTask): boolean {
  if (task.cancelled === true) return false
  if (task.lane !== 'blocked' && task.lane !== 'reviewing') return false
  if (!task.worktree) return false
  return pendingComments(task.review).length > 0
}

function action(
  kind: FactoryCardActionKind,
  labelKey: string,
  variant: FactoryCardAction['variant'],
): FactoryCardAction {
  return { kind, labelKey: `factory.actions.${labelKey}`, variant }
}

function cancelAction(task: FactoryTask): FactoryCardAction {
  return { kind: 'cancel', labelKey: cancelLabelKey(task), variant: 'danger' }
}

/**
 * 卡片按所在泳道直接给出下一步动作。资格判定全部复用检查器那批纯函数，
 * 避免同一动作在卡片上可点、在检查器里报错。
 */
export function cardActions(task: FactoryTask): FactoryCardAction[] {
  if (task.lane === 'done') return [action('view', 'view', 'ghost')]
  if (task.cancelled === true) return []

  switch (task.lane) {
    case 'queued':
      return [action('start', 'start', 'primary'), cancelAction(task)]
    case 'implementing':
      if (canReturnTask(task)) return [action('return', 'return', 'primary')]
      return canTakeOver(task) ? [action('takeover', 'takeover', 'primary')] : []
    case 'reviewing': {
      const items = [action('review', 'review', 'primary')]
      if (canReturnTask(task)) items.push(action('return', 'return', 'ghost'))
      else if (canTakeOver(task)) items.push(action('takeover', 'takeover', 'ghost'))
      return items
    }
    case 'mergeable':
      return [action('merge', 'mergeShort', 'primary')]
    case 'blocked': {
      const items: FactoryCardAction[] = []
      // 有未决意见才谈得上「让 Agent 修」；其余阻塞（停止、验证失败、冲突）走重试。
      if (canFixTask(task)) items.push(action('fix', 'fix', 'primary'))
      else if (canRetryTask(task)) items.push(action('retry', 'retryShort', 'primary'))
      if (canCancelTask(task)) items.push(cancelAction(task))
      return items
    }
  }
}
