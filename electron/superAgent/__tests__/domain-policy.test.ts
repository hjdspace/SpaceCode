// @vitest-environment node
/**
 * 执行策略领域命令（T12 #82）。
 *
 * 覆盖验收：
 *  - 默认串行（serial/1/none），与 T05 行为一致，不受新代码影响；
 *  - 并行强制 per-ticket worktree：worktree 由 mode 派生，并行不存在共享目录形态；
 *  - 并行上限 2–6、串行固定 1（invalidWorkerLimit）；
 *  - 策略是持久领域事实：落 state.executionPolicy，重水化原样保留、缺失补默认；
 *  - 相同策略重复设置幂等（不推进 seq）。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentDomain } from '../domain'
import type { SuperAgentDomainState } from '../model'

const AT = '2026-01-01T00:00:00.000Z'

function makeDomain(initialState?: SuperAgentDomainState) {
  let counter = 0
  return createSuperAgentDomain({
    now: () => new Date(AT),
    newId: (kind) => `${kind}-${++counter}`,
    ...(initialState ? { initialState } : {}),
  })
}

describe('execution policy defaults', () => {
  it('starts serial with one worker on the shared directory (T05-compatible)', () => {
    const domain = makeDomain()
    expect(domain.state.executionPolicy).toEqual({
      mode: 'serial',
      maxWorkers: 1,
      worktree: 'none',
    })
  })

  it('rehydrates a persisted policy as-is and defaults a missing one (forward compat)', () => {
    const persisted = makeDomain()
    persisted.setExecutionPolicy({ mode: 'parallel', maxWorkers: 3 })
    const rehydrated = makeDomain(
      JSON.parse(JSON.stringify(persisted.state)) as SuperAgentDomainState,
    )
    expect(rehydrated.state.executionPolicy).toEqual({
      mode: 'parallel',
      maxWorkers: 3,
      worktree: 'per-ticket',
    })

    // 旧快照（无 executionPolicy 字段）补默认串行，已有事实原样保留
    const legacySnapshot = JSON.parse(
      JSON.stringify(persisted.state),
    ) as SuperAgentDomainState
    delete (legacySnapshot as { executionPolicy?: unknown }).executionPolicy
    const legacy = makeDomain(legacySnapshot)
    expect(legacy.state.executionPolicy).toEqual({
      mode: 'serial',
      maxWorkers: 1,
      worktree: 'none',
    })
  })
})

describe('setExecutionPolicy validation', () => {
  it('derives per-ticket worktree from parallel mode (no shared-directory parallel)', () => {
    const domain = makeDomain()
    const result = domain.setExecutionPolicy({ mode: 'parallel', maxWorkers: 2 })
    expect(result).toEqual({
      policy: { mode: 'parallel', maxWorkers: 2, worktree: 'per-ticket' },
      changed: true,
    })
    // 并行不存在 worktree='none' 形态：worktree 由 mode 派生，结构上不可能共享目录
    expect(domain.state.executionPolicy.worktree).toBe('per-ticket')
  })

  it('rejects parallel worker limits outside 2..6', () => {
    const domain = makeDomain()
    for (const maxWorkers of [0, 1, 7, 100]) {
      expect(() => domain.setExecutionPolicy({ mode: 'parallel', maxWorkers })).toThrowError(
        expect.objectContaining({ code: 'invalidWorkerLimit' }),
      )
    }
  })

  it('rejects serial mode with a non-default worker limit', () => {
    const domain = makeDomain()
    expect(() => domain.setExecutionPolicy({ mode: 'serial', maxWorkers: 2 })).toThrowError(
      expect.objectContaining({ code: 'invalidWorkerLimit' }),
    )
  })

  it('defaults serial to 1 worker and parallel to 2 when maxWorkers is omitted', () => {
    const domain = makeDomain()
    expect(domain.setExecutionPolicy({ mode: 'serial' }).policy.maxWorkers).toBe(1)
    expect(domain.setExecutionPolicy({ mode: 'parallel' }).policy.maxWorkers).toBe(2)
  })

  it('round-trips back to serial (shared directory)', () => {
    const domain = makeDomain()
    domain.setExecutionPolicy({ mode: 'parallel', maxWorkers: 2 })
    const result = domain.setExecutionPolicy({ mode: 'serial' })
    expect(result.changed).toBe(true)
    expect(domain.state.executionPolicy).toEqual({
      mode: 'serial',
      maxWorkers: 1,
      worktree: 'none',
    })
  })

  it('is idempotent for the same policy (no seq advance)', () => {
    const domain = makeDomain()
    domain.setExecutionPolicy({ mode: 'parallel', maxWorkers: 2 })
    const seq = domain.state.seq
    const result = domain.setExecutionPolicy({ mode: 'parallel', maxWorkers: 2 })
    expect(result.changed).toBe(false)
    expect(domain.state.seq).toBe(seq)
  })
})
