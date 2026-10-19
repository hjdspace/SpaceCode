#!/usr/bin/env node
/**
 * 验证 package.json 中 build.files 的排除规则是否仍然正确。
 *
 * 背景：经过打包优化，dependencies 已精简到只有运行时必需的原生模块和子进程依赖
 *（node-pty / better-sqlite3 / @earendil-works/pi-coding-agent）。
 * electron-builder 只打 dependencies（不含 devDependencies），因此不再需要
 * 逐包排除渲染进程依赖的百行清单。
 *
 * 本脚本现在的作用是验证：
 *   1. dependencies 中没有不该出现的渲染进程依赖（防止误加回去）
 *   2. build.files 中的排除规则与实际 dependencies 一致
 *
 * 用法：
 *   node scripts/gen-bundle-excludes.cjs          # 验证并打印结果
 *   node scripts/gen-bundle-excludes.cjs --fix     # 自动修复 build.files
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const NODE_MODULES = path.join(ROOT, 'node_modules')
const PKG = path.join(ROOT, 'package.json')

/**
 * 运行时必须保留在 dependencies 中的包。
 * electron-builder 会将这些包及其传递依赖打进 asar。
 *
 * 判定依据（详见 docs/desktop-bundle-optimization.md）：
 * - node-pty / better-sqlite3：原生模块，vite-plugin-electron external，运行时从 node_modules 加载
 * - @earendil-works/pi-coding-agent：以独立子进程执行（spawn node cli.js），需完整依赖闭包
 */
const EXPECTED_DEPS = new Set([
  'node-pty',
  'better-sqlite3',
  '@earendil-works/pi-coding-agent',
])

/**
 * build.files 中必须包含的基础白名单和原生模块裁剪规则。
 * 这些规则裁剪的是跨平台预编译产物和源码，不影响功能。
 */
const REQUIRED_FILE_PATTERNS = [
  'dist/**/*',
  'dist-electron/**/*',
  'node_modules/node-pty/**/*',
  'node_modules/@earendil-works/**/*',
]

/** 跨平台通用的产物裁剪规则 */
const PRUNE_PATTERNS = [
  '!**/node_modules/**/*.map',
  '!**/node_modules/better-sqlite3/deps/**/*',
  '!**/node_modules/better-sqlite3/prebuilds/win32-arm64*',
  '!**/node_modules/better-sqlite3/prebuilds/linuxmusl-*',
  '!**/node_modules/better-sqlite3/src/**/*',
  '!**/node_modules/better-sqlite3/build/**/*',
  '!**/node_modules/node-pty/prebuilds/darwin-*',
  '!**/node_modules/node-pty/prebuilds/linux-*',
  '!**/node_modules/node-pty/prebuilds/win32-arm64*',
  '!**/node_modules/node-pty/prebuilds/**/*.pdb',
  '!**/node_modules/node-pty/src/**/*',
  '!**/node_modules/node-pty/deps/**/*',
  '!**/node_modules/node-pty/third_party/conpty/**/win10-arm64/**/*',
  '!**/node_modules/@earendil-works/pi-coding-agent/docs/**/*',
  '!**/node_modules/@earendil-works/pi-coding-agent/examples/**/*',
  '!**/node_modules/@earendil-works/pi-ai/node_modules/**/*',
  '!**/node_modules/koffi/build/koffi/darwin_*',
  '!**/node_modules/koffi/build/koffi/freebsd_*',
  '!**/node_modules/koffi/build/koffi/openbsd_*',
  '!**/node_modules/koffi/build/koffi/musl_*',
  '!**/node_modules/koffi/build/koffi/linux_*',
  '!**/node_modules/koffi/build/koffi/win32_ia32',
  '!**/node_modules/koffi/build/koffi/win32_arm64',
  '!**/node_modules/koffi/doc/**/*',
  '!**/node_modules/koffi/vendor/**/*',
]

function readPkgJson(name) {
  const p = path.join(NODE_MODULES, ...name.split('/'), 'package.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

/** 计算一组根的 production 依赖闭包（含 optionalDependencies） */
function dependencyClosure(roots) {
  const seen = new Set()
  const stack = [...roots]
  while (stack.length > 0) {
    const name = stack.pop()
    if (seen.has(name)) continue
    seen.add(name)
    const pj = readPkgJson(name)
    if (pj == null) continue
    for (const key of ['dependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(pj[key] || {})) {
        if (!seen.has(dep)) stack.push(dep)
      }
    }
  }
  return seen
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'))
  const build = pkg.build
  if (build == null) {
    console.error('package.json 缺少 build 字段')
    process.exit(1)
  }

  const actualDeps = Object.keys(pkg.dependencies || {})
  const unexpected = actualDeps.filter(d => !EXPECTED_DEPS.has(d))
  const missing = [...EXPECTED_DEPS].filter(d => !actualDeps.includes(d))

  console.log('=== 打包依赖验证 ===\n')

  if (unexpected.length > 0) {
    console.warn('⚠️  dependencies 中有非预期包（可能需要移到 devDependencies）:')
    for (const d of unexpected) {
      console.warn(`   - ${d}`)
    }
    console.warn('')
  } else {
    console.log('✅ dependencies 只含运行时必需包')
  }

  if (missing.length > 0) {
    console.error('❌ dependencies 缺少运行时必需包:')
    for (const d of missing) {
      console.error(`   - ${d}`)
    }
    console.error('')
  }

  // 验证 build.files
  const expectedPatterns = [...REQUIRED_FILE_PATTERNS, ...PRUNE_PATTERNS]
  const actualFiles = build.files || []
  const missingPatterns = expectedPatterns.filter(p => !actualFiles.includes(p))
  const extraPatterns = actualFiles.filter(p => !expectedPatterns.includes(p))

  if (missingPatterns.length > 0) {
    console.warn('⚠️  build.files 缺少必要规则:')
    for (const p of missingPatterns) {
      console.warn(`   - ${p}`)
    }
  }

  if (extraPatterns.length > 0) {
    console.warn('⚠️  build.files 有多余规则（可清理）:')
    for (const p of extraPatterns) {
      console.warn(`   - ${p}`)
    }
  }

  if (missingPatterns.length === 0 && extraPatterns.length === 0) {
    console.log('✅ build.files 规则正确')
  }

  // 计算依赖闭包以供参考
  const keep = dependencyClosure([...EXPECTED_DEPS])
  console.log(`\n运行时依赖闭包: ${keep.size} 个包`)

  if (process.argv.includes('--fix')) {
    const patterns = [...REQUIRED_FILE_PATTERNS, ...PRUNE_PATTERNS]
    build.files = patterns
    for (const platform of ['win', 'mac', 'linux']) {
      if (build[platform] != null) delete build[platform].files
    }
    fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    console.log(`\n已修复 build.files：${patterns.length} 条规则`)
  } else if (missingPatterns.length > 0 || extraPatterns.length > 0) {
    console.log('\n运行 --fix 以自动修复 build.files')
  }
}

main()
