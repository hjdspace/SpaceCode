// @vitest-environment node
/**
 * per-ticket worktree（T12 #82）：并行策略下每个 ticket 复用 Factory worktree
 * 基建建独立工作树（幂等：重试复用同一目录；分支与工厂 agent/task-* 区分）。
 */
import { describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import { createTicketWorktreePreparer, ticketWorktreeBranch } from '../ticketWorktree'
import type { GitExecResult, GitRunner } from '../../factory/worktree'

function ok(stdout = ''): GitExecResult {
  return { ok: true, stdout, stderr: '', timedOut: false }
}

function notOk(stderr: string): GitExecResult {
  return { ok: false, stdout: '', stderr, timedOut: false }
}

// resolve 后才是平台无关的绝对路径：'D:/repo' 在 Linux 上会被当成相对路径。
const REPO = resolve('D:/repo')
const TICKET = 'ticket-00000000-0000-4000-8000-000000000001'

describe('ticketWorktreeBranch', () => {
  it('namespaces super agent ticket branches apart from factory task branches', () => {
    expect(ticketWorktreeBranch(TICKET)).toBe(`agent/superagent-${TICKET}`)
  })
})

describe('createTicketWorktreePreparer', () => {
  it('prepares a worktree under the sandbox root with the ticket branch and current HEAD as base', async () => {
    const commands: string[][] = []
    const git: GitRunner = async (args) => {
      commands.push(args)
      if (args[0] === 'worktree' && args[1] === 'list') return ok('')
      return ok('')
    }
    const preparer = createTicketWorktreePreparer({
      git,
      pathExists: () => false,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    const result = await preparer.prepare(REPO, TICKET)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.worktree.absolute.replace(/\\/g, '/')).toBe(
        join(REPO, '.spacecode', 'worktrees', TICKET).replace(/\\/g, '/'),
      )
      expect(result.worktree.branch).toBe(`agent/superagent-${TICKET}`)
      expect(result.worktree.reused).toBe(false)
    }
    const add = commands.find((args) => args[0] === 'worktree' && args[1] === 'add')
    expect(add).toEqual([
      'worktree',
      'add',
      '-b',
      `agent/superagent-${TICKET}`,
      expect.stringContaining(TICKET),
      'HEAD',
    ])
  })

  it('reuses the same directory on retry (idempotent prepare)', async () => {
    let listed = false
    const git: GitRunner = async (args) => {
      if (args[0] === 'worktree' && args[1] === 'list') {
        listed = true
        return ok(`worktree ${REPO}/.spacecode/worktrees/${TICKET}\nHEAD abc123\nbranch refs/heads/agent/superagent-${TICKET}\n`)
      }
      return ok('')
    }
    const preparer = createTicketWorktreePreparer({
      git,
      pathExists: () => listed,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    })
    const result = await preparer.prepare(REPO, TICKET)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.worktree.reused).toBe(true)
  })

  it('propagates preparation failures (e.g. not a git repo) to the caller', async () => {
    const git: GitRunner = async (args) => {
      if (args[0] === 'worktree' && args[1] === 'list') return notOk('fatal: not a git repository')
      return ok('')
    }
    const preparer = createTicketWorktreePreparer({ git, pathExists: () => false })
    const result = await preparer.prepare(REPO, TICKET)
    expect(result).toMatchObject({ ok: false, error: 'not-git-repo' })
  })

  it('rejects ticket ids outside the task id pattern defensively', async () => {
    const preparer = createTicketWorktreePreparer({ git: async () => ok(''), pathExists: () => false })
    const result = await preparer.prepare(REPO, 'ticket with spaces')
    expect(result).toMatchObject({ ok: false, error: 'invalid-task-id' })
  })
})
