// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * Python detection for the browser-use bridge. The bridge only runs on a real
 * CPython 3.11+, so a wrong detection shows up to the user as "电脑控制装不上".
 * The order that matters and is pinned below: explicit PYTHON_PATH override →
 * PATH (`python`/`python3`/`py` on Windows, `python3`/`python` elsewhere) →
 * known install locations, and *every* candidate must pass the version gate —
 * an override that points at Python 3.9 has to fall through rather than be
 * trusted.
 */

const probe = vi.hoisted(() => ({
  existing: new Set<string>(),
  dirEntries: new Map<string, string[]>(),
  which: new Map<string, string>(),
  versions: new Map<string, string>(),
  execLog: [] as Array<{ cmd: string; args: string[] }>,
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  execFileSync: (cmd: string, args: string[]) => {
    probe.execLog.push({ cmd, args })
    if (args[0] === '--version') {
      const version = probe.versions.get(cmd)
      if (!version) throw new Error(`${cmd} exited with status 1`)
      return `Python ${version}\n`
    }
    // which / where
    const found = probe.which.get(args[0])
    if (!found) throw Object.assign(new Error(`not found: ${args[0]}`), { status: 1 })
    return found + '\n'
  },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => probe.existing.has(String(p)),
  readFileSync: vi.fn(() => ''),
  readdirSync: (dir: string) => {
    const entries = probe.dirEntries.get(String(dir))
    if (!entries) throw new Error(`ENOENT: ${dir}`)
    return entries
  },
}))

vi.mock('os', () => ({
  homedir: () => path.join(process.cwd(), 'home'),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: (name: string) => path.join(process.cwd(), name),
    resourcesPath: process.cwd(),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: class {
    static getAllWindows = vi.fn(() => [])
  },
}))

