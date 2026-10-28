/**
 * 六泳道看板的纯投影逻辑：泳道元数据、分组计数、阶段进度与卡片状态。
 *
 * 六条泳道是投影，不是六份存储；任务只存 `lane + stageIdx`。
 * 组件只渲染这里的结果，i18n key 也由这里给出，避免文案散落在模板里。
 */
import type { FactoryLane, FactoryTask } from '@/shared/factory'

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

export function findTask(tasks: readonly FactoryTask[], id: string | null): FactoryTask | null {
  if (!id) return null
  return tasks.find((task) => task.id === id) ?? null
}

export interface FactoryTaskStatus {
  key: string
  params?: Record<string, number>
}

export function taskStatus(task: FactoryTask): FactoryTaskStatus {
  switch (task.lane) {
    case 'queued':
      return { key: 'factory.cardStatus.queued' }
    case 'implementing':
      return {
        key: 'factory.cardStatus.implementing',
        params: { iteration: task.iteration, max: task.maxIterations },
      }
    case 'reviewing':
      return { key: 'factory.cardStatus.reviewing' }
    case 'mergeable':
      return { key: 'factory.cardStatus.mergeable' }
    case 'blocked':
      return { key: 'factory.cardStatus.blocked' }
    case 'done':
      return { key: task.cancelled ? 'factory.cardStatus.cancelled' : 'factory.cardStatus.done' }
  }
}

/** 阶段进度按「已进入第几个阶段」计算：领取是 1/6，完成是 6/6。 */
export function taskStagePercent(task: FactoryTask): number {
  const index = Math.min(FACTORY_STEPS.length - 1, Math.max(0, task.stageIdx))
  return Math.round(((index + 1) / FACTORY_STEPS.length) * 100)
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
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** 检查器里的时间戳用本地时区的 MM-DD HH:MM；缺失或非法返回空串。 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}
