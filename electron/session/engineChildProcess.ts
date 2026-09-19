/**
 * EngineChildProcess — deep module for child process lifecycle management.
 *
 * Interface (small): killTree / extractStderrTail / isProbableBunExecutable / resolveBunPath
 * Implementation (deep): platform-aware process-tree kill, stderr tail buffering,
 *   bun binary discovery with caching, executable validation.
 *
 * Two adapters consume this module:
 *   - SessionProcess (Claude Code engine)
 *   - PiSessionProcess (Pi engine)
 *
 * Design rationale: spawn/stderr/exit/kill/runtime-resolution were duplicated across
 * both adapters with divergent behaviour (kill used taskkill on one side, SIGTERM on
 * the other). This module absorbs that complexity behind a small interface so both
 * adapters share identical, correct semantics.
 */

import { ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { app } from 'electron'
import { info, warn, debug } from './logger'

// ─── Types ──────────────────────────────────────────────────────────────

export interface ExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
  stderrTail: string
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; stdio: ['pipe', 'pipe', 'pipe']; shell?: boolean; windowsHide?: boolean },
) => ChildProcess

// ─── Stderr tail buffer ─────────────────────────────────────────────────

/**
 * Bounded stderr buffer that keeps the last N bytes so we can surface it on exit.
 * Both adapters had their own version; this unifies the behaviour.
 */
export class StderrTailBuffer {
  private buffer = ''
  private readonly maxBytes: number

  constructor(maxBytes = 8 * 1024) {
    this.maxBytes = maxBytes
  }

  append(chunk: string): void {
    this.buffer = (this.buffer + chunk).slice(-this.maxBytes)
  }

  /** Returns the last `maxLines` non-empty lines, joined by newline. */
  tail(maxLines = 5): string {
    return this.buffer
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxLines)
      .join('\n')
  }

  get raw(): string {
    return this.buffer.trim()
  }

  clear(): void {
    this.buffer = ''
  }
}

// ─── Process-tree kill ──────────────────────────────────────────────────

/**
 * Kill a child process and its entire process tree.
 *
 * On Windows: uses `taskkill /F /T /PID` to forcefully terminate the tree.
 *   Falls back to `SIGKILL` if taskkill fails or is unavailable.
 * On Unix: sends `SIGKILL` to the child (the OS cleans up orphans via session/process group).
 *
 * This replaces the divergent kill logic:
 *   - SessionProcess used taskkill /F /T (correct for Windows)
 *   - PiSessionProcess used SIGTERM only (left orphans on Windows)
 */
export function killTree(proc: ChildProcess, logTag: string): void {
  const pid = proc.pid
  if (!pid) return

  info(logTag, `Killing process tree | pid=${pid}`)

  try {
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process')
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 5000 })
        info(logTag, `Process tree killed via taskkill | pid=${pid}`)
        return
      } catch {
        // taskkill failed — fall back to SIGKILL
        warn(logTag, `taskkill failed, falling back to SIGKILL | pid=${pid}`)
      }
    }
    // Unix or taskkill fallback
    proc.kill('SIGKILL')
  } catch {
    // Process may have already exited
  }
}

/**
 * Suspend a process: send SIGTERM (or kill on Windows) and let the caller
 * handle reference cleanup. This is softer than killTree — used for eviction.
 */
export function suspendProcess(proc: ChildProcess): void {
  try {
    proc.kill()
  } catch {
    // already dead
  }
}

// ─── Bun binary resolution (cached) ─────────────────────────────────────

let cachedBunPath: string | null = null
let cachedBunPathForPackagedDesktop: string | null = null
let bunProbeDone = false
let bunProbePackagedDone = false

/**
 * Check if a file exists and looks like a real bun executable (not a placeholder or LFS pointer).
 * Real bun binaries are multi-MB; empty or LFS-pointer files cause spawn ENOENT.
 */
export function isProbableBunExecutable(absPath: string): boolean {
  try {
    const st = fs.statSync(absPath)
    const valid = st.isFile() && st.size >= 256 * 1024
    if (!valid) {
      warn('EngineChildProcess', `isProbableBunExecutable: rejected | path=${absPath} | size=${st.size}`)
    }
    return valid
  } catch {
    return false
  }
}

/**
 * Resolve the path to a usable bun binary for running engine CLIs.
 *
 * Search order:
 *   1. Bundled bun in engine/bin (instant fs check)
 *   2. Platform-specific bundled bun
 *   3. Global bun via `where`/`which` (slower — spawns subprocess; cached after first call)
 *
 * The result is cached for the process lifetime — `where bun` takes ~100ms-5s
 * and only needs to run once. This directly speeds up the first session in packaged mode.
 *
 * @param cliRoot The engine root directory (contains bin/, dist-desktop/, etc.)
 * @param logTag Tag for logging
 * @returns Absolute path to bun, or `'bun'` as PATH fallback
 */
