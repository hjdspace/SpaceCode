/**
 * 预下载 cua-driver 二进制文件到 resources/cua-driver/ 目录。
 *
 * 在构建前运行此脚本，将 cua-driver 二进制预先下载到打包资源目录中，
 * 这样应用安装后无需从 GitHub 下载，大幅提升用户体验。
 *
 * 下载逻辑对齐官方安装脚本：
 *   - Windows: install.ps1       (tag prefix: cua-driver-rs-v)
 *   - Mac/Linux: _install-rust.sh (tag prefix: cua-driver-rs-v)
 *
 * Asset 命名规则（来自官方 CD workflow）：
 *   Windows: cua-driver-rs-{version}-windows-x86_64.zip
 *   Mac:     cua-driver-rs-{version}-darwin-universal.tar.gz  (universal binary)
 *   Linux:   cua-driver-rs-{version}-linux-x86_64-binary.tar.gz
 *
 * 用法：
 *   node scripts/download-cua-driver.mjs          # 下载当前平台
 *   node scripts/download-cua-driver.mjs --all    # 下载所有平台
 *
 * 环境变量：
 *   CUA_DRIVER_GITHUB_MIRROR  GitHub 镜像地址（如 https://ghfast.top）
 *   CUA_DRIVER_VERSION        指定版本（如 0.6.8），不指定则使用 baked 版本或最新
 */
import { existsSync, mkdirSync, createWriteStream, readdirSync, rmSync, renameSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

/** TLS 证书相关错误码 */
const TLS_ERROR_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
])

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const TARGET_DIR = join(ROOT, 'resources', 'cua-driver')
const REPO = 'trycua/cua'
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases`
const TAG_PREFIX = 'cua-driver-rs-v'
const MIRROR = process.env.CUA_DRIVER_GITHUB_MIRROR || ''
const FORCE_VERSION = process.env.CUA_DRIVER_VERSION || ''

/**
 * Baked version — 与官方安装脚本保持同步。
 * 官方 CD workflow 在每次 release 后自动更新此值。
 * 设置后可直接构造下载 URL，无需请求 GitHub API。
 */
const BAKED_VERSION = '0.6.8'

// ── 平台目标定义 ──────────────────────────────────────────────

/**
 * @typedef {Object} PlatformTarget
 * @property {string} binName   - 二进制文件名（如 cua-driver.exe）
 * @property {string} label     - asset 命名用的平台标签（如 windows-x86_64）
 * @property {string} ext       - 压缩包扩展名（.zip 或 .tar.gz）
 * @property {string[]} [extraBinaries] - 额外需要复制的二进制（如 cua-driver-uia.exe）
 * @property {boolean} [linuxStyle] - Linux 风格 asset 名（含 -binary 后缀）
 */

/** 当前平台的下载目标 */
function getPlatformTargets() {
  const platform = process.platform
  const arch = process.arch
  const targets = []

  if (platform === 'win32') {
    targets.push({
      binName: 'cua-driver.exe',
      label: 'windows-x86_64',
      ext: '.zip',
      extraBinaries: ['cua-driver-uia.exe'],
    })
  } else if (platform === 'darwin') {
    // Mac 使用 universal binary，一个 tarball 同时支持 arm64 和 x86_64
    targets.push({
      binName: 'cua-driver',
      label: 'darwin-universal',
      ext: '.tar.gz',
    })
  } else if (platform === 'linux') {
    if (arch === 'arm64') {
      targets.push({
        binName: 'cua-driver',
        label: 'linux-arm64',
        ext: '.tar.gz',
        linuxStyle: true,
      })
    }
    targets.push({
      binName: 'cua-driver',
      label: 'linux-x86_64',
      ext: '.tar.gz',
      linuxStyle: true,
    })
  }

  return targets
}

/** 所有平台的下载目标（--all 模式） */
function getAllTargets() {
  return [
    {
      binName: 'cua-driver.exe',
      label: 'windows-x86_64',
      ext: '.zip',
      extraBinaries: ['cua-driver-uia.exe'],
    },
    {
      binName: 'cua-driver',
      label: 'darwin-universal',
      ext: '.tar.gz',
    },
    {
      binName: 'cua-driver',
      label: 'linux-x86_64',
      ext: '.tar.gz',
      linuxStyle: true,
    },
    {
      binName: 'cua-driver',
      label: 'linux-arm64',
      ext: '.tar.gz',
      linuxStyle: true,
    },
  ]
}

// ── 网络工具 ──────────────────────────────────────────────────

/** HTTPS GET with redirect following and TLS error retry */
function httpsGet(url, maxRedirects = 5, allowInsecure = false) {
  return new Promise((resolve, reject) => {
    const doRequest = (insecure) => {
      const options = {
        headers: {
          'User-Agent': 'SpaceCode-Build-Script',
          'Accept': 'application/vnd.github+json',
        },
      }
      if (insecure) {
        options.agent = new https.Agent({ rejectUnauthorized: false })
      }
      https.get(url, options, (res) => {
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
          httpsGet(location, maxRedirects - 1, insecure).then(resolve).catch(reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} for ${url}`))
          return
        }
        resolve(res)
      }).on('error', (e) => {
        // TLS 证书验证失败时（常见于企业代理/防火墙环境），自动降级重试
        if (!insecure && TLS_ERROR_CODES.has(e.code)) {
          console.warn(`  ⚠ TLS 证书验证失败 (${e.code})，将使用宽松 TLS 模式重试...`)
          console.warn(`    如需根治，请设置环境变量 NODE_EXTRA_CA_CERTS 指向企业根证书。`)
          doRequest(true)
        } else {
          reject(e)
        }
      })
    }
    doRequest(allowInsecure)
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

