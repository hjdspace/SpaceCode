/**
 * Skill Manager V2 — Filesystem Utilities
 *
 * Stable directory hashing, YAML frontmatter parsing, recursive copy,
 * symlink creation with Windows fallback, and file-tree building.
 *
 * Reference: AgentBro `src-tauri/src/skills/v2/fsutil.rs`
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// ── Ignored entries ────────────────────────────────────────────────

const IGNORED_NAMES = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  'target',
  '__pycache__',
  '.idea',
  '.venv',
  'venv',
  'output',
])

/** Returns true if the entry name should be ignored during hash/copy/tree. */
export function isIgnoredEntry(name: string): boolean {
  if (IGNORED_NAMES.has(name)) return true
  if (name.endsWith('.tmp') || name.endsWith('.swp')) return true
  return false
}

// ── Home / paths ───────────────────────────────────────────────────

let homeOverride: string | null = null

/**
 * Override the home directory (used by tests to keep scans hermetic).
 * Pass null to restore the real home.
 */
export function setHomeOverride(dir: string | null): void {
  homeOverride = dir
}

export function home(): string {
  return homeOverride ?? os.homedir()
}

export function spacecodeHome(): string {
  return path.join(home(), '.spacecode')
}

export function defaultCenterPath(): string {
  return path.join(spacecodeHome(), 'skills')
}

export function defaultSqlitePath(): string {
  return path.join(spacecodeHome(), 'skill-manager', 'skill-manager.db')
}

export function defaultSnapshotPath(): string {
  return path.join(defaultCenterPath(), 'spacecode-skills.snapshot.json')
}

export function settingsPath(): string {
  return path.join(spacecodeHome(), 'skill-manager', 'settings.json')
}

/** Expand `~/foo` to absolute path. */
export function expandTilde(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(home(), p.slice(2))
  }
  if (p.startsWith('~\\')) {
    return path.join(home(), p.slice(2))
  }
  return p
}

// ── Directory hashing ──────────────────────────────────────────────

/**
 * Stable SHA-256 hash over a directory's files.
 * Hashes relative path + file content, sorted, ignoring noise entries.
 * Returns hex digest.
 */
export function hashDir(dir: string): string {
  return hashDirWithRoot(dir, true)
}

/** Hash only the contents, not the root directory name. */
export function hashDirContents(dir: string): string {
  return hashDirWithRoot(dir, false)
}

function hashDirWithRoot(dir: string, includeRoot: boolean): string {
  const entries: Array<{ abs: string; rel: string }> = []
  collectFiles(dir, dir, entries)
  entries.sort((a, b) => a.rel.localeCompare(b.rel))

  const hasher = crypto.createHash('sha256')
  if (includeRoot) {
    const baseName = path.basename(dir)
    hasher.update(baseName)
  }
  for (const { abs, rel } of entries) {
    hasher.update(rel)
    hasher.update('\0')
    try {
      const bytes = fs.readFileSync(abs)
      hasher.update(bytes)
    } catch {
      hasher.update('<missing>')
    }
    hasher.update('\0')
  }
  return hasher.digest('hex')
}

function collectFiles(root: string, dir: string, out: Array<{ abs: string; rel: string }>): void {
  let rd: fs.Dir
  try {
    rd = fs.opendirSync(dir)
  } catch {
    return
  }
  let entry: fs.Dirent | null
  while ((entry = rd.readSync()) !== null) {
    const name = entry.name
    if (isIgnoredEntry(name)) continue
    const fullPath = path.join(dir, name)
    const isSymlink = entry.isSymbolicLink()
    if (entry.isDirectory()) {
      // Don't follow symlinks into other trees
      if (isSymlink) continue
      collectFiles(root, fullPath, out)
    } else if (entry.isFile()) {
      const rel = path.relative(root, fullPath)
      out.push({ abs: fullPath, rel })
    }
  }
  rd.closeSync()
}

// ── Frontmatter parsing ────────────────────────────────────────────

export interface Frontmatter {
  map: Map<string, string>
}

export function emptyFrontmatter(): Frontmatter {
  return { map: new Map() }
}

/** A directory is a valid skill if it contains a SKILL.md file. */
export function isSkillDir(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, 'SKILL.md')).isFile()
  } catch {
    return false
  }
}

/** Read and parse frontmatter from SKILL.md in the given directory. */
export function readFrontmatter(dir: string): Frontmatter {
  const skillMdPath = path.join(dir, 'SKILL.md')
  let content: string
  try {
    content = fs.readFileSync(skillMdPath, 'utf-8')
  } catch {
    return emptyFrontmatter()
  }
  return { map: parseFrontmatterText(content) }
}

/**
 * Parse YAML frontmatter (lines between `---` delimiters at the top).
 * Simple key: value parser — does not support nested structures.
 */
export function parseFrontmatterText(content: string): Map<string, string> {
  const map = new Map<string, string>()
  const lines = content.split('\n')
  if (lines.length === 0 || lines[0].trim() !== '---') return map

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '---') break
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value = line.slice(colonIdx + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key) map.set(key, value)
  }
  return map
}

/** Resolve a skill id from a directory: prefer frontmatter `name`, else sanitized dir name. */
export function inferSkillId(dir: string): string {
  const fm = readFrontmatter(dir)
  const name = fm.map.get('name')
  if (name && name.trim()) return sanitizeId(name)
  const baseName = path.basename(dir)
  return sanitizeId(baseName)
}

// ── Sanitize ID ────────────────────────────────────────────────────

