/**
 * Terminal Manager
 * 
 * Manages node-pty terminal instances for the desktop app.
 * Each terminal is identified by a unique ID and communicates
 * with the renderer process via IPC.
 */

import { BrowserWindow, app } from 'electron'
import { randomUUID } from 'crypto'
import * as path from 'path'
import * as fs from 'fs'

/**
 * 加载 node-pty 原生模块
 *
 * 打包后 node-pty 通过 asarUnpack 被展开到 resources/app.asar.unpacked。
 * node-pty 自带的加载器 (lib/utils.js#loadNativeModule) 会按下面顺序
 * 依次尝试 6 个相对路径：
 *   ../build/Release/pty.node, ./build/Release/pty.node,
 *   ../build/Debug/pty.node,   ./build/Debug/pty.node,
 *   ../prebuilds/{platform}-{arch}/pty.node, ./prebuilds/{platform}-{arch}/pty.node
 * 但它的 try/catch 只保留 *最后* 一次失败的 lastError，所以一旦第一次因
 * ABI 不匹配 / 共享库缺失抛错，最终错误会被后续 "Cannot find module" 覆盖，
 * 严重误导排查 (典型现象：build/Release/pty.node 明明存在，却报 prebuilds
 * 路径找不到)。
 *
 * 这里的策略：
 *   1. 在 require('node-pty') 之前，主动定位真实存在的 pty.node 文件，
 *      用 process.dlopen 显式加载并捕获每个候选的真实错误信息；
 *   2. 加载成功后，把 native binding 注入 require.cache，使 node-pty
 *      自带的 require('../build/Release/...') 直接命中缓存，跳过它脆弱的
 *      6 路 fallback，避免不必要的二次 dlopen；
 *   3. 任何阶段失败都输出每个候选的完整错误，便于诊断 (ABI mismatch、
 *      missing libstdc++、文件不存在等)。
 */
function resolveNodePtyDir(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'node-pty'
    )
  }
  // 开发环境：使用 require.resolve 找到 node-pty 的根目录
  const pkgJsonPath = require.resolve('node-pty/package.json')
  return path.dirname(pkgJsonPath)
}

function listCandidatePtyBinaries(nodePtyDir: string): string[] {
  const platArch = `${process.platform}-${process.arch}`
  return [
    path.join(nodePtyDir, 'build', 'Release', 'pty.node'),
    path.join(nodePtyDir, 'build', 'Debug', 'pty.node'),
    path.join(nodePtyDir, 'prebuilds', platArch, 'pty.node'),
    // 备份：递归找一个 (用户手工放置 / 异常构建)
  ]
}

function preloadNativeBinding(absPath: string): { module: any | null; error: Error | null } {
  try {
    const m: any = { exports: {} }
    // 使用 process.dlopen 直接装载 .node，避免再次走 require 解析逻辑
    ;(process as any).dlopen(m, absPath)
    return { module: m.exports, error: null }
  } catch (err) {
    return { module: null, error: err instanceof Error ? err : new Error(String(err)) }
  }
}

function injectIntoRequireCache(absPath: string, exportsObj: any) {
  const Module = require('module')
  // 命中 require.cache 的 key 必须是 path.resolve 后的规范化绝对路径
  const key = path.resolve(absPath)
  if (Module._cache[key]) return
  const fakeMod = new Module(key, null)
  fakeMod.id = key
  fakeMod.filename = key
  fakeMod.loaded = true
  fakeMod.exports = exportsObj
  Module._cache[key] = fakeMod
}

