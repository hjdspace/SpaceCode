/**
 * GitHub 鉴权：token 校验与 gh CLI 登录检测。
 *
 * 错误必须分类成「无效 / 无仓库权限 / 网络」，渲染层才能给出正确修复动作。
 * 这里只用 token 的只读接口；写权限在首次评论/关闭时再验证（与原型一致）。
 */
import { execFile } from 'child_process'
import type { FactoryGithubAuthResult, FactoryPrReadyResult } from '@/shared/factory'
import { classifyGhFailure, type GhRunner as ClientGhRunner } from './githubClient'

export interface GithubFetchResponse {
  status: number
  json: () => Promise<unknown>
}

export type GithubFetch = (url: string, init: { headers: Record<string, string> }) => Promise<GithubFetchResponse>

export type GhRunner = (args: string[]) => Promise<{ code: number; stdout: string }>

const API_BASE = 'https://api.github.com'

function defaultFetch(url: string, init: { headers: Record<string, string> }): Promise<GithubFetchResponse> {
  return fetch(url, init) as unknown as Promise<GithubFetchResponse>
}

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'SpaceCode-Factory',
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** 校验 token 与目标仓库可读性；不检查写权限。 */
export async function verifyGithubToken(
  token: string,
  repo: string,
  fetchImpl: GithubFetch = defaultFetch,
): Promise<FactoryGithubAuthResult> {
  const trimmed = token.trim()
  if (!trimmed) return { ok: false, reason: 'invalid-token' }

  try {
    const userRes = await fetchImpl(`${API_BASE}/user`, { headers: headers(trimmed) })
    if (userRes.status === 401 || userRes.status === 403) return { ok: false, reason: 'invalid-token' }
    if (userRes.status < 200 || userRes.status >= 300) return { ok: false, reason: 'network' }
    const user = asRecord(await userRes.json())
    const login = typeof user.login === 'string' ? user.login : undefined

    const repoRes = await fetchImpl(`${API_BASE}/repos/${repo}`, { headers: headers(trimmed) })
    if (repoRes.status === 404 || repoRes.status === 403) {
      return { ok: false, reason: 'repo-permission', ...(login ? { login } : {}) }
    }
    if (repoRes.status < 200 || repoRes.status >= 300) {
      return { ok: false, reason: 'network', ...(login ? { login } : {}) }
    }
    const repoBody = asRecord(await repoRes.json())
    const permissions = asRecord(repoBody.permissions)
    return {
      ok: true,
      reason: 'ok',
      ...(login ? { login } : {}),
      repo,
      private: repoBody.private === true,
      canPush: permissions.push === true,
    }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

export function defaultGhRunner(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      process.platform === 'win32' ? 'gh.exe' : 'gh',
      args,
      { timeout: 10000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as NodeJS.ErrnoException).code === 'number' ? (error as NodeJS.ErrnoException).code as unknown as number : 1) : 0
        resolve({ code, stdout: `${stdout ?? ''}${stderr ?? ''}` })
      },
    )
  })
}

export async function checkGhAuth(run: GhRunner = defaultGhRunner): Promise<FactoryGithubAuthResult> {
  try {
    const result = await run(['auth', 'status'])
    if (result.code !== 0) return { ok: false, reason: 'gh-not-logged-in' }
    const match = result.stdout.match(/as\s+([A-Za-z0-9-]+)/i)
    return { ok: true, reason: 'ok', ...(match ? { login: match[1] } : {}) }
  } catch {
    return { ok: false, reason: 'gh-not-logged-in' }
  }
}

/** PR 模式：gh 凭据对目标仓库是否具备写权限（push/建 PR）。 */
export async function checkGhWriteAccess(
  repo: string,
  run: ClientGhRunner = defaultGhRunner,
): Promise<FactoryPrReadyResult> {
  try {
    const result = await run(['api', `repos/${repo}`, '--jq', '.permissions.push'])
    if (result.code !== 0) {
      return { ok: false, reason: classifyGhFailure(result.code, result.stdout ?? '') }
    }
    return result.stdout.trim() === 'true' ? { ok: true } : { ok: false, reason: 'repo-permission' }
  } catch {
    return { ok: false, reason: 'unsupported' }
  }
}
