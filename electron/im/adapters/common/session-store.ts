/**
 * SessionStore — Persistent chatId ↔ sessionId mapping
 *
 * Stores the mapping between IM chatId and Claude Code sessionId,
 * allowing session recovery after adapter process restart.
 *
 * Key design decisions:
 * - Every get() calls refresh() to re-read the file (multi-process coordination)
 * - mtime cache: statSync to check mtime; skip read+parse if unchanged
 * - Atomic write: tmp file + rename (ensures consistency across processes)
 * - deleteBySessionId: full scan (don't break on first match, handle dirty data)
 * - Windows: strip UNC prefix \\?\ from paths, chmod 0o600 is no-op on NTFS
 */

import * as fs from 'fs'
import * as path from 'path'
import type { SessionBinding } from './types'

export interface SessionStoreData {
  [chatId: string]: SessionBinding
}

export interface SessionStoreOptions {
  filePath?: string
}

export class SessionStore {
  private readonly filePath: string
  private cachedMtime: number = 0
  private cachedData: SessionStoreData | null = null

  constructor(opts: SessionStoreOptions = {}) {
    this.filePath = opts.filePath ?? this.getDefaultPath()
  }

  /**
   * Get the session binding for a chatId.
   * Refreshes from disk on every call (multi-process coordination via mtime).
   */
  get(chatId: string): SessionBinding | null {
    const data = this.refresh()
    return data[chatId] ?? null
  }

  /** Set or update the session binding for a chatId. */
  set(chatId: string, binding: SessionBinding): void {
    const data = this.refresh()
    data[chatId] = binding
    this.save(data)
  }

  /** Delete the session binding for a chatId. */
  delete(chatId: string): void {
    const data = this.refresh()
    if (chatId in data) {
      delete data[chatId]
      this.save(data)
    }
  }

  /**
   * Delete all chatId bindings that reference the given sessionId.
   * Full scan — does NOT break on first match (handles dirty data where
   * two chatIds might erroneously point to the same sessionId).
   */
  deleteBySessionId(sessionId: string): string[] {
    const data = this.refresh()
    const removed: string[] = []

    for (const [chatId, binding] of Object.entries(data)) {
      if (binding.sessionId === sessionId) {
        delete data[chatId]
        removed.push(chatId)
      }
    }

    if (removed.length > 0) {
      this.save(data)
    }

    return removed
  }

  /** Get all chatId → binding entries. */
  entries(): SessionStoreData {
    return this.refresh()
  }

  /** Force clear the cache and re-read from disk on next access. */
  invalidateCache(): void {
    this.cachedMtime = 0
    this.cachedData = null
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Refresh from disk. Uses mtime cache to skip unnecessary read+parse.
   *
   * Safety guarantee: mtime is a filesystem-level modification timestamp.
   * Other processes' atomic writes (tmp+rename) always change mtime,
   * so the cache will never return stale data.
   */
  private refresh(): SessionStoreData {
    try {
      const stat = fs.statSync(this.filePath)
      const mtime = stat.mtimeMs

      if (this.cachedData && mtime === this.cachedMtime) {
        return this.cachedData
      }

      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw) as SessionStoreData
      this.cachedMtime = mtime
      this.cachedData = data
      return data
    } catch {
      // File doesn't exist or is corrupted — return empty
      this.cachedMtime = 0
      this.cachedData = {}
      return {}
    }
  }

  /**
   * Atomic write: write to tmp file, then rename.
   * On Linux/macOS, sets mode 0o600 for sensitive data.
   * On Windows, chmod is no-op — caller should use icacls for ACL.
   */
  private save(data: SessionStoreData): void {
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const tmpPath = this.filePath + '.tmp'
    const content = JSON.stringify(data, null, 2)

    fs.writeFileSync(tmpPath, content, {
      encoding: 'utf-8',
      mode: 0o600,
    })

    fs.renameSync(tmpPath, this.filePath)

    // Update cache
    this.cachedData = data
    try {
      this.cachedMtime = fs.statSync(this.filePath).mtimeMs
    } catch {
      // ignore
    }
  }

  private getDefaultPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || ''
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
    return path.join(claudeDir, 'adapter-sessions.json')
  }
}
