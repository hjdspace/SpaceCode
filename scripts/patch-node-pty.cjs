/**
 * patch-node-pty.cjs
 *
 * 移除 node-pty 中 binding.gyp 与 deps/winpty/src/winpty.gyp 的
 * SpectreMitigation 要求。
 *
 * 背景：
 *   node-pty 1.1.0 在 Windows 下强制启用 Spectre 缓解
 *   (`'SpectreMitigation': 'Spectre'`)，需要 Visual Studio 2022 安装
 *   "MSVC v143 - Spectre-mitigated libs" 组件（约 2GB）。许多开发环境
 *   未安装该组件，导致 electron-builder 调用 @electron/rebuild 重编译
 *   node-pty 时报 MSB8040 错误。
 *
 *   node-pty 自带 prebuilds/win32-x64/pty.node 预编译二进制，npm install
 *   时通过 prebuild.js 直接使用预编译版本，不触发编译。但 electron-builder
 *   打包时会强制按 Electron ABI 重新编译，仍会命中 Spectre 要求。
 *
 *   Spectre 要求出现在 3 个位置：
 *     1. node-pty/binding.gyp （顶层 target_defaults）
 *     2. node-pty/deps/winpty/src/winpty.gyp （winpty-agent target）
 *     3. node-pty/deps/winpty/src/winpty.gyp （winpty shared_library target）
 *
 *   终端应用场景下 Spectre 攻击面极小，禁用 Spectre 缓解对安全影响可忽略。
 *
 * 调用时机：
 *   - postinstall 钩子（每次 npm install 后自动应用）
 *   - 也可手动执行：node scripts/patch-node-pty.cjs
 *
 * 幂等性：
 *   脚本检测每个 gyp 文件是否已移除 SpectreMitigation 字段，若已移除
 *   则跳过，避免重复修改。
 */

const fs = require('fs')
const path = require('path')

const NODE_PTY_DIR = path.join(__dirname, '..', 'node_modules', 'node-pty')

const TARGET_FILES = [
  path.join(NODE_PTY_DIR, 'binding.gyp'),
  path.join(NODE_PTY_DIR, 'deps', 'winpty', 'src', 'winpty.gyp'),
]

let patchedCount = 0
let skippedCount = 0

for (const filePath of TARGET_FILES) {
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-node-pty] Not found, skipping: ${path.relative(NODE_PTY_DIR, filePath)}`)
    skippedCount++
    continue
  }

  const original = fs.readFileSync(filePath, 'utf8')

  if (!original.includes("'SpectreMitigation': 'Spectre'")) {
    console.log(`[patch-node-pty] Already patched: ${path.relative(NODE_PTY_DIR, filePath)}`)
    skippedCount++
    continue
  }

  // 移除 SpectreMitigation 属性块（含末尾逗号和换行）
  // 匹配：
  //   'msvs_configuration_attributes': {
  //     'SpectreMitigation': 'Spectre'
  //   },
  const patched = original.replace(
    /\s*'msvs_configuration_attributes':\s*\{\s*'SpectreMitigation':\s*'Spectre'\s*\},?\s*\n/g,
    '\n'
  )

  if (patched === original) {
    console.warn(
      `[patch-node-pty] WARNING: SpectreMitigation detected in ${path.relative(
        NODE_PTY_DIR,
        filePath
      )} but pattern did not match. Manual edit may be required.`
    )
    skippedCount++
    continue
  }

  fs.writeFileSync(filePath, patched)
  console.log(
    `[patch-node-pty] Patched: ${path.relative(NODE_PTY_DIR, filePath)} ` +
      '(removed SpectreMitigation that was causing MSB8040 error)'
  )
  patchedCount++
}

// node-pty's relative loader runs from app.asar, while electron-builder
// places native .node files in app.asar.unpacked. Retry the real filesystem
// path so packaging does not turn a native-load error into a misleading
// MODULE_NOT_FOUND error.
const utilsPath = path.join(NODE_PTY_DIR, 'lib', 'utils.js')
if (fs.existsSync(utilsPath)) {
  const original = fs.readFileSync(utilsPath, 'utf8')
  if (!original.includes('[spacecode-patch-v1]')) {
    const oldCatch = [
      '            catch (e) {',
      '                lastError = e;',
      '            }',
    ].join('\n')
    const newCatch = [
      '            catch (e) {',
      '                // [spacecode-patch-v1] asar unpacked fallback',
      '                var _unpackedError;',
      '                try {',
      '                    var _path = require("path");',
      '                    var _fs = require("fs");',
      '                    var _resolved = _path.resolve(__dirname, dir + "/" + name + ".node");',
      '                    var _unpacked = _resolved.replace("app.asar", "app.asar.unpacked").replace("node_modules.asar", "node_modules.asar.unpacked");',
      '                    if (_unpacked !== _resolved && _fs.existsSync(_unpacked)) {',
      '                        return { dir: dir, module: require(_unpacked) };',
      '                    }',
      '                } catch (_e2) { _unpackedError = _e2; }',
      '                lastError = _unpackedError || e;',
      '            }',
    ].join('\n')
    if (original.includes(oldCatch)) {
      fs.writeFileSync(utilsPath, original.replace(oldCatch, newCatch))
      console.log('[patch-node-pty] Patched node-pty/lib/utils.js for app.asar.unpacked fallback')
    } else {
      console.warn('[patch-node-pty] Could not find node-pty/lib/utils.js loader catch block')
    }
  } else {
    console.log('[patch-node-pty] node-pty/lib/utils.js already patched')
  }
}

console.log(`[patch-node-pty] Done. Patched: ${patchedCount}, Skipped: ${skippedCount}`)
