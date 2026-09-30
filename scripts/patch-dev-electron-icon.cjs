/**
 * Windows 开发态图标补丁.
 *
 * 为什么需要: Electron 的 Windows toast 后端每弹一次系统通知, 就会向开始菜单写出一个
 * IconLocation 为空的快捷方式, 其图标继承进程 exe (electron.exe) 的 Electron 原子图标,
 * 任务栏组图标随即被它接管. 详见 electron/main.ts 中 setAppUserModelId 上方的机制说明.
 *
 * 给 electron.exe 写入应用图标 + FileDescription 后, 该回退链的每一环都落在正确图标上,
 * 无需在运行时增删改用户的开始菜单文件.
 *
 * 幂等: 以 (Electron 版本, 图标文件指纹) 为标记, 只在变化时重打. 任何失败都只告警不阻断
 * (dev 进程占用 exe 时 rcedit 会失败, 此时图标退回改动前的行为).
 */
const { existsSync, readFileSync, writeFileSync, statSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { execFileSync } = require('node:child_process')

const FILE_DESCRIPTION = 'SpaceCode Dev'
const MARKER_NAME = '.spacecode-dev-icon.json'

const say = (msg) => console.log(`[dev-icon] ${msg}`)
const warn = (msg) => console.warn(`[dev-icon] WARN ${msg}`)

function resolveElectronExe() {
  try {
    const p = require('electron')
    return typeof p === 'string' && existsSync(p) ? p : null
  } catch {
    return null
  }
}

function resolveRcedit() {
  const root = join(__dirname, '..')
  for (const rel of [
    'node_modules/rcedit/bin/rcedit.exe',
    'node_modules/electron-winstaller/vendor/rcedit.exe',
  ]) {
    const p = join(root, rel)
    if (existsSync(p)) return p
  }
  return null
}

/** 标记内容: Electron 版本 + 图标文件指纹. 图标重新生成或 Electron 升级后自动重打. */
function currentFingerprint(iconPath) {
  const stat = statSync(iconPath)
  return {
    electronVersion: require('electron/package.json').version,
    iconSize: stat.size,
    iconMtimeMs: stat.mtimeMs,
  }
}

function isUpToDate(markerPath, fingerprint) {
  try {
    const saved = JSON.parse(readFileSync(markerPath, 'utf-8'))
    return JSON.stringify(saved) === JSON.stringify(fingerprint)
  } catch {
    return false
  }
}

function main() {
  if (process.platform !== 'win32') {
    say('非 Windows, 跳过')
    return
  }

  const exePath = resolveElectronExe()
  if (!exePath) {
    warn('未找到 electron 可执行文件, 跳过 —— 任务栏图标在弹通知后可能显示为 Electron 默认图标')
    return
  }

  const iconPath = join(__dirname, '..', 'icons', 'icon.ico')
  if (!existsSync(iconPath)) {
    warn(`图标文件不存在: ${iconPath} —— 先执行 npm run icons:generate`)
    return
  }

  const markerPath = join(dirname(exePath), MARKER_NAME)
  const fingerprint = currentFingerprint(iconPath)
  if (isUpToDate(markerPath, fingerprint)) {
    say('已是最新, 跳过')
    return
  }

  const rcedit = resolveRcedit()
  if (!rcedit) {
    warn('未找到 rcedit.exe (rcedit 或 electron-winstaller), 跳过')
    return
  }

  try {
    execFileSync(
      rcedit,
      [
        exePath,
        '--set-icon', iconPath,
        '--set-version-string', 'FileDescription', FILE_DESCRIPTION,
      ],
      { stdio: 'pipe' }
    )
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    warn(`打补丁失败: ${detail}`)
    warn('若提示文件被占用，请先关闭正在运行的 dev 实例，再执行 npm run patch:dev-electron')
    return
  }

  writeFileSync(markerPath, JSON.stringify(fingerprint, null, 2))
  say(`已为 ${exePath} 写入图标与 FileDescription="${FILE_DESCRIPTION}"`)
}

main()
