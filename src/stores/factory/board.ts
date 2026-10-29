/**
 * 六泳道看板的纯投影逻辑：泳道元数据、分组计数、阶段进度与卡片状态。
 *
 * 六条泳道是投影，不是六份存储；任务只存 `lane + stageIdx`。
 * 组件只渲染这里的结果，i18n key 也由这里给出，避免文案散落在模板里。
 */
import type { FactoryLane, FactoryRun, FactoryTask, FactoryTaskDiff } from '@/shared/factory'

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
