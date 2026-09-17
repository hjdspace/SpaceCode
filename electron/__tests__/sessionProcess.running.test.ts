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
import { proxyManager } from '../proxyManager'

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
    vi.restoreAllMocks()
    proc.removeAllListeners()
  })

  it('uses the proxy-supported Claude route for non-Anthropic providers', () => {
    vi.spyOn(proxyManager, 'getProxyUrl').mockReturnValue('http://127.0.0.1:34567')
    const proxyProc = new SessionProcess('sess-proxy', makeSessionConfig({
      provider: 'openai',
      model: 'sonnet',
    }))

    const args = (proxyProc as any).buildArgs(proxyProc.config) as string[]
    const modelIndex = args.indexOf('--model')

    expect(modelIndex).toBeGreaterThanOrEqual(0)
    expect(args[modelIndex + 1]).toBe('claude-sonnet-4-20250514')
    proxyProc.removeAllListeners()
  })

  it('maps the opus alias to the proxy opus route so input-box model selection survives restarts', () => {
    vi.spyOn(proxyManager, 'getProxyUrl').mockReturnValue('http://127.0.0.1:34567')
    const proxyProc = new SessionProcess('sess-proxy-opus', makeSessionConfig({
      provider: 'openai',
      model: 'opus',
    }))

    const args = (proxyProc as any).buildArgs(proxyProc.config) as string[]
    const modelIndex = args.indexOf('--model')

    expect(modelIndex).toBeGreaterThanOrEqual(0)
    expect(args[modelIndex + 1]).toBe('claude-opus-4-8')
    proxyProc.removeAllListeners()
  })

  it('maps the haiku alias to the proxy haiku route', () => {
    vi.spyOn(proxyManager, 'getProxyUrl').mockReturnValue('http://127.0.0.1:34567')
    const proxyProc = new SessionProcess('sess-proxy-haiku', makeSessionConfig({
      provider: 'openai',
      model: 'haiku',
    }))

    const args = (proxyProc as any).buildArgs(proxyProc.config) as string[]
    const modelIndex = args.indexOf('--model')

    expect(modelIndex).toBeGreaterThanOrEqual(0)
    expect(args[modelIndex + 1]).toBe('claude-haiku-4-8')
    proxyProc.removeAllListeners()
  })

  it('opts the proxy route into 1M context when configured above the default', () => {
    vi.spyOn(proxyManager, 'getProxyUrl').mockReturnValue('http://127.0.0.1:34567')
    const proxyProc = new SessionProcess('sess-proxy-1m', makeSessionConfig({
      provider: 'openai',
      model: 'deepseek-v4-flash',
      modelContextWindows: { 'deepseek-v4-flash': 1_000_000 },
    }))

    const args = (proxyProc as any).buildArgs(proxyProc.config) as string[]
    const modelIndex = args.indexOf('--model')

    expect(args[modelIndex + 1]).toBe('claude-sonnet-4-20250514[1m]')
    proxyProc.removeAllListeners()
  })

  it('opts the proxy route into 1M context for a slot alias when the real model is configured', () => {
    vi.spyOn(proxyManager, 'getProxyUrl').mockReturnValue('http://127.0.0.1:34567')
    const proxyProc = new SessionProcess('sess-proxy-1m-alias', makeSessionConfig({
      provider: 'openai',
      model: 'sonnet',
      modelContextWindows: { 'kimi-k3': 400_000, sonnet: 400_000 },
    }))

    const args = (proxyProc as any).buildArgs(proxyProc.config) as string[]
    const modelIndex = args.indexOf('--model')

    expect(args[modelIndex + 1]).toBe('claude-sonnet-4-20250514[1m]')
    proxyProc.removeAllListeners()
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
