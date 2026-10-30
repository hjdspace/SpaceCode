/**
 * 检查器：空态、概览字段、六阶段进度、时间戳、页签空态与切换不丢选中。
 */
import { describe, it, expect, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type {
  FactoryDiffFile,
  FactoryEvent,
  FactoryPermissionMode,
  FactoryReview,
  FactoryRun,
  FactoryRunStatus,
  FactoryTask,
  FactoryTaskConfigSnapshot,
} from '@/shared/factory'
import { formatTimestamp } from '@/stores/factory/board'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryInspector from '../FactoryInspector.vue'

function task(overrides: Partial<FactoryTask> = {}): FactoryTask {
  return {
    id: 'bl-1',
    runId: 'run-1',
    source: 'local',
    title: '登录态在刷新后丢失',
    goal: '修复 sessionRestore 的恢复顺序，并补一条回归测试。',
    lane: 'implementing',
    stageIdx: 2,
    branch: 'agent/task-bl-1',
    worktree: '.spacecode/worktrees/bl-1',
    model: 'Opus 4.8',
    iteration: 2,
    maxIterations: 5,
    diff: { additions: 34, deletions: 8 },
    timestamps: { claimedAt: '2026-10-28T10:00:00Z', startedAt: '2026-10-28T10:01:00Z' },
    ...overrides,
  }
}

/** 领取时固化的最小快照：只关心实现阶段的权限模式。 */
function configSnapshot(implement: FactoryPermissionMode): FactoryTaskConfigSnapshot {
  const stage = (permissionMode: FactoryPermissionMode) => ({
    enabled: true,
    permissionMode,
    humanGate: false,
  })
  return {
    revision: 3,
    engineType: 'claude-code',
    maxIterations: 5,
    stages: {
      plan: stage('plan'),
      implement: stage(implement),
      verify: stage('default'),
      review: stage('default'),
      merge: stage('default'),
    },
    verifyCommand: 'npm run test',
    taskTimeoutSec: 3600,
  }
}

function run(overrides: Partial<FactoryRun> = {}): FactoryRun {
  return {
    id: 'run-1',
    status: 'running',
    paused: false,
    createdAt: '2026-10-28T10:00:00Z',
    maxConcurrency: 2,
    spendUsd: 0,
    elapsedMs: 0,
    ...overrides,
  }
}

/** 事件流用例只关心级别与顺序，参数走最小形状。 */
function event(
  code: string,
  level: 'info' | 'ok' | 'warn' | 'error',
  at: string,
  seq: number,
): FactoryEvent {
  return { seq, at, runId: 'run-1', taskId: 'bl-1', stage: 'implement', code, level }
}

describe('FactoryInspector', () => {
  it('shows an empty state without tabs when nothing is selected', () => {
    const wrapper = mount(FactoryInspector, { props: { task: null, tab: 'overview' } })
    expect(wrapper.find('[data-inspector-empty]').exists()).toBe(true)
    expect(wrapper.findAll('[data-inspector-tab]')).toHaveLength(0)
  })

  it('renders the overview fields and the six stage rail', () => {
    const selected = task()
    const wrapper = mount(FactoryInspector, { props: { task: selected, tab: 'overview' } })

    expect(wrapper.find('[data-inspector-title]').text()).toBe(selected.title)
    expect(wrapper.find('[data-inspector-status]').text()).toBe(
      'factory.cardStatus.implementing|{"iteration":2,"max":5}',
    )
    expect(wrapper.text()).toContain(selected.goal)
    expect(wrapper.text()).toContain(selected.branch)
    expect(wrapper.text()).toContain(selected.worktree!)
    expect(wrapper.text()).toContain(selected.model)
    expect(wrapper.text()).toContain(formatTimestamp(selected.timestamps.claimedAt))
    expect(wrapper.text()).toContain(formatTimestamp(selected.timestamps.startedAt))

    const steps = wrapper.findAll('[data-step]')
    expect(steps).toHaveLength(6)
    expect(steps.map((step) => step.classes().find((cls) => cls !== 'step'))).toEqual([
      'done',
      'done',
      'active',
      'pending',
      'pending',
      'pending',
    ])
  })

  it('counts this run in commits, changes and elapsed time', () => {
    const wrapper = mount(FactoryInspector, {
      props: {
        task: task({
          commits: [
            { sha: 'abcdef1234567', message: 'fix: restore session' },
            { sha: '1234567890abcde', message: 'test: cover restore order' },
          ],
        }),
        // 10:01:00 起跑，量到 10:03:30 即两分半。
        nowMs: Date.parse('2026-10-28T10:03:30Z'),
        tab: 'overview',
      },
    })

    expect(wrapper.find('[data-inspector-commits]').text()).toBe('2')
    expect(wrapper.find('[data-inspector-changes]').text()).toBe('+34 −8')
    expect(wrapper.find('[data-inspector-elapsed]').text()).toBe('02:30')
  })

  it('falls back to a placeholder before the worktree exists', () => {
    const wrapper = mount(FactoryInspector, {
      props: { task: task({ worktree: null }), tab: 'overview' },
    })
    expect(wrapper.text()).toContain('factory.inspector.worktreePending')
  })

  it('lists the four tabs and emits the chosen one', async () => {
    const wrapper = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    const tabs = wrapper.findAll('[data-inspector-tab]')
    expect(tabs.map((tab) => tab.attributes('data-inspector-tab'))).toEqual([
      'overview',
      'events',
      'diff',
      'review',
    ])

    await wrapper.find('[data-inspector-tab="events"]').trigger('click')
    expect(wrapper.emitted('select-tab')?.[0]).toEqual(['events'])
  })

  it('renders empty bodies for events, diff and review in this ticket', () => {
    for (const tab of ['events', 'diff', 'review'] as const) {
      const wrapper = mount(FactoryInspector, { props: { task: task(), tab } })
      expect(wrapper.find(`[data-empty="${tab}"]`).exists()).toBe(true)
    }
    expect(mount(FactoryInspector, { props: { task: task(), tab: 'overview' } }).find('[data-empty]').exists()).toBe(
      false,
    )
  })

  it('keeps the selected task when switching tabs', async () => {
    const selected = task()
    const wrapper = mount(FactoryInspector, { props: { task: selected, tab: 'overview' } })
    await wrapper.setProps({ tab: 'diff' })
    expect(wrapper.find('[data-inspector-title]').text()).toBe(selected.title)
  })

  it('resolves each event to its own text and level', () => {
    const wrapper = mount(FactoryInspector, {
      props: {
        task: task(),
        tab: 'events',
        events: [
          {
            seq: 1,
            at: '2026-10-28T10:02:00Z',
            runId: 'run-1',
            taskId: 'bl-1',
            stage: 'implement',
            code: 'task.started',
            level: 'ok',
            params: { branch: 'agent/task-bl-1' },
          },
          {
            seq: 2,
            at: '2026-10-28T10:03:00Z',
            runId: 'run-1',
            taskId: 'bl-1',
            stage: 'implement',
            code: 'agent.turn',
            level: 'info',
            params: { inputTokens: 10, outputTokens: 4 },
          },
        ],
      },
    })

    const rows = wrapper.findAll('[data-event-code]')
    expect(rows.map((row) => row.attributes('data-event-code'))).toEqual(['task.started', 'agent.turn'])
    expect(rows[0].text()).toContain('factory.events.task.started|{"branch":"agent/task-bl-1"}')
    expect(rows[0].classes()).toContain('ok')
    expect(rows[1].text()).toContain('factory.events.agent.turn|{"inputTokens":10,"outputTokens":4}')
  })

  it('lays events on a timeline: dot per level, time left of the text', () => {
    const wrapper = mount(FactoryInspector, {
      props: {
        task: task(),
        tab: 'events',
        events: [
          event('task.started', 'ok', '2026-10-28T10:02:00Z', 1),
          event('agent.turn', 'warn', '2026-10-28T10:03:00Z', 2),
          event('agent.error', 'error', '2026-10-28T10:04:00Z', 3),
        ],
      },
    })

    expect(wrapper.find('[data-event-timeline]').exists()).toBe(true)
    const rows = wrapper.findAll('[data-event-code]')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.classes().filter((cls) => cls !== 'tl-item'))).toEqual([
      ['ok'],
      ['warn'],
      ['error'],
    ])

    for (const row of rows) {
      const indexOf = (selector: string) =>
        Array.from(row.element.children).findIndex((child) => child.matches(selector))
      expect(indexOf('[data-event-dot]')).toBe(0)
      expect(indexOf('[data-event-time]')).toBe(1)
      expect(indexOf('[data-event-text]')).toBe(2)
    }
    expect(rows[0].find('[data-event-time]').text()).toBe(
      formatTimestamp('2026-10-28T10:02:00Z'),
    )
  })

  it('keeps a live agent row at the end of the timeline while the agent works', () => {
    const wrapper = mount(FactoryInspector, {
      props: {
        task: task(),
        run: run(),
        tab: 'events',
        events: [event('task.started', 'ok', '2026-10-28T10:02:00Z', 1)],
      },
    })

    const items = wrapper.findAll('[data-event-timeline] > li')
    expect(items).toHaveLength(2)
    expect(items[1].attributes('data-agent-live')).toBeDefined()
    expect(items[1].text()).toContain('factory.inspector.agentLive')
  })

  it('replaces the empty hint with the live row before any event lands', () => {
    const wrapper = mount(FactoryInspector, {
      props: { task: task(), run: run(), tab: 'events', events: [] },
    })
    expect(wrapper.find('[data-empty="events"]').exists()).toBe(false)
    expect(wrapper.find('[data-agent-live]').exists()).toBe(true)
  })

  it('hides the live row when the run pauses, stops, or the task leaves implementation', () => {
    const base = { tab: 'events' as const, events: [] as FactoryEvent[] }
    expect(
      mount(FactoryInspector, { props: { ...base, task: task(), run: run({ paused: true }) } }).find(
        '[data-agent-live]',
      ).exists(),
    ).toBe(false)
    expect(
      mount(FactoryInspector, {
        props: { ...base, task: task(), run: run({ status: 'stopped' }) },
      }).find('[data-agent-live]').exists(),
    ).toBe(false)
    expect(
      mount(FactoryInspector, {
        props: { ...base, task: task({ lane: 'reviewing' }), run: run() },
      }).find('[data-agent-live]').exists(),
    ).toBe(false)
  })

  it('follows the timeline to the bottom on opening the tab and on every new event', async () => {
    const wrapper = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    const body = wrapper.find('[data-inspector-body]').element as HTMLElement
    const setScrollTop = vi.fn()
    Object.defineProperty(body, 'scrollHeight', { configurable: true, get: () => 800 })
    Object.defineProperty(body, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: setScrollTop,
    })

    await wrapper.setProps({
      tab: 'events',
      events: [event('task.started', 'ok', '2026-10-28T10:02:00Z', 1)],
    })
    await flushPromises()
    expect(setScrollTop).toHaveBeenLastCalledWith(800)

    setScrollTop.mockClear()
    await wrapper.setProps({
      events: [
        event('task.started', 'ok', '2026-10-28T10:02:00Z', 1),
        event('agent.turn', 'info', '2026-10-28T10:03:00Z', 2),
      ],
    })
    await flushPromises()
    expect(setScrollTop).toHaveBeenLastCalledWith(800)

    // 其他页签不动滚动位置：用户往上翻 Diff 时不该被拽回底部。
    setScrollTop.mockClear()
    await wrapper.setProps({ tab: 'diff' })
    await flushPromises()
    expect(setScrollTop).not.toHaveBeenCalled()
  })

  it('gives a loading, failed and empty stream its own identifiable hint', () => {
    const loaded = [event('task.started', 'ok', '2026-10-28T10:02:00Z', 1)]

    const pending = mount(FactoryInspector, {
      props: { task: task(), tab: 'events', events: loaded, eventsLoading: true },
    })
    expect(pending.find('[data-events-loading]').exists()).toBe(true)
    expect(pending.find('[data-event-timeline]').exists()).toBe(false)

    const failed = mount(FactoryInspector, {
      props: { task: task(), tab: 'events', events: loaded, eventsError: 'load-failed' },
    })
    expect(failed.find('[data-events-error]').exists()).toBe(true)
    expect(failed.find('[data-events-loading]').exists()).toBe(false)
    expect(failed.find('[data-event-timeline]').exists()).toBe(false)
    expect(failed.text()).toContain('factory.events.loadFailed')

    const empty = mount(FactoryInspector, { props: { task: task(), tab: 'events', events: [] } })
    expect(empty.find('[data-empty="events"]').exists()).toBe(true)
    expect(empty.text()).toContain('factory.empty.events')
  })

  it('marks a failed GitHub write-back as retryable without touching the merge', async () => {
    const failed = task({
      source: 'github-issues',
      issueNumber: 42,
      lane: 'done',
      writeback: { status: 'failed', at: '2026-10-28T11:00:00Z', attempts: 1, error: 'rate-limit' },
    })
    const wrapper = mount(FactoryInspector, {
      props: { task: failed, tab: 'overview', writebackError: { reason: 'rate-limit' } },
    })

    expect(wrapper.find('[data-inspector-writeback]').exists()).toBe(true)
    expect(wrapper.find('[data-writeback-status]').text()).toContain(
      'factory.github.writeback.failed|{"attempts":1}',
    )
    expect(wrapper.find('[data-writeback-error]').text()).toBe('factory.github.errors.rate-limit')

    await wrapper.find('[data-writeback-retry]').trigger('click')
    expect(wrapper.emitted('retry-writeback')).toHaveLength(1)

    const done = mount(FactoryInspector, {
      props: {
        task: task({
          source: 'github-issues',
          issueNumber: 42,
          lane: 'done',
          writeback: { status: 'done', at: '2026-10-28T11:00:00Z', attempts: 1 },
        }),
        tab: 'overview',
      },
    })
    expect(done.find('[data-writeback-retry]').exists()).toBe(false)
  })

  it('shows diff files, commits, and the no-commit empty state', () => {
    const withCommits = mount(FactoryInspector, {
      props: {
        task: task({
          diff: {
            additions: 12,
            deletions: 3,
            files: [
              { path: 'src/a.ts', additions: 10, deletions: 1 },
              { path: 'src/b.ts', additions: 2, deletions: 2 },
            ],
          },
          commits: [{ sha: 'abcdef1234567', message: 'fix: restore session' }],
        }),
        tab: 'diff',
      },
    })

    expect(withCommits.find('[data-diff-summary]').text()).toContain('+12 −3')
    expect(withCommits.findAll('[data-diff-files] li')).toHaveLength(2)
    expect(withCommits.findAll('[data-commit-list] li')).toHaveLength(1)
    expect(withCommits.text()).toContain('abcdef1')
    expect(withCommits.text()).toContain('fix: restore session')
    expect(withCommits.find('[data-empty="commits"]').exists()).toBe(false)

    const withoutCommits = mount(FactoryInspector, { props: { task: task(), tab: 'diff' } })
    expect(withoutCommits.find('[data-empty="commits"]').exists()).toBe(true)
  })

  describe('line-level diff tab', () => {
    const patchFile: FactoryDiffFile = {
      path: 'src/a.ts',
      additions: 2,
      deletions: 1,
      kind: 'patch',
      hunks: [
        {
          header: '@@ -1,3 +1,4 @@',
          lines: [
            { kind: 'ctx', oldLine: 1, newLine: 1, text: 'ctx one' },
            { kind: 'del', oldLine: 2, text: 'removed' },
            { kind: 'add', newLine: 2, text: 'added one' },
            { kind: 'add', newLine: 3, text: 'added two' },
          ],
        },
      ],
    }
    const truncatedFile: FactoryDiffFile = {
      path: 'src/big.ts',
      additions: 900,
      deletions: 880,
      kind: 'patch',
      truncated: true,
      hunks: [
        {
          header: '@@ -1,1 +1,1 @@',
          lines: [
            { kind: 'del', oldLine: 1, text: 'old head' },
            { kind: 'add', newLine: 1, text: 'new head' },
          ],
        },
      ],
    }
    const droppedFile: FactoryDiffFile = {
      path: 'src/later.ts',
      additions: 10,
      deletions: 4,
      kind: 'patch',
      truncated: true,
      hunks: [],
    }

    function richTask(overrides: Partial<FactoryTask> = {}): FactoryTask {
      return task({
        ...overrides,
        diff: {
          additions: 912,
          deletions: 885,
          files: [
            patchFile,
            { path: 'assets/logo.png', additions: 0, deletions: 0, kind: 'binary' },
            { path: 'src/new.ts', additions: 0, deletions: 0, kind: 'renamed', oldPath: 'src/old.ts' },
            { path: 'src/m.md', additions: 1, deletions: 0, kind: 'missing' },
            truncatedFile,
            droppedFile,
          ],
        },
      })
    }

    function mountDiff(overrides: Partial<FactoryTask> = {}) {
      return mount(FactoryInspector, { props: { task: richTask(overrides), tab: 'diff' } })
    }

    it('renders the first patch by default with hunk header, kinds and line numbers', () => {
      const wrapper = mountDiff()
      const rows = wrapper.findAll('[data-diff-file]')
      expect(rows).toHaveLength(6)
      expect(rows[0].classes()).toContain('active')

      expect(wrapper.find('[data-diff-patch]').exists()).toBe(true)
      expect(wrapper.find('[data-diff-hunk]').text()).toContain('@@ -1,3 +1,4 @@')

      const lines = wrapper.findAll('[data-diff-line]')
      expect(lines).toHaveLength(4)
      expect(lines[0].classes()).toContain('ctx')
      expect(lines[1].classes()).toContain('del')
      expect(lines[2].classes()).toContain('add')
      expect(lines[1].find('.ln').text()).toBe('2')
      expect(lines[2].find('.ln').text()).toBe('2')
      expect(lines[3].find('.ln').text()).toBe('3')
      expect(lines[3].find('.code').text()).toBe('added two')
    })

    it('switches the patch column when another file row is clicked', async () => {
      const wrapper = mountDiff()
      await wrapper.findAll('[data-diff-file]')[4].trigger('click')

      expect(wrapper.findAll('[data-diff-file]')[4].classes()).toContain('active')
      expect(wrapper.find('[data-diff-patch]').exists()).toBe(true)
      expect(wrapper.find('[data-diff-hunk]').text()).toContain('@@ -1,1 +1,1 @@')
      expect(wrapper.find('[data-diff-truncated]').text()).toBe('factory.diff.truncated')

      await wrapper.findAll('[data-diff-file]')[0].trigger('click')
      expect(wrapper.find('[data-diff-hunk]').text()).toContain('@@ -1,3 +1,4 @@')
      expect(wrapper.find('[data-diff-truncated]').exists()).toBe(false)
    })

    it('gives binary, renamed, missing and fully-dropped files their own placeholders', async () => {
      const wrapper = mountDiff()

      await wrapper.findAll('[data-diff-file]')[1].trigger('click')
      expect(wrapper.find('[data-diff-placeholder="binary"]').text()).toBe('factory.diff.binary')
      expect(wrapper.find('[data-diff-patch]').exists()).toBe(false)

      await wrapper.findAll('[data-diff-file]')[2].trigger('click')
      expect(wrapper.find('[data-diff-placeholder="renamed"]').text()).toBe(
        'factory.diff.renamed|{"from":"src/old.ts","to":"src/new.ts"}',
      )
      expect(wrapper.find('[data-diff-patch]').exists()).toBe(false)

      await wrapper.findAll('[data-diff-file]')[3].trigger('click')
      expect(wrapper.find('[data-diff-placeholder="missing"]').text()).toBe('factory.diff.noPatch')
      expect(wrapper.find('[data-diff-patch]').exists()).toBe(false)

      await wrapper.findAll('[data-diff-file]')[5].trigger('click')
      expect(wrapper.find('[data-diff-placeholder="truncated"]').text()).toBe('factory.diff.truncated')
      expect(wrapper.find('[data-diff-patch]').exists()).toBe(false)
    })

    it('keeps the diff empty state when the task has no files', () => {
      const wrapper = mount(FactoryInspector, { props: { task: task(), tab: 'diff' } })
      expect(wrapper.find('[data-empty="diff"]').exists()).toBe(true)
      expect(wrapper.find('[data-diff-pane]').exists()).toBe(false)
    })

    it('resets the selection when the inspected task changes', async () => {
      const wrapper = mountDiff()
      await wrapper.findAll('[data-diff-file]')[3].trigger('click')
      expect(wrapper.findAll('[data-diff-file]')[3].classes()).toContain('active')

      const next = richTask({ id: 'bl-2' })
      await wrapper.setProps({ task: next })
      expect(wrapper.findAll('[data-diff-file]')[0].classes()).toContain('active')
      expect(wrapper.find('[data-diff-hunk]').text()).toContain('@@ -1,3 +1,4 @@')
    })
  })

  it('offers start, stop, reveal and dirty confirmation actions', async () => {
    const queued = mount(FactoryInspector, {
      props: { task: task({ lane: 'queued', stageIdx: 0 }), tab: 'overview', pendingDirty: true },
    })
    expect(queued.find('[data-task-start]').exists()).toBe(true)
    expect(queued.find('[data-task-stop]').exists()).toBe(false)
    await queued.find('[data-task-start]').trigger('click')
    await queued.find('[data-task-confirm-dirty]').trigger('click')
    expect(queued.emitted('start')).toHaveLength(1)
    expect(queued.emitted('confirm-dirty')).toHaveLength(1)

    const running = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    expect(running.find('[data-task-start]').exists()).toBe(false)
    await running.find('[data-task-stop]').trigger('click')
    await running.find('[data-reveal-worktree]').trigger('click')
    expect(running.emitted('stop')).toHaveLength(1)
    expect(running.emitted('reveal')).toHaveLength(1)
  })

  it('offers remove on a queued task and abandon on a blocked one', async () => {
    const queued = mount(FactoryInspector, {
      props: { task: task({ lane: 'queued', stageIdx: 0, worktree: null }), tab: 'overview' },
    })
    expect(queued.find('[data-task-cancel]').text()).toBe('factory.actions.remove')
    await queued.find('[data-task-cancel]').trigger('click')
    expect(queued.emitted('cancel')).toHaveLength(1)

    const blocked = mount(FactoryInspector, {
      props: { task: task({ lane: 'blocked', stageIdx: 2 }), tab: 'overview' },
    })
    expect(blocked.find('[data-task-cancel]').text()).toBe('factory.actions.abandon')
  })

  it('hides abandon once the lane is advancing and while the call is in flight', () => {
    const running = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    expect(running.find('[data-task-cancel]').exists()).toBe(false)

    const busy = mount(FactoryInspector, {
      props: { task: task({ lane: 'queued', stageIdx: 0, worktree: null }), tab: 'overview', cancelling: true },
    })
    expect(busy.find('[data-task-cancel]').attributes('disabled')).toBeDefined()
  })

  const needsChanges: FactoryReview = {
    verdict: 'needs_changes',
    summary: 'One blocker found',
    at: '2026-10-28T10:05:00Z',
    comments: [
      {
        id: 'c1',
        file: 'src/a.ts',
        line: 3,
        body: 'missing guard',
        severity: 'blocker',
        status: 'open',
      },
      { id: 'c2', body: 'plain note', severity: 'suggestion', status: 'resolved' },
    ],
  }

  it('renders the review verdict, summary and comments', () => {
    const wrapper = mount(FactoryInspector, {
      props: { task: task({ lane: 'reviewing', review: needsChanges }), tab: 'review' },
    })

    expect(wrapper.find('[data-review-verdict]').text()).toBe('factory.review.verdict.needs_changes')
    expect(wrapper.find('[data-review-summary]').text()).toBe('One blocker found')
    const comments = wrapper.findAll('[data-review-comment]')
    expect(comments).toHaveLength(2)
    expect(comments[0].text()).toContain('src/a.ts:3')
    expect(comments[0].text()).toContain('missing guard')
    expect(comments[0].text()).toContain('factory.review.severity.blocker')
    expect(comments[0].classes()).toContain('blocker')
    expect(comments[1].text()).not.toContain('src/a.ts')
    expect(wrapper.find('[data-empty="review"]').exists()).toBe(false)
  })

  it('emits accept, ignore and confirmed ignore for a comment', async () => {
    const wrapper = mount(FactoryInspector, {
      props: { task: task({ lane: 'reviewing', review: needsChanges }), tab: 'review' },
    })
    await wrapper.find('[data-comment-accept]').trigger('click')
    await wrapper.find('[data-comment-ignore]').trigger('click')
    expect(wrapper.emitted('comment-accept')?.[0]).toEqual(['c1'])
    expect(wrapper.emitted('comment-ignore')?.[0]).toEqual(['c1'])
    expect(wrapper.find('[data-comment-confirm-ignore]').exists()).toBe(false)

    await wrapper.setProps({ pendingIgnoreId: 'c1' })
    await wrapper.find('[data-comment-confirm-ignore]').trigger('click')
    expect(wrapper.emitted('comment-confirm-ignore')?.[0]).toEqual(['c1'])
  })

  it('makes the agent fix the primary comment action and keeps ignore two-stepped', async () => {
    const wrapper = mount(FactoryInspector, {
      props: { task: task({ lane: 'reviewing', review: needsChanges }), tab: 'review' },
    })

    const fix = wrapper.find('[data-comment-accept]')
    expect(fix.text()).toBe('factory.actions.fix')
    expect(fix.classes()).toContain('primary')
    expect(wrapper.find('[data-comment-ignore]').text()).toBe('factory.actions.ignore')

    await wrapper.find('[data-comment-ignore]').trigger('click')
    expect(wrapper.emitted('comment-ignore')?.[0]).toEqual(['c1'])
    expect(wrapper.find('[data-comment-confirm-ignore]').exists()).toBe(false)

    await wrapper.setProps({ pendingIgnoreId: 'c1' })
    expect(wrapper.find('[data-comment-confirm-ignore]').exists()).toBe(true)
  })

  it('keeps verdict and test results visible on the overview tab', () => {
    const wrapper = mount(FactoryInspector, {
      props: {
        task: task({
          lane: 'reviewing',
          review: needsChanges,
          tests: { status: 'pass', command: 'npm run test', at: '2026-10-28T10:00:00Z' },
        }),
        tab: 'overview',
      },
    })
    expect(wrapper.find('[data-inspector-tests]').text()).toBe('factory.tests.status.pass')
    expect(wrapper.find('[data-inspector-review]').text()).toBe('factory.review.verdict.needs_changes')
  })

  it('states the review conclusion on the overview once a review exists', () => {
    const wrapper = mount(FactoryInspector, {
      props: { task: task({ lane: 'reviewing', review: needsChanges }), tab: 'overview' },
    })
    expect(wrapper.find('[data-overview-verdict]').text()).toBe(
      'factory.review.verdict.needs_changes',
    )
    expect(wrapper.find('[data-overview-summary]').text()).toBe('One blocker found')

    const unreviewed = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    expect(unreviewed.find('[data-overview-verdict]').exists()).toBe(false)
    expect(unreviewed.find('[data-overview-summary]').exists()).toBe(false)
  })

  it('disables approval until the task is eligible', async () => {
    const reviewing = task({ lane: 'reviewing', review: needsChanges })
    const blocked = mount(FactoryInspector, { props: { task: reviewing, tab: 'review' } })
    expect(blocked.find('[data-task-approve]').attributes('disabled')).toBeDefined()
    expect(blocked.find('[data-task-request-changes]').exists()).toBe(true)

    const eligible = mount(FactoryInspector, {
      props: { task: reviewing, tab: 'review', eligible: true },
    })
    expect(eligible.find('[data-task-approve]').attributes('disabled')).toBeUndefined()
    await eligible.find('[data-task-approve]').trigger('click')
    await eligible.find('[data-task-request-changes]').trigger('click')
    expect(eligible.emitted('approve')).toHaveLength(1)
    expect(eligible.emitted('request-changes')).toHaveLength(1)
  })

  it('offers the fix action only when pending comments exist', async () => {
    const withPending = mount(FactoryInspector, {
      props: { task: task({ lane: 'blocked', review: needsChanges }), tab: 'review' },
    })
    expect(withPending.find('[data-task-fix]').exists()).toBe(true)
    await withPending.find('[data-task-fix]').trigger('click')
    expect(withPending.emitted('fix')).toHaveLength(1)

    const settled = mount(FactoryInspector, {
      props: {
        task: task({
          lane: 'reviewing',
          review: { ...needsChanges, comments: [] },
        }),
        tab: 'review',
        eligible: true,
      },
    })
    expect(settled.find('[data-task-fix]').exists()).toBe(false)
  })

  it('collapses the inspector from the header close button', async () => {
    const wrapper = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    await wrapper.find('[data-inspector-close]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    // 空态没有任务可收起，头部整体不存在。
    expect(
      mount(FactoryInspector, { props: { task: null, tab: 'overview' } }).find('[data-inspector-close]').exists(),
    ).toBe(false)
  })

  it('copies the branch name and shows a transient hint', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const wrapper = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    expect(wrapper.find('[data-copy-hint]').exists()).toBe(false)

    await wrapper.find('[data-copy-branch]').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('agent/task-bl-1')
    expect(wrapper.find('[data-copy-hint]').text()).toBe('factory.inspector.copied')
  })

  it('drops the copy hint when the selection moves to another branch', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const wrapper = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    await wrapper.find('[data-copy-branch]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-copy-hint]').exists()).toBe(true)

    await wrapper.setProps({ task: task({ id: 'bl-2', branch: 'agent/task-bl-2' }) })
    expect(wrapper.find('[data-copy-hint]').exists()).toBe(false)
  })

  it('shows the permission mode frozen when the task was claimed', () => {
    const wrapper = mount(FactoryInspector, {
      props: { task: task({ configSnapshot: configSnapshot('acceptEdits') }), tab: 'overview' },
    })
    expect(wrapper.find('[data-inspector-permission]').text()).toBe(
      'factory.config.permissions.acceptEdits',
    )
  })

  it('hides the permission row for tasks claimed before snapshots existed', () => {
    const wrapper = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    expect(wrapper.find('[data-inspector-permission]').exists()).toBe(false)
  })

  it('badges the diff and review tabs, zero included', () => {
    const wrapper = mount(FactoryInspector, {
      props: {
        task: task({
          diff: {
            additions: 12,
            deletions: 3,
            files: [
              { path: 'src/a.ts', additions: 10, deletions: 1 },
              { path: 'src/b.ts', additions: 2, deletions: 2 },
            ],
          },
          review: { ...needsChanges, comments: [needsChanges.comments[0]] },
        }),
        tab: 'overview',
      },
    })
    expect(wrapper.find('[data-inspector-badge="diff"]').text()).toBe('2')
    expect(wrapper.find('[data-inspector-badge="review"]').text()).toBe('1')

    const fresh = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    expect(fresh.find('[data-inspector-badge="diff"]').text()).toBe('0')
    expect(fresh.find('[data-inspector-badge="review"]').text()).toBe('0')
  })

  it('makes viewing the work tree the primary action of a finished task', async () => {
    const done = mount(FactoryInspector, {
      props: { task: task({ lane: 'done', stageIdx: 6 }), tab: 'overview' },
    })
    const button = done.find('[data-task-view-worktree]')
    expect(button.exists()).toBe(true)
    expect(button.classes()).toContain('primary')
    await button.trigger('click')
    expect(done.emitted('reveal')).toHaveLength(1)

    // 其他泳道不抢这条主按钮，动作顺序保持原样。
    expect(
      mount(FactoryInspector, { props: { task: task(), tab: 'overview' } }).find(
        '[data-task-view-worktree]',
      ).exists(),
    ).toBe(false)
  })

  it('接管中的任务给出重新打开接管面板的入口', async () => {
    const wrapper = mount(FactoryInspector, {
      props: {
        task: task({ takeover: { at: '2026-10-28T10:05:00Z', sessionId: 'sess-1' } }),
        tab: 'overview',
      },
    })

    await wrapper.find('[data-task-open-takeover]').trigger('click')

    expect(wrapper.emitted('open-takeover')).toHaveLength(1)
    // 接管中不再给第二次「接管」：面板入口与交回才是这个状态的动作。
    expect(wrapper.find('[data-task-takeover]').exists()).toBe(false)
  })

  it('keeps a single worktree affordance on a finished task', () => {
    // 底部主按钮已经是「查看工作树」，元信息行不该再挂一个同义入口。
    const done = mount(FactoryInspector, {
      props: { task: task({ lane: 'done', stageIdx: 6 }), tab: 'overview' },
    })
    expect(done.find('[data-task-view-worktree]').exists()).toBe(true)
    expect(done.find('[data-reveal-worktree]').exists()).toBe(false)

    const running = mount(FactoryInspector, { props: { task: task(), tab: 'overview' } })
    expect(running.find('[data-reveal-worktree]').exists()).toBe(true)
  })
})
