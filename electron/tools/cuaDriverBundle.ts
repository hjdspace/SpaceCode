/**
 * macOS 上 cua-driver 的 CuaDriver.app bundle 解析与落地。
 *
 * 为什么必须有 bundle：TCC（辅助功能 / 屏幕录制）按 CFBundleIdentifier 归属，
 * 且授权算到 responsible process 头上。裸 Mach-O 没有 bundle id，也就无法
 * relaunch 成以自己的身份运行的 daemon，于是驱动查到的永远是「未授权」——
 * 用户在系统设置里给 SpaceCode 打了勾也没用，那不是同一个 TCC client。
 *
 * 为什么必须落在标准目录：`cua-driver mcp` 靠 `open -n -g -a CuaDriver` 拉起
 * daemon，`-a` 是按名字走 LaunchServices 发现的。嵌在 SpaceCode.app 里的
 * bundle 不会被发现，relaunch 会失败，所以只能从内置副本落地到
 * /Applications（回退 ~/Applications）。
 *
 * 本模块只做只读解析 + 一次显式落地；落地不在状态查询里偷偷发生，
 * 只有用户点「安装」时才写 /Applications。
 */
import { app } from 'electron'
import { existsSync, mkdirSync, realpathSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { info, warn } from '../infra/logger'

/** 上游约定的 bundle 名（bundle id com.trycua.driver，与 Swift 版共用，TCC 授权可跨升级保留） */
export const CUA_DRIVER_APP_NAME = 'CuaDriver.app'

/** LaunchServices 会扫描的标准位置里，bundle 所在的父目录 */
function standardAppParents(): string[] {
  return ['/Applications', join(homedir(), 'Applications')]
}

/** 由 .app 目录推出驱动可执行文件路径。appDir 必须以 CuaDriver.app 结尾 */
function appBinaryPath(appDir: string): string {
  return join(appDir, 'Contents', 'MacOS', 'cua-driver')
}

/**
 * 判断一个可执行文件路径是否真的位于某个 CuaDriver.app 内。
 *
 * 先 realpath：`~/.local/bin/cua-driver` 是指向 bundle 内的软链，
 * 直接看字符串会漏判；而指向别处的同名文件不能当成有身份。
 */
export function isInsideCuaDriverApp(candidate: string): boolean {
  let real: string
  try {
    real = realpathSync(candidate)
  } catch {
    return false
  }
  const parts = real.split(/[\\/]/)
  const at = parts.lastIndexOf(CUA_DRIVER_APP_NAME)
  return at >= 0 && parts[at + 1] === 'Contents' && parts[at + 2] === 'MacOS'
}

/**
 * 查找已安装在标准目录里的驱动可执行文件。
 *
 * 返回 null 表示机器上没有可用的 bundle —— 此时不能退回裸二进制去跑 MCP，
 * 那样只会得到一份全红的诊断，调用方应引导用户点「安装」。
 */
export function findInstalledAppBundleBinary(): string | null {
  for (const parent of standardAppParents()) {
    const bin = appBinaryPath(join(parent, CUA_DRIVER_APP_NAME))
    if (existsSync(bin)) return bin
  }

  // 官方安装脚本会在 ~/.local/bin 留一个指向 bundle 内的软链。GUI 启动的
  // Electron 拿不到登录 shell 的 PATH，所以显式补这一条。
  const link = join(homedir(), '.local', 'bin', 'cua-driver')
  if (existsSync(link) && isInsideCuaDriverApp(link)) {
    try {
      return realpathSync(link)
    } catch {
      return null
    }
  }

  return null
}

/** SpaceCode 自带的 CuaDriver.app 源目录（用于落地到标准目录） */
function findBundledAppBundle(): string | null {
  const parents = app.isPackaged
    ? [join(process.resourcesPath, 'cua-driver')]
    : [
        join(__dirname, '..', '..', 'resources', 'cua-driver'),
        join(__dirname, '..', 'cua-driver'),
      ]
  for (const parent of parents) {
    const appDir = join(parent, CUA_DRIVER_APP_NAME)
    if (existsSync(appBinaryPath(appDir))) return appDir
  }
  return null
}

/** execFile 的 Promise 封装 */
function run(cmd: string, args: string[], timeout = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err) => (err ? reject(err) : resolve()))
  })
}

/**
 * 让 LaunchServices 立刻能按名字发现新落地的 bundle。
 *
 * 失败不致命：`open -a CuaDriver` 稍后仍可能通过目录扫描找到它，
 * 而且用户重启一次就一定会被注册上。
 */
async function registerWithLaunchServices(appDir: string): Promise<void> {
  const lsregister = join(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support',
    'lsregister',
  )
  if (!existsSync(lsregister)) return
  try {
    await run(lsregister, ['-f', appDir], 20_000)
  } catch (e) {
    warn('CuaDriverBundle', `lsregister failed for ${appDir}: ${e}`)
  }
}

export interface StageBundleResult {
  ok: boolean
  /** 落地后的驱动可执行文件路径 */
  binaryPath?: string
  /** 落地位置 */
  appDir?: string
  error?: string
}

/**
 * 把内置的 CuaDriver.app 复制到标准安装目录。
 *
 * 只在用户显式点「安装/升级」时调用 —— 这是对系统目录的写操作，
 * 不在只读的状态查询里顺带发生。/Applications 不可写时回退 ~/Applications。
 */
export async function stageAppBundle(): Promise<StageBundleResult> {
  const src = findBundledAppBundle()
  if (!src) {
    return { ok: false, error: 'SpaceCode 内置的 CuaDriver.app 未找到，无法建立驱动身份' }
  }

  const errors: string[] = []
  for (const parent of standardAppParents()) {
    const dest = join(parent, CUA_DRIVER_APP_NAME)
    try {
      mkdirSync(parent, { recursive: true })
      // ditto 而非 cp -R：保留 bundle 的元数据与嵌套软链，保住上游的签名。
      await run('ditto', [src, dest])
      await registerWithLaunchServices(dest)
      const bin = appBinaryPath(dest)
      if (!existsSync(bin)) {
        errors.push(`${dest}: 复制后缺少 Contents/MacOS/cua-driver`)
        continue
      }
      info('CuaDriverBundle', `Staged ${CUA_DRIVER_APP_NAME} to ${dest}`)
      return { ok: true, binaryPath: bin, appDir: dest }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${parent}: ${msg}`)
      warn('CuaDriverBundle', `Failed to stage into ${parent}: ${msg}`)
    }
  }

  return { ok: false, error: `无法安装 CuaDriver.app（${errors.join('; ')}）` }
}
