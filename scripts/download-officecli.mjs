#!/usr/bin/env node
/**
 * Download the correct OfficeCLI binary for the current platform.
 *
 * Usage:
 *   node scripts/download-officecli.mjs          # download latest release
 *   node scripts/download-officecli.mjs v1.0.0   # download specific tag
 *
 * The binary is placed in resources/officecli/ with the expected naming convention:
 *   officecli-{platform}-{arch}[.exe]
 *
 * If the binary already exists, the download is skipped (unless --force is passed).
 */

import { existsSync, mkdirSync, createWriteStream, renameSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawnSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TARGET_DIR = join(__dirname, '..', 'resources', 'officecli')

// ===== Platform detection =====

function getPlatformInfo() {
  const platform = process.platform
  const arch = process.arch

  let platformName
  if (platform === 'win32') platformName = 'win'
  else if (platform === 'darwin') platformName = 'mac'
  else if (platform === 'linux') platformName = 'linux'
  else throw new Error(`Unsupported platform: ${platform}`)

  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported architecture: ${arch}`)
  }

  const exeName = `officecli-${platformName}-${arch}${platform === 'win32' ? '.exe' : ''}`
  return { platformName, arch, exeName, platform }
}

// ===== GitHub API =====

const GITHUB_API = 'https://api.github.com/repos/iOfficeAI/OfficeCLI/releases'

async function fetchLatestRelease(tag) {
  const url = tag ? `${GITHUB_API}/tags/${tag}` : `${GITHUB_API}/latest`
  console.log(`[OfficeCLI] Fetching release info from: ${url}`)

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'SpaceCode-OfficeCLI-Downloader' },
  })

  if (!resp.ok) {
    throw new Error(`GitHub API returned ${resp.status}: ${await resp.text()}`)
  }

  return resp.json()
}

// ===== Download =====

async function downloadFile(url, destPath) {
  console.log(`[OfficeCLI] Downloading: ${url}`)
  console.log(`[OfficeCLI] Destination: ${destPath}`)

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'SpaceCode-OfficeCLI-Downloader' },
    redirect: 'follow',
  })

  if (!resp.ok) {
    throw new Error(`Download failed: HTTP ${resp.status}`)
  }

  const contentLength = resp.headers.get('content-length')
  if (contentLength) {
    console.log(`[OfficeCLI] File size: ${(parseInt(contentLength) / 1024 / 1024).toFixed(1)} MB`)
  }

  const tmpPath = destPath + '.tmp'
  const stream = createWriteStream(tmpPath)

  const reader = resp.body.getReader()
  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      stream.write(Buffer.from(value))
    }
  }

  try {
    await pump()
    stream.end()
    renameSync(tmpPath, destPath)
    console.log(`[OfficeCLI] Download complete.`)
  } catch (err) {
    stream.destroy()
    throw err
  }
}

// ===== Main =====

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const tag = args.find(a => !a.startsWith('-'))

  const { exeName, platform } = getPlatformInfo()

  // Ensure target directory exists
  if (!existsSync(TARGET_DIR)) {
    mkdirSync(TARGET_DIR, { recursive: true })
  }

  const targetPath = join(TARGET_DIR, exeName)

  // Skip if already exists (unless --force)
  if (existsSync(targetPath) && !force) {
    const stats = statSync(targetPath)
    if (stats.size > 0) {
      console.log(`[OfficeCLI] Binary already exists: ${targetPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)
      console.log(`[OfficeCLI] Use --force to re-download.`)

      // Verify it works
      try {
        const result = spawnSync(targetPath, ['--version'], { timeout: 5000, encoding: 'utf-8' })
        if (result.status === 0) {
          console.log(`[OfficeCLI] Version: ${result.stdout.trim()}`)
        }
      } catch { /* ignore version check errors */ }
      return
    }
  }

  // Fetch release info
  let release
  try {
    release = await fetchLatestRelease(tag)
  } catch (err) {
    console.error(`[OfficeCLI] Failed to fetch release info: ${err.message}`)
    console.error(`[OfficeCLI] You can manually download from: https://github.com/iOfficeAI/OfficeCLI/releases`)
    console.error(`[OfficeCLI] Place the binary at: ${targetPath}`)
    process.exit(1)
  }

  // Find matching asset
  const assets = release.assets || []
  const asset = assets.find(a => a.name === exeName)

  if (!asset) {
    console.error(`[OfficeCLI] No matching asset found for ${exeName}`)
    console.error(`[OfficeCLI] Available assets:`)
    assets.forEach(a => console.error(`  - ${a.name} (${(a.size / 1024 / 1024).toFixed(1)} MB)`))
    console.error(`[OfficeCLI] You can manually download from: ${release.html_url || 'https://github.com/iOfficeAI/OfficeCLI/releases'}`)
    process.exit(1)
  }

  console.log(`[OfficeCLI] Release: ${release.tag_name || 'latest'}`)
  console.log(`[OfficeCLI] Asset: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`)

  // Download
  try {
    await downloadFile(asset.browser_download_url, targetPath)

    // Make executable on Unix
    if (platform !== 'win32') {
      try {
        spawnSync('chmod', ['+x', targetPath])
      } catch { /* ignore */ }
    }

    // Verify
    const result = spawnSync(targetPath, ['--version'], { timeout: 5000, encoding: 'utf-8' })
    if (result.status === 0) {
      console.log(`[OfficeCLI] Verification OK. Version: ${result.stdout.trim()}`)
    } else {
      console.warn(`[OfficeCLI] Binary downloaded but version check failed (may still work).`)
    }
  } catch (err) {
    console.error(`[OfficeCLI] Download failed: ${err.message}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error(`[OfficeCLI] Fatal error: ${err.message}`)
  process.exit(1)
})
