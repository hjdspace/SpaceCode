// @vitest-environment node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const ptyBuild = readFileSync(join(root, 'scripts', 'build-linux-pty.mjs'), 'utf8')
const ptyPatch = readFileSync(join(root, 'scripts', 'patch-node-pty.cjs'), 'utf8')
const platformSetup = readFileSync(join(root, 'electron', 'infra', 'platformSetup.ts'), 'utf8')
const proxyManager = readFileSync(join(root, 'electron', 'infra', 'proxyManager.ts'), 'utf8')
const releaseWorkflow = readFileSync(join(root, '.github', 'workflows', 'build-release.yml'), 'utf8')
const piSessionProcess = readFileSync(join(root, 'electron', 'engine', 'engines', 'PiSessionProcess.ts'), 'utf8')
const piCliResolver = readFileSync(join(root, 'electron', 'engine', 'engines', 'piCliResolver.ts'), 'utf8')

describe('Linux AppImage packaging', () => {
  it('builds node-pty against the CentOS 8 ABI before electron-builder runs', () => {
    assert.match(packageJson.scripts['electron:build:linux'], /build:linux-pty.*electron-builder --linux/)
    assert.equal(packageJson.build.npmRebuild, false)
    assert.equal(packageJson.build.nodeGypRebuild, false)
    assert.match(ptyBuild, /rockylinux:8/)
    assert.match(ptyBuild, /GLIBC_2\.28/)
    assert.match(ptyBuild, /GLIBCXX_3\.4\.25/)
    assert.match(ptyBuild, /-static-libstdc\+\+ -static-libgcc/)
    assert.match(ptyBuild, /npmmirror\.com\/mirrors\/node/)
    assert.doesNotMatch(ptyBuild, /spawnSync\('docker'.*shell:/)
    assert.match(ptyBuild, /__PTY_OK__/)
    assert.match(ptyBuild, /rmSync\(BUILD_DIR/)
  })

  it('loads unpacked native and proxy files from their packaged paths', () => {
    assert.match(ptyPatch, /spacecode-patch-v1/)
    assert.match(ptyPatch, /app\.asar\.unpacked/)
    assert.match(proxyManager, /app\.asar\.unpacked.*dist-electron.*proxy.*index\.js/)
  })

  it('executes the bundled Pi CLI from real files outside the asar when packaged', () => {
    // #52：打包态只认 extraResources 搬出去的 resources/pi（自包含的 dist/bundle）。
    // 旧做法是把 node_modules 副本 asarUnpack 出来 —— 子进程确实读到了 cli.js，
    // 却读不到留在 asar 里的裸依赖（file-type/chalk/undici），于是干脆 fall through
    // 到用户全局装的 pi，引擎版本由不得我们。
    assert.match(piCliResolver, /process\.resourcesPath/)
    assert.match(piCliResolver, /'dist', 'bundle', 'cli\.js'/)
    // 解析只此一处：进程不再自己猜 asar 内外，也不再退回全局 pi / npx
    assert.doesNotMatch(piSessionProcess, /app\.asar\.unpacked/)
    assert.doesNotMatch(piSessionProcess, /'npx'/)
  })

  it('sets up Linux IME and D-Bus before creating renderer windows', () => {
    assert.match(platformSetup, /GTK_IM_MODULE/)
    assert.match(platformSetup, /XMODIFIERS/)
    assert.match(platformSetup, /\/run\/user\/\$\{uid\}\/bus/)
    assert.match(platformSetup, /dbus-launch/)
    assert.match(platformSetup, /appendSwitch\('log-level', '3'\)/)
  })

  it('uses the compatible binary and builds the proxy in release CI', () => {
    assert.match(releaseWorkflow, /npm run build:linux-pty -- --force/)
    assert.match(releaseWorkflow, /prebuilds\/linux-x64\/pty\.node/)
    assert.doesNotMatch(releaseWorkflow, /node:20-bullseye/)
    assert.match(releaseWorkflow, /npm run build:all/)
  })
})
