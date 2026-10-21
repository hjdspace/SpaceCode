import * as fs from 'fs'
import * as path from 'path'
import { execSync, execFileSync } from 'child_process'
import { app } from 'electron'
import type { EngineUnavailableReason } from './types'
import { info, warn } from '../../infra/logger'

const TAG = 'PiCliResolver'

export const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent'

/**
 * 宿主侧要求的引擎下限，取以下各项的最大值：
 * - 宿主的 wire 契约：PiEventMapper 只理解 toolcall delta 顶层带 id/toolName 的 1.x 形状；
 * - @tintinweb/pi-subagents 的 peer 下限 >=1.1.0 —— 选了 agent 就会强制加载它 (#46)；
 * - @narumitw/pi-plan-mode 的文档要求 >=0.80.6（被前一项覆盖）。
 *
 * 这个常量是界面可用性、spawn 目标与会话报错的唯一口径 (#52)；调整前先看
 * piVersionFloor.test.ts 的不变量，别让它低于随产物分发的扩展所声明的下限。
 */
export const MIN_PI_VERSION = '1.1.0'

export type PiCliSource = 'bundled' | 'dev' | 'installed'

export interface PiCliInfo {
  /** 可直接 spawn 的入口：脚本绝对路径，或裸命令 `pi`；null = 没有可执行的副本 */
  entry: string | null
  source: PiCliSource | null
  version: string | null
  available: boolean
  reason: EngineUnavailableReason
}

interface Candidate {
  entry: string
  source: PiCliSource
  /** 入口所属 pi 包根；读它的 package.json 拿版本。全局命令没有，只能探针。 */
  packageDir: string | null
}

const probedVersions = new Map<string, string | null>()

/** 全局 `pi` 的探针结果按入口缓存（同一个进程里起 N 个会话只问一次版本）。清缓存目前只给测试用。 */
export function resetPiCliProbeCache(): void {
  probedVersions.clear()
}

/**
 * 把解析到的入口包成「终端里能直接敲」的命令，供侧栏的「打开 pi CLI」用。
 *
 * 只在这里写一份 spawn 口径：bundled / dev 的入口是脚本，得借宿主 runtime 跑
 * （与 PiSessionProcess 起子进程同一个 ELECTRON_RUN_AS_NODE 约定）。解析不到就回 null，
 * 让调用方什么都不起 —— 以前这条链末端是 `npx @earendil-works/pi-coding-agent`，
 * 等于在终端里再拉一个版本没人管的引擎 (#52)。
 */
export function piShellCommand(cli: PiCliInfo = detectPiCli()): string | null {
  if (!cli.entry) return null
  if (cli.source === 'installed') return cli.entry
  const exe = process.execPath
  return process.platform === 'win32'
    ? `set ELECTRON_RUN_AS_NODE=1&& "${exe}" "${cli.entry}"`
    : `ELECTRON_RUN_AS_NODE=1 "${exe}" "${cli.entry}"`
}

/**
 * 打包态唯一认可的副本：electron-builder 用 extraResources 把 pi 的 package.json 与
 * 自包含的 dist/bundle 搬到 resources/pi。bundle 里零裸依赖 import，子进程不需要读
 * node_modules 闭包 —— 这是把 bundled 路径放进 asar 再 unpack 那套做法学不到的东西。
 *
 * package.json 必须一起搬：pi 启动时向上走目录找它来定 VERSION，光拷 bundle 会读到
 * 宿主的 package.json，报出一个根本不存在的引擎版本。
 */
function packagedCandidates(): Candidate[] {
  const packageDir = path.join(process.resourcesPath || '', 'pi')
  return [
    {
      entry: path.join(packageDir, 'dist', 'bundle', 'cli.js'),
      source: 'bundled',
      packageDir,
    },
  ]
}

function devCandidates(): Candidate[] {
  const fromPackageRoot = (packageDir: string): Candidate => ({
    entry: path.join(packageDir, 'dist', 'cli.js'),
    source: 'dev',
    packageDir,
  })
  const packageDirOf = (root: string): string => path.join(root, 'node_modules', PI_PACKAGE_NAME)
  const candidates: Candidate[] = [
    fromPackageRoot(packageDirOf(path.resolve(__dirname, '../..'))),
    fromPackageRoot(packageDirOf(path.resolve(__dirname, '../../..'))),
  ]

  try {
    const appPath = app.getAppPath()
    // packaged 时 appPath 指向 asar，子进程读不进去；dev 时它才是项目根
    const appRoot = appPath.endsWith('.asar') ? path.dirname(appPath) : appPath
    candidates.push(fromPackageRoot(packageDirOf(appRoot)))
    candidates.push({
      entry: path.join(appRoot, 'pi-engine', 'packages', 'coding-agent', 'dist', 'cli.js'),
      source: 'dev',
      packageDir: path.join(appRoot, 'pi-engine', 'packages', 'coding-agent'),
    })
  } catch {
    // app might not be ready
  }

  candidates.push(fromPackageRoot(packageDirOf(process.cwd())))
  return candidates
}

