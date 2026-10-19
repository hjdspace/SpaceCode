/**
 * 预下载 cua-driver 到 resources/cua-driver/ 目录。
 *
 * 在构建前运行此脚本，将 cua-driver 预先下载到打包资源目录中，
 * 这样应用安装后无需从 GitHub 下载，大幅提升用户体验。
 *
 * macOS 保留整个 CuaDriver.app 而不是裸二进制：TCC（辅助功能 / 屏幕录制）
 * 按 CFBundleIdentifier 归属，裸 Mach-O 没有身份，抽出来打包会让
 * Computer Use 永远停在「未授权」。详见 electron/tools/cuaDriverBundle.ts。
 *
 * 下载逻辑对齐官方安装脚本：
 *   - Windows: install.ps1       (tag prefix: cua-driver-rs-v)
 *   - Mac/Linux: _install-rust.sh (tag prefix: cua-driver-rs-v)
 *
 * Asset 命名规则（来自官方 CD workflow）：
 *   Windows: cua-driver-rs-{version}-windows-x86_64.zip
 *   Mac:     cua-driver-rs-{version}-darwin-universal.tar.gz  (含 CuaDriver.app)
 *   Linux:   cua-driver-rs-{version}-linux-x86_64-binary.tar.gz
 *
 * 用法：
 *   node scripts/download-cua-driver.mjs          # 下载当前平台
 *   node scripts/download-cua-driver.mjs --all    # 下载所有平台
 *
 * 环境变量：
 *   CUA_DRIVER_GITHUB_MIRROR  GitHub 镜像地址（如 https://ghfast.top）
 *   CUA_DRIVER_VERSION        指定版本（如 0.34.0），不指定则使用 baked 版本或最新
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
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''

/**
 * Baked version — 与官方安装脚本保持同步。
 * 官方 CD workflow 在每次 release 后自动更新此值。
 * 设置后可直接构造下载 URL，无需请求 GitHub API。
 */
const BAKED_VERSION = '0.34.0'

// ── 平台目标定义 ──────────────────────────────────────────────

/**
 * @typedef {Object} PlatformTarget
 * @property {string} binName   - 二进制文件名（如 cua-driver.exe）
 * @property {string} label     - asset 命名用的平台标签（如 windows-x86_64）
 * @property {string} ext       - 压缩包扩展名（.zip 或 .tar.gz）
 * @property {string[]} [extraBinaries] - 额外需要复制的二进制（如 cua-driver-uia.exe）
 * @property {boolean} [linuxStyle] - Linux 风格 asset 名（含 -binary 后缀）
 * @property {string} [appBundle] - 需要整目录保留的 .app bundle 名（macOS）
 * @property {boolean} [bundleOnly] - 只保留 bundle，不抽裸二进制
 */

/**
 * 所有平台的下载目标 —— 单一事实来源。
 *
 * 之前 getPlatformTargets / getAllTargets 各写一份目标表，两份会漂移；
 * macOS 那份漂移的结果是 bundle 被漏掉，装出来的包只剩裸二进制。
 */
const ALL_TARGETS = [
  {
    platform: 'win32',
    binName: 'cua-driver.exe',
    label: 'windows-x86_64',
    ext: '.zip',
    extraBinaries: ['cua-driver-uia.exe'],
  },
  {
    platform: 'darwin',
    binName: 'cua-driver',
    label: 'darwin-universal',
    ext: '.tar.gz',
    appBundle: 'CuaDriver.app',
    bundleOnly: true,
  },
  {
    platform: 'linux',
    binName: 'cua-driver',
    label: 'linux-x86_64',
    ext: '.tar.gz',
    linuxStyle: true,
  },
  {
    platform: 'linux',
    binName: 'cua-driver',
    label: 'linux-arm64',
    ext: '.tar.gz',
    linuxStyle: true,
  },
]

/** 当前平台的下载目标 */
function getPlatformTargets() {
  const platform = process.platform
  const forPlatform = ALL_TARGETS.filter((t) => t.platform === platform)
  if (platform !== 'linux') return forPlatform
  // Linux 只在 arm64 机器上额外拉 arm64 包
  if (process.arch === 'arm64') return forPlatform
  return forPlatform.filter((t) => t.label !== 'linux-arm64')
}