function loadNodePty(): any {
  const nodePtyDir = resolveNodePtyDir()
  const candidates = listCandidatePtyBinaries(nodePtyDir)
  const platArch = `${process.platform}-${process.arch}`

  console.log('[TerminalManager] Diagnosing node-pty:')
  console.log(`  isPackaged: ${app.isPackaged}`)
  console.log(`  resourcesPath: ${process.resourcesPath}`)
  console.log(`  nodePtyDir: ${nodePtyDir}`)
  console.log(`  nodePtyDir exists: ${fs.existsSync(nodePtyDir)}`)
  for (const c of candidates) {
    console.log(`  candidate exists [${fs.existsSync(c) ? 'yes' : 'no '}]: ${c}`)
  }

  const errors: string[] = []
  let nativeBinding: any = null
  let nativeBindingPath: string | null = null

  for (const c of candidates) {
    if (!fs.existsSync(c)) {
      errors.push(`  - ${c}: file not found`)
      continue
    }
    const result = preloadNativeBinding(c)
    if (result.module) {
      nativeBinding = result.module
      nativeBindingPath = c
      console.log(`[TerminalManager] Successfully dlopen'd: ${c}`)
      break
    }
    errors.push(`  - ${c}: ${result.error?.message ?? 'unknown error'}`)
  }

  if (!nativeBinding) {
    // 最后兜底：交给 node-pty 自己的 require (开发环境通常足够)
    try {
      console.log('[TerminalManager] Falling back to plain require(node-pty)')
      return require(app.isPackaged ? nodePtyDir : 'node-pty')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`  - require(node-pty): ${msg}`)

      // 检测典型的 glibc 版本过低错误，给出明确的中文诊断提示
      const allErrors = errors.join('\n')
      const glibcMatch = allErrors.match(/GLIBC_([0-9.]+)['`]?\s+not found/i)
      if (glibcMatch && process.platform === 'linux') {
        const requiredGlibc = glibcMatch[1]
        throw new Error(
          `[node-pty] 当前系统 glibc 版本过低，无法加载 pty.node。\n` +
          `打包时使用的二进制需要 GLIBC_${requiredGlibc}，但当前发行版未提供该版本。\n` +
          `常见于 Ubuntu 20.04 / Debian 11 / RHEL 8 等较老的 Linux 发行版。\n` +
          `\n建议：\n` +
          `  1) 升级到较新的发行版（Ubuntu 22.04+ / Debian 12+ / RHEL 9+）；或\n` +
          `  2) 等待官方发布在低版本 glibc 上重编译的 AppImage；或\n` +
          `  3) 自行从源码运行（npm ci && npm run electron:build:linux）。\n` +
          `\n详细诊断:\n${allErrors}`
        )
      }

      throw new Error(
        `Failed to load node-pty pty.node native binding for ${platArch}. ` +
        `Make sure @electron/rebuild has been run for the target Electron ABI ` +
        `before packaging (typical fix: \`npx @electron/rebuild -f -w node-pty\`).\n` +
        `Attempted binaries:\n${allErrors}`
      )
    }
  }

  // 关键：把已加载的 native 模块注入 require.cache，这样 node-pty 自带的
  // require('../build/Release/pty.node') 等会直接命中缓存，不会再触发 dlopen。
  // 同时为同一个文件的多个等价绝对路径都注入一份，覆盖 './' 与 '../' 两种写法。
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      injectIntoRequireCache(c, nativeBinding)
    }
  }
  // 也注入实际加载成功的那个路径 (大概率与上面重复，但保险)
  if (nativeBindingPath) {
    injectIntoRequireCache(nativeBindingPath, nativeBinding)
  }

  // 再 require 包入口；它内部的 loadNativeModule 会因 require.cache 命中而成功
  try {
    return require(app.isPackaged ? nodePtyDir : 'node-pty')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `Loaded pty.node successfully from ${nativeBindingPath}, but require('node-pty') ` +
      `still failed: ${msg}\nPrior attempts:\n${errors.join('\n')}`
    )
  }
}

let pty: any
let ptyLoadError: Error | null = null
let ptyLoaded = false

function ensurePtyLoaded() {
  if (ptyLoaded) return
  ptyLoaded = true
  try {
    pty = loadNodePty()
    console.log('[TerminalManager] node-pty loaded successfully')
  } catch (error) {
    ptyLoadError = error as Error
    console.warn(
      '[TerminalManager] node-pty not available, terminal feature will be disabled:',
      error
    )
  }
}

interface TerminalInstance {
  id: string
  ptyProcess: any
  isAlive: boolean
  shell: string
}

export class TerminalManager {
  private terminals: Map<string, TerminalInstance> = new Map()

