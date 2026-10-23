import { execFile, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { shell } from 'electron'
import { CliDetectionResult, CliUpdateCheck, CliUpdateState, EnvironmentCheck, EnvItemStatus, InstallProgress } from '../proxy/types'
import { info, warn, debug } from '../infra/logger'

const SCOPE = 'CliDetector'
const isWindows = process.platform === 'win32'
const MIN_CLI_VERSION = '1.0.0'
const CLAUDE_CODE_PKG = '@anthropic-ai/claude-code'
const CLI_OVERVIEW_DOCS = 'https://docs.anthropic.com/en/docs/claude-code/overview'

function execFileAsync(command: string, args: string[] = [], timeout = 15000, forceShell = false): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Windows 上 .cmd/.bat 不是真正的可执行文件，必须通过 shell 解释。
    // 否则 execFile 会直接 ENOENT —— 这就是早先 npx (npx.cmd) 检测假阴性的根因。
    const lower = command.toLowerCase()
    const useShell = forceShell || (isWindows && (lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1')))
    // 走 shell 时路径可能含空格（如 "C:\Program Files\nodejs\npx.cmd"），需要加引号
    // 防止 shell 在空格处拆参数；非 shell 模式 execFile 自己会处理空格。
    const finalCommand = useShell && command.includes(' ') ? `"${command}"` : command
    const options: import('child_process').ExecFileOptions = { timeout, windowsHide: true, shell: useShell }
    execFile(finalCommand, args, options, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout: String(stdout).trim(), stderr: String(stderr).trim() })
    })
  })
}

async function findInPath(cliName: string): Promise<string | null> {
  try {
    const cmd = isWindows ? 'where' : 'which'
    const { stdout } = await execFileAsync(cmd, [cliName], 15000, true)
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    if (!lines.length) return null
    if (isWindows) {
      const cmdFile = lines.find(l => l.toLowerCase().endsWith('.cmd'))
      if (cmdFile) return cmdFile
    }
    return lines[0] || null
  } catch {
    return null
  }
}

/**
 * npm 的真实可执行路径。
 *
 * 必须传**完整路径**而不是裸 `'npm'`：execFileAsync 只在命令串以 .cmd/.bat/.ps1
 * 结尾时才开 shell，而 Windows 的 CreateProcess 不补 PATHEXT —— 裸 `'npm'` 直接
 * `spawn npm ENOENT`，`npm view` / `npm install -g` 全部静默失败（checkEnvItem
 * 早就踩过同一个坑，见那里的注释）。
 *
 * 也不能自己拼 `npm.cmd` 硬塞：Node 对 .cmd/.bat 有 CVE-2024-27980 保护，
 * shell:false 下会**同步抛 EINVAL**，连 Promise 都进不去。走 findInPath 拿到的
 * 全路径会命中 execFileAsync 的 .cmd 分支，由它决定开 shell。
 *
 * 查不到时回退裸名 —— 非 Windows 上 'npm' 本来就能跑，Windows 上至少让错误
 * 留在日志里而不是把功能整个关掉。
 */
let npmCommandPath: string | null = null
async function resolveNpmCommand(): Promise<string> {
  if (npmCommandPath) return npmCommandPath
  const found = await findInPath('npm')
  npmCommandPath = found || 'npm'
  if (!found) warn(SCOPE, 'npm not found on PATH, falling back to the bare command name')
  else debug(SCOPE, 'Resolved npm command', { npmCommandPath })
  return npmCommandPath
}

/**
 * 在 npm 全局安装里定位可执行文件。
 *
 * 包名与 bin 名是两个不同的命名空间：`@anthropic-ai/claude-code` 提供的命令是
 * `claude`。把它们混成一个参数会让 bin 查找永远 miss，并把包目录本身（不可执行）
 * 当成 CLI 返回 —— 版本探测随即失败，UI 显示"已找到"却给了个跑不了的路径。
 * bin 找不到时返回 null，让调用方继续回退到常见 bin 目录扫描，而不是虚报可用。
 */
async function checkNpmGlobal(pkgName: string, binName: string): Promise<string | null> {
  try {
    const { stdout: npmRoot } = await execFileAsync(await resolveNpmCommand(), ['root', '-g'])
    if (!fs.existsSync(path.join(npmRoot, '@anthropic-ai', pkgName))) return null
    if (isWindows) {
      const cmdFile = path.join(npmRoot, `${binName}.cmd`)
      if (fs.existsSync(cmdFile)) return cmdFile
    }
    const binFile = path.join(npmRoot, '.bin', binName)
    if (fs.existsSync(binFile)) return binFile
  } catch {}
  return null
}

