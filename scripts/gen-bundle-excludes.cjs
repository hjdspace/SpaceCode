#!/usr/bin/env node
/**
 * 重新生成 package.json 中 build.files 的依赖排除规则。
 *
 * 背景：electron-builder 会把 package.json 里全部 production `dependencies` 强制打进
 * app.asar，`files` 只能对其追加 `!` 排除规则，无法做白名单。渲染进程依赖已被 vite
 * 打包进 dist/，但其 node_modules 副本仍会被重复打包 —— 本项目实测占 198 MB。
 *
 * 因此维护了一份「运行时必需包闭包」白名单，其余 root production 依赖全部排除：
 *   keep = node-pty + better-sqlite3 + @mariozechner/pi-coding-agent 的依赖闭包
 * 其中 @mariozechner/pi-coding-agent 是以独立子进程执行的，必须保留完整闭包。
 *
 * 用法（新增/移除依赖后手动执行一次）：
 *   node scripts/gen-bundle-excludes.cjs          # 写入 package.json
 *   node scripts/gen-bundle-excludes.cjs --dry    # 只打印，不写入
 *
 * 注意：所有规则必须写在同一个顶层 files 数组里，不要用 win.files / mac.files /
 * linux.files —— electron-builder 的 normalizeFiles() 会把顶层 files 整体折叠成一个
 * FileSet，此时平台级 files 会让主匹配器退化为「匹配任意文件」的通配模式，
 * 结果就是把整个工程目录打进 asar。
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const NODE_MODULES = path.join(ROOT, 'node_modules')
const PKG = path.join(ROOT, 'package.json')

/** 主进程/子进程运行时真正需要的包（依赖闭包会被完整保留） */
const RUNTIME_ROOTS = ['node-pty', 'better-sqlite3', '@mariozechner/pi-coding-agent']

/** 基础白名单：必须直接复制的产物 */
const BASE_PATTERNS = [
  'dist/**/*',
  'dist-electron/**/*',
  'node_modules/node-pty/**/*',
  'node_modules/@mariozechner/**/*',
]

/** 跨平台通用的产物裁剪：只剔除 win/mac/linux 三个目标都用不到的预编译产物 */
const PRUNE_PATTERNS = [
  '!**/node_modules/**/*.map',
  '!**/node_modules/better-sqlite3/deps/**/*',
  '!**/node_modules/better-sqlite3/prebuilds/win32-arm64*',
  '!**/node_modules/better-sqlite3/prebuilds/linuxmusl-*',
  '!**/node_modules/node-pty/prebuilds/win32-arm64*',
  '!**/node_modules/node-pty/third_party/conpty/**/win10-arm64/**/*',
  '!**/node_modules/koffi/build/koffi/freebsd_*',
  '!**/node_modules/koffi/build/koffi/openbsd_*',
  '!**/node_modules/koffi/build/koffi/musl_*',
  '!**/node_modules/koffi/build/koffi/linux_loong64',
  '!**/node_modules/koffi/build/koffi/linux_riscv64d',
  '!**/node_modules/koffi/build/koffi/linux_ia32',
  '!**/node_modules/koffi/build/koffi/linux_armhf',
  '!**/node_modules/koffi/build/koffi/win32_ia32',
  '!**/node_modules/koffi/build/koffi/win32_arm64',
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

  const production = dependencyClosure(Object.keys(pkg.dependencies || {}))
  const keep = dependencyClosure(RUNTIME_ROOTS)

  const excluded = [...production].filter(name => !keep.has(name)).sort()

  const patterns = [
    ...BASE_PATTERNS,
    // electron-builder 对 node_modules 的过滤使用绝对目标路径，
    // 规则必须带上「双星号 + 斜杠」前缀才能命中
    ...excluded.map(name => `!**/node_modules/${name}/**/*`),
    ...PRUNE_PATTERNS,
  ]

  if (process.argv.includes('--dry')) {
    console.log(JSON.stringify(patterns, null, 2))
    console.log(`\n共 ${patterns.length} 条（排除 ${excluded.length} 个包）`)
    return
  }

  build.files = patterns
  for (const platform of ['win', 'mac', 'linux']) {
    if (build[platform] != null) delete build[platform].files
  }

  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log(`已更新 build.files：${patterns.length} 条规则，排除 ${excluded.length} 个包`)
}

main()
