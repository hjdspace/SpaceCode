/**
 * GitHub 鉴权：token 校验与 gh CLI 登录检测。
 *
 * 错误必须分类成「无效 / 无仓库权限 / 网络」，渲染层才能给出正确修复动作。
 * 这里只用 token 的只读接口；写权限在首次评论/关闭时再验证（与原型一致）。
 */
import { execFile, spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import type {
  FactoryGhLoginResult,
  FactoryGithubFailureReason,
  FactoryGithubRepo,
  FactoryGithubReposResult,
  FactoryGithubAuthResult,
  FactoryPrReadyResult,
} from '@/shared/factory'
import { classifyGhFailure, classifyGithubStatus, type GhRunner as ClientGhRunner } from './githubClient'

export interface GithubFetchResponse {
  status: number
  json: () => Promise<unknown>
  /** 仅失败分类需要：403 要区分限流与权限不足。 */
  text?: () => Promise<string>
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
    // 向导的仓库来自「凭据可访问的仓库」列表，校验阶段可以不带仓库。
    if (!repo.trim()) return { ok: true, reason: 'ok', ...(login ? { login } : {}) }

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

// ── 向导仓库下拉 ──────────────────────────────────────────────

/** 当前凭据可访问的仓库：最多 100 个，按最近更新排序（REST 与 gh 共用同一路径）。 */
const REPO_LIST_PATH =
  'user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member'
/** 让 gh 侧只回传需要的字段，避免 100 个仓库的完整 JSON 撑大输出。 */
const REPO_LIST_JQ =
  '[.[] | {repo: .full_name, name: .name, private: (.private == true), description: .description}]'

function normalizeRepos(payload: unknown): FactoryGithubRepo[] {
  if (!Array.isArray(payload)) return []
  const repos: FactoryGithubRepo[] = []
  for (const item of payload) {
    const record = asRecord(item)
    // gh 侧用 jq 投影成 repo 字段；REST 原样返回 full_name。
    const repo =
      typeof record.repo === 'string'
        ? record.repo
        : typeof record.full_name === 'string'
          ? record.full_name
          : undefined
    if (!repo) continue
    repos.push({
      repo,
      name: typeof record.name === 'string' ? record.name : repo.split('/')[1] ?? repo,
      private: record.private === true,
      ...(typeof record.description === 'string' && record.description
        ? { description: record.description }
        : {}),
    })
  }
  return repos
}

/**
 * 列出当前凭据可访问的仓库：`gh` 走 CLI，token 走 REST。
 *
 * token 为空时说明渲染层没传新 token，由调用方决定是否回退到已保存的凭据。
 */
export async function listGithubRepos(
  source: 'gh' | 'token',
  token: string | null,
  deps: { run?: typeof defaultGhRunner; fetch?: GithubFetch } = {},
): Promise<FactoryGithubReposResult> {
  if (source === 'gh') {
    const run = deps.run ?? defaultGhRunner
    let result: { code: number; stdout: string }
    try {
      result = await run(['api', REPO_LIST_PATH, '--jq', REPO_LIST_JQ])
    } catch {
      return { ok: false, reason: 'unsupported' }
    }
    if (result.code !== 0) return { ok: false, reason: classifyGhFailure(result.code, result.stdout) }
    try {
      return { ok: true, repos: normalizeRepos(JSON.parse(result.stdout)) }
    } catch {
      return { ok: false, reason: 'unknown' }
    }
  }

  const trimmed = token?.trim()
  if (!trimmed) return { ok: false, reason: 'invalid-token' }
  try {
    const res = await (deps.fetch ?? defaultFetch)(`${API_BASE}/${REPO_LIST_PATH}`, {
      headers: headers(trimmed),
    })
    if (res.status < 200 || res.status >= 300) {
      const text = res.text ? await res.text().catch(() => '') : ''
      return { ok: false, reason: classifyGithubStatus(res.status, text) }
    }
    return { ok: true, repos: normalizeRepos(await res.json()) }
  } catch {
    return { ok: false, reason: 'network' }
  }
}

/** 等待 gh 打印一次性代码的时间；超时说明 CLI 无法在无终端环境下发起流程。 */
const GH_LOGIN_CODE_TIMEOUT_MS = 20_000
/** 授权流程（用户在浏览器里操作）的最长存活时间。 */
const GH_LOGIN_FLOW_TIMEOUT_MS = 5 * 60_000

let activeGhLogin: ChildProcess | null = null

function defaultGhSpawn(args: string[]): ChildProcess {
  return spawn(process.platform === 'win32' ? 'gh.exe' : 'gh', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

/**
 * 发起 `gh auth login --web`：解析 gh 打印的一次性代码，由调用方负责打开浏览器。
 *
 * gh 只有在终端里才会自己拉起浏览器；从 Electron spawn 出来时 stdio 是管道（非 TTY），
 * 它只打印「One-time code (XXXX-XXXX) copied to clipboard」和授权 URL。
 * 首次解析到代码就返回，进程继续留在后台等待用户在浏览器完成授权；
 * 登录状态由检查按钮/轮询的 `checkGhAuth` 确认。发起新一次登录时上一进程会被终止。
 */
export function startGhWebLogin(
  spawnImpl: (args: string[]) => ChildProcess = defaultGhSpawn,
): Promise<FactoryGhLoginResult> {
  try {
    activeGhLogin?.kill()
  } catch {
    // 上一进程可能已退出。
  }
  activeGhLogin = null

  return new Promise((resolve) => {
    let settled = false
    let output = ''
    let answeredEnter = false
    let answeredConfirm = false
    let codeTimer: ReturnType<typeof setTimeout> | null = null

    const finish = (result: FactoryGhLoginResult): void => {
      if (settled) return
      settled = true
      if (codeTimer) clearTimeout(codeTimer)
      resolve(result)
    }
    const detail = (): string => stripAnsi(output).trim().slice(-400)

    let child: ChildProcess
    try {
      child = spawnImpl(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'])
    } catch {
      resolve({ ok: false, reason: 'unsupported' })
      return
    }
    activeGhLogin = child

    codeTimer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // 已退出。
      }
      activeGhLogin = null
      finish({ ok: false, reason: 'timeout', ...(detail() ? { detail: detail() } : {}) })
    }, GH_LOGIN_CODE_TIMEOUT_MS)
    const flowTimer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // 已退出。
      }
      activeGhLogin = null
    }, GH_LOGIN_FLOW_TIMEOUT_MS)
    flowTimer.unref?.()

    const onData = (chunk: Buffer | string): void => {
      output = `${output}${String(chunk)}`.slice(-4000)
      // gh 在非 TTY 下仍可能停在 Enter / (Y/n) 提示；替用户回车一次即可继续。
      const write = (answer: string): void => {
        try {
          child.stdin?.write(answer)
        } catch {
          // stdin 已关闭。
        }
      }
      if (!answeredEnter && /press enter/i.test(output)) {
        answeredEnter = true
        write('\n')
      }
      if (!answeredConfirm && /\[y\/n\]|\(y\/n\)/i.test(output)) {
        answeredConfirm = true
        // 两处 y/n 都以「授权」为准（重新登录、为 https 保存凭据）。
        write('y\n')
      }
      // 兼容两种输出：旧版 `one-time code: ABCD-1234`，新版 `One-time code (ABCD-1234) copied…`。
      const match = stripAnsi(output).match(/one-time code[^\n]*?([A-Z0-9]{4}-[A-Z0-9]{4})/i)
      if (match) {
        finish({ ok: true, reason: 'ok', code: match[1], url: 'https://github.com/login/device' })
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', () => {
      activeGhLogin = null
      finish({ ok: false, reason: 'unsupported', ...(detail() ? { detail: detail() } : {}) })
    })
    child.on('exit', (code) => {
      activeGhLogin = null
      if (code === 0) finish({ ok: true, reason: 'ok' })
      else finish({ ok: false, reason: 'unknown', ...(detail() ? { detail: detail() } : {}) })
    })
  })
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
