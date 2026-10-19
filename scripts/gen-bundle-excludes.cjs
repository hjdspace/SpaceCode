#!/usr/bin/env node
/**
 * 验证 package.json 中 build.files 的排除规则是否仍然正确。
 *
 * 背景：经过打包优化，dependencies 已精简到只有宿主进程真正 require 的原生模块
 *（node-pty / better-sqlite3）。electron-builder 只把 dependencies 的闭包搬进 asar，
 * 因此不再需要逐包排除渲染进程依赖的百行清单。
 *
 * 本脚本现在验证三件事：
 *   1. dependencies 中没有不该出现的渲染进程依赖（防止误加回去）
 *   2. build.files / build.asarUnpack 中的规则与实际 dependencies 一致
 *   3. pi 走 extraResources 的自包含 bundle，而不是 node_modules 副本 (#52)
 *
 * 第 3 条是这条路径唯一的防线：asarUnpack 过去根本没人对比，而 bundled pi 一旦在产物里
 * 取不到，运行时会一路 fall through 到用户全局装的 pi —— 类型检查与单测都看不见。
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
 */
const EXPECTED_DEPS = new Set([
  'node-pty',
  'better-sqlite3',
])

/**
 * pi 是「打包期输入 + 独立子进程」，宿主进程从不 require 它：
 * 留在 dependencies 里，它 22MB 级的依赖闭包会被 electron-builder 一起塞进 asar，
 * 而那份副本在 asar 里根本 spawn 不起来（子进程读不到裸依赖），纯死重。
 * 端点改成 extraResources 搬 dist/bundle —— bundle 自包含，不依赖任何 node_modules。
 */
const BUNDLED_PI_PACKAGE = '@earendil-works/pi-coding-agent'
const BUNDLED_PI_SOURCE = `node_modules/${BUNDLED_PI_PACKAGE}`
const BUNDLED_PI_DEST = 'pi'
/** pi 自己启动时向上找 package.json 定 VERSION，只搬 bundle 会读成宿主的版本 */
const BUNDLED_PI_REQUIRED_FILTER = ['package.json', 'dist/bundle/**/*']

/**
 * build.files 中必须包含的基础白名单和原生模块裁剪规则。
 * 这些规则裁剪的是跨平台预编译产物和源码，不影响功能。
 */
const REQUIRED_FILE_PATTERNS = [
  'dist/**/*',
  'dist-electron/**/*',
  'node_modules/node-pty/**/*',
]

/** build.asarUnpack 必须包含的规则（子进程要读真实文件，asar 路径读不到） */
const REQUIRED_UNPACK_PATTERNS = [
  'node_modules/node-pty/**/*',
  'dist-electron/proxy/**/*',
]

/**
 * 出现即报错的规则：pi 一律走 extraResources，node_modules 副本与它的裁剪规则都不该
 * 再出现在 build 配置里 —— --fix 也不会把它们写回去。
 */
