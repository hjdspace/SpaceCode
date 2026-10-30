/**
 * 从 `git remote get-url origin` 解析 owner/repo（兼容 SSH 与 HTTPS）。
 *
 * 向导自动回填与手填校验共用同一份规则，避免“自动识别”与“手动输入”出现分歧。
 * 解析失败返回 undefined，界面据此允许手填并用 `isValidRepoSlug` 兜底校验。
 */

import type { FactoryTrackerConfig } from '@/shared/factory'

/** `owner/repo` 形式；拒绝空段、空白与 `..`。 */
export const REPO_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export function isValidRepoSlug(repo: string): boolean {
  return REPO_SLUG_PATTERN.test(repo) && !repo.includes('..')
}

export function parseRepoFromRemote(remote: string | undefined | null): string | undefined {
  if (typeof remote !== 'string') return undefined
  const trimmed = remote.trim()
  if (!trimmed) return undefined

  // https://host/owner/repo(.git) / git@host:owner/repo(.git) / ssh://git@host:22/owner/repo(.git)
  const match = trimmed.match(/(?:^|[:/])([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/)
  if (!match) return undefined

  const repo = `${match[1]}/${match[2]}`
  return isValidRepoSlug(repo) ? repo : undefined
}

/** 取绝对路径的最后一段；没有目录名（空串、POSIX 根、盘符根）时返回空串。 */
export function projectNameFromPath(path: string): string {
  const segments = path.trim().replace(/[\\/]+$/, '').split(/[\\/]/)
  const name = segments[segments.length - 1] ?? ''
  return /^[A-Za-z]:$/.test(name) ? '' : name
}

/** 看板与向导共用的仓库标识：GitHub 用 owner/repo，本地 backlog 用项目目录名。 */
export function factoryRepoLabel(
  tracker: { type: FactoryTrackerConfig['type']; repo?: string },
  projectRoot: string,
): string {
  if (tracker.type === 'github-issues') return tracker.repo ?? ''
  return projectNameFromPath(projectRoot)
}
