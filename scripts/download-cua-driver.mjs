/**
 * 预下载 cua-driver 二进制文件到 resources/cua-driver/ 目录。
 *
 * 在构建前运行此脚本，将 cua-driver 二进制预先下载到打包资源目录中，
 * 这样应用安装后无需从 GitHub 下载，大幅提升用户体验。
 *
 * 用法：
 *   node scripts/download-cua-driver.mjs          # 下载当前平台
 *   node scripts/download-cua-driver.mjs --all    # 下载所有平台
 *
 * 环境变量：
 *   CUA_DRIVER_GITHUB_MIRROR  GitHub 镜像地址（如 https://ghfast.top）
 *   CUA_DRIVER_VERSION        指定版本（如 0.5.8），不指定则下载最新
 */
import { existsSync, mkdirSync, createWriteStream, readdirSync, rmSync, renameSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const TARGET_DIR = join(ROOT, 'resources', 'cua-driver')
const GITHUB_API = 'https://api.github.com/repos/trycua/cua/releases'
const MIRROR = process.env.CUA_DRIVER_GITHUB_MIRROR || ''
const FORCE_VERSION = process.env.CUA_DRIVER_VERSION || ''

/** 平台映射 */
function getPlatformTargets() {
  const platform = process.platform
  const arch = process.arch
  const targets = []

  if (platform === 'win32') {
    targets.push({ name: 'cua-driver.exe', target: 'x86_64-pc-windows-msvc', ext: '.zip' })
  } else if (platform === 'darwin') {
    if (arch === 'arm64') {
      targets.push({ name: 'cua-driver', target: 'aarch64-apple-darwin', ext: '.tar.gz' })
    }
    targets.push({ name: 'cua-driver', target: 'x86_64-apple-darwin', ext: '.tar.gz' })
  } else if (platform === 'linux') {
    targets.push({ name: 'cua-driver', target: 'x86_64-unknown-linux-gnu', ext: '.tar.gz' })
  }

  return targets
}

function getAllTargets() {
  return [
    { name: 'cua-driver.exe', target: 'x86_64-pc-windows-msvc', ext: '.zip' },
    { name: 'cua-driver', target: 'aarch64-apple-darwin', ext: '.tar.gz' },
    { name: 'cua-driver', target: 'x86_64-apple-darwin', ext: '.tar.gz' },
    { name: 'cua-driver', target: 'x86_64-unknown-linux-gnu', ext: '.tar.gz' },
  ]
}

/** HTTPS GET with redirect following */
function httpsGet(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'SpaceCode-Build-Script',
        'Accept': 'application/vnd.github+json',
      },
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'))
          return
        }
        const location = res.headers.location
        if (!location) {
          reject(new Error('Redirect without Location header'))
          return
        }
        res.resume()
        httpsGet(location, maxRedirects - 1).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      resolve(res)
    }).on('error', reject)
  })
}

/** Fetch JSON from URL */
async function fetchJson(url) {
  const res = await httpsGet(url)
  const chunks = []
  for await (const chunk of res) {
    chunks.push(chunk)
  }
  const data = Buffer.concat(chunks).toString()
  return JSON.parse(data)
}

/** Download file to disk */
async function downloadFile(url, destPath) {
  const res = await httpsGet(url)
  const file = createWriteStream(destPath)
  return new Promise((resolve, reject) => {
    res.pipe(file)
    file.on('finish', () => {
      file.close()
      resolve()
    })
    file.on('error', (e) => {
      file.close()
      reject(e)
    })
  })
}

