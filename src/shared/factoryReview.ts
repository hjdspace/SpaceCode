/**
 * 审查与合并资格的纯函数（主进程与渲染层共用同一套判定）。
 *
 * 合并资格对齐 sandcastle 的保守策略：验证通过 + 审查通过 + 无未决阻塞意见。
 * 这里只读投影，不写状态；所有动作仍由主进程 runtime 落盘。
 */
import type { FactoryReview, FactoryReviewComment, FactoryTask } from './factory'

export type FactoryMergeBlockReason =
  | 'tests-missing'
  | 'tests-failed'
  | 'review-missing'
  | 'review-needs-changes'
  | 'open-blockers'

export function openBlockerComments(review: FactoryReview | undefined): FactoryReviewComment[] {
  if (!review) return []
  return review.comments.filter((comment) => comment.status === 'open' && comment.severity === 'blocker')
}

/** 未决意见：待处理或已加入修复清单（忽略/已解决不算）。 */
export function pendingComments(review: FactoryReview | undefined): FactoryReviewComment[] {
  if (!review) return []
  return review.comments.filter((comment) => comment.status === 'open' || comment.status === 'accepted')
}

export type MergeEligibility = { ok: true } | { ok: false; reasons: FactoryMergeBlockReason[] }

/** 只有「测试通过 + 审查通过 + 无未决阻塞意见」才允许进入待合并。 */
export function mergeEligibility(task: Pick<FactoryTask, 'tests' | 'review'>): MergeEligibility {
  const reasons: FactoryMergeBlockReason[] = []
  if (!task.tests) reasons.push('tests-missing')
  else if (task.tests.status !== 'pass') reasons.push('tests-failed')

  if (!task.review) reasons.push('review-missing')
  else {
    if (task.review.verdict !== 'approved') reasons.push('review-needs-changes')
    if (openBlockerComments(task.review).length > 0) reasons.push('open-blockers')
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

/** 单条意见的接受/忽略；返回新对象，找不到意见返回 null。 */
export function updateReviewComment(
  review: FactoryReview,
  commentId: string,
  action: 'accept' | 'ignore',
): FactoryReview | null {
  const index = review.comments.findIndex((comment) => comment.id === commentId)
  if (index < 0) return null
  const comments = [...review.comments]
  comments[index] = {
    ...comments[index],
    status: action === 'accept' ? 'accepted' : 'ignored',
  }
  return { ...review, comments }
}
