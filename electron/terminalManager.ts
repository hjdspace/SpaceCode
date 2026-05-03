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

// Use require for node-pty since it's a native module
let pty: any
try {
  // 在打包环境中，需要确保能正确找到原生模块
  if (app.isPackaged) {
    // 尝试从 app.asar.unpacked 路径加载
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty')
    try {
      pty = require(unpackedPath)
    } catch {
      // 如果失败，回退到正常 require
      pty = require('node-pty')
    }
  } else {
    pty = require('node-pty')
  }
} catch (error) {
  console.warn('[TerminalManager] node-pty not available, terminal feature will be disabled:', error)
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
      throw new Error('node-pty is not available')
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
