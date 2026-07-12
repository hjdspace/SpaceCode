import { electronAPI } from './_context'

export const terminal = {
  create: (options?: { cwd?: string; command?: string; env?: Record<string, string> }): Promise<{ id: string | null; shell?: string; error?: string }> => {
    if (electronAPI?.terminal) {
      return electronAPI.terminal.create(options)
    }
    return Promise.resolve({ id: null, error: 'Terminal API not available' })
  },
  write: (id: string, data: string) => electronAPI?.terminal?.write(id, data),
  resize: (id: string, cols: number, rows: number) => electronAPI?.terminal?.resize(id, cols, rows),
  kill: (id: string) => electronAPI?.terminal?.kill(id),
  runCommand: (id: string, command: string) => electronAPI?.terminal?.runCommand(id, command),
  onData: (callback: (id: string, data: string) => void): (() => void) => {
    if (electronAPI?.terminal) {
      return electronAPI.terminal.onData(callback)
    }
    return () => {}
  },
  onExit: (callback: (id: string, exitCode: number) => void): (() => void) => {
    if (electronAPI?.terminal) {
      return electronAPI.terminal.onExit(callback)
    }
    return () => {}
  },
}
