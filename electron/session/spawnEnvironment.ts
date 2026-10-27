/**
 * 会话 spawn 前「这台机器上装了些什么」的探测快照。
 *
 * 原先这些探测是 SessionProcess 的私有方法，每次 spawn 都**同步**跑一遍：Windows
 * 上两次 `reg query` 子进程、若干次目录扫描、可能再来一次 `where git`，全部压在
 * Electron 主进程的事件循环上 —— 同一个循环还要负责转发引擎事件与 IPC。抽成独立
 * 模块之后：
 *  - 结果按 TTL 复用，并在主进程启动时预热一次，首条消息不必再等这些子进程；
 *  - `child_process` 在模块顶层 import、同步 `execSync` 换成异步 `execFile`：
 *    既不再阻塞事件循环，测试也能从真正的入口打进去。原先函数体里的
 *    `require('child_process')` 是 mock 不掉的缝，那几个分支因此在测试里只能靠
 *    强制 `process.platform = 'linux'` 绕开。
 *
 * 用 TTL 而不是永久缓存：这套探测存在的意义正是「应用启动之后才装上的工具要能被
 * 看见」（见 refreshWindowsPath 保留下来的原始注释）。永久缓存会让用户装完 Python
 * 必须重启应用才生效；取一个够短的过期时间，会话之间感知不到差别。
 */
import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { debug } from '../infra/logger'

/** 探测一次子进程：stdout 直接给出去，失败由调用方按"这台机器查不到"处理。 */
function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    )
  })
}

/** 机器上装了什么在一分钟内不会变；再长就会推迟"新装工具立即可用"。 */
const PROBE_TTL_MS = 60_000

export interface SpawnEnvironmentSnapshot {
  /**
   * 注册表里的系统 + 用户 PATH、当前进程 PATH、以及未进 PATH 的 Python 安装目录
   * 合并去重后的结果。非 Windows 返回 null（此时引擎直接继承宿主 PATH）。
   */
  path: string | null
  /** Git Bash 的绝对路径；非 Windows 或找不到则为 null。 */
  gitBashPath: string | null
}

let cache: { value: SpawnEnvironmentSnapshot; at: number } | null = null
/** 并发拉起多个会话时共享同一次探测，不要各扫一遍注册表。 */
let inflight: Promise<SpawnEnvironmentSnapshot> | null = null

export function getSpawnEnvironment(): Promise<SpawnEnvironmentSnapshot> {
  if (cache && Date.now() - cache.at < PROBE_TTL_MS) return Promise.resolve(cache.value)
  if (inflight) return inflight
  inflight = probeSpawnEnvironment()
    .then(value => {
      cache = { value, at: Date.now() }
      return value
    })
    .finally(() => { inflight = null })
  return inflight
}

async function probeSpawnEnvironment(): Promise<SpawnEnvironmentSnapshot> {
  if (process.platform !== 'win32') return { path: null, gitBashPath: null }
  // 注册表 PATH 与 Git Bash 互不依赖，并行探测（Git Bash 兜底要起一个 `where`）
  const [mergedPath, gitBashPath] = await Promise.all([refreshWindowsPath(), findGitBashPath()])
  return { path: prependPythonDirs(mergedPath), gitBashPath }
}

/**
 * On Windows, reads the current system and user PATH from the registry.
 *
 * Windows GUI apps inherit PATH from explorer.exe at launch time. If the user
 * installs tools (Python, Node, etc.) after the app was launched, those new
 * PATH entries don't propagate to already-running processes. Reading from the
 * registry ensures we always get the current PATH, making newly-installed
 * tools available to the engine's bash tool.
 *
 * Returns the merged PATH string, or null on non-Windows / failure.
 */
async function refreshWindowsPath(): Promise<string | null> {
  const readRegPath = async (hive: string): Promise<string> => {
    try {
      const stdout = await run('reg', ['query', hive, '/v', 'Path'])
      // Parse output like:
      //   "    Path    REG_EXPAND_SZ    C:\Windows\system32;C:\Windows;..."
      const match = stdout.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/)
      if (!match) return ''
      // Expand environment variables like %SystemRoot% (REG_EXPAND_SZ)
      return match[1].trim().replace(/%([^%]+)%/g, (_, name: string) => process.env[name] || '')
    } catch {
      return ''
    }
  }

  try {
    const [systemPath, userPath] = await Promise.all([
      readRegPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
      readRegPath('HKCU\\Environment'),
    ])
    const existingPath = process.env.PATH || ''

    // Merge: system PATH first, then user PATH, then existing process.env.PATH
    // (existing entries are kept to preserve any custom additions like officecli)
    const allEntries = [
      ...systemPath.split(';'),
      ...userPath.split(';'),
      ...existingPath.split(';'),
    ].filter(Boolean)

    // Deduplicate while preserving order (case-insensitive on Windows)
    const seen = new Set<string>()
    const deduped: string[] = []
    for (const entry of allEntries) {
      const key = entry.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        deduped.push(entry)
      }
    }

    const merged = deduped.join(';')
    if (merged !== existingPath) {
      debug(
        'SpawnEnvironment',
        `Refreshed PATH from Windows registry | originalEntries=${existingPath.split(';').length} | refreshedEntries=${deduped.length}`,
      )
    }
    return merged
  } catch {
    return null
  }
}

