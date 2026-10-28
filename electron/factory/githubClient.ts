/**
 * GitHub 传输层（spec §8 / §11）。
 *
 * 两条互斥路径：
 * - `gh` CLI：`execFile` 传 args，绝不经 shell；stdout 只按 JSON 解析。
 * - REST：仅主进程内存里的 token 进入 Authorization 头，全部请求带超时与响应大小上限。
 *
 * 失败统一分类成 `FactoryGithubFailureReason`，渲染层据此给出修复动作。
 */
import type { FactoryGithubFailureReason } from '@/shared/factory'

export const GITHUB_API_BASE = 'https://api.github.com'
export const DEFAULT_TIMEOUT_MS = 15000
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const DEFAULT_MAX_BODY_CHARS = 20000
export const DEFAULT_PER_PAGE = 50
export const MAX_ISSUES = 100

export interface GithubRawIssue {
  number: number
  title: string
  body: string
  labels: string[]
  state: 'open' | 'closed'
  url?: string
  /** gh 列表会带回评论，用于在列表阶段识别「已被领取」。 */
  comments?: Array<{ body: string }>
}

export type GithubResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: FactoryGithubFailureReason; detail?: string }

export interface GithubApi {
  listIssues(input: { label?: string; limit: number }): Promise<GithubResult<GithubRawIssue[]>>
  listComments(issueNumber: number): Promise<GithubResult<Array<{ body: string }>>>
  createComment(issueNumber: number, body: string): Promise<GithubResult<{ id?: number }>>
  closeIssue(issueNumber: number): Promise<GithubResult<{ closed: boolean }>>
}

export type GithubFetch = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: string
    signal: AbortSignal
  },
) => Promise<{ status: number; text: () => Promise<string>; headers: { get(name: string): string | null } }>

const defaultFetch: GithubFetch = async (url, init) => {
  const res = await fetch(url, init)
  return {
    status: res.status,
    text: () => res.text(),
    headers: res.headers,
  }
}

/** gh CLI runner：settle 而非 reject，便于把非零退出码统一分类。 */
export type GhRunner = (args: string[]) => Promise<{ code: number | string; stdout: string }>

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function normalizeState(value: unknown): 'open' | 'closed' {
  return String(value ?? '').toUpperCase() === 'CLOSED' ? 'closed' : 'open'
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item : asRecord(item).name))
    .filter((name): name is string => typeof name === 'string' && name !== '')
}

function normalizeComments(value: unknown): Array<{ body: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asRecord(item).body)
    .filter((body): body is string => typeof body === 'string')
    .map((body) => ({ body }))
}

function truncateBody(body: string, maxChars: number): string {
  return body.length > maxChars ? body.slice(0, maxChars) : body
}

function normalizeIssue(raw: unknown, maxBodyChars: number): GithubRawIssue | null {
  const record = asRecord(raw)
  const number = record.number
  if (typeof number !== 'number' || !Number.isFinite(number)) return null
  const issue: GithubRawIssue = {
    number,
    title: typeof record.title === 'string' ? record.title : '',
    body: typeof record.body === 'string' ? truncateBody(record.body, maxBodyChars) : '',
    labels: normalizeLabels(record.labels),
    state: normalizeState(record.state),
  }
  if (typeof record.url === 'string' && record.url) issue.url = record.url
  if (Array.isArray(record.comments)) issue.comments = normalizeComments(record.comments)
  return issue
}

/** HTTP 状态 + 响应文本 → 可操作的失败原因（401/403/404 与限流必须分开）。 */
export function classifyGithubStatus(status: number, text: string): FactoryGithubFailureReason {
  const lower = text.toLowerCase()
  if (status === 401) return 'invalid-token'
  if (status === 429) return 'rate-limit'
  if (status === 403) {
    return lower.includes('rate limit') || lower.includes('secondary rate') ? 'rate-limit' : 'repo-permission'
  }
  if (status === 404) return 'repo-not-found'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 413) return 'response-too-large'
  if (status >= 500) return 'network'
  return 'unknown'
}

/** gh 非零退出码 → 失败原因；`ENOENT` / 未安装视为 unsupported。 */
export function classifyGhFailure(code: number | string, output: string): FactoryGithubFailureReason {
  if (code === 'ENOENT' || code === 127) return 'unsupported'
  const lower = output.toLowerCase()
  if (lower.includes('gh auth login') || lower.includes('not logged in') || lower.includes('authentication')) {
    return 'not-logged-in'
  }
  if (lower.includes('http 401')) return 'invalid-token'
  if (lower.includes('http 429')) return 'rate-limit'
  if (lower.includes('http 403')) {
    return lower.includes('rate limit') ? 'rate-limit' : 'repo-permission'
  }
  if (lower.includes('http 404')) return 'repo-not-found'
  if (lower.includes('rate limit')) return 'rate-limit'
  if (lower.includes('timed out') || lower.includes('etimedout') || lower.includes('timeout')) return 'timeout'
  if (lower.includes('enoent') || lower.includes('not recognized') || lower.includes('command not found')) {
    return 'unsupported'
  }
  return 'unknown'
}

export interface RestApiOptions {
  repo: string
  token: string
  fetchImpl?: GithubFetch
  timeoutMs?: number
  maxResponseBytes?: number
  maxBodyChars?: number
  perPage?: number
  baseUrl?: string
}