vi.mock('../browserUseMcpClient', () => ({
  BrowserUseMcpClient: class {},
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { findPython } from '../browserUseService'

const ORIGINAL_PLATFORM = process.platform
const ENV_KEYS = ['PYTHON_PATH', 'LOCALAPPDATA', 'APPDATA'] as const
const savedEnv: Record<string, string | undefined> = {}

function usePlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  probe.existing.clear()
  probe.dirEntries.clear()
  probe.which.clear()
  probe.versions.clear()
  probe.execLog = []
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('findPython — PYTHON_PATH override', () => {
  it('uses the override when it exists and is new enough', () => {
    usePlatform('linux')
    const custom = path.join(process.cwd(), 'tools', 'python3.12')
    probe.existing.add(custom)
    probe.versions.set(custom, '3.12.1')
    process.env.PYTHON_PATH = custom

    expect(findPython()).toEqual({ path: custom, version: '3.12.1' })
    // No PATH lookup once the override is accepted.
    expect(probe.execLog.filter((c) => c.cmd === 'which' || c.cmd === 'where')).toHaveLength(0)
  })

  it('ignores an override pointing at a path that does not exist', () => {
    usePlatform('linux')
    process.env.PYTHON_PATH = path.join(process.cwd(), 'missing-python')
    const sys = path.join('/usr', 'bin', 'python3')
    probe.which.set('python3', sys)
    probe.existing.add(sys)
    probe.versions.set(sys, '3.11.4')

    expect(findPython()).toEqual({ path: sys, version: '3.11.4' })
  })

  it('rejects an override that is too old instead of running the bridge on it', () => {
    usePlatform('linux')
    const custom = path.join(process.cwd(), 'tools', 'python3.9')
    const sys = path.join('/usr', 'bin', 'python3')
    probe.existing.add(custom)
    probe.versions.set(custom, '3.9.13')
    probe.which.set('python3', sys)
    probe.existing.add(sys)
    probe.versions.set(sys, '3.11.2')
    process.env.PYTHON_PATH = custom

    expect(findPython()).toEqual({ path: sys, version: '3.11.2' })
  })
})

describe('findPython — PATH candidates', () => {
  it('tries python, python3 then py on Windows', () => {
    usePlatform('win32')
    for (const name of ['python', 'python3', 'py']) {
      const target = path.join('C:\\', 'Python', name)
      probe.which.set(name, target)
      probe.existing.add(target)
      probe.versions.set(target, name === 'py' ? '3.13.0' : '3.10.0')
    }

    const result = findPython()
    expect(probe.execLog.filter((c) => c.cmd === 'where').map((c) => c.args[0])).toEqual(['python', 'python3', 'py'])
    // The two first candidates fail the version gate, the third wins.
    expect(result).toEqual({ path: path.join('C:\\', 'Python', 'py'), version: '3.13.0' })
  })

  it('tries python3 before python on posix', () => {
    usePlatform('linux')
    const py3 = path.join('/usr', 'bin', 'python3')
    probe.which.set('python3', py3)
    probe.existing.add(py3)
    probe.versions.set(py3, '3.11.9')

    expect(findPython()).toEqual({ path: py3, version: '3.11.9' })
    expect(probe.execLog.filter((c) => c.cmd === 'which').map((c) => c.args[0])).toEqual(['python3'])
  })

  it('accepts exactly the minimum version', () => {
    usePlatform('linux')
    const py3 = path.join('/usr', 'bin', 'python3')
    probe.which.set('python3', py3)
    probe.existing.add(py3)
    probe.versions.set(py3, '3.11.0')

    expect(findPython()?.version).toBe('3.11.0')
  })

  it('skips a PATH hit whose --version command fails', () => {
    usePlatform('linux')
    const broken = path.join('/opt', 'conda', 'python3')
    const good = path.join('/usr', 'bin', 'python3')
    // python3 resolves to a broken interpreter, python to a working one.
    probe.which.set('python3', broken)
    probe.existing.add(broken)
    probe.which.set('python', good)
    probe.existing.add(good)
    probe.versions.set(good, '3.12.0')

    expect(findPython()).toEqual({ path: good, version: '3.12.0' })
  })

  it('requires the resolved PATH entry to exist on disk', () => {
    usePlatform('linux')
    const ghost = path.join('/usr', 'bin', 'python3')
    probe.which.set('python3', ghost)
    probe.versions.set(ghost, '3.12.0')

    expect(findPython()).toBeNull()
    expect(probe.execLog.some((c) => c.cmd === ghost)).toBe(false)
  })
})

describe('findPython — known install locations', () => {
  it('scans %LOCALAPPDATA%\\Programs\\Python for Python3xx directories on Windows', () => {
    usePlatform('win32')
    const programs = path.join(process.cwd(), 'LocalAppData', 'Programs', 'Python')
    process.env.LOCALAPPDATA = path.join(process.cwd(), 'LocalAppData')
    probe.dirEntries.set(programs, ['Python312', 'Shared', 'Python38'])
    const py312 = path.join(programs, 'Python312', 'python.exe')
    const py38 = path.join(programs, 'Python38', 'python.exe')
    probe.existing.add(py312)
    probe.existing.add(py38)
    probe.versions.set(py312, '3.12.3')
    probe.versions.set(py38, '3.8.10')

    expect(findPython()).toEqual({ path: py312, version: '3.12.3' })
  })

  it('tolerates an unreadable Programs\\Python directory', () => {
    usePlatform('win32')
    process.env.LOCALAPPDATA = path.join(process.cwd(), 'LocalAppData')
    const store = path.join(process.cwd(), 'LocalAppData', 'Microsoft', 'WindowsApps', 'python.exe')
    probe.existing.add(store)
    probe.versions.set(store, '3.11.5')

    // No dirEntries for Programs\Python → readdirSync throws and is swallowed.
    expect(findPython()).toEqual({ path: store, version: '3.11.5' })
  })

  it('checks the mac install locations in order', () => {
    usePlatform('darwin')
    // These candidates are hardcoded posix literals in the source, so the
    // expectation must stay a literal rather than a host path.join.
    const homebrew = '/opt/homebrew/bin/python3'
    probe.existing.add(homebrew)
    probe.versions.set(homebrew, '3.13.1')

    expect(findPython()).toEqual({ path: homebrew, version: '3.13.1' })
  })

  it('falls back to /usr/bin/python3 on linux', () => {
    usePlatform('linux')
    const system = '/usr/bin/python3'
    probe.existing.add(system)
    probe.versions.set(system, '3.11.2')

    expect(findPython()?.path).toBe(system)
  })

  it('returns null when no interpreter anywhere passes the version gate', () => {
    usePlatform('linux')
    probe.existing.add('/usr/bin/python3')
    probe.versions.set('/usr/bin/python3', '3.8.2')

    expect(findPython()).toBeNull()
  })
})
