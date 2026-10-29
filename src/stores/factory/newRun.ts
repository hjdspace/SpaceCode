/**
 * 新建运行弹窗的候选投影：把本地待办与 GitHub issue 统一成同一份
 * 「可勾选 / 已领取跳过」列表，组件只负责渲染与选择。
 */
import type { FactoryBacklogItem, FactoryGithubIssue } from '@/shared/factory'

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