const FORBIDDEN_PI_PATTERNS = [
  'node_modules/@earendil-works/**/*',
  '!**/node_modules/@earendil-works/pi-coding-agent/docs/**/*',
  '!**/node_modules/@earendil-works/pi-coding-agent/examples/**/*',
  '!**/node_modules/@earendil-works/pi-ai/node_modules/**/*',
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

/**
 * pi 的打包路径 (issue #52)，三条都得中：
 *   - pi 归 devDependencies：留在 dependencies 会让 electron-builder 把它整个依赖闭包
 *     塞进 asar，而那份副本在 asar 里 spawn 不起来（子进程读不到裸依赖），纯死重
 *   - build.files / build.asarUnpack 都不带它的 node_modules 副本
 *   - extraResources 真的搬到解析器要找的位置，且连 package.json 一起搬
 *
 * 任何一条漂移都不报类型错、也只会在打包后的机器上表现为「跑的是用户全局装的 pi」，
 * 所以这里当硬断言用，漂移即以非 0 退出（tests/integration 里钉着这个 CLI 契约）。
 */
function checkBundledPi(pkg, build) {
  const deps = Object.keys(pkg.dependencies || {})
  const devDeps = Object.keys(pkg.devDependencies || {})
  const problems = []

  if (deps.includes(BUNDLED_PI_PACKAGE)) {
    problems.push(`${BUNDLED_PI_PACKAGE} 还在 dependencies：依赖闭包会被塞进 asar，而那份副本根本 spawn 不起来`)
  }
  if (!devDeps.includes(BUNDLED_PI_PACKAGE)) {
    problems.push(`${BUNDLED_PI_PACKAGE} 不在 devDependencies：extraResources 没有可搬的源`)
  }

  const staleFiles = (build.files || []).filter(p => FORBIDDEN_PI_PATTERNS.includes(p))
  if (staleFiles.length > 0) {
    problems.push(`build.files 仍带 pi 的 node_modules 规则: ${staleFiles.join(', ')}`)
  }

  const staleUnpack = (build.asarUnpack || []).filter(p => p.includes('@earendil-works'))
  if (staleUnpack.length > 0) {
    problems.push(`build.asarUnpack 仍带 pi 的 node_modules 副本: ${staleUnpack.join(', ')}`)
  }

  const entry = (build.extraResources || []).find(r => typeof r === 'object' && r.from === BUNDLED_PI_SOURCE)
  if (!entry) {
    problems.push(`extraResources 缺 from=${BUNDLED_PI_SOURCE} 的条目`)
  } else {
    if (entry.to !== BUNDLED_PI_DEST) {
      problems.push(`extraResources 的 to 应为 ${BUNDLED_PI_DEST}，实际 ${entry.to}`)
    }
    for (const need of BUNDLED_PI_REQUIRED_FILTER) {
      if (!(entry.filter || []).includes(need)) {
        problems.push(`extraResources.filter 缺 ${need}：只搬 bundle 不搬 package.json，pi 会向上找到宿主的清单并报出错的版本号`)
      }
    }
  }

  // 规则写对而源不在盘上，同样搬不出可用的产物
  const srcDir = path.join(ROOT, ...BUNDLED_PI_SOURCE.split('/'))
  for (const rel of ['package.json', path.join('dist', 'bundle', 'cli.js')]) {
    if (!fs.existsSync(path.join(srcDir, rel))) {
      problems.push(`node_modules 里没有 ${BUNDLED_PI_SOURCE}/${rel}`)
    }
  }

  console.log('')
  if (problems.length === 0) {
    console.log(`✅ bundled pi 走 extraResources（${BUNDLED_PI_SOURCE} → resources/${BUNDLED_PI_DEST}）`)
    return false
  }
  console.error('❌ bundled pi 打包路径已漂移:')
  for (const p of problems) console.error(`   - ${p}`)
  return true
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

  const actualUnpack = build.asarUnpack || []
  const missingUnpack = REQUIRED_UNPACK_PATTERNS.filter(p => !actualUnpack.includes(p))
  if (missingUnpack.length > 0) {
    console.error('❌ build.asarUnpack 缺少必要规则:')
    for (const p of missingUnpack) {
      console.error(`   - ${p}`)
    }
  } else {
    console.log('✅ build.asarUnpack 规则正确')
  }

  // 计算依赖闭包以供参考
  const keep = dependencyClosure([...EXPECTED_DEPS])
  console.log(`\n运行时依赖闭包: ${keep.size} 个包`)

  const piDrift = checkBundledPi(pkg, build)

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

  // 这些漂移不会报类型错、也只会在打包后的机器上表现为「跑的是用户全局的 pi」，
  // 所以必须让守卫以非 0 退出，CI 才拦得住
  if (piDrift || missingUnpack.length > 0 || missingPatterns.length > 0 || extraPatterns.length > 0 || missing.length > 0) {
    process.exitCode = 1
  }
}

main()
