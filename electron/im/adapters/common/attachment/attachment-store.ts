/**
 * AttachmentStore — File storage for IM attachments
 *
 * Features:
 * - Path sanitization: prevent directory traversal (../../etc/passwd)
 * - Collision avoidance: append counter to duplicate filenames
 * - Atomic write: tmp.part + rename
 * - Dual-threshold GC: normal files 24h, .part orphans 10min
 * - Hourly GC timer: independent of write path
 * - Windows: strip UNC prefix \\?\
 */

import * as fs from 'fs'
import * as path from 'path'

const NORMAL_FILE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const PART_FILE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const GC_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

/** Strip UNC prefix \\?\ from Windows paths. */
function stripUncPrefix(p: string): string {
  if (p.startsWith('\\\\?\\')) {
    return p.slice(4)
  }
  return p
}

/** Sanitize a filename to prevent directory traversal. */
function sanitizeFilename(name: string): string {
  // Remove path separators and dangerous characters
  const sanitized = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/^\.+/, '')
    .trim()

  // Ensure non-empty
  return sanitized || 'attachment'
}

export interface AttachmentStoreOptions {
  rootDir: string
}

export interface GcResult {
  removed: number
  bytes: number
}

export class AttachmentStore {
  private readonly rootDir: string
  private gcTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: AttachmentStoreOptions) {
    this.rootDir = stripUncPrefix(path.normalize(opts.rootDir))

    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true })
    }
  }

  /**
   * Store an attachment file. Returns the absolute path.
   * Uses atomic write (tmp.part + rename) and collision avoidance.
   */
  save(name: string, data: Buffer, sessionId: string): string {
    const sessionDir = path.join(this.rootDir, sessionId)
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true })
    }

    const safeName = sanitizeFilename(name)
    let targetPath = path.join(sessionDir, safeName)

    // Collision avoidance: append counter
    if (fs.existsSync(targetPath)) {
      const ext = path.extname(safeName)
      const base = path.basename(safeName, ext)
      let counter = 1
      while (fs.existsSync(targetPath)) {
        targetPath = path.join(sessionDir, `${base}_${counter}${ext}`)
        counter++
      }
    }

    // Atomic write: tmp.part + rename
    const tmpPath = targetPath + '.part'
    fs.writeFileSync(tmpPath, data)
    fs.renameSync(tmpPath, targetPath)

    return targetPath
  }

  /**
   * Resolve a stored attachment path, ensuring it doesn't escape rootDir.
   * Returns null if the path would escape (directory traversal attempt).
   */
  resolve(sessionId: string, filename: string): string | null {
    const safeName = sanitizeFilename(filename)
    const target = stripUncPrefix(path.normalize(path.join(this.rootDir, sessionId, safeName)))

    // Verify the resolved path is within rootDir
    const relative = path.relative(this.rootDir, target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      // Path traversal attempt — reject
      return null
    }

    return target
  }

  /** Delete a stored attachment. */
  delete(filePath: string): boolean {
    try {
      const normalized = stripUncPrefix(path.normalize(filePath))
      // Verify within rootDir
      const relative = path.relative(this.rootDir, normalized)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return false
      }

      fs.unlinkSync(normalized)
      return true
    } catch {
      return false
    }
  }

  /**
   * Garbage collect expired files.
   * - Normal files: remove if older than 24h
   * - .part orphan files: remove if older than 10min (more aggressive)
   */
  gc(): GcResult {
    let removed = 0
    let bytes = 0

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return

      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          walk(fullPath)
          // Remove empty directories
          try {
            const remaining = fs.readdirSync(fullPath)
            if (remaining.length === 0) {
              fs.rmdirSync(fullPath)
            }
          } catch {
            // ignore
          }
        } else {
          const stat = fs.statSync(fullPath)
          const age = Date.now() - stat.mtimeMs
          const isPart = entry.name.endsWith('.part')

          if ((isPart && age > PART_FILE_TTL_MS) || (!isPart && age > NORMAL_FILE_TTL_MS)) {
            try {
              fs.unlinkSync(fullPath)
              removed++
              bytes += stat.size
            } catch {
              // ignore
            }
          }
        }
      }
    }

    walk(this.rootDir)

    return { removed, bytes }
  }

  /** Start hourly GC timer. */
  startGcTimer(): void {
    if (this.gcTimer) return
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS)
    if (this.gcTimer.unref) {
      this.gcTimer.unref()
    }
  }

  /** Stop GC timer. */
  stopGcTimer(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer)
      this.gcTimer = null
    }
  }
}
