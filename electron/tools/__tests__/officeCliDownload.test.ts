// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { Readable } from 'stream'

/**
 * The in-app "download OfficeCLI" button.
 *
 * It used to answer "already installed" whenever ~/.officecli/bin held any
 * runnable binary, so the button could never upgrade a stale copy. Release
 * freshness is now what gates the download.
 */

const runtime = vi.hoisted(() => ({
  appPath: '',
  files: new Set<string>(),
  versions: new Map<string, string>(),
  latestRelease: null as unknown,
  writeStreams: [] as string[],
  progress: [] as Array<{ stage: string; message: string; percent: number }>,
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
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: (_ch: string, p: never) => runtime.progress.push(p) } }] },
}))

const norm = (p: string) => p.replace(/\\/g, '/')

vi.mock('fs', () => ({
  existsSync: (p: string) => runtime.files.has(norm(p)),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  renameSync: vi.fn(),
  chmodSync: vi.fn(),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  createWriteStream: (p: string) => {
    runtime.writeStreams.push(norm(p))
    return { on: vi.fn(), write: vi.fn(), end: vi.fn(), destroy: vi.fn(), once: vi.fn() }
  },
}))

vi.mock('https', () => ({
  get: (url: string, _options: unknown, cb: (res: unknown) => void) => {
    const body = norm(String(url)).includes('/releases/latest')
      ? JSON.stringify(runtime.latestRelease)
      : JSON.stringify({ message: 'unexpected url' })
    const res = Readable.from([Buffer.from(body)]) as Readable & { statusCode: number }
    res.statusCode = 200
    setImmediate(() => cb(res))
    return { on: vi.fn() }
  },
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { downloadOfficeCliBinary, getOfficeCliInstalledBinary } from '../officeCliService'

const INSTALLED = norm(getOfficeCliInstalledBinary())

function release(tag: string, assetNames: string[] = []): void {
  runtime.latestRelease = {
    tag_name: tag,
    html_url: 'https://github.com/iOfficeAI/OfficeCLI/releases',
    assets: assetNames.map((name) => ({ name, size: 1, browser_download_url: 'https://example.invalid/x' })),
  }
}

beforeEach(() => {
  runtime.appPath = path.join(process.cwd(), 'app')
  runtime.files.clear()
  runtime.versions.clear()
  runtime.writeStreams.length = 0
  runtime.progress.length = 0
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

describe('downloadOfficeCliBinary', () => {
  it('returns the existing copy without downloading when it already matches the release', async () => {
    runtime.files.add(INSTALLED)
    runtime.versions.set(INSTALLED, '1.0.157')
    release('v1.0.157')

    await expect(downloadOfficeCliBinary()).resolves.toBe(getOfficeCliInstalledBinary())

    expect(runtime.writeStreams).toEqual([])
    expect(runtime.progress[runtime.progress.length - 1]).toMatchObject({ stage: 'done', message: '1.0.157' })
  })

  it('keeps going when the copy is behind the release', async () => {
    // The old short-circuit read "any working binary" as done. Making it stop
    // claiming that is the whole point, and the run reaching the asset lookup
    // (which then fails on the stub release) proves the gate moved.
    runtime.files.add(INSTALLED)
    runtime.versions.set(INSTALLED, '1.0.149')
    release('v1.0.157')

    await expect(downloadOfficeCliBinary()).rejects.toThrow(/No matching asset/)

    expect(runtime.writeStreams).toEqual([])
    expect(runtime.progress[runtime.progress.length - 1]).toMatchObject({ stage: 'fetching' })
  })

  it('downloads when the user copy exists but reports no version', async () => {
    runtime.files.add(INSTALLED)
    release('v1.0.157')

    await expect(downloadOfficeCliBinary()).rejects.toThrow(/No matching asset/)
  })
})
