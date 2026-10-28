// @vitest-environment node
/**
 * 验证执行器：只跑配置里的简单命令，超时/中断/失败都落成可读状态，
 * 失败详情只取尾部关键行，避免把整份日志塞进下一轮提示词。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  parseVerifyCommand,
  runVerification,
  tailOutput,
  scrubEnv,
  type VerifyExecutor,
} from '../verify'

function executor(result: {
  code: number | null
  stdout?: string
  stderr?: string
  timedOut?: boolean
  aborted?: boolean
}): VerifyExecutor & { calls: Array<{ argv: string[]; cwd: string; env: NodeJS.ProcessEnv }> } {
  const calls: Array<{ argv: string[]; cwd: string; env: NodeJS.ProcessEnv }> = []
  const fn = (async (argv, cwd, options) => {
    calls.push({ argv, cwd, env: options.env })
    return {
      code: result.code,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      timedOut: result.timedOut ?? false,
      aborted: result.aborted ?? false,
    }
  }) as VerifyExecutor & { calls: typeof calls }
  fn.calls = calls
  return fn
}

describe('parseVerifyCommand', () => {
  it('splits a simple configured command', () => {
    expect(parseVerifyCommand('npm run test:changed')).toEqual(['npm', 'run', 'test:changed'])
    expect(parseVerifyCommand('pnpm test -- --reporter=dot')).toEqual([
      'pnpm',
      'test',
      '--',
      '--reporter=dot',
    ])
  })

  it('rejects shell composition and unclosed quotes', () => {
    expect(parseVerifyCommand('npm test && rm -rf /')).toBeNull()
    expect(parseVerifyCommand('npm test | tee log')).toBeNull()
    expect(parseVerifyCommand('npm test > out.txt')).toBeNull()
    expect(parseVerifyCommand('npm test $(whoami)')).toBeNull()
    expect(parseVerifyCommand('npm "test')).toBeNull()
    expect(parseVerifyCommand('   ')).toBeNull()
  })
})

describe('tailOutput', () => {
  it('keeps only the trailing lines and caps the character budget', () => {
    const lines = Array.from({ length: 60 }, (_, index) => `line-${index + 1}`)
    const tail = tailOutput(lines.join('\n'), '', 5, 4000)
    expect(tail.split('\n')).toEqual(['line-56', 'line-57', 'line-58', 'line-59', 'line-60'])

    const capped = tailOutput('a'.repeat(100), '', 10, 20)
    expect(capped.length).toBe(20)
    expect(capped.endsWith('a')).toBe(true)
  })

  it('includes stderr after stdout and drops empty lines', () => {
    const tail = tailOutput('ok\n\n', 'boom\n', 10)
    expect(tail.split('\n')).toEqual(['ok', 'boom'])
  })
})

describe('scrubEnv', () => {
  it('removes credentials before running user commands', () => {
    const env = scrubEnv({ PATH: '/bin', GH_TOKEN: 'x', GITHUB_TOKEN: 'y', MY_API_KEY: 'z', HOME: '/home' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home' })
  })
})

describe('runVerification', () => {
  it('runs the command inside the worktree and reports pass', async () => {
    const exec = executor({ code: 0, stdout: 'all good\n' })
    const result = await runVerification(
      { command: 'npm run test:changed', cwd: '/repo/.spacecode/worktrees/bl-1' },
      { exec, now: () => new Date('2026-10-28T10:00:00Z') },
    )
    expect(result).toMatchObject({ status: 'pass', exitCode: 0, at: '2026-10-28T10:00:00.000Z' })
    expect(exec.calls[0].argv).toEqual(['npm', 'run', 'test:changed'])
    expect(exec.calls[0].cwd).toBe('/repo/.spacecode/worktrees/bl-1')
    expect(exec.calls[0].env.GH_TOKEN).toBeUndefined()
  })

  it('turns a non-zero exit into fail with only the tail as detail', async () => {
    const failing = Array.from({ length: 50 }, (_, index) => `failure-${index + 1}`).join('\n')
    const exec = executor({ code: 1, stdout: failing, stderr: 'extra' })
    const result = await runVerification(
      { command: 'npm test', cwd: '/repo' },
      { exec, maxLines: 3, now: () => new Date('2026-10-28T10:00:00Z') },
    )
    expect(result.status).toBe('fail')
    expect(result.exitCode).toBe(1)
    expect(result.detail).toBe('failure-49\nfailure-50\nextra')
  })

  it('reports timeout and stopped separately from a plain failure', async () => {
    const timeout = await runVerification(
      { command: 'npm test', cwd: '/repo' },
      { exec: executor({ code: null, timedOut: true, stdout: 'still running' }) },
    )
    expect(timeout).toMatchObject({ status: 'timeout', detail: 'still running' })

    const controller = new AbortController()
    controller.abort()
    const stopped = await runVerification(
      { command: 'npm test', cwd: '/repo', signal: controller.signal },
      { exec: executor({ code: null, aborted: true }) },
    )
    expect(stopped.status).toBe('stopped')
  })

  it('refuses shell composition without executing anything', async () => {
    const exec = executor({ code: 0 })
    const result = await runVerification({ command: 'npm test && curl x', cwd: '/repo' }, { exec })
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('rejected')
    expect(exec.calls).toHaveLength(0)
  })

  it('maps a spawn failure to fail with the message as detail', async () => {
    const exec = vi.fn(async () => {
      throw new Error('spawn npm ENOENT')
    }) as unknown as VerifyExecutor
    const result = await runVerification({ command: 'npm test', cwd: '/repo' }, { exec })
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('spawn npm ENOENT')
  })
})
