/**
 * HttpClient — REST client for IM Server API
 *
 * Features:
 * - 30s default timeout (AbortController + setTimeout)
 * - 4-level matchProject (absolute path → index → exact name → fuzzy contains)
 * - allowedProjectRoots default deny (empty = reject all absolute paths)
 * - Session CRUD, project listing, git info, providers, models, skills
 */

import * as path from 'path'

const DEFAULT_TIMEOUT_MS = 30_000

export interface HttpClientOptions {
  baseUrl: string
  timeoutMs?: number
  allowedProjectRoots?: string[]
}

export interface SessionInfo {
  sessionId: string
  title?: string
}

export interface ProjectInfo {
  name: string
  path: string
  realPath?: string
}

export interface GitInfo {
  branch: string
  status?: string
  ahead?: number
  behind?: number
}

export interface ProviderInfo {
  id: string
  name: string
  active: boolean
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
}

export interface SkillInfo {
  name: string
  description?: string
}

export class HttpClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly allowedProjectRoots: string[]

  constructor(opts: HttpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.allowedProjectRoots = opts.allowedProjectRoots ?? []
  }

  /** Create a new Claude session. Returns sessionId + auth token. */
  async createSession(workDir: string): Promise<{ sessionId: string; token: string }> {
    const res = await this.request('POST', '/api/sessions', { workDir })
    return { sessionId: res.sessionId, token: res.token }
  }

  /** Check if a session exists. */
  async sessionExists(sessionId: string): Promise<boolean> {
    try {
      await this.request('GET', `/api/sessions/${sessionId}`)
      return true
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return false
      throw err
    }
  }

  /** List recent projects. */
  async listRecentProjects(): Promise<ProjectInfo[]> {
    return this.request('GET', '/api/sessions/recent-projects')
  }

  /** Get git info for a session. */
  async getGitInfo(sessionId: string): Promise<GitInfo> {
    return this.request('GET', `/api/sessions/${sessionId}/git-info`)
  }

  /** List sessions with pagination. */
  async listSessions(limit = 20, offset = 0): Promise<SessionInfo[]> {
    return this.request('GET', `/api/sessions?limit=${limit}&offset=${offset}`)
  }

  /** List LLM providers. */
  async listProviders(): Promise<ProviderInfo[]> {
    return this.request('GET', '/api/providers')
  }

  /** Activate a provider. */
  async activateProvider(providerId: string): Promise<void> {
    await this.request('POST', `/api/providers/${providerId}/activate`)
  }

  /** List models. */
  async listModels(): Promise<ModelInfo[]> {
    return this.request('GET', '/api/models')
  }

  /** Set current model. */
  async setModel(modelId: string): Promise<void> {
    await this.request('PUT', '/api/models/current', { modelId })
  }

  /** List skills for a working directory. */
  async listSkills(cwd: string): Promise<SkillInfo[]> {
    return this.request('GET', `/api/skills?cwd=${encodeURIComponent(cwd)}`)
  }

  /** Get task counts for a session. */
  async getTaskCounts(sessionId: string): Promise<Record<string, number>> {
    return this.request('GET', `/api/tasks/lists/${sessionId}`)
  }

  /**
   * Match a user-provided project query to a project from the list.
   * 4-level matching:
   * 1. Query is an absolute path within allowedProjectRoots → return directly
   * 2. parseInt(query) as 1-based index → projects[num-1]
   * 3. projectName.toLowerCase() === query → exact match
   * 4. projectName/realPath contains query → 1 match: return, multiple: ambiguous
   */
  matchProject(query: string, projects: ProjectInfo[]): ProjectInfo | null | 'ambiguous' {
    const trimmed = query.trim()
    if (!trimmed) return null

    // 1. Absolute path within allowedProjectRoots
    if (path.isAbsolute(trimmed)) {
      if (this.allowedProjectRoots.length === 0) {
        // Default deny: no allowed roots configured
        return null
      }
      const isAllowed = this.allowedProjectRoots.some((root) =>
        trimmed === root || trimmed.startsWith(root + path.sep)
      )
      if (isAllowed) {
        return { name: path.basename(trimmed), path: trimmed }
      }
      return null
    }

    // 2. 1-based index
    const index = parseInt(trimmed, 10)
    if (!isNaN(index) && index >= 1 && index <= projects.length) {
      return projects[index - 1]
    }

    // 3. Exact name match (case-insensitive)
    const lowerQuery = trimmed.toLowerCase()
    const exactMatch = projects.find((p) => p.name.toLowerCase() === lowerQuery)
    if (exactMatch) return exactMatch

    // 4. Fuzzy contains
    const fuzzyMatches = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerQuery) ||
        (p.realPath && p.realPath.toLowerCase().includes(lowerQuery)) ||
        p.path.toLowerCase().includes(lowerQuery)
    )

    if (fuzzyMatches.length === 0) return null
    if (fuzzyMatches.length === 1) return fuzzyMatches[0]
    return 'ambiguous'
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const url = `${this.baseUrl}${path}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new HttpError(res.status, await res.text().catch(() => ''))
      }

      const text = await res.text()
      return text ? JSON.parse(text) : null
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`HTTP ${status}: ${body}`)
    this.name = 'HttpError'
  }
}