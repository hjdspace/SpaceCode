import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { info, warn } from '../../infra/logger'

/**
 * pi 扩展包入口的解析口径。
 *
 * 每个要 `--extension` 强制加载的扩展都得到同一个答案：打包态只认 extraResources 搬到
 * `resources/pi-extensions` 下的那份，开发态只认 node_modules 里的真实副本，asar 路径一概不算。
 * 这条规则以前在每个引擎里手抄一遍，抄漏一次就出现「可用性说有能力、子进程跑的是另一份」
 * 那种失效 (#52) —— 所以收在这一个函数里。
 */

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
 * 这个路径要交给 pi 子进程去读，所以只认真实文件。不做任何兜底查找：加载不到时
 * 由调用方决定怎么 fail closed，而不是悄悄换一个副本。
 */
export function resolvePiExtensionEntry(
  packageName: string,
  entrySegments: string[],
  tag: string,
): string | null {
  const entryIn = (nodeModulesDir: string): string =>
    path.join(nodeModulesDir, ...packageName.split('/'), ...entrySegments)

  const dirs = app.isPackaged ? [packagedNodeModulesDir()] : devNodeModulesDirs()
  for (const dir of dirs) {
    const entry = entryIn(dir)
    if (fs.existsSync(entry)) {
      info(tag, `Resolved extension entry | ${entry}`)
      return entry
    }
  }
  warn(tag, `Extension entry not found | candidates=${dirs.map(entryIn).join(', ') || '(none)'}`)
  return null
}
