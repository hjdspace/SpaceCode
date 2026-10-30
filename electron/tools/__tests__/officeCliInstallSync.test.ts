// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'os'
import * as path from 'path'

/**
 * ~/.officecli/bin is what the agent's Bash tool actually runs (sessionProcess
 * prepends it to PATH). It was only ever written when absent, so an app update
 * that shipped a newer bundled binary left the user copy pinned at the version
 * from first launch — forever. These tests pin the refresh rule: bundled wins
 * when it is strictly newer, and nothing is rewritten when it isn't.
 */

const runtime = vi.hoisted(() => ({
  appPath: '',
  files: new Set<string>(),
  versions: new Map<string, string>(),
  copies: [] as Array<{ from: string; to: string }>,
  mkdirs: [] as string[],
  copyThrows: false,
}))

const cp = vi.hoisted(() => ({ execFile: vi.fn(), spawnSync: vi.fn(), spawn: vi.fn() }))

vi.mock('child_process', () => ({ execFile: cp.execFile, spawnSync: cp.spawnSync, spawn: cp.spawn }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => runtime.appPath,
    getPath: (name: string) => path.join(os.homedir(), name),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: class {},
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => runtime.files.has(norm(p)),
  mkdirSync: (p: string) => { runtime.mkdirs.push(norm(p)) },
  copyFileSync: (from: string, to: string) => {
    if (runtime.copyThrows) throw new Error('EPERM: operation not permitted')
    runtime.copies.push({ from: norm(from), to: norm(to) })
    runtime.files.add(norm(to))
  },
  // readOfficeCliVersion 按 (size, mtime) 复用 `--version` 的结论。这里让指纹
  // 完全由"这个二进制报的版本"推导：版本变了就等于文件被换过，缓存必须失效 ——
  // 否则测试会在跨用例之间泄漏上一个版本。
  statSync: (p: string) => {
    const key = norm(p)
    if (!runtime.files.has(key)) throw new Error('ENOENT')
    const version = runtime.versions.get(key) ?? ''
    let hash = 5381
    for (let i = 0; i < version.length; i++) hash = (hash * 33 + version.charCodeAt(i)) | 0
    return { size: version.length, mtimeMs: Math.abs(hash) }
  },
  chmodSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
  createWriteStream: vi.fn(),
  promises: {
    mkdir: vi.fn(async (p: string) => { runtime.mkdirs.push(norm(p)) }),
    copyFile: vi.fn(async (from: string, to: string) => {
      if (runtime.copyThrows) throw new Error('EPERM: operation not permitted')
      runtime.copies.push({ from: norm(from), to: norm(to) })
      runtime.files.add(norm(to))
    }),
    chmod: vi.fn(async () => {}),
  },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const norm = (p: string) => p.replace(/\\/g, '/')

import {
  getOfficeCliBinaryPath,
  getOfficeCliInstalledBinary,
  syncInstalledOfficeCli,
} from '../officeCliService'

const ORIGINAL_PLATFORM = process.platform

function usePlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

/** Wire the bundled binary + the user copy and what each reports for `--version`. */
function setup(opts: {
  hasBundled?: boolean
  hasInstalled?: boolean
  bundledVersion?: string
  installedVersion?: string
}): void {
  const hasBundled = opts.hasBundled !== false
  const hasInstalled = opts.hasInstalled !== false
  const bundled = norm(getOfficeCliBinaryPath())
  const installed = norm(getOfficeCliInstalledBinary())
  if (hasBundled) runtime.files.add(bundled)
  if (hasInstalled) runtime.files.add(installed)
  if (opts.bundledVersion) runtime.versions.set(bundled, opts.bundledVersion)
  if (opts.installedVersion) runtime.versions.set(installed, opts.installedVersion)
}

beforeEach(() => {
  runtime.appPath = path.join(process.cwd(), 'app')
  usePlatform('linux')
  cp.execFile.mockImplementation((
    cmd: string,
    _args: string[],
    _options: object,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const version = runtime.versions.get(norm(String(cmd)))
    if (version) callback(null, version, '')
    else callback(new Error('version probe failed'), '', '')
  })
})

afterEach(() => {
  usePlatform(ORIGINAL_PLATFORM)
  runtime.files.clear()
  runtime.versions.clear()
  runtime.copies.length = 0
  runtime.mkdirs.length = 0
  runtime.copyThrows = false
})

describe('syncInstalledOfficeCli', async () => {
  it('copies the bundled binary into ~/.officecli/bin when the user copy is missing', async () => {
    setup({ hasInstalled: false, bundledVersion: '1.0.157' })

    const result = await syncInstalledOfficeCli()

    expect(result).toMatchObject({ copied: true, reason: 'missing', bundledVersion: '1.0.157' })
    expect(runtime.copies).toEqual([
      { from: norm(getOfficeCliBinaryPath()), to: norm(getOfficeCliInstalledBinary()) },
    ])
  })

  it('overwrites the user copy when the bundled binary is newer', async () => {
    // The defect this file exists for: 1.0.149 sat in ~/.officecli/bin long after
    // the app shipped 1.0.157, because "file exists" was the only condition.
    setup({ bundledVersion: '1.0.157', installedVersion: '1.0.149' })

    const result = await syncInstalledOfficeCli()

    expect(result).toMatchObject({ copied: true, reason: 'outdated', installedVersion: '1.0.149' })
    expect(runtime.copies).toHaveLength(1)
  })

  it('leaves the user copy alone when it already matches the bundled version', async () => {
    setup({ bundledVersion: '1.0.157', installedVersion: '1.0.157' })

    const result = await syncInstalledOfficeCli()

    expect(result).toMatchObject({ copied: false, reason: 'up-to-date' })
    expect(runtime.copies).toEqual([])
  })

  it('never downgrades a user-installed binary that is newer than the bundle', async () => {
    setup({ bundledVersion: '1.0.157', installedVersion: '1.0.160' })

    const result = await syncInstalledOfficeCli()

    expect(result).toMatchObject({ copied: false, reason: 'up-to-date' })
    expect(runtime.copies).toEqual([])
  })

  it('compares the numeric parts, not the strings (1.0.9 vs 1.0.10)', async () => {
    setup({ bundledVersion: '1.0.10', installedVersion: '1.0.9' })

    const result = await syncInstalledOfficeCli()

    expect(result.reason).toBe('outdated')
    expect(runtime.copies).toHaveLength(1)
  })

  it('does nothing when the app carries no bundled binary', async () => {
    setup({ hasBundled: false, installedVersion: '1.0.149' })

    const result = await syncInstalledOfficeCli()

    expect(result).toMatchObject({ copied: false, reason: 'no-bundle' })
    expect(runtime.copies).toEqual([])
    expect(cp.spawnSync).not.toHaveBeenCalled()
  })

  it('refuses to rewrite either binary when a version cannot be read', async () => {
    // A flaky `--version` must not turn into a 33MB overwrite on every session start.
    setup({ bundledVersion: '1.0.157' })

    const result = await syncInstalledOfficeCli()

    expect(result).toMatchObject({ copied: false, reason: 'unknown-version', installedVersion: null })
    expect(runtime.copies).toEqual([])
  })

  it('creates the install directory before copying on a first run', async () => {
    setup({ hasInstalled: false, bundledVersion: '1.0.157' })

    await syncInstalledOfficeCli()

    expect(runtime.mkdirs).toContain(norm(path.join(os.homedir(), '.officecli', 'bin')))
  })

  it('keeps the .exe suffix when syncing on Windows', async () => {
    usePlatform('win32')
    setup({ hasInstalled: false, bundledVersion: '1.0.157' })

    await syncInstalledOfficeCli()

    expect(path.basename(runtime.copies[0].to)).toBe('officecli.exe')
  })

  it('reports a failed copy instead of throwing into the session spawn path', async () => {
    runtime.copyThrows = true
    setup({ bundledVersion: '1.0.157', installedVersion: '1.0.149' })

    const result = await syncInstalledOfficeCli()

    expect(result).toMatchObject({ copied: false, reason: 'copy-failed' })
  })

  it('reuses both version probes across session starts while neither binary changed', async () => {
    // syncInstalledOfficeCli 跑在每次会话 spawn 前的临界路径上，而它每次都要起
    // 两个 `--version` 子进程（Windows 上还叠加 AV 扫描）。文件没变就不该再问第二遍。
    // 版本取一个本文件没用过的：指纹由内容推导，撞上前面用例的缓存会让这个断言空转。
    setup({ bundledVersion: '2.0.1', installedVersion: '2.0.1' })

    const before = cp.execFile.mock.calls.length
    await syncInstalledOfficeCli()
    const afterFirst = cp.execFile.mock.calls.length
    const second = await syncInstalledOfficeCli()

    expect(afterFirst - before).toBe(2)
    expect(cp.execFile.mock.calls.length).toBe(afterFirst)
    expect(second).toMatchObject({ copied: false, reason: 'up-to-date' })
  })

  it('re-reads the user copy when it is replaced out-of-band, so a newer binary is never downgraded', async () => {
    // 缓存按文件指纹而不是"读过一次就定论"。用户在自己终端里跑了 `officecli install`
    // 把 ~/.officecli/bin 换成更新版本后，下一次会话必须看得见 —— 拿旧结论会比成
    // "bundled 更新"而把用户刚装好的二进制覆盖回去。
    setup({ bundledVersion: '1.0.157', installedVersion: '1.0.149' })
    await syncInstalledOfficeCli()

    const installed = norm(getOfficeCliInstalledBinary())
    runtime.versions.set(installed, '1.0.160')
    runtime.copies.length = 0

    const result = await syncInstalledOfficeCli()

    expect(result).toMatchObject({ copied: false, reason: 'up-to-date', installedVersion: '1.0.160' })
    expect(runtime.copies).toEqual([])
  })

  it('shares one in-flight sync between startup and session creation', async () => {
    setup({ bundledVersion: '1.0.157', installedVersion: '1.0.149' })
    const installed = norm(getOfficeCliInstalledBinary())
    let finishInstalledProbe: (() => void) | undefined
    cp.execFile.mockImplementation((
      cmd: string,
      _args: string[],
      _options: object,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const version = runtime.versions.get(norm(String(cmd))) ?? ''
      if (norm(String(cmd)) === installed) {
        finishInstalledProbe = () => callback(null, version, '')
      } else {
        callback(null, version, '')
      }
    })

    const startupSync = syncInstalledOfficeCli()
    const sessionSync = syncInstalledOfficeCli()

    expect(startupSync).toBe(sessionSync)
    finishInstalledProbe?.()
    const [startupResult, sessionResult] = await Promise.all([startupSync, sessionSync])
    expect(startupResult).toEqual(sessionResult)
    expect(runtime.copies).toHaveLength(1)
  })
})
