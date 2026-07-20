#!/usr/bin/env node
/**
 * 本地构建包装脚本：在调用 electron-builder 之前注入环境变量，
 * 用于绕过企业代理 / 自签名证书导致的 TLS 校验失败问题。
 *
 * 设置的环境变量：
 *   - NODE_TLS_REJECT_UNAUTHORIZED=0              关闭 Node 的 TLS 证书校验（仅本地构建使用）
 *   - ELECTRON_MIRROR                              electron 预构建二进制镜像（淘宝）
 *   - ELECTRON_BUILDER_BINARIES_MIRROR             electron-builder 依赖（winCodeSign/nsis 等）镜像
 *
 * 若用户已显式设置上述变量，则保留用户值不覆盖。
 *
 * 用法：
 *   npm run electron:build:win:local     # 构建 Windows 安装包
 *   npm run electron:build:mac:local     # 构建 macOS 安装包
 *   npm run electron:build:linux:local   # 构建 Linux 安装包
 *
 * 注意：此脚本仅用于本地构建，CI 环境请使用原 electron:build:* 脚本。
 */

const { spawnSync } = require('child_process')
const { resolve } = require('path')
const { existsSync } = require('fs')

// ===== 注入环境变量（仅当用户未显式设置时）=====

if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  console.log('[local-build] NODE_TLS_REJECT_UNAUTHORIZED=0 (绕过企业代理 TLS 校验)')
}

if (!process.env.ELECTRON_MIRROR) {
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  console.log('[local-build] ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/')
}

if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
  console.log('[local-build] ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/')
}

// ===== 解析平台参数 =====

const platformArg = process.argv.slice(2).find(a => a.startsWith('--'))
const platformFlag = platformArg || ''
const target = platformFlag.replace(/^--/, '') // win / mac / linux

// ===== 调用原生 electron:build:{target} 脚本 =====
// 通过 npm run 调用，自动复用 icons/copy-bun/engine 等前置步骤

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const scriptName = target ? `electron:build:${target}` : 'electron:build'

console.log(`[local-build] 执行: npm run ${scriptName}`)
console.log('---')

const result = spawnSync(npmCmd, ['run', scriptName], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
})

if (result.error) {
  console.error('[local-build] 启动失败:', result.error.message)
  process.exit(1)
}

process.exit(result.status || 0)
