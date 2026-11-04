// @vitest-environment node
/**
 * Service 层执行策略与检查点（T12 #82）。
 *
 * 覆盖验收：
 *  - policy 读默认串行；setPolicy 并行需 confirmed（UI 二次确认）且要求 git 仓库；
 *  - 运行中不热切换：有 Worker 占槽 → policyChangeBlocked；
 *  - 策略变更持久化（domain state）并即时生效（queue().maxWorkers 跟随）；
 *  - checkpoint 返回最新检查点 + 检查点后新增的脏文件清单（回退候选）；
 *  - checkpointRollback 委托检查点存储按文件显式回退。
 */
import { describe, expect, it, vi } from 'vitest'
import { createSuperAgentService } from '../service'
import type { SuperAgentCheckpointStore } from '../checkpoint'
import type { SuperAgentWorkspaceStatus, WorkspaceProbe } from '../workspace'
import type { WorkerLauncher } from '../scheduler'

const REPO = 'D:/repo'

function makeWorkspace(overrides: Partial<SuperAgentWorkspaceStatus> = {}): SuperAgentWorkspaceStatus {
  return {
    head: 'abc123',
    dirty: false,
    statusText: '',
    entries: [],
    ...overrides,
  }
}

interface Harness {
  service: ReturnType<typeof createSuperAgentService>
  checkpoints: SuperAgentCheckpointStore & { saveMock: ReturnType<typeof vi.fn> }
  probe: WorkspaceProbe
}

function makeHarness(overrides: { launcher?: WorkerLauncher | null } = {}): Harness {
  const saveMock = vi.fn(async () => {})
  const checkpoints: SuperAgentCheckpointStore & { saveMock: ReturnType<typeof vi.fn> } = {
    saveMock,
    save: saveMock,
    latest: vi.fn(() => null),
    rollbackFiles: vi.fn(async (_repoRoot: string, files: string[]) => ({
      rolled: files,
      skipped: [],
    })),
  }
  const probe: WorkspaceProbe = {
    probe: vi.fn(async () => makeWorkspace()),
  }
  const service = createSuperAgentService({
    launcher: overrides.launcher ?? null,
    probe,
    checkpoints,
  })
  return { service, checkpoints, probe }
}

describe('service policy', () => {
  it('reads the default serial policy', () => {
    const h = makeHarness()
    const view = h.service.executionPolicy(REPO)
    expect(view.policy).toEqual({ mode: 'serial', maxWorkers: 1, worktree: 'none' })
  })

  it('switches to parallel when confirmed and the repoRoot is a git repository', async () => {
    const h = makeHarness()
    const view = await h.service.setExecutionPolicy(REPO, {
      mode: 'parallel',
      maxWorkers: 3,
      confirmed: true,
    })
    expect(view.policy).toEqual({ mode: 'parallel', maxWorkers: 3, worktree: 'per-ticket' })
    // 即时生效：队列快照跟随新上限
    expect(h.service.queue(REPO).maxWorkers).toBe(3)
  })

  it('requires explicit confirmation to enable parallel', async () => {
    const h = makeHarness()
    await expect(
      h.service.setExecutionPolicy(REPO, { mode: 'parallel', maxWorkers: 2 }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'policyConfirmRequired' }))
    expect(h.service.executionPolicy(REPO).policy.mode).toBe('serial')
  })

  it('refuses parallel when the repoRoot is not a git repository', async () => {
    const h = makeHarness()
    const probe: WorkspaceProbe = {
      probe: vi.fn(async () =>
        makeWorkspace({ head: null, dirty: false, statusText: '工作区状态不可用' }),
      ),
    }
    const service = createSuperAgentService({ launcher: null, probe, checkpoints: h.checkpoints })
    await expect(
      service.setExecutionPolicy(REPO, { mode: 'parallel', maxWorkers: 2, confirmed: true }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'worktreeUnavailable' }))
    expect(service.executionPolicy(REPO).policy.mode).toBe('serial')
  })

  it('refuses policy changes while a worker occupies a slot (no hot switching)', async () => {
    // launcher 挂起 → dispatch 后槽位被占用
    const launcher: WorkerLauncher = { launch: () => new Promise<void>(() => {}) }
    const h = makeHarness({ launcher })
    h.service.dispatch(REPO, {
      requestId: 'd1',
      title: '工单一',
      text: '目标',
      actor: 'person',
    })
    expect(h.service.queue(REPO).running).toHaveLength(1)

    await expect(
      h.service.setExecutionPolicy(REPO, { mode: 'parallel', maxWorkers: 2, confirmed: true }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'policyChangeBlocked' }))
    expect(h.service.executionPolicy(REPO).policy.mode).toBe('serial')
  })

  it('is idempotent when the policy is unchanged (no gate)', async () => {
    const h = makeHarness()
    const view = await h.service.setExecutionPolicy(REPO, { mode: 'serial' })
    expect(view.policy.mode).toBe('serial')
  })

  it('round-trips back to serial and drains the queue cap immediately', async () => {
    const h = makeHarness()
    await h.service.setExecutionPolicy(REPO, { mode: 'parallel', maxWorkers: 3, confirmed: true })
    const view = await h.service.setExecutionPolicy(REPO, { mode: 'serial' })
    expect(view.policy).toEqual({ mode: 'serial', maxWorkers: 1, worktree: 'none' })
    expect(h.service.queue(REPO).maxWorkers).toBe(1)
  })
})

describe('service checkpoint', () => {
  it('returns no checkpoint and no changed files before any launch', async () => {
    const h = makeHarness()
    const info = await h.service.checkpoint(REPO)
    expect(info).toEqual({ repoRoot: REPO, checkpoint: null, changedFiles: [] })
  })

  it('lists files dirtied after the checkpoint as rollback candidates', async () => {
    const h = makeHarness()
    ;(h.checkpoints.latest as ReturnType<typeof vi.fn>).mockReturnValue({
      repoRoot: REPO,
      savedAt: '2026-01-01T00:00:00.000Z',
      head: 'abc123',
      entries: ['src/pre-existing.ts'],
      statusText: ' M src/pre-existing.ts\n',
      patch: null,
    })
    ;(h.probe.probe as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeWorkspace({ statusText: ' M src/pre-existing.ts\n?? src/added.ts\n' }),
    )
    const info = await h.service.checkpoint(REPO)
    expect(info.checkpoint).toMatchObject({ head: 'abc123', entries: ['src/pre-existing.ts'] })
    expect(info.changedFiles).toEqual(['src/added.ts'])
  })

  it('rolls back selected files via the checkpoint store (explicit per-file)', async () => {
    const h = makeHarness()
    const result = await h.service.checkpointRollback(REPO, { files: ['src/a.ts'] })
    expect(result).toEqual({ rolled: ['src/a.ts'], skipped: [] })
    expect(h.checkpoints.rollbackFiles).toHaveBeenCalledWith(REPO, ['src/a.ts'])
  })
})