function scanCommonPaths(cliName: string): string | null {
  const candidates: string[] = []
  if (isWindows) {
    const appData = process.env.APPDATA
    if (appData) candidates.push(path.join(appData, 'npm', `${cliName}.cmd`))
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) candidates.push(path.join(localAppData, 'npm', `${cliName}.cmd`))
  } else {
    const home = os.homedir()
    candidates.push(path.join(home, '.local', 'bin', cliName))
    candidates.push(path.join('/usr', 'local', 'bin', cliName))
    candidates.push(path.join(home, '.npm-global', 'bin', cliName))
    const npmBinPrefix = process.env.NPM_CONFIG_PREFIX
    if (npmBinPrefix) candidates.push(path.join(npmBinPrefix, 'bin', cliName))
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

async function getVersion(cliPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cliPath, ['--version'])
    const match = stdout.match(/(\d+\.\d+\.\d+)/)
    return match ? match[1] : stdout.split(/\r?\n/)[0] || null
  } catch {
    return null
  }
}

export async function detectInstalledCli(): Promise<CliDetectionResult> {
  debug(SCOPE, 'Starting CLI detection')

  let cliPath = await findInPath('claude')
  debug(SCOPE, 'PATH lookup result', { cliPath })

  if (!cliPath) {
    cliPath = await checkNpmGlobal('claude-code', 'claude')
    debug(SCOPE, 'npm global check result', { cliPath })
  }

  if (!cliPath) {
    cliPath = scanCommonPaths('claude')
    debug(SCOPE, 'Common paths scan result', { cliPath })
  }

  if (!cliPath) {
    info(SCOPE, 'CLI not found')
    return { available: false, path: null, version: null }
  }

  const version = await getVersion(cliPath)
  info(SCOPE, 'CLI detected', { path: cliPath, version })

  const versionCompatible = version ? isVersionGte(version, MIN_CLI_VERSION) : false

  return {
    available: true,
    path: cliPath,
    version,
    versionCompatible,
  }
}

const LATEST_VERSION_TTL_MS = 10 * 60 * 1000
/** 一次成功检查的保鲜期。设置页、导航红点都读这份结论。 */
const UPDATE_STATE_TTL_MS = 12 * 60 * 60 * 1000
/** registry 查询失败后的重试间隔，避免每次打开界面都去打一次不可达的网络。 */
const UPDATE_RETRY_BACKOFF_MS = 5 * 60 * 1000

let latestVersionCache: { version: string; at: number } | null = null
let latestVersionInflight: Promise<string | null> | null = null

interface CliUpdateAttempt {
  result: CliUpdateCheck
  at: number
}

/** 最近一次问过 registry 的结论；null 表示还没成功检查过。 */
let updateState: CliUpdateAttempt | null = null
/** 最近一次尝试（含失败），用于失败退避和「刚查过但没问通」的展示。 */
let lastAttempt: CliUpdateAttempt | null = null
let updateInflight: Promise<CliUpdateCheck> | null = null

export function getCliUpdateState(): CliUpdateState | null {
  if (!updateState) return null
  return {
    result: updateState.result,
    checkedAt: updateState.at,
    stale: Date.now() - updateState.at >= UPDATE_STATE_TTL_MS,
  }
}

/**
 * 安装/更新/切换引擎来源之后调用：本机 CLI 已经变了，旧结论不再成立。
 */
export function invalidateCliUpdateState(): void {
  updateState = null
  lastAttempt = null
}

/**
 * npm 上的最新发布版。
 *
 * 走 `npm view` 而不是直接 fetch registry.npmjs.org：前者尊重用户 `.npmrc` 里的
 * registry / 镜像 / 代理配置，和后面真正执行安装的是同一条链路。用公网地址查会
 * 出现「公网说有新版、公司镜像还没同步」的假阳性，点了更新什么也不会发生。
 *
 * 结果按 TTL 缓存并做 in-flight 去重 —— 设置页每次 mount 都会问一次，registry
 * 查询本身要几百毫秒到几十秒。
 */
