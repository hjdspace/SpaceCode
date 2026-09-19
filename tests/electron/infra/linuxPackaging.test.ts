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

  it('executes the Pi CLI from app.asar.unpacked when packaged', () => {
    assert.match(piSessionProcess, /app\.asar\.unpacked/)
    assert.match(piSessionProcess, /child process cannot execute a script from inside/)
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
