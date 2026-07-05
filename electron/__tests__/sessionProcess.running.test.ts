/**
 * Behavioral tests for SessionProcess.isRunning() and sendMessage() guards.
 *
 * These target the bug where isRunning() reported true because the ChildProcess
 * object still existed, even though its stdin was no longer writable. The front
 * end then treated the session as alive, setPermissionMode failed with
 * "No active process", and user messages were written to a closed stream.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionProcess, SessionConfig } from '../sessionProcess'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/spacecode-test-userdata'
      return '/tmp'
    }),
  },
}))

function makeSessionConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    cwd: '/tmp',
    permissionMode: 'default',
    ...overrides,
  }
}

function makeFakeProcess(writable: boolean, killed = false): any {
  return {
    pid: 1234,
    killed,
    stdin: {
      writable,
      write: vi.fn(),
    },
  }
}

describe('SessionProcess — running state reflects writable stdin', () => {
  let proc: SessionProcess

  beforeEach(() => {
    proc = new SessionProcess('sess-test', makeSessionConfig())
  })

  afterEach(() => {
    proc.removeAllListeners()
  })

  it('isRunning returns true when process exists and stdin is writable', () => {
    proc.process = makeFakeProcess(true)
    expect(proc.isRunning()).toBe(true)
  })

  it('isRunning returns false when process exists but stdin is not writable', () => {
    proc.process = makeFakeProcess(false)
    expect(proc.isRunning()).toBe(false)
  })

  it('isRunning returns false when process is null', () => {
    proc.process = null
    expect(proc.isRunning()).toBe(false)
  })

  it('isRunning returns false when process has been killed', () => {
    proc.process = makeFakeProcess(true, true)
    expect(proc.isRunning()).toBe(false)
  })

  it('sendMessage throws "No active process" when stdin is not writable', () => {
    proc.process = makeFakeProcess(false)
    expect(() => proc.sendMessage('hello')).toThrow('No active process')
  })
})