async function fetchLatestCliVersion(): Promise<string | null> {
  if (latestVersionCache && Date.now() - latestVersionCache.at < LATEST_VERSION_TTL_MS) {
    return latestVersionCache.version
  }
  if (latestVersionInflight) return latestVersionInflight

  latestVersionInflight = (async () => {
    try {
      const { stdout } = await execFileAsync(await resolveNpmCommand(), ['view', CLAUDE_CODE_PKG, 'version'], 20000)
      const match = stdout.match(/(\d+\.\d+\.\d+)/)
      if (!match) {
        warn(SCOPE, 'npm view returned an unparsable version', { stdout: stdout.slice(0, 120) })
        return null
      }
      latestVersionCache = { version: match[1], at: Date.now() }
      return match[1]
    } catch (err) {
      warn(SCOPE, 'Failed to query latest CLI version', { error: String(err) })
      return null
    } finally {
      latestVersionInflight = null
    }
  })()

  return latestVersionInflight
}

/**
 * 查询更新。
 *
 * 默认命中 12h 缓存；`force: true` 用于用户点「检查更新」和安装/更新后的复核 ——
 * 这两种场景必须重新 spawn `claude --version`，不能拿旧结论糊弄。
 */
export async function checkCliUpdate(options: { force?: boolean } = {}): Promise<CliUpdateCheck> {
  if (!options.force) {
    if (updateState && Date.now() - updateState.at < UPDATE_STATE_TTL_MS) {
      return updateState.result
    }
    if (lastAttempt && Date.now() - lastAttempt.at < UPDATE_RETRY_BACKOFF_MS) {
      return lastAttempt.result
    }
  }
  if (updateInflight) return updateInflight

  const run = (async (): Promise<CliUpdateCheck> => {
    const detection = await detectInstalledCli()
    let result: CliUpdateCheck

    if (!detection.available) {
      result = { installed: false, installedVersion: null, latestVersion: null, hasUpdate: false, unusable: false, checkFailed: false }
    } else if (!detection.version) {
      // PATH 上有 claude 但 --version 跑不出来：这份安装是坏的。此时不必再问
      // registry —— 有没有新版都要重装，而把这一态并进 checkFailed 会让界面
      // 一个按钮都不给，用户只能看着一句「版本过旧」。
      warn(SCOPE, 'CLI found on PATH but it reports no version — installation is broken', { path: detection.path })
      result = { installed: true, installedVersion: null, latestVersion: null, hasUpdate: false, unusable: true, checkFailed: false }
    } else {
      const latest = await fetchLatestCliVersion()
      if (!latest) {
        result = { installed: true, installedVersion: detection.version, latestVersion: null, hasUpdate: false, unusable: false, checkFailed: true }
      } else {
        // 本地比 registry 新（rc / slow 通道）也是「无更新」，不是失败。
        const hasUpdate = latest !== detection.version && isVersionGte(latest, detection.version)
        info(SCOPE, 'CLI update check', { installed: detection.version, latest, hasUpdate })
        result = { installed: true, installedVersion: detection.version, latestVersion: latest, hasUpdate, unusable: false, checkFailed: false }
      }
    }

    const at = Date.now()
    lastAttempt = { result, at }
    // registry 没答上来时不覆盖上一次成功结论：宁可继续展示旧版本，也不要把
    // 「无法检查」写成一个新鲜的「已是最新」。
    if (!result.checkFailed) {
      updateState = { result, at }
    }
    return result
  })()

  updateInflight = run
  try {
    return await run
  } finally {
    if (updateInflight === run) updateInflight = null
  }
}

async function checkEnvItem(name: string, versionArgs: string[] = ['--version']): Promise<EnvItemStatus> {
  try {
    const envPath = await findInPath(name)
    if (!envPath) {
      return { available: false, version: null, path: null }
    }
    // 用 findInPath 返回的**完整路径**（含 .cmd/.bat 后缀）来跑 --version。
    //
    // 原因：Node 的 child_process.execFile 在 Windows 上不识别 PATHEXT —— 它只查
    // 精确文件名。如果传裸命令名（如 'npx'），但 PATH 里只有 'npx.cmd'，会触发
    // ENOENT 落入 catch，UI 就误报"未安装"。execFileAsync 内部已根据
    // command.endsWith('.cmd') 自动启用 shell，只要把完整路径传进去就能命中。
    const { stdout } = await execFileAsync(envPath, versionArgs)
    const version = stdout.split(/\r?\n/)[0] || null
    return { available: true, version, path: envPath }
  } catch {
    return { available: false, version: null, path: null }
  }
}

