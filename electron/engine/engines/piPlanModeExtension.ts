import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { info, warn } from '../../infra/logger'

const TAG = 'PiPlanModeExtension'

/**
 * plan 模式的权限闸扩展。Pi 不内置权限闸（1.3.0 的 docs/security.md 仍写着
 * "does not ask for approval before every tool call"），也没有可以拼的 `--permission-mode`
 * 旗子 —— 能把「界面说 plan、实际照写不误」扭过来的通道，是用 `--extension` 强制加载这个
 * 扩展，再由宿主把它的 RPC 对话框应答掉 (issue #45)。
 */
export const PLAN_MODE_PACKAGE = '@narumitw/pi-plan-mode'

/** 扩展没有启动旗子（README: "There is no startup flag."），进出模式只能发这两条命令。 */
export const PLAN_MODE_ENTER_COMMAND = '/plan start'
export const PLAN_MODE_EXIT_COMMAND = '/plan exit'

/** 包清单 `pi.extensions` 指向的入口；Pi 的 jiti 直接吃 TypeScript。 */
const ENTRY_SEGMENTS = ['dist', 'index.ts']

function extensionEntry(nodeModulesDir: string): string {
  return path.join(nodeModulesDir, ...PLAN_MODE_PACKAGE.split('/'), ...ENTRY_SEGMENTS)
}

/** 打包态的落点：build.extraResources 把扩展闭包搬到 resources/pi-extensions 下 (#45)。 */
function packagedNodeModulesDir(): string {
  return path.join(process.resourcesPath || '', 'pi-extensions', 'node_modules')
}

function devNodeModulesDirs(): string[] {
  const roots = [
    path.resolve(__dirname, '../..'),
    path.resolve(__dirname, '../../..'),
    process.cwd(),
  ]
  try {
    const appPath = app.getAppPath()
    // packaged 时 appPath 指向 asar，子进程读不进去；dev 时它才是项目根
    roots.push(appPath.endsWith('.asar') ? path.dirname(appPath) : appPath)
  } catch {
    // app 还没 ready
  }
  return [...new Set(roots)].map(root => path.join(root, 'node_modules'))
}

/**
 * 解析扩展入口的绝对路径；null = 这台机器上没有可加载的副本。
 *
 * 这个路径要交给 pi 子进程去读，所以只认真实文件：打包态那份由 extraResources 提供，
 * dev 态由 node_modules 提供。asar 里的路径在这里一律不算数 —— 子进程读不到。
 */
export function resolvePlanModeExtensionPath(): string | null {
  const dirs = app.isPackaged ? [packagedNodeModulesDir()] : devNodeModulesDirs()
  for (const dir of dirs) {
    const entry = extensionEntry(dir)
    if (fs.existsSync(entry)) {
      info(TAG, `Resolved plan mode extension | ${entry}`)
      return entry
    }
  }
  warn(TAG, `Plan mode extension not found | candidates=${dirs.map(extensionEntry).join(', ') || '(none)'}`)
  return null
}
