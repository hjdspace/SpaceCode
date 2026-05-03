const { execSync } = require('child_process')
const { existsSync, mkdirSync, copyFileSync } = require('fs')
const { join, resolve } = require('path')

const binDir = resolve(__dirname, '..', 'engine', 'bin')
const isWin = process.platform === 'win32'
const bunExeName = isWin ? 'bun.exe' : 'bun'
const targetPath = join(binDir, bunExeName)

if (existsSync(targetPath)) {
  console.log(`[copy-bun] ${bunExeName} already exists at ${targetPath}, skipping.`)
  process.exit(0)
}

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
copyFileSync(bunSourcePath, targetPath)
console.log(`[copy-bun] Copied bun from ${bunSourcePath} to ${targetPath}`)