function extractZip(zipPath, destDir) {
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`)
}

function extractTarGz(tarPath, destDir) {
  execSync(`tar -xzf "${tarPath}" -C "${destDir}"`)
}

async function findLatestRelease() {
  const url = FORCE_VERSION
    ? `${GITHUB_API}/tags/cua-driver-v${FORCE_VERSION}`
    : `${GITHUB_API}/latest`

  console.log(`  Fetching release info from: ${url}`)
  const release = await fetchJson(url)

  if (!release || !release.assets) {
    if (Array.isArray(release) && release.length > 0) {
      return release[0]
    }
    throw new Error('No release assets found')
  }

  return release
}

function findAsset(release, target, ext) {
  const patterns = [
    `cua-driver-${target}${ext}`,
    `cua-driver-rs-${target}${ext}`,
  ]

  for (const pattern of patterns) {
    const asset = release.assets.find((a) => a.name === pattern)
    if (asset) return asset
  }

  // 模糊匹配
  const fuzzyAsset = release.assets.find((a) =>
    a.name.includes(target) && a.name.endsWith(ext)
  )
  return fuzzyAsset || null
}

function findBinaryInDir(dir, binName) {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    if (entry === binName) {
      return fullPath
    }
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        const found = findBinaryInDir(fullPath, binName)
        if (found) return found
      }
    } catch {
      // ignore
    }
  }
  return null
}

async function downloadForTarget(target, release) {
  const { name: binName, target: targetTriple, ext } = target
  const asset = findAsset(release, targetTriple, ext)

  if (!asset) {
    console.warn(`  ⚠ No asset found for ${targetTriple} (looked for *${ext})`)
    console.warn(`    Available assets: ${release.assets?.map(a => a.name).join(', ') || 'none'}`)
    return false
  }

  const downloadUrl = MIRROR
    ? `${MIRROR}/${asset.browser_download_url.replace('https://', '')}`
    : asset.browser_download_url

  console.log(`  Downloading: ${downloadUrl}`)

  const tmpFile = join(tmpdir(), `cua-driver-${targetTriple}${ext}`)
  await downloadFile(downloadUrl, tmpFile)
  console.log(`  Downloaded (${(asset.size / 1024 / 1024).toFixed(1)} MB)`)

  // 解压到临时目录
  const extractDir = join(TARGET_DIR, `_tmp_${targetTriple}`)
  if (existsSync(extractDir)) {
    rmSync(extractDir, { recursive: true })
  }
  mkdirSync(extractDir, { recursive: true })

  if (ext === '.zip') {
    extractZip(tmpFile, extractDir)
  } else {
    extractTarGz(tmpFile, extractDir)
  }

  // 查找解压后的二进制文件并复制/重命名到目标目录
  const extractedBin = findBinaryInDir(extractDir, binName)
  if (extractedBin) {
    const finalPath = join(TARGET_DIR, binName)
    if (existsSync(finalPath)) {
      rmSync(finalPath)
    }
    renameSync(extractedBin, finalPath)
    console.log(`  ✓ Installed: ${finalPath}`)
  } else {
    console.warn(`  ⚠ Binary ${binName} not found in extracted files`)
    console.warn(`    Extracted contents: ${readdirSync(extractDir).join(', ')}`)
  }

  // 清理临时目录
  if (existsSync(extractDir)) {
    rmSync(extractDir, { recursive: true })
  }

  return true
}

async function main() {
  const downloadAll = process.argv.includes('--all')
  const targets = downloadAll ? getAllTargets() : getPlatformTargets()

  console.log('━'.repeat(60))
  console.log('  cua-driver Binary Pre-Download Script')
  console.log('━'.repeat(60))
  console.log(`  Platform targets: ${targets.map(t => t.target).join(', ')}`)
  if (MIRROR) console.log(`  GitHub mirror: ${MIRROR}`)
  if (FORCE_VERSION) console.log(`  Version: ${FORCE_VERSION}`)
  console.log()

  mkdirSync(TARGET_DIR, { recursive: true })

  const release = await findLatestRelease()
  console.log(`  Latest release: ${release.tag_name || 'unknown'}`)
  console.log(`  Assets: ${release.assets?.length || 0}`)
  console.log()

  let success = 0
  let failed = 0

  for (const target of targets) {
    console.log(`  Processing: ${target.target}`)
    try {
      const ok = await downloadForTarget(target, release)
      if (ok) success++
      else failed++
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`)
      failed++
    }
    console.log()
  }

  console.log('━'.repeat(60))
  console.log(`  Results: ${success} succeeded, ${failed} failed`)
  console.log(`  Output directory: ${TARGET_DIR}`)
  console.log('━'.repeat(60))

  if (failed > 0 && success === 0) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('Fatal error:', e)
  process.exit(1)
})