/**
 * 通用「命令是否可用」检测。返回命令是否存在、版本与路径。
 *
 * 用于 MCP 内置服务器的依赖检测（如 cdp-bridge 依赖 uvx、chrome-devtools
 * 依赖 npx）。复用 findInPath + --version，避免每个调用点各写一套
 * where/which 逻辑。
 */
export async function isCommandAvailable(command: string): Promise<EnvItemStatus> {
  return checkEnvItem(command, ['--version'])
}

export async function checkEnvironment(): Promise<EnvironmentCheck> {
  debug(SCOPE, 'Checking environment prerequisites')

  const [node, npm, git] = await Promise.all([
    checkEnvItem('node'),
    checkEnvItem('npm'),
    checkEnvItem('git'),
  ])

  info(SCOPE, 'Environment check complete', {
    node: node.available ? `${node.version} @ ${node.path}` : 'NOT FOUND',
    npm: npm.available ? `${npm.version} @ ${npm.path}` : 'NOT FOUND',
    git: git.available ? `${git.version} @ ${git.path}` : 'NOT FOUND',
  })

  return { node, npm, git }
}

/**
 * 通过 spawn 跑一个安装命令，把 stdout/stderr 实时桥接到 onProgress。
 *
 * 用 spawn（而不是 execFile）是为了拿到真实流式输出，避免「点了安装、
 * 进度条静默几十秒、突然跳到 80%」的体验。三种来源的 hint：
 *
 * 1. **stdout/stderr 字节抵达** → 至少证明子进程还活着，bumpAlive 让进度往
 *    `ceiling` 方向爬一格，并把最近一行输出作为 message 透传给 UI。
 * 2. **每秒一次心跳** → 即使没有任何输出（winget 一段时间内只画进度条到
 *    同一行），也让进度往前蹭，避免界面假死。
 * 3. **可选的数字解析**：传 percentParser 可以把 winget「14.5 MB / 31.0 MB」
 *    或 brew/curl 的「54.3%」抽出来，按 [floor, ceiling] 区间线性映射。
 *
 * @returns 子进程退出码（>0 时 caller 应当抛错）
 */