// ── 解压工具 ──────────────────────────────────────────────────

function extractZip(zipPath, destDir) {
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`)
}

function extractTarGz(tarPath, destDir) {
  execSync(`tar -xzf "${tarPath}" -C "${destDir}"`)
}

// ── 版本解析 ──────────────────────────────────────────────────

/**
 * 解析版本号，优先级：
 * 1. CUA_DRIVER_VERSION 环境变量
 * 2. BAKED_VERSION 常量
 * 3. GitHub Releases API（过滤 cua-driver-rs-v* 前缀）
 */
async function resolveVersion() {
  if (FORCE_VERSION) {
    const v = FORCE_VERSION.replace(/^v/, '')
    console.log(`  使用指定版本: ${TAG_PREFIX}${v}`)
    return v
  }

  if (BAKED_VERSION) {
    const v = BAKED_VERSION.replace(/^v/, '')
    console.log(`  使用 baked 版本: ${TAG_PREFIX}${v}`)
    return v
  }

  // Fallback: 查询 GitHub API，过滤 cua-driver-rs-v* 标签
  console.log(`  查询 GitHub API 获取最新 ${TAG_PREFIX}* release...`)
  const releases = await fetchJson(`${GITHUB_API}?per_page=100`)
  const matched = releases.filter((r) => r.tag_name?.startsWith(TAG_PREFIX))
  if (matched.length === 0) {
    throw new Error(`No release matching ${TAG_PREFIX}* found on ${REPO}`)
  }

  // 按 SemVer 降序排序
  matched.sort((a, b) => {
    const va = a.tag_name.slice(TAG_PREFIX.length).split('.').map(Number)
    const vb = b.tag_name.slice(TAG_PREFIX.length).split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      if (vb[i] !== va[i]) return vb[i] - va[i]
    }
    return 0
  })

  const latest = matched[0]
  const version = latest.tag_name.slice(TAG_PREFIX.length)
  console.log(`  最新 release: ${latest.tag_name}`)
  return version
}

/**
 * 获取 release 信息（包含 assets 列表）。
 * 如果版本已知且有 baked version，可直接构造下载 URL 而无需 API 调用。
 */
async function getReleaseInfo(version) {
  const tag = `${TAG_PREFIX}${version}`
  const url = `${GITHUB_API}/tags/${tag}`
  console.log(`  Fetching release info: ${url}`)
  const release = await fetchJson(url)
  if (!release || !release.assets) {
    throw new Error(`No release assets found for ${tag}`)
  }
  return release
}

// ── Asset 查找 ────────────────────────────────────────────────

/**
 * 构造 asset 名称（对齐官方 CD workflow 的命名规则）。
 *
 * Windows: cua-driver-rs-{version}-windows-x86_64.zip
 * Mac:     cua-driver-rs-{version}-darwin-universal.tar.gz
 * Linux:   cua-driver-rs-{version}-linux-x86_64-binary.tar.gz
 */
function buildAssetName(target, version) {
  if (target.linuxStyle) {
    return `cua-driver-rs-${version}-${target.label}-binary${target.ext}`
  }
  return `cua-driver-rs-${version}-${target.label}${target.ext}`
}

/**
 * 在 release assets 中查找目标 asset。
 * 优先精确匹配构造的名称，回退到模糊匹配。
 */
function findAsset(release, target, version) {
  const expectedName = buildAssetName(target, version)

  // 精确匹配
  const exact = release.assets.find((a) => a.name === expectedName)
  if (exact) return exact

  // 模糊匹配：包含 label 且扩展名相同
  const fuzzy = release.assets.find((a) =>
    a.name.includes(target.label) && a.name.endsWith(target.ext)
  )
  return fuzzy || null
}

// ── 文件操作 ──────────────────────────────────────────────────

/**
 * 递归查找目录中的指定文件名。
 */
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

/**
 * 检查目标二进制是否已存在（直接路径或 bin/ 子目录）。
 * @returns 已存在文件的完整路径，不存在则返回 null
 */
function findExistingBinary(binName) {
  const directPath = join(TARGET_DIR, binName)
  if (existsSync(directPath)) return directPath
  const binPath = join(TARGET_DIR, 'bin', binName)
  if (existsSync(binPath)) return binPath
  return null
}

/**
 * 将文件从源路径移动到目标目录（覆盖已存在的文件）。
 */
function moveFile(srcPath, destPath) {
  if (existsSync(destPath)) {
    rmSync(destPath)
  }
  renameSync(srcPath, destPath)
}

// ── 下载核心逻辑 ──────────────────────────────────────────────

/**
 * 下载并安装单个平台目标的 cua-driver 二进制。
 */
async function downloadForTarget(target, release, version) {
  const { binName, ext, extraBinaries } = target
  const asset = findAsset(release, target, version)

  if (!asset) {
    const expectedName = buildAssetName(target, version)
    console.warn(`  ⚠ 未找到 asset: ${expectedName}`)
    console.warn(`    Available: ${release.assets?.map((a) => a.name).join(', ') || 'none'}`)
    return false
  }

  const downloadUrl = MIRROR
    ? `${MIRROR}/${asset.browser_download_url.replace('https://', '')}`
    : asset.browser_download_url

  console.log(`  Downloading: ${downloadUrl}`)

  const tmpFile = join(tmpdir(), `cua-driver-rs-${version}-${target.label}${ext}`)
  await downloadFile(downloadUrl, tmpFile)
  console.log(`  Downloaded (${(asset.size / 1024 / 1024).toFixed(1)} MB)`)

  // 解压到临时目录
  const extractDir = join(TARGET_DIR, `_tmp_${target.label}`)
  if (existsSync(extractDir)) {
    rmSync(extractDir, { recursive: true })
  }
  mkdirSync(extractDir, { recursive: true })

  if (ext === '.zip') {
    extractZip(tmpFile, extractDir)
  } else {
    extractTarGz(tmpFile, extractDir)
  }

  // 查找并移动主二进制文件
  const extractedBin = findBinaryInDir(extractDir, binName)
  if (extractedBin) {
    const finalPath = join(TARGET_DIR, binName)
    moveFile(extractedBin, finalPath)
    console.log(`  ✓ Installed: ${finalPath}`)
  } else {
    console.warn(`  ⚠ Binary ${binName} not found in extracted files`)
    console.warn(`    Extracted contents: ${readdirSync(extractDir).join(', ')}`)
  }

  // 查找并移动额外二进制文件（如 cua-driver-uia.exe）
  if (extraBinaries) {
    for (const extraName of extraBinaries) {
      const extractedExtra = findBinaryInDir(extractDir, extraName)
      if (extractedExtra) {
        const extraPath = join(TARGET_DIR, extraName)
        moveFile(extractedExtra, extraPath)
        console.log(`  ✓ Installed: ${extraPath}`)
      } else {
        console.log(`  ℹ ${extraName} not found in archive (optional, skipping)`)
      }
    }
  }

  // 清理临时目录
  if (existsSync(extractDir)) {
    rmSync(extractDir, { recursive: true })
  }

  return true
}

// ── 主入口 ────────────────────────────────────────────────────

async function main() {
  const downloadAll = process.argv.includes('--all')
  const targets = downloadAll ? getAllTargets() : getPlatformTargets()

  if (targets.length === 0) {
    console.error(`Unsupported platform: ${process.platform}/${process.arch}`)
    process.exit(1)
  }

  console.log('━'.repeat(60))
  console.log('  cua-driver Binary Pre-Download Script')
  console.log('━'.repeat(60))
  console.log(`  Platform targets: ${targets.map((t) => t.label).join(', ')}`)
  if (MIRROR) console.log(`  GitHub mirror: ${MIRROR}`)
  if (FORCE_VERSION) console.log(`  Version: ${FORCE_VERSION}`)
  else if (BAKED_VERSION) console.log(`  Baked version: ${BAKED_VERSION}`)
  console.log()

  mkdirSync(TARGET_DIR, { recursive: true })

  // 检查哪些目标二进制尚未存在，仅对缺失的执行下载
  const missing = targets.filter((t) => !findExistingBinary(t.binName))
  const existing = targets.filter((t) => findExistingBinary(t.binName))

  for (const target of existing) {
    const path = findExistingBinary(target.binName)
    console.log(`  ✓ ${target.label}: 已存在 (${path})，跳过下载`)
  }
  if (existing.length > 0) console.log()

  let success = existing.length
  let failed = 0

  // 全部已存在时无需请求 GitHub API
  if (missing.length === 0) {
    console.log('  所有目标二进制均已就绪，跳过下载。')
  } else {
    const version = await resolveVersion()
    const release = await getReleaseInfo(version)
    console.log(`  Release: ${release.tag_name}, Assets: ${release.assets?.length || 0}`)
    console.log()

    for (const target of missing) {
      console.log(`  Processing: ${target.label}`)
      try {
        const ok = await downloadForTarget(target, release, version)
        if (ok) success++
        else failed++
      } catch (e) {
        console.error(`  ✗ Failed: ${e.message}`)
        failed++
      }
      console.log()
    }
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
