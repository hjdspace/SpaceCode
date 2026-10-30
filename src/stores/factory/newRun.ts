/**
 * 新建运行弹窗的候选投影：把本地待办与 GitHub issue 统一成同一份
 * 「可勾选 / 已领取跳过」列表，组件只负责渲染与选择。
 */
import type { FactoryBacklogItem, FactoryGithubIssue, FactoryPlanTask } from '@/shared/factory'

export interface NewRunCandidate {
  /** 本地待办 id，或 issue 编号的字符串形式；提交时由视图层还原。 */
  id: string
  title: string
  detail?: string
  /** 已被未结束的运行领取：不可勾选，并展示跳过原因。 */
  claimed: boolean
}

export function backlogCandidates(
  items: readonly FactoryBacklogItem[],
  claimedIds: readonly string[],
): NewRunCandidate[] {
  const claimed = new Set(claimedIds)
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    ...(item.goal ? { detail: item.goal } : {}),
    claimed: claimed.has(item.id),
  }))
}

export function githubCandidates(issues: readonly FactoryGithubIssue[]): NewRunCandidate[] {
  return issues.map((issue) => ({
    id: String(issue.number),
    title: `#${issue.number} ${issue.title}`,
    ...(issue.labels.length ? { detail: issue.labels.join(' · ') } : {}),
    claimed: issue.claimed,
  }))
}

/** 规划结果回填到弹窗选择时使用候选 id 空间；GitHub 任务 id 是 `issue-<n>`。 */
export interface PlannedCandidate {
  candidateId: string
  dependsOn: string[]
}

export function plannedCandidates(
  source: 'local' | 'github-issues',
  tasks: readonly FactoryPlanTask[],
): PlannedCandidate[] {
  const candidateIdOf = (task: FactoryPlanTask): string =>
    source === 'github-issues' && typeof task.issueNumber === 'number'
      ? String(task.issueNumber)
      : task.id
  const byTaskId = new Map(tasks.map((task) => [task.id, candidateIdOf(task)]))
  return tasks.map((task) => ({
    candidateId: candidateIdOf(task),
    dependsOn: task.dependsOn
      .map((dependency) => byTaskId.get(dependency))
      .filter((dependency): dependency is string => dependency !== undefined),
  }))
}

/** 弹窗选择是候选 id；创建运行/GitHub 领取需要任务 id 空间的依赖表。 */
export function runDependencies(
  source: 'local' | 'github-issues',
  dependencies: Record<string, string[]> | undefined,
): Record<string, string[]> | undefined {
  if (!dependencies) return undefined
  const entries = Object.entries(dependencies).filter(([, value]) => value.length > 0)
  if (entries.length === 0) return undefined
  const taskId = (candidateId: string): string =>
    source === 'github-issues' ? `issue-${candidateId}` : candidateId
  return Object.fromEntries(
    entries.map(([id, value]) => [taskId(id), value.map(taskId)]),
  )
}