/**
 * Detects Python installation directories on Windows that might not be in PATH.
 *
 * This handles cases where:
 * - Python was installed without checking "Add to PATH"
 * - Python is a portable/standalone installation
 * - Python is managed by pyenv-win, conda, etc.
 *
 * Only directories containing python.exe are returned.
 */
function detectPythonPaths(): string[] {
  const found: string[] = []
  const checked = new Set<string>()

  const checkDir = (dir: string): void => {
    if (!dir) return
    const key = dir.toLowerCase()
    if (checked.has(key)) return
    checked.add(key)
    try {
      if (fs.existsSync(path.join(dir, 'python.exe'))) {
        found.push(dir)
      }
    } catch { /* ignore */ }
  }

  // 1. python.org installer: %LOCALAPPDATA%\Programs\Python\Python3XX\
  if (process.env.LOCALAPPDATA) {
    const pythonDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Python')
    try {
      for (const entry of fs.readdirSync(pythonDir)) {
        if (/^Python\d+/i.test(entry)) {
          checkDir(path.join(pythonDir, entry))
        }
      }
    } catch { /* directory doesn't exist */ }
  }

  // 2. Windows Store App Execution Aliases: %LOCALAPPDATA%\Microsoft\WindowsApps\
  if (process.env.LOCALAPPDATA) {
    checkDir(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'))
  }

  // 3. Anaconda / Miniconda
  const condaDirs = [
    path.join(os.homedir(), 'Anaconda3'),
    path.join(os.homedir(), 'anaconda3'),
    path.join(os.homedir(), 'Miniconda3'),
    path.join(os.homedir(), 'miniconda3'),
    'C:\\ProgramData\\Anaconda3',
    'C:\\ProgramData\\miniconda3',
  ]
  for (const dir of condaDirs) {
    checkDir(dir)
  }

  // 4. pyenv-win: %USERPROFILE%\.pyenv\pyenv-win\versions\<version>\
  const pyenvDir = process.env.PYENV || path.join(os.homedir(), '.pyenv', 'pyenv-win')
  try {
    const versionsDir = path.join(pyenvDir, 'versions')
    for (const entry of fs.readdirSync(versionsDir)) {
      checkDir(path.join(versionsDir, entry))
    }
  } catch { /* pyenv-win not installed */ }

  return found
}

/** 把没在 PATH 上的 Python 安装位置前置进去。 */
function prependPythonDirs(currentPath: string | null): string | null {
  const pythonDirs = detectPythonPaths()
  if (pythonDirs.length === 0) return currentPath
  const base = currentPath || process.env.PATH || ''
  const existingEntries = base.split(path.delimiter)
  const newEntries = pythonDirs.filter(p => !existingEntries.some(e => e.toLowerCase() === p.toLowerCase()))
  if (newEntries.length === 0) return currentPath
  debug('SpawnEnvironment', `Detected Python installations not in PATH | dirs=${newEntries.join(';')}`)
  return [...newEntries, ...existingEntries].join(path.delimiter)
}

async function findGitBashPath(): Promise<string | null> {
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH && fs.existsSync(process.env.CLAUDE_CODE_GIT_BASH_PATH)) {
    return process.env.CLAUDE_CODE_GIT_BASH_PATH
  }
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    process.env.ProgramW6432 && path.join(process.env.ProgramW6432, 'Git', 'bin', 'bash.exe'),
  ].filter(Boolean) as string[]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  try {
    const stdout = await run('where', ['git'])
    const gitExe = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0]
    if (gitExe) {
      const bashFromGit = path.join(path.dirname(path.dirname(gitExe)), 'bin', 'bash.exe')
      if (fs.existsSync(bashFromGit)) return bashFromGit
    }
  } catch { /* git not on PATH */ }
  return null
}