  create(cwd?: string, command?: string, env?: Record<string, string>): { id: string; shell: string } {
    ensurePtyLoaded()
    if (!pty) {
      const baseMsg = 'node-pty is not available'
      if (ptyLoadError) {
        throw new Error(`${baseMsg}: ${ptyLoadError.message}`)
      }
      throw new Error(baseMsg)
    }

    const id = randomUUID()
    const shell = command || this.getDefaultShell()
    const args = this.getShellArgs(shell)

    try {
      const ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: cwd || process.cwd(),
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          ...(env || {}),
        }
      })

      const instance: TerminalInstance = {
        id,
        ptyProcess,
        isAlive: true,
        shell
      }

      // Forward terminal output to renderer
      ptyProcess.onData((data: string) => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win && !win.isDestroyed()) {
          try {
            win.webContents.send('terminal:data', id, data)
          } catch (error) {
            console.error('[Terminal] Failed to send data:', error)
          }
        }
      })

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        instance.isAlive = false
        const win = BrowserWindow.getAllWindows()[0]
        if (win && !win.isDestroyed()) {
          try {
            win.webContents.send('terminal:exit', id, exitCode)
          } catch (error) {
            console.error('[Terminal] Failed to send exit event:', error)
          }
        }
        this.terminals.delete(id)
        console.log('[Terminal] Process exited:', id, 'code:', exitCode)
      })

      this.terminals.set(id, instance)
      return { id, shell }
    } catch (error) {
      console.error('[Terminal] Failed to spawn process:', error)
      throw error
    }
  }

  write(id: string, data: string): void {
    const instance = this.terminals.get(id)
    if (instance?.isAlive) {
      try {
        instance.ptyProcess.write(data)
      } catch (error) {
        console.error('[Terminal] Failed to write:', error)
      }
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.terminals.get(id)
    if (instance?.isAlive) {
      try {
        instance.ptyProcess.resize(cols, rows)
      } catch (error) {
        // Ignore resize errors - can happen during terminal shutdown
      }
    }
  }

  kill(id: string): void {
    const instance = this.terminals.get(id)
    if (instance) {
      instance.isAlive = false
      const pid = instance.ptyProcess?.pid
      try {
        // Windows 上使用 taskkill /F /T 强制终止整个进程树
        if (process.platform === 'win32' && pid) {
          try {
            const { execSync } = require('child_process')
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 5000 })
            console.log('[Terminal] Process tree killed via taskkill:', id, 'pid:', pid)
          } catch {
            // taskkill 失败时回退到默认 kill
            instance.ptyProcess.kill()
          }
        } else {
          // Unix/Linux/macOS 使用 SIGKILL 强制终止
          instance.ptyProcess.kill('SIGKILL')
        }
      } catch (error) {
        console.error('[Terminal] Failed to kill process:', error)
      }
      this.terminals.delete(id)
    }
  }

  killAll(): void {
    for (const [id] of this.terminals) {
      this.kill(id)
    }
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      // 1. 优先检测 PowerShell 7 (pwsh.exe) — 更现代的版本
      const pwshPath = path.join(
        process.env.ProgramFiles || 'C:\\Program Files',
        'PowerShell', '7', 'pwsh.exe'
      )
      if (fs.existsSync(pwshPath)) return pwshPath

      // 2. Windows PowerShell (系统自带) — 与 VSCode 等主流 IDE 行为一致，默认使用 PowerShell
      const psPath = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
      )
      if (fs.existsSync(psPath)) return psPath

      // 3. 兜底：通过 ComSpec 环境变量获取系统默认命令解释器（cmd.exe）
      if (process.env.ComSpec) {
        const comSpec = process.env.ComSpec
        if (fs.existsSync(comSpec)) return comSpec
      }

      return 'powershell.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }

  private getShellArgs(shell: string): string[] {
    if (process.platform === 'win32') {
      // 不传 -NoLogo，让用户 profile 正常加载（别名、提示符、模块等）
      return []
    }
    // For Unix shells, start in login mode
    if (shell.includes('zsh') || shell.includes('bash')) {
      return ['-l']
    }
    return []
  }
}