function runStreamingInstaller(
  command: string,
  args: string[],
  options: {
    onProgress: (p: InstallProgress) => void
    /** 心跳爬升的下界 */
    floor: number
    /** 上限（无论怎么爬都不超过这个值，给后续 verifying/done 留出空间） */
    ceiling: number
    /** 起始 message */
    initialMessage: string
    /** 可选：从输出行抽出 0-100 的 percent，命中后线性映射到 [floor, ceiling] */
    percentParser?: (line: string) => number | null
    /** 整体超时（默认 5 分钟） */
    timeoutMs?: number
    /** 是否走 shell（brew/winget 都不需要；installWithScript 自己已用 sh -c）*/
    useShell?: boolean
  },
): Promise<{ code: number; stderr: string }> {
  const { onProgress, floor, ceiling, initialMessage, percentParser, timeoutMs = 300000, useShell = false } = options
  return new Promise((resolve, reject) => {
    onProgress({ stage: 'downloading', message: initialMessage, percent: floor })

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
      windowsHide: true,
    })

    // 当前进度状态：交给心跳和数据回调一起更新
    let percent = floor
    let lastMessage = initialMessage
    let stderrBuf = ''
    let settled = false

    /** 把进度往 ceiling 方向爬一小步，但永远不到 ceiling，留出收尾空间 */
    const bumpAlive = () => {
      const remaining = ceiling - percent
      if (remaining <= 1) return
      // 每次走剩余距离的 10%（下界 0.5%），自然减速
      const step = Math.max(0.5, remaining * 0.1)
      percent = Math.min(ceiling - 1, percent + step)
      onProgress({ stage: 'downloading', message: lastMessage, percent: Math.round(percent) })
    }

    const handleChunk = (buf: Buffer | string, isStderr: boolean) => {
      const text = typeof buf === 'string' ? buf : buf.toString('utf8')
      if (isStderr) stderrBuf += text

      // winget 用 CR 在同一行刷进度条；把 \r 当 \n 一起切，取最后一段非空
      const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)
      if (lines.length === 0) {
        bumpAlive()
        return
      }
      lastMessage = lines[lines.length - 1].slice(0, 120)

      // 尝试从最后一行抽出真实百分比
      if (percentParser) {
        for (let i = lines.length - 1; i >= 0; i--) {
          const parsed = percentParser(lines[i])
          if (parsed != null) {
            const mapped = floor + (parsed / 100) * (ceiling - floor)
            if (mapped > percent) percent = Math.min(ceiling - 1, mapped)
            break
          }
        }
      }
      onProgress({ stage: 'downloading', message: lastMessage, percent: Math.round(percent) })
    }

    child.stdout?.on('data', d => handleChunk(d, false))
    child.stderr?.on('data', d => handleChunk(d, true))

    // 心跳：每秒推一步，让 UI 知道还在干活
    const heartbeat = setInterval(bumpAlive, 1000)

    const timeoutTimer = setTimeout(() => {
      if (settled) return
      settled = true
      clearInterval(heartbeat)
      try { child.kill('SIGTERM') } catch {}
      reject(new Error(`Installer timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearInterval(heartbeat)
      clearTimeout(timeoutTimer)
      resolve({ code: code ?? 1, stderr: stderrBuf })
    }

    child.on('close', code => finish(code))
    child.on('error', err => {
      if (settled) return
      settled = true
      clearInterval(heartbeat)
      clearTimeout(timeoutTimer)
      reject(err)
    })
  })
}

/** winget 的「14.5 MB / 31.0 MB」/「54%」解析 */
function parseWingetPercent(line: string): number | null {
  // 优先匹配 "x MB / y MB"
  const sizeMatch = line.match(/([\d.]+)\s*MB\s*\/\s*([\d.]+)\s*MB/i)
  if (sizeMatch) {
    const cur = parseFloat(sizeMatch[1])
    const total = parseFloat(sizeMatch[2])
    if (total > 0) return Math.min(100, (cur / total) * 100)
  }
  // 兜底匹配裸百分比
  const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pctMatch) {
    const p = parseFloat(pctMatch[1])
    if (p >= 0 && p <= 100) return p
  }
  return null
}

/** brew/curl 的 "###...### 100.0%" / "==> Pouring xxx" */
function parseBrewPercent(line: string): number | null {
  const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pctMatch) {
    const p = parseFloat(pctMatch[1])
    if (p >= 0 && p <= 100) return p
  }
  // brew 的阶段提示：Pouring（解压）阶段可视为接近完成
  if (/==>\s*Pouring/i.test(line)) return 90
  if (/==>\s*Installing/i.test(line)) return 85
  return null
}

async function installWithWinget(packageId: string, onProgress: (p: InstallProgress) => void): Promise<void> {
  const result = await runStreamingInstaller(
    'winget',
    ['install', '--id', packageId, '--accept-source-agreements', '--accept-package-agreements', '--silent'],
    {
      onProgress,
      floor: 5,
      ceiling: 80,
      initialMessage: `Downloading ${packageId}...`,
      percentParser: parseWingetPercent,
    },
  )
  if (result.code !== 0) {
    const msg = `winget install failed (exit ${result.code}): ${result.stderr.trim().slice(0, 200) || 'unknown error'}`
    warn(SCOPE, msg)
    throw new Error(msg)
  }
  onProgress({ stage: 'installing', message: `${packageId} installed`, percent: 80 })
}

async function installWithBrew(packageName: string, onProgress: (p: InstallProgress) => void): Promise<void> {
  const result = await runStreamingInstaller(
    'brew',
    ['install', packageName],
    {
      onProgress,
      floor: 5,
      ceiling: 80,
      initialMessage: `Downloading ${packageName}...`,
      percentParser: parseBrewPercent,
    },
  )
  if (result.code !== 0) {
    const msg = `brew install failed (exit ${result.code}): ${result.stderr.trim().slice(0, 200) || 'unknown error'}`
    warn(SCOPE, msg)
    throw new Error(msg)
  }
  onProgress({ stage: 'installing', message: `${packageName} installed`, percent: 80 })
}

async function installMissingDeps(envCheck: EnvironmentCheck, onProgress: (p: InstallProgress) => void): Promise<void> {
  const missing: string[] = []
  if (!envCheck.node.available) missing.push('node')
  if (!envCheck.npm.available) missing.push('npm')
  if (!envCheck.git.available) missing.push('git')

  if (missing.length === 0) return

  debug(SCOPE, 'Installing missing dependencies', { missing })

  if (isWindows) {
    if (!envCheck.node.available || !envCheck.npm.available) {
      await installWithWinget('OpenJS.NodeJS.LTS', onProgress)
    }
    if (!envCheck.git.available) {
      await installWithWinget('Git.Git', onProgress)
    }
  } else {
    if (!envCheck.node.available || !envCheck.npm.available) {
      await installWithBrew('node', onProgress)
    }
    if (!envCheck.git.available) {
      await installWithBrew('git', onProgress)
    }
  }
}

async function installClaudeCodeCli(
  onProgress: (p: InstallProgress) => void,
  pkgSpec: string = CLAUDE_CODE_PKG,
): Promise<void> {
  onProgress({ stage: 'installing', message: `Installing ${pkgSpec}...`, percent: 50 })
  // npm 12 起安装脚本默认被 allow-scripts 策略拦截：npm 退出 0，wrapper 的
  // bin/claude.exe 却还是 500 字节占位脚本，`claude --version` 直接失败。
  // 该选项只对 global / npx 上下文有效（项目的 npm install 传它会报错），
  // 旧版 npm 只当作未知配置告警，postinstall 本来就会跑。
  await execFileAsync(
    await resolveNpmCommand(),
    ['install', '-g', `--allow-scripts=${CLAUDE_CODE_PKG}`, pkgSpec],
    300000,
  )
  onProgress({ stage: 'verifying', message: 'Verifying installation...', percent: 90 })
}

/**
 * 手动执行 wrapper 包自带的 postinstall。
 *
 * 覆盖 `--allow-scripts` 管不到的情况（用户 .npmrc 里 ignore-scripts=true 等）：
 * 原生包此时已经在 node_modules 里，install.cjs 只负责把它放进 bin/。stub 自己
 * 打印的修复说明也是这一步。
 *
 * @returns 脚本输出；无法执行时返回原因。
 */
async function runClaudePostinstall(): Promise<string> {
  try {
    const { stdout: npmRoot } = await execFileAsync(await resolveNpmCommand(), ['root', '-g'])
    const script = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'install.cjs')
    if (!fs.existsSync(script)) {
      warn(SCOPE, 'Claude Code postinstall script not found', { script })
      return `install.cjs not found at ${script}`
    }
    const node = await findInPath('node')
    if (!node) {
      warn(SCOPE, 'Cannot run Claude Code postinstall: node not found on PATH')
      return 'node not found on PATH'
    }
    const { stderr } = await execFileAsync(node, [script], 120000)
    info(SCOPE, 'Ran Claude Code postinstall manually', { script })
    return stderr.trim()
  } catch (err) {
    warn(SCOPE, 'Manual Claude Code postinstall failed', { error: String(err) })
    return String(err)
  }
}

/**
 * 装完后复验。PATH 上有 claude 但 --version 跑不出来，就是 wrapper 装上了、
 * 原生二进制没落位的「假安装」—— npm 脚本被拦截时正是这个状态。
 */
async function detectInstalledCliWithRepair(): Promise<{
  detection: CliDetectionResult
  postinstall: string | null
}> {
  let detection = await detectInstalledCli()
  let postinstall: string | null = null
  if (detection.available && !detection.version) {
    postinstall = await runClaudePostinstall()
    detection = await detectInstalledCli()
  }
  return { detection, postinstall }
}

function brokenCliInstallError(postinstall: string | null): string {
  const detail = postinstall
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop()
  const suffix = detail ? ` (install.cjs: ${detail.slice(0, 200)})` : ''
  return `claude --version still fails — its native binary install step did not complete${suffix}. Run "npm install -g @anthropic-ai/claude-code@latest --allow-scripts=@anthropic-ai/claude-code" in a terminal to see the full error.`
}

function openDownloadPage(missing: string[]): void {
  for (const item of missing) {
    switch (item) {
      case 'node':
      case 'npm':
        shell.openExternal('https://nodejs.org/en/download/')
        break
      case 'git':
        shell.openExternal('https://git-scm.com/downloads')
        break
    }
  }
  shell.openExternal(CLI_OVERVIEW_DOCS)
}

export async function installCli(
  mainWindow: Electron.BrowserWindow | null,
  onProgress: (p: InstallProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  info(SCOPE, 'Starting CLI installation')

  try {
    const envCheck = await checkEnvironment()

    try {
      await installMissingDeps(envCheck, onProgress)
    } catch (depErr) {
      warn(SCOPE, 'Failed to install missing dependencies, opening download pages', { error: String(depErr) })
      const missing: string[] = []
      if (!envCheck.node.available) missing.push('node')
      if (!envCheck.npm.available) missing.push('npm')
      if (!envCheck.git.available) missing.push('git')
      openDownloadPage(missing)
      return { success: false, error: `Failed to install dependencies automatically. Download pages have been opened. ${depErr}` }
    }

    try {
      await installClaudeCodeCli(onProgress)
    } catch (installErr) {
      warn(SCOPE, 'npm install -g failed, opening download page', { error: String(installErr) })
      shell.openExternal(CLI_OVERVIEW_DOCS)
      return { success: false, error: `Failed to install CLI via npm. Download page has been opened. ${installErr}` }
    }

    const { detection, postinstall } = await detectInstalledCliWithRepair()
    if (detection.available && detection.version) {
      onProgress({ stage: 'done', message: 'Claude Code CLI installed successfully', percent: 100 })
      info(SCOPE, 'CLI installed successfully', { path: detection.path, version: detection.version })
      return { success: true }
    }

    if (detection.available) {
      onProgress({ stage: 'error', message: 'Installed but claude --version still fails', percent: 100 })
      warn(SCOPE, 'CLI still unusable after installation', { path: detection.path })
      return { success: false, error: `Installation completed but ${brokenCliInstallError(postinstall)}` }
    }

    onProgress({ stage: 'error', message: 'Installation completed but CLI not detected', percent: 100 })
    warn(SCOPE, 'CLI not detected after installation')
    return { success: false, error: 'Installation completed but CLI not detected in PATH' }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    onProgress({ stage: 'error', message: errMsg, percent: 100 })
    warn(SCOPE, 'Installation failed', { error: errMsg })
    return { success: false, error: errMsg }
  }
}

/**
 * 把已装的 CLI 更到 npm 上的最新发布版。
 *
 * 用 `npm install -g @anthropic-ai/claude-code@latest` 而不是 CLI 自带的
 * `claude update`：PATH 上那个 bin 就是 npm 放下的，npm 直装保证覆盖到的正是
 * 用户实际在跑的那个文件。自带更新器有自己的安装类型 / 发布通道概念
 * （npm-global、npm-local、native），存在「它报更新成功、PATH 上还是旧的」的
 * 分裂风险，而这条链路本来就要有 npm，不额外引入依赖。
 *
 * 装完必须复验版本真的前进了 —— 退出码 0 不代表 PATH 解析到的二进制变了。
 */
export async function updateCli(
  onProgress: (p: InstallProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  const before = await detectInstalledCli()
  if (!before.available) {
    onProgress({ stage: 'error', message: 'Claude Code CLI not detected', percent: 100 })
    warn(SCOPE, 'Update requested but CLI not detected')
    return { success: false, error: 'Claude Code CLI is not installed. Install it first.' }
  }

  // version 为 null 是「装坏了」，而 npm 重装正是修复手段 —— 不能拿它当阻断条件，
  // 否则最需要自救的那台机器上按钮反而点不动。
  const repairing = !before.version
  info(SCOPE, repairing ? 'Starting CLI repair' : 'Starting CLI update', {
    from: before.version,
    path: before.path,
  })

  try {
    await installClaudeCodeCli(onProgress, `${CLAUDE_CODE_PKG}@latest`)
  } catch (err) {
    warn(SCOPE, 'npm install -g @latest failed, opening docs', { error: String(err) })
    shell.openExternal(CLI_OVERVIEW_DOCS)
    return { success: false, error: `Failed to update CLI via npm. Install guide opened. ${err}` }
  }

  const { detection: after, postinstall } = await detectInstalledCliWithRepair()
  if (!after.available || !after.version) {
    onProgress({ stage: 'error', message: 'Reinstalled but claude --version still fails', percent: 100 })
    warn(SCOPE, 'CLI still unusable after update', { available: after.available, version: after.version })
    return {
      success: false,
      error: `npm reinstalled the package but ${brokenCliInstallError(postinstall)}`,
    }
  }

  if (after.version === before.version) {
    onProgress({ stage: 'error', message: `Still running v${before.version}`, percent: 100 })
    warn(SCOPE, 'CLI version did not advance after update', { version: before.version })
    return { success: false, error: `Update finished but the CLI on PATH still reports v${before.version}` }
  }

  onProgress({ stage: 'done', message: `Updated to v${after.version}`, percent: 100 })
  info(SCOPE, repairing ? 'CLI repaired' : 'CLI updated', {
    from: before.version,
    to: after.version,
    path: after.path,
  })
  return { success: true }
}

/**
 * 通过 `curl ... | sh` 形式的安装脚本装一个依赖（Linux 上 uv 的官方安装方式）。
 * 用 spawn 跑 shell，实时 drain stdout/stderr，resolve on close。
 */
async function installWithScript(
  script: string,
  onProgress: (p: InstallProgress) => void,
  label: string,
): Promise<void> {
  // 沿用 runStreamingInstaller 的心跳 + 数据爬升 + 百分比解析，让 curl 管道
  // 装 uv 的过程也有实时反馈（uv 的 install.sh 会输出多行进度信息）。
  const result = await runStreamingInstaller(
    'sh',
    ['-c', script],
    {
      onProgress,
      floor: 5,
      ceiling: 80,
      initialMessage: `Downloading ${label}...`,
      percentParser: parseBrewPercent,
    },
  )
  if (result.code !== 0) {
    throw new Error(`${label} install script exited with code ${result.code}: ${result.stderr.trim().slice(0, 200)}`)
  }
  onProgress({ stage: 'installing', message: `${label} installed`, percent: 80 })
}

const UV_INSTALL_DOCS = 'https://docs.astral.sh/uv/getting-started/installation/'

/**
 * 安装一个 MCP 依赖命令。当前支持 `uv`（提供 uvx）。
 *
 * 平台策略：
 * - Windows: winget install astral-sh.uv
 * - macOS:   brew install uv
 * - Linux:   curl -LsSf https://astral.sh/uv/install.sh | sh
 *
 * 安装后用 isCommandAvailable('uvx') 验证；失败时打开官方文档并返回错误。
 * 全程通过 onProgress 推 InstallProgress（downloading/installing/verifying/done/error）。
 */
export async function installCommand(
  cmd: 'uv',
  onProgress: (p: InstallProgress) => void,
): Promise<{ success: boolean; error?: string }> {
  info(SCOPE, `Starting dependency installation: ${cmd}`)

  try {
    // 注意：不在这里推 percent，否则 installWithWinget/Brew 的 floor=5 会让进度
    // 看起来「先到 10 又回到 5」。把第一帧的责任交给具体安装器，确保单调递增。

    if (isWindows) {
      await installWithWinget('astral-sh.uv', onProgress)
    } else if (process.platform === 'darwin') {
      await installWithBrew('uv', onProgress)
    } else {
      // Linux / 其他 Unix：走官方 install script
      await installWithScript(
        'curl -LsSf https://astral.sh/uv/install.sh | sh',
        onProgress,
        'uv',
      )
    }

    onProgress({ stage: 'verifying', message: 'Verifying installation...', percent: 90 })

    // uv 安装后会提供 uvx 命令；检测 uvx 是否可用
    const uvxStatus = await isCommandAvailable('uvx')
    if (uvxStatus.available) {
      onProgress({ stage: 'done', message: `${cmd} installed successfully`, percent: 100 })
      info(SCOPE, `${cmd} installed successfully`, { version: uvxStatus.version, path: uvxStatus.path })
      return { success: true }
    }

    // 可能 uv 装好了但 uvx 还没进 PATH（新开终端才生效）。再测一次 uv 本身。
    const uvStatus = await isCommandAvailable('uv')
    if (uvStatus.available) {
      onProgress({ stage: 'done', message: `${cmd} installed (restart shell to refresh PATH)`, percent: 100 })
      info(SCOPE, `${cmd} installed but uvx not on PATH yet`, { version: uvStatus.version })
      return { success: true }
    }

    onProgress({ stage: 'error', message: 'Installation completed but uvx not detected', percent: 100 })
    warn(SCOPE, 'uvx not detected after installation')
    return { success: false, error: 'Installation completed but uvx not detected in PATH. You may need to restart your shell.' }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    onProgress({ stage: 'error', message: errMsg, percent: 100 })
    warn(SCOPE, `${cmd} installation failed, opening docs`, { error: errMsg })
    // 自动安装失败时打开官方文档，让用户手动装
    shell.openExternal(UV_INSTALL_DOCS)
    return { success: false, error: `Failed to install ${cmd} automatically. Installation guide opened: ${errMsg}` }
  }
}

function isVersionGte(version: string, minVersion: string): boolean {
  const parse = (v: string) => v.split('.').map(Number)
  const a = parse(version)
  const b = parse(minVersion)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] || 0
    const bi = b[i] || 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return true
}