/** 所有平台的下载目标（--all 模式） */
function getAllTargets() {
  return ALL_TARGETS
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
      // 匿名请求在 GitHub Actions 的共享出口 IP 上会被限流成 403，带 token 才能稳。
      // 按 host 逐跳判断（含重定向后的每一次请求），镜像与下载直链一律不带凭据。
      if (GITHUB_TOKEN && new URL(url).host === 'api.github.com') {
        options.headers.Authorization = `Bearer ${GITHUB_TOKEN}`
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
          // 只报状态码分不清限流与 404，响应体里才是真原因
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            if (body.length < 400) body += chunk
          })
          res.on('end', () => {
            reject(new Error(`HTTP ${res.statusCode} for ${url}: ${body.slice(0, 400).replace(/\s+/g, ' ')}`))
          })
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
 * 检查目标平台的产物是否已就绪，避免重复下载。
 *
 * bundleOnly 的平台以 bundle 内的可执行文件为准 —— 只留下一个空壳 .app
 * 目录会让脚本误判为已下载，从而把缺陷带进包里。
 */
function findExistingArtifact(target) {
  if (target.appBundle) {
    const inBundle = join(TARGET_DIR, target.appBundle, 'Contents', 'MacOS', target.binName)
    return existsSync(inBundle) ? inBundle : null
  }
  const directPath = join(TARGET_DIR, target.binName)
  if (existsSync(directPath)) return directPath
  const binPath = join(TARGET_DIR, 'bin', target.binName)
  if (existsSync(binPath)) return binPath
  return null
}

/**
 * 移动文件或目录，覆盖已存在的目标。
 */
function movePath(srcPath, destPath) {
  if (existsSync(destPath)) {
    rmSync(destPath, { recursive: true })
  }
  renameSync(srcPath, destPath)
}

// ── 下载核心逻辑 ──────────────────────────────────────────────

/**
 * 下载并安装单个平台目标的 cua-driver 二进制。
 */
async function downloadForTarget(target, release, version) {
  const { binName, ext, extraBinaries, appBundle, bundleOnly } = target
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

  // macOS 的 TCC 身份挂在 .app bundle 上，整目录保留，不要只抽裸二进制。
  let bundleOk = true
  if (appBundle) {
    const extractedApp = findBinaryInDir(extractDir, appBundle)
    if (extractedApp) {
      const finalApp = join(TARGET_DIR, appBundle)
      movePath(extractedApp, finalApp)
      const innerBin = join(finalApp, 'Contents', 'MacOS', binName)
      if (!existsSync(innerBin)) {
        console.warn(`  ⚠ ${appBundle} 内缺少 Contents/MacOS/${binName}，bundle 不可用`)
        bundleOk = false
      } else {
        console.log(`  ✓ Installed: ${finalApp}`)
      }
    } else {
      console.warn(`  ⚠ ${appBundle} not found in extracted files`)
      console.warn(`    Extracted contents: ${readdirSync(extractDir).join(', ')}`)
      bundleOk = false
    }
  }

  // 查找并移动主二进制文件
  if (!bundleOnly) {
    const extractedBin = findBinaryInDir(extractDir, binName)
    if (extractedBin) {
      const finalPath = join(TARGET_DIR, binName)
      movePath(extractedBin, finalPath)
      console.log(`  ✓ Installed: ${finalPath}`)
    } else {
      console.warn(`  ⚠ Binary ${binName} not found in extracted files`)
      console.warn(`    Extracted contents: ${readdirSync(extractDir).join(', ')}`)
    }
  }

  // 查找并移动额外二进制文件（如 cua-driver-uia.exe）
  if (extraBinaries) {
    for (const extraName of extraBinaries) {
      const extractedExtra = findBinaryInDir(extractDir, extraName)
      if (extractedExtra) {
        const extraPath = join(TARGET_DIR, extraName)
        movePath(extractedExtra, extraPath)
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

  return bundleOk
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

  // 检查哪些目标产物尚未存在，仅对缺失的执行下载
  const missing = targets.filter((t) => !findExistingArtifact(t))
  const existing = targets.filter((t) => findExistingArtifact(t))

  for (const target of existing) {
    const path = findExistingArtifact(target)
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
