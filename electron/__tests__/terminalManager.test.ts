import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

import { TerminalManager } from '../terminalManager'

describe('TerminalManager shell startup', () => {
  const originalPlatform = process.platform
  const originalShell = process.env.SHELL

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    if (originalShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = originalShell
    }
  })

  it('uses the shell inherited from the desktop application environment', () => {
    process.env.SHELL = '/bin/zsh'

    const manager = new TerminalManager()

    expect(manager['getDefaultShell']()).toBe('/bin/zsh')
  })

  it.each(['/bin/zsh', '/bin/bash', '/bin/tcsh'])(
    'starts %s as an interactive non-login shell',
    (shell) => {
      const manager = new TerminalManager()

      expect(manager['getShellArgs'](shell)).toEqual([])
    },
  )
})
