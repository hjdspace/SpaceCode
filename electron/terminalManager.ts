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
 * node-pty 内部会查找以下三个相对路径中的一个以定位 pty.node:
 *   - ../build/Release/pty.node
 *   - ../build/Debug/pty.node
 *   - ../prebuilds/{platform}-{arch}/pty.node
 *
 * Linux 上官方不提供 prebuilds，必须通过 electron-rebuild (或 @electron/rebuild)
 * 在打包前用 Electron 的 Node ABI 重新编译 node-pty，生成 build/Release/pty.node。
 *
 * 这里的加载策略参考 VSCode 的做法：
 *   1. 先尝试 app.asar.unpacked 下的路径 (打包环境)
 *   2. 再尝试普通 require (开发环境 / 回退)
 *   3. 每次失败都输出详细诊断信息，方便排查
 */
function loadNodePty(): any {
  const tried: string[] = []
  const errors: string[] = []

  const logAttempt = (p: string, err: unknown) => {
    tried.push(p)
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`  - ${p}: ${msg}`)
  }

  // 1) 打包环境：优先从 app.asar.unpacked 加载
  if (app.isPackaged) {
    const unpackedPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'node-pty'
    )

    // 先打个诊断：检查关键文件是否真的存在
    const expectedBinary = path.join(
      unpackedPath,
      'build',
      'Release',
      'pty.node'
    )
    const expectedPrebuild = path.join(
      unpackedPath,
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'pty.node'
    )

    console.log('[TerminalManager] Diagnosing node-pty in packaged app:')
    console.log(`  resourcesPath: ${process.resourcesPath}`)
    console.log(`  unpackedPath exists: ${fs.existsSync(unpackedPath)}`)
    console.log(`  build/Release/pty.node exists: ${fs.existsSync(expectedBinary)}`)
    console.log(`  prebuilds/${process.platform}-${process.arch}/pty.node exists: ${fs.existsSync(expectedPrebuild)}`)

    try {
      return require(unpackedPath)
    } catch (err) {
      logAttempt(unpackedPath, err)
    }

    // 再尝试 asar 内的 (虽然多半加载不了 .node，但万一 electron 做了重定向)
    const asarPath = path.join(
      process.resourcesPath,
      'app.asar',
      'node_modules',
      'node-pty'
    )
    try {
      return require(asarPath)
    } catch (err) {
      logAttempt(asarPath, err)
    }
  }

  // 2) 开发环境或 fallback：普通 require
  try {
    return require('node-pty')
  } catch (err) {
    logAttempt('node-pty (resolved via require)', err)
  }

  throw new Error(
    `Failed to load node-pty from any location. Tried:\n${errors.join('\n')}`
  )
}

let pty: any
let ptyLoadError: Error | null = null
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

interface TerminalInstance {
  id: string
  ptyProcess: any
  isAlive: boolean
}

export class TerminalManager {
  private terminals: Map<string, TerminalInstance> = new Map()

  create(cwd?: string, command?: string, env?: Record<string, string>): string {
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
        isAlive: true
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
      return id
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
      return 'powershell.exe'
    }
    return process.env.SHELL || '/bin/sh'
  }

  private getShellArgs(shell: string): string[] {
    if (process.platform === 'win32') {
      if (shell.toLowerCase().includes('powershell') || shell.toLowerCase().includes('pwsh')) {
        return ['-NoLogo']
      }
      return []
    }
    // For Unix shells, start in login mode
    if (shell.includes('zsh') || shell.includes('bash')) {
      return ['-l']
    }
    return []
  }
}
