/**
 * 修复 engine/ 目录下 bun workspace 的损坏符号链接（Windows 专用）。
 *
 * 背景：Windows 上 bun install 创建的 workspace symlink 在某些环境下会变成
 * 空目录（权限不足时），导致内置引擎 CLI 启动时报 "Cannot find module" 错误。
 *
 * 本脚本遍历 engine/packages/ 下的所有 workspace 包，检查 node_modules 中
 * 对应的符号链接是否有效；若无效则用 mklink /J (目录联接) 重建。
 *
 * 目录联接（junction）不需要管理员权限，且行为与符号链接一致。
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ENGINE_DIR = path.resolve(__dirname, '..', 'engine')
const PACKAGES_DIR = path.join(ENGINE_DIR, 'packages')
const NODE_MODULES = path.join(ENGINE_DIR, 'node_modules')

function isBrokenLink(linkPath) {
  try {
    const st = fs.lstatSync(linkPath)
    if (st.isSymbolicLink()) {
      // 尝试读取目标
      try {
        fs.readlinkSync(linkPath)
        return false
      } catch {
        return true
      }
    }
    // 不是符号链接，但可能是空目录（bun 在无法创建 symlink 时的 fallback）
    if (st.isDirectory()) {
      const entries = fs.readdirSync(linkPath)
      if (entries.length === 0) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

function repairLink(linkPath, targetPath) {
  // 删除损坏的链接/空目录
  try {
    if (fs.lstatSync(linkPath).isDirectory()) {
      fs.rmdirSync(linkPath, { recursive: true })
    } else {
      fs.unlinkSync(linkPath)
    }
  } catch {
    // 忽略删除失败
  }

  // 使用 mklink /J 创建目录联接
  try {
    const linkDir = path.dirname(linkPath)
    if (!fs.existsSync(linkDir)) {
      fs.mkdirSync(linkDir, { recursive: true })
    }
    execSync(`cmd /c mklink /J "${linkPath}" "${targetPath}"`, {
      stdio: 'ignore',
      cwd: ENGINE_DIR,
    })
    console.log(`  ✓ Repaired: ${path.relative(ENGINE_DIR, linkPath)} → ${path.relative(ENGINE_DIR, targetPath)}`)
    return true
  } catch (e) {
    console.error(`  ✗ Failed to repair ${path.relative(ENGINE_DIR, linkPath)}: ${e.message}`)
    return false
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[repair-workspace-links] Skipped (not Windows)')
    return
  }

  if (!fs.existsSync(PACKAGES_DIR)) {
    console.log('[repair-workspace-links] Skipped (no packages directory)')
    return
  }

  console.log('[repair-workspace-links] Checking workspace links...')
  let repaired = 0

  // 遍历 packages/ 下的所有 workspace 包
  const packageGroups = fs.readdirSync(PACKAGES_DIR)
  for (const group of packageGroups) {
    const groupDir = path.join(PACKAGES_DIR, group)
    if (!fs.statSync(groupDir).isDirectory()) continue
    if (group.startsWith('.')) continue

    const packages = fs.readdirSync(groupDir)
    for (const pkgName of packages) {
      const pkgDir = path.join(groupDir, pkgName)
      if (!fs.statSync(pkgDir).isDirectory()) continue
      const pkgJson = path.join(pkgDir, 'package.json')
      if (!fs.existsSync(pkgJson)) continue

      // 读取包名
      let name
      try {
        name = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).name
      } catch {
        continue
      }
      if (!name) continue

      // 检查 node_modules 中的链接
      const linkPath = path.join(NODE_MODULES, ...name.split('/'))
      if (fs.existsSync(linkPath) && isBrokenLink(linkPath)) {
        if (repairLink(linkPath, pkgDir)) {
          repaired++
        }
      }
    }
  }

  if (repaired > 0) {
    console.log(`[repair-workspace-links] Repaired ${repaired} broken workspace link(s)`)
  } else {
    console.log('[repair-workspace-links] All workspace links OK')
  }
}

main()
