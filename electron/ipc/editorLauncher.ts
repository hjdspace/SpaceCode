/**
 * External editor launcher — spawns VS Code, Cursor, terminal, etc.
 * for "Open in Editor" context-menu actions.
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { error } from '../infra/logger'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

export type ExternalEditor = 'vscode' | 'visualstudio' | 'cursor' | 'fileExplorer' | 'terminal' | 'gitBash' | 'wsl' | 'androidStudio'

interface EditorLauncher {
  id: ExternalEditor
  command: (targetPath: string) => string
  args: (targetPath: string) => string[]
  raw?: boolean
}

/** Convert a Windows path to a WSL-friendly POSIX path. */
function toWslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
  if (!m) return p.replace(/\\/g, '/')
  const drive = m[1].toLowerCase()
  const rest = m[2].replace(/\\/g, '/')
  return `/mnt/${drive}/${rest}`
}

export const EDITOR_LAUNCHERS: Record<ExternalEditor, EditorLauncher> = {
  vscode: {
    id: 'vscode',
    command: () => 'code',
    args: (p) => ['-r', p],
  },
  visualstudio: {
    id: 'visualstudio',
    command: () => (isWin ? 'devenv' : 'visualstudio'),
    args: (p) => [p],
  },
  cursor: {
    id: 'cursor',
    command: () => 'cursor',
    args: (p) => [p],
  },
  fileExplorer: {
    id: 'fileExplorer',
    command: () => (isWin ? 'explorer.exe' : isMac ? 'open' : 'xdg-open'),
    args: (p) => [p],
    raw: isWin,
  },
  terminal: {
    id: 'terminal',
    command: () => {
      if (isWin) return 'cmd.exe'
      if (isMac) return 'open'
      return 'x-terminal-emulator'
    },
    args: (p) => {
      if (isWin) return ['/c', 'start', '""', '/D', p, 'cmd.exe', '/K', 'cd', '/d', p]
      if (isMac) return ['-a', 'Terminal', p]
      return ['--working-directory', p]
    },
  },
  gitBash: {
    id: 'gitBash',
    command: () => {
      if (isWin) return 'C:\\Program Files\\Git\\git-bash.exe'
      if (isMac) return '/Applications/GitHub Desktop.app/Contents/Resources/git-bash'
      return 'git-bash'
    },
    args: (p) => (isWin ? [`--cd=${p}`] : ['-c', `cd '${p}' && exec $SHELL`]),
  },
  wsl: {
    id: 'wsl',
    command: () => 'wsl.exe',
    args: (p) => ['--cd', toWslPath(p)],
  },
  androidStudio: {
    id: 'androidStudio',
    command: () => {
      if (isWin) return 'studio64.exe'
      if (isMac) return '/Applications/Android Studio.app/Contents/MacOS/studio'
      return 'studio'
    },
    args: (p) => [p],
  },
}

export function openPathInEditor(editor: ExternalEditor, targetPath: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!targetPath || !existsSync(targetPath)) {
      resolve({ success: false, error: 'Path does not exist' })
      return
    }

    const launcher = EDITOR_LAUNCHERS[editor]
    if (!launcher) {
      resolve({ success: false, error: `Unsupported editor: ${editor}` })
      return
    }

    const command = launcher.command(targetPath)
    const args = launcher.args(targetPath)
    const useShell = !launcher.raw

    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: useShell,
    })

    let settled = false
    child.once('error', (err) => {
      settled = true
      error('IPC', 'app:openInEditor failed', { editor, targetPath, command, err })
      resolve({ success: false, error: err.message })
    })
    child.once('spawn', () => {
      child.unref()
      setTimeout(() => {
        if (!settled) {
          settled = true
          resolve({ success: true })
        }
      }, 100)
    })
  })
}