export function resolveBunPath(cliRoot: string, logTag: string): string {
  if (bunProbeDone && cachedBunPath !== null) {
    debug(logTag, `Using cached bun path: ${cachedBunPath}`)
    return cachedBunPath
  }

  const platform = process.platform
  const arch = process.arch
  const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
  const shortTag = logTag.includes('[') ? logTag : logTag

  // 1. Bundled bun
  const bundledBun = path.join(cliRoot, 'bin', bunName)
  if (isProbableBunExecutable(bundledBun)) {
    debug(shortTag, `Using bundled bun: ${bundledBun}`)
    cachedBunPath = bundledBun
    bunProbeDone = true
    return bundledBun
  }

  // 2. Platform-specific bundled bun
  const platformSuffix = platform === 'win32' ? 'windows-x64'
    : platform === 'darwin' ? (arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
    : 'linux-x64'
  const platformSpecificBun = path.join(cliRoot, 'bin', `bun-${platformSuffix}`)
  if (isProbableBunExecutable(platformSpecificBun)) {
    debug(shortTag, `Using platform-specific bun: ${platformSpecificBun}`)
    cachedBunPath = platformSpecificBun
    bunProbeDone = true
    return platformSpecificBun
  }
  if (platform === 'win32') {
    const exe = platformSpecificBun + '.exe'
    if (isProbableBunExecutable(exe)) {
      debug(shortTag, `Using platform-specific bun.exe: ${exe}`)
      cachedBunPath = exe
      bunProbeDone = true
      return exe
    }
  }

  // 3. Global bun (cached after first probe)
  try {
    const { execSync } = require('child_process')
    let globalBun: string | null = null
    if (platform === 'win32') {
      globalBun = execSync('where bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split(/\r\n/)[0]?.trim() || null
    } else {
      globalBun = execSync('which bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split('\n')[0]?.trim() || null
    }
    if (globalBun && isProbableBunExecutable(globalBun)) {
      debug(shortTag, `Using global bun: ${globalBun}`)
      cachedBunPath = globalBun
      bunProbeDone = true
      return globalBun
    }
  } catch {}

  warn(shortTag, 'No bun binary found, falling back to PATH')
  cachedBunPath = 'bun'
  bunProbeDone = true
  return 'bun'
}

/**
 * For dist-desktop: only return bun if the binary looks real;
 * otherwise null so the caller can fall back to Electron-as-Node.
 *
 * Also cached for the process lifetime.
 */
export function resolveBunPathForPackagedDesktop(cliRoot: string, logTag: string): string | null {
  if (bunProbePackagedDone) {
    debug(logTag, `Using cached packaged-desktop bun: ${cachedBunPathForPackagedDesktop ?? '(null — Electron-as-Node)'}`)
    return cachedBunPathForPackagedDesktop
  }

  const platform = process.platform
  const arch = process.arch
  const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
  const shortTag = logTag

  // 1. Bundled bun
  const bundledBun = path.join(cliRoot, 'bin', bunName)
  if (isProbableBunExecutable(bundledBun)) {
    debug(shortTag, `Using bundled bun: ${bundledBun}`)
    cachedBunPathForPackagedDesktop = bundledBun
    bunProbePackagedDone = true
    return bundledBun
  }

  // 2. Platform-specific bundled bun
  const platformSuffix = platform === 'win32' ? 'windows-x64'
    : platform === 'darwin' ? (arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
    : 'linux-x64'
  const platformSpecificBun = path.join(cliRoot, 'bin', `bun-${platformSuffix}`)
  if (isProbableBunExecutable(platformSpecificBun)) {
    debug(shortTag, `Using platform-specific bun: ${platformSpecificBun}`)
    cachedBunPathForPackagedDesktop = platformSpecificBun
    bunProbePackagedDone = true
    return platformSpecificBun
  }
  if (platform === 'win32') {
    const exe = `${platformSpecificBun}.exe`
    if (isProbableBunExecutable(exe)) {
      debug(shortTag, `Using platform-specific bun.exe: ${exe}`)
      cachedBunPathForPackagedDesktop = exe
      bunProbePackagedDone = true
      return exe
    }
  }

  // 3. Global bun
  try {
    const { execSync } = require('child_process')
    let globalBun: string | null = null
    if (platform === 'win32') {
      globalBun = execSync('where bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split(/\r\n/)[0]?.trim() || null
    } else {
      globalBun = execSync('which bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split('\n')[0]?.trim() || null
    }
    if (globalBun && isProbableBunExecutable(globalBun)) {
      debug(shortTag, `Using global bun: ${globalBun}`)
      cachedBunPathForPackagedDesktop = globalBun
      bunProbePackagedDone = true
      return globalBun
    }
  } catch {}

  cachedBunPathForPackagedDesktop = null
  bunProbePackagedDone = true
  return null
}

/**
 * Reset the bun path cache. Intended for testing only.
 */
export function _resetBunCacheForTesting(): void {
  cachedBunPath = null
  cachedBunPathForPackagedDesktop = null
  bunProbeDone = false
  bunProbePackagedDone = false
}

// ─── CLI root resolution ────────────────────────────────────────────────

/**
 * Resolve the engine CLI root directory.
 *
 * In packaged mode: process.resourcesPath/engine
 * In dev mode: __dirname/../engine (relative to dist-electron/)
 */
export function resolveCliRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'engine')
  }
  return path.resolve(__dirname, '../engine')
}
