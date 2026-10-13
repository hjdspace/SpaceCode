// electron/h5/h5PathGuard.ts
// `/api/fs/*` 的可信根守卫 — 只有桌面端亲自打开过的项目目录才可被远端读取

import { realpathSync } from 'fs'
import { resolve } from 'path'

const IS_WIN = process.platform === 'win32'
const SEP = IS_WIN ? '\\' : '/'

export type PathDecision = { allowed: true } | { allowed: false; reason: 'no-roots' | 'outside-roots' }

/**
 * realpath when the path exists (so a symlink is judged as its target), the
 * resolved absolute path when it does not (so a missing file under an allowed
 * root keeps the routes' existing "read returns nothing" behaviour).
 */
function canonicalize(candidate: string): string {
  try {
    return realpathSync(candidate)
  } catch {
    return resolve(candidate)
  }
}

function compareForm(path: string): string {
  const stripped = path.replace(/[\\/]+$/, '')
  const value = stripped === '' ? path : stripped
  return IS_WIN ? value.toLowerCase() : value
}

function inside(child: string, root: string): boolean {
  const prefixRoot = root.replace(/[\\/]+$/, '')
  const prefix = prefixRoot === '' ? root : root + SEP
  return child === prefixRoot || child.startsWith(prefix)
}

export class H5PathGuard {
  private readonly roots = new Set<string>()

  /**
   * Register a readable project root. Nothing on the request path may call
   * this — the token holder must not be able to widen its own reach.
   */
  addRoot(projectPath: string | null | undefined): void {
    if (typeof projectPath !== 'string' || projectPath.trim() === '') return
    this.roots.add(compareForm(canonicalize(projectPath)))
  }

  get rootCount(): number {
    return this.roots.size
  }

  check(candidate: string): PathDecision {
    const path = compareForm(canonicalize(candidate))

    if (this.roots.size === 0) return { allowed: false, reason: 'no-roots' }
    for (const root of this.roots) {
      if (inside(path, root)) return { allowed: true }
    }
    return { allowed: false, reason: 'outside-roots' }
  }
}
