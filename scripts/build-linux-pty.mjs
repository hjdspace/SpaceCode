/**
 * Build node-pty for Linux against the CentOS/RHEL 8 glibc baseline.
 *
 * node-pty has no Linux prebuild. Building it on a current distro can make
 * pty.node require GLIBC newer than 2.28, which prevents terminals from
 * starting on CentOS 8. Docker keeps the build and ABI baseline reproducible.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PTY_DIR = join(ROOT, 'node_modules', 'node-pty')
const BUILD_DIR = join(PTY_DIR, 'build')
const PREBUILD_FILE = join(PTY_DIR, 'prebuilds', 'linux-x64', 'pty.node')
const CACHE_DIR = join(ROOT, '.cache', 'linux-pty')
const CACHE_FILE = join(CACHE_DIR, 'pty.node')
const VERSION_FILE = join(CACHE_DIR, '.version')
const BUILD_PROFILE = 'rockylinux8-glibc228-static-cxx-v1'
const DOCKER_NODE_VERSION = '22.18.0'
const DEFAULT_NODEJS_MIRROR = process.env.CI
  ? 'https://nodejs.org/dist'
  : 'https://npmmirror.com/mirrors/node'
const NODEJS_MIRROR = (process.env.NODEJS_MIRROR || DEFAULT_NODEJS_MIRROR).replace(/\/$/, '')

function packageVersion(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8')).version
}

function dockerAvailable() {
  const result = spawnSync('docker', ['--version'], { stdio: 'ignore' })
  return result.status === 0
}

function registry() {
  if (process.env.NPM_REGISTRY) return process.env.NPM_REGISTRY
  try {
    const npmrc = readFileSync(join(ROOT, '.npmrc'), 'utf8')
    const match = npmrc.match(/^registry\s*=\s*(.+)$/m)
    if (match) return match[1].trim()
  } catch {
    // Use the public registry when no project .npmrc is available.
  }
  return 'https://registry.npmjs.org/'
}

function versionMatches(key) {
  try {
    return readFileSync(VERSION_FILE, 'utf8').trim() === key
  } catch {
    return false
  }
}

function buildInRockyLinux(electronVersion, ptyVersion) {
  mkdirSync(CACHE_DIR, { recursive: true })
  const mountedCache = CACHE_DIR.replace(/\\/g, '/')
  const script = [
    'set -euo pipefail',
    'dnf install -y gcc-toolset-10-gcc gcc-toolset-10-gcc-c++ make python39 tar gzip xz curl binutils > /dev/null',
    `curl -fsSL ${NODEJS_MIRROR}/v${DOCKER_NODE_VERSION}/node-v${DOCKER_NODE_VERSION}-linux-x64.tar.gz | tar -xz -C /usr/local --strip-components=1`,
    'export MANPATH="${MANPATH:-}"',
    'source /opt/rh/gcc-toolset-10/enable',
    'export PYTHON=/usr/bin/python3.9',
    'export npm_config_python=/usr/bin/python3.9',
    'export LDFLAGS="-static-libstdc++ -static-libgcc"',
    'rm -rf /tmp/pty-build && mkdir -p /tmp/pty-build && cd /tmp/pty-build',
    'npm init -y > /dev/null',
    `npm install node-pty@${ptyVersion} --ignore-scripts --registry ${registry()} 2>&1 | tail -5`,
    `npx @electron/rebuild@4.2.0 -v ${electronVersion} -f -w node-pty --arch x64 --build-from-source 2>&1 | tail -20`,
    'required_glibc=$(readelf --version-info node_modules/node-pty/build/Release/pty.node | grep -o "GLIBC_[0-9.]*" | sort -Vu | tail -1)',
    'required_glibcxx=$(readelf --version-info node_modules/node-pty/build/Release/pty.node | grep -o "GLIBCXX_[0-9.]*" | sort -Vu | tail -1)',
    'echo "[build-linux-pty] Maximum required glibc: $required_glibc"',
    'echo "[build-linux-pty] Maximum required glibcxx: ${required_glibcxx:-none}"',
    'test -n "$required_glibc"',
    'test "$(printf "%s\\n" "$required_glibc" "GLIBC_2.28" | sort -V | tail -1)" = "GLIBC_2.28"',
    'test -z "$required_glibcxx" || test "$(printf "%s\\n" "$required_glibcxx" "GLIBCXX_3.4.25" | sort -V | tail -1)" = "GLIBCXX_3.4.25"',
    '! readelf -d node_modules/node-pty/build/Release/pty.node | grep -q "libstdc++.so"',
    '! ldd node_modules/node-pty/build/Release/pty.node | grep -q "not found"',
    'node -e \'const pty=require("./node_modules/node-pty");let out="";const p=pty.spawn("/bin/bash",[],{cols:80,rows:24});const t=setTimeout(()=>process.exit(1),5000);p.onData(d=>out+=d);p.onExit(e=>{clearTimeout(t);process.exit(e.exitCode===0&&out.includes("__PTY_OK__")?0:1)});p.resize(100,30);p.write("echo __PTY_OK__; exit\\n")\'',
    'mkdir -p /output && cp node_modules/node-pty/build/Release/pty.node /output/pty.node',
  ].join(' && ')
  const args = ['run', '--rm', '--platform', 'linux/amd64', '-v', `${mountedCache}:/output`, 'rockylinux:8', 'bash', '-c', script]
  const result = spawnSync('docker', args, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('Docker node-pty build failed; ensure Docker is running and can reach the npm registry.')
}

if (!existsSync(PTY_DIR)) {
  console.error('[build-linux-pty] node_modules/node-pty not found; run npm install first.')
  process.exit(1)
}

const electronVersion = packageVersion(join(ROOT, 'node_modules', 'electron', 'package.json'))
const ptyVersion = packageVersion(join(PTY_DIR, 'package.json'))
const versionKey = `electron-${electronVersion}_pty-${ptyVersion}_${BUILD_PROFILE}`
const force = process.argv.includes('--force')

if (!force && existsSync(PREBUILD_FILE) && versionMatches(versionKey)) {
  rmSync(BUILD_DIR, { recursive: true, force: true })
  console.log(`[build-linux-pty] Reusing verified prebuild (${(statSync(PREBUILD_FILE).size / 1024).toFixed(0)} KB).`)
  process.exit(0)
}

if (!dockerAvailable()) {
  console.error('[build-linux-pty] Docker is required to build the CentOS 8-compatible Linux binary.')
  process.exit(1)
}

console.log(`[build-linux-pty] Building Electron ${electronVersion} / node-pty ${ptyVersion} in Rocky Linux 8...`)
buildInRockyLinux(electronVersion, ptyVersion)
if (!existsSync(CACHE_FILE)) throw new Error(`Docker output missing: ${CACHE_FILE}`)
mkdirSync(dirname(PREBUILD_FILE), { recursive: true })
copyFileSync(CACHE_FILE, PREBUILD_FILE)
rmSync(BUILD_DIR, { recursive: true, force: true })
mkdirSync(CACHE_DIR, { recursive: true })
writeFileSync(VERSION_FILE, versionKey, 'utf8')
console.log(`[build-linux-pty] Wrote ${PREBUILD_FILE}`)
