/**
 * GitHub Issues 任务源（spec §8）。
 *
 * 负责三件事：
 * 1. 列出 open issues（标签过滤、分页上限、去重、领取态）；
 * 2. 领取前写一条含运行标识的幂等评论，重复领取会被识别并拒绝；
 *    已结束/已消失运行留下的标记视为陈旧，不再阻止重新领取；
 * 3. 合并成功后回写摘要评论与关闭，两个开关彼此独立。
 *
 * 传输层由 `githubTracker` 注入（gh 或 REST），因此所有分支都能在单测里覆盖。
 */
import type {
  FactoryGithubIssue,
  FactoryGithubListResult,
  FactoryGithubFailureReason,
  FactoryMergeMode,
  FactoryReview,
  FactoryTestRun,
} from '@/shared/factory'
import type { GithubApi, GithubRawIssue } from './githubClient'
import { MAX_ISSUES } from './githubClient'

export type GithubTrackerApi = GithubApi

const CLAIM_PATTERN = /<!--\s*spacecode-factory:claim\s+run=([^\s]+)\s+task=([^\s]+)\s*-->/g
const DEFAULT_LIST_LIMIT = 20

export function claimMarker(runId: string, taskId: string): string {
  return `<!-- spacecode-factory:claim run=${runId} task=${taskId} -->`
}

export function parseClaimMarkers(bodies: string[]): Array<{ runId: string; taskId: string }> {
  const markers: Array<{ runId: string; taskId: string }> = []
  for (const body of bodies) {
    for (const match of body.matchAll(CLAIM_PATTERN)) {
      markers.push({ runId: match[1], taskId: match[2] })
    }
  }
  return markers
}

export type GithubClaimOutcome =
  | { ok: true; idempotent: boolean }
  | { ok: false; reason: 'already-claimed' | FactoryGithubFailureReason; byRun?: string }

export interface GithubWriteBackOutcome {
  ok: boolean
  reason?: FactoryGithubFailureReason
  commented: boolean
  closed: boolean
}

export interface GithubTrackerOptions {
  api: GithubApi
  label?: string
  /** 本地未结束运行已领取的 issue 编号；与远端评论一起参与去重。 */
  locallyClaimed?: number[]
  /**
   * 远端领取标记是否仍占着该 issue：只有本地未结束、且该 issue 的任务
   * 尚未完成/取消的运行才算。不传时退化为「任何标记都算占用」（旧行为）。
   */
  holdsClaim?: (issueNumber: number, runId: string) => boolean
}

export interface GithubTracker {
  list(input?: { label?: string; limit?: number }): Promise<FactoryGithubListResult>
  claim(input: { issueNumber: number; runId: string; taskId: string }): Promise<GithubClaimOutcome>
  writeBack(input: {
    issueNumber: number
    body: string
    comment: boolean
    close: boolean
  }): Promise<GithubWriteBackOutcome>
}

function matchesLabel(issue: GithubRawIssue, label: string): boolean {
  return issue.labels.some((item) => item.toLowerCase() === label.toLowerCase())
}

function toSummary(
  issue: GithubRawIssue,
  claimed: boolean,
): FactoryGithubIssue {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    state: issue.state,
    ...(issue.url ? { url: issue.url } : {}),
    claimed,
  }
}

export function createGithubTracker(options: GithubTrackerOptions): GithubTracker {
  const localClaimed = new Set(options.locallyClaimed ?? [])
  const holdsClaim = options.holdsClaim

  return {
    async list(input = {}) {
      const label = (input.label ?? options.label ?? '').trim()
      const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_ISSUES))
      const result = await options.api.listIssues({ ...(label ? { label } : {}), limit })
      if (!result.ok) {
        return { ok: false, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}) }
      }

      const seen = new Set<number>()
      const issues: FactoryGithubIssue[] = []
      for (const issue of result.value) {
        if (issue.state !== 'open') continue
        if (label && !matchesLabel(issue, label)) continue
        if (seen.has(issue.number)) continue
        seen.add(issue.number)

        const remoteMarkers = parseClaimMarkers((issue.comments ?? []).map((comment) => comment.body))
        const claimedRemotely = remoteMarkers.some(
          (marker) => holdsClaim?.(issue.number, marker.runId) ?? true,
        )
        issues.push(toSummary(issue, localClaimed.has(issue.number) || claimedRemotely))
        if (issues.length >= limit) break
      }
      return { ok: true, issues }
    },

    async claim(input) {
      const comments = await options.api.listComments(input.issueNumber)
      if (!comments.ok) {
        return { ok: false, reason: comments.reason }
      }
      const markers = parseClaimMarkers(comments.value.map((comment) => comment.body))
      const other = markers.find(
        (marker) =>
          marker.runId !== input.runId &&
          (holdsClaim?.(input.issueNumber, marker.runId) ?? true),
      )
      if (other) return { ok: false, reason: 'already-claimed', byRun: other.runId }

      if (markers.some((marker) => marker.runId === input.runId && marker.taskId === input.taskId)) {
        return { ok: true, idempotent: true }
      }

      const body = [
        claimMarker(input.runId, input.taskId),
        `本次运行 \`${input.runId}\` 已领取该 issue（任务 \`${input.taskId}\`）。`,
      ].join('\n')
      const comment = await options.api.createComment(input.issueNumber, body)
      if (!comment.ok) return { ok: false, reason: comment.reason }
      return { ok: true, idempotent: false }
    },

    async writeBack(input) {
      let commented = false
      let closed = false

      if (input.comment) {
        const comment = await options.api.createComment(input.issueNumber, input.body)
        if (!comment.ok) {
          return { ok: false, reason: comment.reason, commented: false, closed: false }
        }
        commented = true
      }

      if (input.close) {
        const closedResult = await options.api.closeIssue(input.issueNumber)
        if (!closedResult.ok) {
          return { ok: false, reason: closedResult.reason, commented, closed: false }
        }
        closed = true
      }

      return { ok: true, commented, closed }
    },
  }
}

export interface MergeCommentInput {
  branch: string
  targetBranch: string
  mergedCommits: number
  mergedAt: string
  mode: FactoryMergeMode
  tests?: FactoryTestRun
  review?: FactoryReview
}

/** 回写评论只包含可审计事实，不把 issue 正文或凭据带进去。 */
export function buildMergeComment(input: MergeCommentInput): string {
  const lines: string[] = [
    '<!-- spacecode-factory:merge -->',
    '## 已合并',
    '',
    `- 分支：\`${input.branch}\` → \`${input.targetBranch}\``,
    `- 提交：${input.mergedCommits} 个`,
    `- 合并方式：${input.mode}`,
  ]

  if (input.tests) {
    const status =
      input.tests.status === 'pass'
        ? '通过'
        : input.tests.status === 'timeout'
          ? '超时'
          : input.tests.status === 'stopped'
            ? '已中断'
            : '未通过'
    lines.push(`- 验证：${status}（\`${input.tests.command}\`）`)
  } else {
    lines.push('- 验证：无记录')
  }

  if (input.review) {
    const verdict = input.review.verdict === 'approved' ? '通过' : '要求修改'
    lines.push(`- 审查：${verdict}`)
  } else {
    lines.push('- 审查：无记录')
  }

  lines.push(`- 合并时间：${input.mergedAt}`)
  return lines.join('\n')
}
