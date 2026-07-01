/**
 * 预打包 @zavora-ai/computer-use-mcp 到 mcp-vendor/，让内置 computer-use MCP
 * 在安装后开箱即用、无需联网下载。
 *
 * 流程：
 *   1. npm install 该包及其运行时依赖到 mcp-vendor/node_modules/
 *   2. 删除非当前平台的 .node 原生模块（每个平台构建只保留自己的二进制）
 *   3. 清理 package-lock.json / *.d.ts / 文档等非运行时文件
 *
 * 产物经 electron-builder extraResources 打包到 <resources>/mcp-vendor/，
 * 运行时由 electron/mcpConfigStore.ts 的 buildEnabledMcpConfig() 解析为
 * 绝对路径，用打包内的 bun 执行 dist/server.js 启动 stdio MCP server。
 *
 * 用法：node scripts/copy-mcp-vendor.cjs
 *       （已串入 package.json 的 electron:build:* 脚本链）
 */
const { execSync } = require('child_process')
const { existsSync, rmSync, readdirSync, statSync } = require('fs')
const { join, resolve } = require('path')

const PKG = '@zavora-ai/computer-use-mcp@latest'
const vendorDir = resolve(__dirname, '..', 'mcp-vendor')

// 当前平台 → 原生模块文件名后缀（与包内 computer-use-napi.<platform>-<arch>.node 对齐）
function currentNativeSuffix() {
  const { platform, arch } = process
  // native.js 的 SUPPORTED_TARGETS: darwin-arm64, darwin-x64, win32-x64, linux-x64, linux-arm64
  return `${platform}-${arch}`
}

// 递归计算目录大小（MB）
function dirSizeMB(dir) {
  let total = 0
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else total += st.size
    }
  }
  try { walk(dir) } catch {}
  return (total / 1024 / 1024).toFixed(2)
}

console.log('[copy-mcp-vendor] Preparing bundled computer-use MCP server...')

// 1. 清理旧产物
if (existsSync(vendorDir)) {
  rmSync(vendorDir, { recursive: true, force: true })
  console.log(`[copy-mcp-vendor] Cleaned existing ${vendorDir}`)
}

// 2. npm install（仅运行时依赖，跳过 dev/peer）
//    --prefix 会在 vendorDir 下生成 node_modules/ 与 package.json
console.log(`[copy-mcp-vendor] Installing ${PKG} into ${vendorDir} ...`)
try {
  execSync(
    `npm install ${PKG} --prefix "${vendorDir}" --omit=dev --no-audit --no-fund --ignore-scripts`,
    { stdio: 'inherit', cwd: resolve(__dirname, '..') },
  )
} catch (e) {
  console.error('[copy-mcp-vendor] npm install failed. The bundled computer-use MCP will NOT be available offline.')
  console.error('[copy-mcp-vendor] Falling back to npx at runtime (requires network on first use).')
  process.exit(1)
}

const nmDir = join(vendorDir, 'node_modules')
const pkgDir = join(nmDir, '@zavora-ai', 'computer-use-mcp')
if (!existsSync(pkgDir)) {
  console.error(`[copy-mcp-vendor] ERROR: ${pkgDir} not found after install.`)
  process.exit(1)
}

// 3. 删除非当前平台的 .node 原生模块，减小打包体积
const keepFile = `computer-use-napi.${currentNativeSuffix()}.node`
const nativeFiles = readdirSync(pkgDir).filter(f => /^computer-use-napi\..+\.node$/.test(f))
let removedNative = 0
for (const f of nativeFiles) {
  if (f !== keepFile && f !== 'computer-use-napi.node') {
    rmSync(join(pkgDir, f), { force: true })
    removedNative++
  }
}
console.log(`[copy-mcp-vendor] Kept native binary: ${keepFile} | removed ${removedNative} other-platform binary(ies)`)

// 4. 清理非运行时文件（.d.ts / package-lock / README / LICENSE 等）
const cleanupTargets = [
  join(vendorDir, 'package-lock.json'),
]
for (const t of cleanupTargets) {
  if (existsSync(t)) rmSync(t, { force: true })
}
// 递归删除所有 .d.ts（类型声明，运行时不需要）
function rmTypeDecls(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      rmTypeDecls(full)
    } else if (entry.endsWith('.d.ts')) {
      rmSync(full, { force: true })
    }
  }
}
try { rmTypeDecls(nmDir) } catch {}

console.log(`[copy-mcp-vendor] Done. mcp-vendor/ size: ${dirSizeMB(vendorDir)} MB`)
console.log(`[copy-mcp-vendor] Server entry: mcp-vendor/node_modules/@zavora-ai/computer-use-mcp/dist/server.js`)
