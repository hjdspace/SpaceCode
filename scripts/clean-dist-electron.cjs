/**
 * 打包前清空 Electron 产物，去掉上一轮遗留的 hash chunk。
 * 只挂在 electron:build* 链上，不作为 build 的 prebuild 钩子：dev 与 prod 共用
 * dist-electron/，而 `npm run build` 是每次改动的验证命令，先删目录会把正在运行的
 * dev 实例的 preload.js 抽走（渲染进程静默失去 contextBridge）。
 */
const { rmSync } = require('node:fs')
const { resolve } = require('node:path')

const outputDir = resolve(__dirname, '..', 'dist-electron')

rmSync(outputDir, { recursive: true, force: true })