/** `where`/`which` 会列出过期条目，所以命中的路径还得真的在盘上才算数。 */
function globalCandidate(): Candidate | null {
  try {
    const cmd = process.platform === 'win32' ? 'where pi' : 'which pi'
    const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim()
    const piPath = output.split(/\r?\n/)[0]?.trim()
    if (piPath && fs.existsSync(piPath)) {
      return { entry: 'pi', source: 'installed', packageDir: null }
    }
  } catch {
    // pi not available globally
  }
  return null
}

function readPackageJsonVersion(candidate: Candidate): string | null {
  if (!candidate.packageDir) return null
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(candidate.packageDir, 'package.json'), 'utf-8')) as { version?: unknown }
    return typeof manifest.version === 'string' && manifest.version ? manifest.version : null
  } catch {
    return null
  }
}

/** 全局 `pi` 没有可读的包清单，只能问它自己是谁 —— 问不出来就算无从核验。 */
function probeInstalledVersion(command: string): string | null {
  if (probedVersions.has(command)) return probedVersions.get(command) ?? null

  let version: string | null = null
  try {
    const output = execFileSync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    version = output.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null
  } catch (err) {
    warn(TAG, `pi --version probe failed | command=${command} | error=${err instanceof Error ? err.message : String(err)}`)
  }

  probedVersions.set(command, version)
  return version
}

function readVersion(candidate: Candidate): string | null {
  return candidate.source === 'installed'
    ? probeInstalledVersion(candidate.entry)
    : readPackageJsonVersion(candidate)
}

/** 'v' / '=' 前缀与 `-beta.1` 这类预发布后缀都不参与下限比较，只取数字核心。 */
function parseVersion(value: string): number[] | null {
  const parts = value.replace(/^[v=]/, '').split('-')[0].split('.').map(Number)
  return parts.every((n) => !Number.isNaN(n)) ? parts : null
}

export function isVersionGte(version: string, floor: string): boolean {
  const a = parseVersion(version)
  const b = parseVersion(floor)
  if (!a || !b) return false

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai > bi) return true
    if (ai < bi) return false
  }
  return true
}

function firstExisting(candidates: Candidate[]): Candidate | undefined {
  return candidates.find((c) => {
    try {
      return fs.existsSync(c.entry)
    } catch {
      return false
    }
  })
}

/**
 * 解析「这次真正该 spawn 哪个 pi，以及它是什么版本」。
 *
 * 取第一个在盘的候选，然后按它的版本定罪，而不是跳过它去凑一个能用的 —— 可用性判定
 * 与 spawn 目标必须是同一个东西，否则界面说「可用」而进程起的是另一个引擎。
 * 打包态候选只有 resources/pi 那一份：用户全局装的版本一概不理。
 */
export function detectPiCli(): PiCliInfo {
  const found = app.isPackaged
    ? firstExisting(packagedCandidates())
    // 全局查找要起子进程，只在盘上的候选全落空时才做
    : firstExisting(devCandidates()) ?? globalCandidate()
  if (!found) {
    warn(TAG, `No pi CLI found | packaged=${app.isPackaged} | resourcesPath=${process.resourcesPath || '(unset)'}`)
    return { entry: null, source: null, version: null, available: false, reason: 'not-found' }
  }

  const version = readVersion(found)
  let reason: EngineUnavailableReason
  if (!version || !parseVersion(version)) {
    reason = 'version-unknown'
  } else if (!isVersionGte(version, MIN_PI_VERSION)) {
    reason = 'version-too-old'
  } else {
    reason = 'ok'
  }
  const available = reason === 'ok'

  info(TAG, `Resolved | entry=${found.entry} | source=${found.source} | version=${version ?? '(unknown)'} | available=${available} | reason=${reason}`)

  return { entry: found.entry, source: found.source, version, available, reason }
}