export function createRestApi(options: RestApiOptions): GithubApi {
  const fetchImpl = options.fetchImpl ?? defaultFetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS
  const perPage = Math.min(options.perPage ?? DEFAULT_PER_PAGE, 100)
  const baseUrl = options.baseUrl ?? GITHUB_API_BASE
  const repoPath = `/repos/${options.repo}`

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${options.token}`,
    'User-Agent': 'SpaceCode-Factory',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  async function request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<GithubResult<{ status: number; text: string }>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      })
      const text = await res.text()
      // 上限按字节计，避免多字节正文绕过字符数比较。
      if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) return { ok: false, reason: 'response-too-large' }
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, reason: classifyGithubStatus(res.status, text) }
      }
      return { ok: true, value: { status: res.status, text } }
    } catch (error) {
      const name = (error as { name?: string })?.name
      if (name === 'AbortError' || name === 'TimeoutError') return { ok: false, reason: 'timeout' }
      return { ok: false, reason: 'network' }
    } finally {
      clearTimeout(timer)
    }
  }

  function parseJson<T>(text: string): T | null {
    try {
      return JSON.parse(text) as T
    } catch {
      return null
    }
  }

  async function listIssues(input: { label?: string; limit: number }): Promise<GithubResult<GithubRawIssue[]>> {
    const limit = Math.max(1, Math.min(input.limit, MAX_ISSUES))
    const issues: GithubRawIssue[] = []
    const maxPages = Math.ceil(limit / perPage) + 1
    for (let page = 1; page <= maxPages && issues.length < limit; page += 1) {
      const params = new URLSearchParams({
        state: 'open',
        per_page: String(perPage),
        page: String(page),
      })
      if (input.label) params.set('labels', input.label)
      const res = await request('GET', `${repoPath}/issues?${params.toString()}`)
      if (!res.ok) return res
      const payload = parseJson<unknown>(res.value.text)
      if (!Array.isArray(payload)) return { ok: false, reason: 'unknown' }
      let pageCount = 0
      for (const raw of payload) {
        const record = asRecord(raw)
        // /issues 会返回 PR；任务源只收真正的 issue。
        if (record.pull_request) continue
        pageCount += 1
        if (issues.length >= limit) break
        const issue = normalizeIssue(record, maxBodyChars)
        if (issue) issues.push(issue)
      }
      if (pageCount < perPage) break
    }
    return { ok: true, value: issues }
  }

  async function listComments(issueNumber: number): Promise<GithubResult<Array<{ body: string }>>> {
    const res = await request('GET', `${repoPath}/issues/${issueNumber}/comments?per_page=100`)
    if (!res.ok) return res
    const payload = parseJson<unknown>(res.value.text)
    if (!Array.isArray(payload)) return { ok: false, reason: 'unknown' }
    return { ok: true, value: normalizeComments(payload) }
  }

  return {
    listIssues,
    listComments,
    async createComment(issueNumber, body) {
      const res = await request('POST', `${repoPath}/issues/${issueNumber}/comments`, { body })
      if (!res.ok) return res
      const payload = asRecord(parseJson<unknown>(res.value.text))
      return { ok: true, value: { ...(typeof payload.id === 'number' ? { id: payload.id } : {}) } }
    },
    async closeIssue(issueNumber) {
      const res = await request('PATCH', `${repoPath}/issues/${issueNumber}`, { state: 'closed' })
      if (!res.ok) return res
      return { ok: true, value: { closed: true } }
    },
  }
}

export interface GhApiOptions {
  repo: string
  run: GhRunner
  maxBodyChars?: number
}

export function createGhApi(options: GhApiOptions): GithubApi {
  const maxBodyChars = options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS

  async function runGh(args: string[]): Promise<GithubResult<string>> {
    let result: { code: number | string; stdout: string }
    try {
      result = await options.run(args)
    } catch {
      return { ok: false, reason: 'unsupported' }
    }
    if (result.code !== 0) return { ok: false, reason: classifyGhFailure(result.code, result.stdout ?? '') }
    return { ok: true, value: result.stdout ?? '' }
  }

  async function runJson(args: string[]): Promise<GithubResult<unknown>> {
    const result = await runGh(args)
    if (!result.ok) return result
    try {
      return { ok: true, value: JSON.parse(result.value) as unknown }
    } catch {
      return { ok: false, reason: 'unknown' }
    }
  }

  async function runVoid(args: string[]): Promise<GithubResult<Record<string, never>>> {
    const result = await runGh(args)
    if (!result.ok) return result
    return { ok: true, value: {} }
  }

  return {
    async listIssues(input) {
      const limit = Math.max(1, Math.min(input.limit, MAX_ISSUES))
      const args = [
        'issue',
        'list',
        '--repo',
        options.repo,
        '--state',
        'open',
        '--limit',
        String(limit),
        '--json',
        'number,title,body,labels,comments,url',
      ]
      if (input.label) args.push('--label', input.label)
      const res = await runJson(args)
      if (!res.ok) return res
      if (!Array.isArray(res.value)) return { ok: false, reason: 'unknown' }
      const issues = res.value
        .map((raw) => normalizeIssue(raw, maxBodyChars))
        .filter((issue): issue is GithubRawIssue => issue !== null)
      return { ok: true, value: issues }
    },
    async listComments(issueNumber) {
      const res = await runJson(['issue', 'view', String(issueNumber), '--repo', options.repo, '--json', 'comments'])
      if (!res.ok) return res
      return { ok: true, value: normalizeComments(asRecord(res.value).comments) }
    },
    async createComment(issueNumber, body) {
      const res = await runVoid(['issue', 'comment', String(issueNumber), '--repo', options.repo, '--body', body])
      if (!res.ok) return res
      return { ok: true, value: {} }
    },
    async closeIssue(issueNumber) {
      const res = await runVoid(['issue', 'close', String(issueNumber), '--repo', options.repo])
      if (!res.ok) return res
      return { ok: true, value: { closed: true } }
    },
  }
}