/** Sanitize a raw string into a safe skill id (alphanumeric, dash, underscore). */
export function sanitizeId(raw: string): string {
  let out = ''
  let prevDash = false
  for (const ch of raw.trim()) {
    if (/[a-zA-Z0-9]/.test(ch) || ch === '-' || ch === '_') {
      out += ch
      prevDash = ch === '-'
    } else if ((ch === ' ' || ch === '.' || ch === '/' || ch === '\\') && !prevDash && out.length > 0) {
      out += '-'
      prevDash = true
    }
  }
  const trimmed = out.replace(/^-+|-+$/g, '')
  return trimmed || 'skill'
}

// ── Recursive copy ─────────────────────────────────────────────────

/** Recursively copy a directory, skipping ignored entries. */
export function copyDirRecursive(src: string, dst: string): void {
  if (!fs.statSync(src).isDirectory()) {
    throw new Error(`Source is not a directory: ${src}`)
  }
  ensureDestinationNotInsideSource(src, dst)
  fs.mkdirSync(dst, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const name = entry.name
    if (isIgnoredEntry(name)) continue
    const from = path.join(src, name)
    const to = path.join(dst, name)
    if (entry.isDirectory()) {
      if (entry.isSymbolicLink()) continue
      copyDirRecursive(from, to)
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to)
    }
  }
}

function ensureDestinationNotInsideSource(src: string, dst: string): void {
  let srcResolved: string
  try {
    srcResolved = fs.realpathSync(src)
  } catch {
    return
  }
  let dstResolved: string
  try {
    dstResolved = fs.realpathSync(dst)
  } catch {
    const parent = path.dirname(dst)
    try {
      const realParent = fs.realpathSync(parent)
      dstResolved = path.join(realParent, path.basename(dst))
    } catch {
      return
    }
  }
  if (dstResolved.startsWith(srcResolved + path.sep)) {
    throw new Error(`Destination ${dst} is inside source ${src}; refusing recursive copy`)
  }
}

// ── Symlink creation with fallback ─────────────────────────────────

export interface CreateLinkResult {
  actualMode: 'link' | 'copy'
  error: string | null
}

/**
 * Attempt to create a symlink. On Windows or when symlink fails,
 * fallback to copy based on the linkFailPolicy.
 */
export function createLink(
  centerPath: string,
  targetPath: string,
  linkFailPolicy: 'ask' | 'copy'
): CreateLinkResult {
  // If target already exists, don't overwrite
  if (pathExists(targetPath)) {
    return { actualMode: 'link', error: 'Target already exists' }
  }

  const parent = path.dirname(targetPath)
  fs.mkdirSync(parent, { recursive: true })

  try {
    fs.symlinkSync(centerPath, targetPath, 'dir')
    return { actualMode: 'link', error: null }
  } catch {
    // Symlink failed (likely Windows EPERM)
    if (linkFailPolicy === 'copy') {
      try {
        copyDirRecursive(centerPath, targetPath)
        return { actualMode: 'copy', error: null }
      } catch (e) {
        return { actualMode: 'copy', error: `Copy fallback failed: ${(e as Error).message}` }
      }
    }
    return { actualMode: 'copy', error: 'Symlink creation failed and policy is "ask"' }
  }
}

// ── Path utilities ─────────────────────────────────────────────────

export function pathExists(p: string): boolean {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}

export function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

/** Remove a file, symlink, or directory tree. */
export function removePath(p: string): void {
  try {
    const stat = fs.lstatSync(p)
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(p)
    } else if (stat.isDirectory()) {
      fs.rmSync(p, { recursive: true, force: true })
    } else {
      fs.unlinkSync(p)
    }
  } catch {
    // Path doesn't exist — nothing to do
  }
}

export type PathKind = 'missing' | 'file' | 'dir' | 'symlink' | 'broken_symlink'

/** Inspect what a path currently points to. */
export function inspectPath(p: string): { kind: PathKind; target: string | null } {
  if (!pathExists(p)) {
    if (isSymlink(p)) return { kind: 'broken_symlink', target: null }
    return { kind: 'missing', target: null }
  }
  if (isSymlink(p)) {
    try {
      const target = fs.readlinkSync(p)
      const resolved = path.isAbsolute(target) ? target : path.join(path.dirname(p), target)
      if (pathExists(resolved)) return { kind: 'symlink', target: resolved }
      return { kind: 'broken_symlink', target: null }
    } catch {
      return { kind: 'broken_symlink', target: null }
    }
  }
  try {
    if (fs.statSync(p).isDirectory()) return { kind: 'dir', target: null }
    return { kind: 'file', target: null }
  } catch {
    return { kind: 'missing', target: null }
  }
}

// ── File tree building ─────────────────────────────────────────────

export interface FileTreeNode {
  name: string
  nodeType: 'dir' | 'file'
  path: string
  children: FileTreeNode[] | null
}

/** Build a depth-bounded file tree for the detail panel. */
export function buildFileTree(root: string, maxDepth: number = 3): FileTreeNode | null {
  return buildNode(root, 0, maxDepth)
}

function buildNode(p: string, depth: number, maxDepth: number): FileTreeNode | null {
  if (depth > maxDepth) return null
  const name = path.basename(p)
  try {
    fs.lstatSync(p)
  } catch {
    return null
  }
  try {
    const stat = fs.statSync(p)
    if (stat.isDirectory()) {
      const children: FileTreeNode[] = []
      const entries = fs.readdirSync(p, { withFileTypes: true })
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (isIgnoredEntry(entry.name)) continue
        const child = buildNode(path.join(p, entry.name), depth + 1, maxDepth)
        if (child) children.push(child)
      }
      return { name, nodeType: 'dir', path: p, children }
    }
    return { name, nodeType: 'file', path: p, children: null }
  } catch {
    return null
  }
}

// ── Time ───────────────────────────────────────────────────────────

export function nowIso(): string {
  return new Date().toISOString()
}
