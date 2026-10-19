const { execSync, spawnSync } = require('child_process')
const { existsSync, mkdirSync, copyFileSync } = require('fs')
const { join, resolve } = require('path')

const binDir = resolve(__dirname, '..', 'engine', 'bin')
const isWin = process.platform === 'win32'
const bunExeName = isWin ? 'bun.exe' : 'bun'
const targetPath = join(binDir, bunExeName)

function versionOf(exe) {
  try {
    const out = spawnSync(exe, ['--version'], { encoding: 'utf-8' }).stdout
    return String(out || '').trim() || null
  } catch {
    return null
  }
}

/** 语义化版本比较，取不到版本号的按最低处理（即倾向于被替换）。 */
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(Number)
  const pb = String(b || '0').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff) return diff
  }
  return 0
}

const force = process.argv.includes('--force')
const currentVersion = existsSync(targetPath) ? versionOf(targetPath) : null

let bunSourcePath = null

if (isWin) {
  try {
    const output = execSync('where bun', { encoding: 'utf-8' }).trim()
    bunSourcePath = output.split(/\r?\n/)[0].trim()
  } catch {}
} else {
  try {
    const output = execSync('which bun', { encoding: 'utf-8' }).trim()
    bunSourcePath = output.split(/\n/)[0].trim()
  } catch {}
}

if (!bunSourcePath || !existsSync(bunSourcePath)) {
  const homeBun = join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.bun',
    'bin',
    bunExeName
  )
  if (existsSync(homeBun)) {
    bunSourcePath = homeBun
  }
}

if (!bunSourcePath || !existsSync(bunSourcePath)) {
  console.warn('[copy-bun] WARNING: bun not found in PATH or ~/.bun/bin.')
  console.warn('[copy-bun] The engine CLI will NOT work in production without bun!')
  process.exit(1)
}

mkdirSync(binDir, { recursive: true })

const sourceVersion = versionOf(bunSourcePath)
// 目标已存在不等于可用：engine/bin/ 是 gitignore 的本地产物，一次拷进旧 bun 就会被之后
// 所有构建沿用；而 build-desktop.ts 用 target:'bun' 且不降级 `using` 等新语法，产物跟随
// 构建机的 bun 版本，旧 bun 跑新产物会当场 SyntaxError。所以只在目标不更旧时才跳过。
if (currentVersion && !force && compareVersions(sourceVersion, currentVersion) <= 0) {
  console.log(`[copy-bun] PATH bun ${sourceVersion || '(unknown)'} is not newer than ${currentVersion}, keeping existing.`)
  console.log(`[copy-bun] 若确认要换，加 --force。产物能否被该 bun 跑起来由 scripts/build-engine-desktop.cjs 把关。`)
  process.exit(0)
}

copyFileSync(bunSourcePath, targetPath)
console.log(`[copy-bun] Copied bun ${sourceVersion || '(unknown)'} (was ${currentVersion || 'none'}) from ${bunSourcePath} to ${targetPath}`)
