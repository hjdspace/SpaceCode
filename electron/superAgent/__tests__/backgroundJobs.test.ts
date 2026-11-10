// @vitest-environment node
/**
 * #104 后台作业注册表：能力边界、槽位口径、30 分钟上限与 Assignment 收尾。
 *
 * 这里断言的是设计 §7.1/§7.2 的三条硬语义：
 *  - 引擎没有枚举能力时如实 unknown，不把「没观察到」写成 0；
 *  - handoff 为 ready 的 shell 作业（dev server 类）可继续且不占槽、不受上限；
 *  - 其余运行中作业在 turn 结束后占槽，超时只杀 shell，subagent 释放归属允许收尾。
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  classifySuperAgentBackgroundEvent,
  createSuperAgentBackgroundJobs,
  readBackgroundOutputTail,
  type SuperAgentBackgroundJob,
  type SuperAgentBackgroundJobsOptions,
  type SuperAgentBackgroundTimeout,
} from '../backgroundJobs'

const TICKET = 'ticket-1'
const ASSIGNMENT = 'assignment-1'
const SESSION = 'session-1'

function makeRegistry(nowValue = 1000, overrides: SuperAgentBackgroundJobsOptions = {}) {
  const killed: SuperAgentBackgroundJob[] = []
  const completed: SuperAgentBackgroundJob[] = []
  const timeouts: SuperAgentBackgroundTimeout[] = []
  const drained: string[] = []
  const jobs = createSuperAgentBackgroundJobs({
    now: () => nowValue,
    onKill: (job) => killed.push(job),
    onCompleted: (job) => completed.push(job),
    onTimeout: (event) => timeouts.push(event),
    onDrained: (ticketId) => drained.push(ticketId),
    ...overrides,
  })
  return { jobs, killed, completed, timeouts, drained }
}

describe('background jobs registry', () => {
  it('reports unknown when nothing has been observed (never 0)', () => {
    const { jobs } = makeRegistry()
    expect(jobs.snapshot(TICKET)).toEqual({ availability: 'unknown' })
  })

  it('keeps shell jobs occupying the slot for waiting handoff, but exempts ready handoff', () => {
    const { jobs } = makeRegistry()
    jobs.register({ ticketId: TICKET, assignmentId: ASSIGNMENT, sessionId: SESSION, jobId: 'bash_1', kind: 'shell' })
    expect(jobs.hasBackgroundWork(TICKET)).toBe(true)

    jobs.markTurnEnded(TICKET, 'waiting')
    expect(jobs.hasBackgroundWork(TICKET)).toBe(true)

    jobs.markTurnEnded(TICKET, 'ready')
    expect(jobs.hasBackgroundWork(TICKET)).toBe(false)
  })

  it('subagents occupy until completed and do not trigger completion wake', () => {
    const { jobs, completed, drained } = makeRegistry()
    jobs.register({ ticketId: TICKET, assignmentId: ASSIGNMENT, sessionId: SESSION, jobId: 'task-1', kind: 'subagent' })
    jobs.markTurnEnded(TICKET, 'waiting')
    expect(jobs.hasBackgroundWork(TICKET)).toBe(true)
    expect(jobs.snapshot(TICKET)).toMatchObject({
      availability: 'known',
      running: { shell: 0, subagent: 1 },
    })

    const job = jobs.complete('task-1')
    expect(job?.state).toBe('completed')
    expect(completed).toEqual([])
    expect(drained).toEqual([TICKET])
    expect(jobs.hasBackgroundWork(TICKET)).toBe(false)
  })

  it('kills overdue shell jobs but releases overdue subagents', () => {
    let now = 1000
    const { jobs, killed, timeouts } = makeRegistry(now, {
      now: () => now,
      maxAgeMs: 60_000,
    })
    jobs.register({ ticketId: TICKET, assignmentId: ASSIGNMENT, sessionId: SESSION, jobId: 'bash_1', kind: 'shell' })
    jobs.register({ ticketId: TICKET, assignmentId: ASSIGNMENT, sessionId: SESSION, jobId: 'task-1', kind: 'subagent' })
    jobs.markTurnEnded(TICKET, 'waiting')

    now = 1000 + 60_000
    const events = jobs.sweep()
    expect(killed.map((job) => job.jobId)).toEqual(['bash_1'])
    expect(events).toHaveLength(1)
    expect(events[0].killed.map((job) => job.jobId)).toEqual(['bash_1'])
    expect(events[0].released.map((job) => job.jobId)).toEqual(['task-1'])
    expect(timeouts).toHaveLength(1)
    // subagent 只是释放归属，不会被 kill —— 引擎里它允许自行收尾。
    expect(jobs.jobsOf(TICKET).find((job) => job.jobId === 'task-1')?.state).toBe('released')
  })

  it('never kills ready-handoff shell jobs (acceptance dev servers)', () => {
    let now = 1000
    const { jobs, killed } = makeRegistry(now, { now: () => now, maxAgeMs: 60_000 })
    jobs.register({ ticketId: TICKET, assignmentId: ASSIGNMENT, sessionId: SESSION, jobId: 'dev-server', kind: 'shell' })
    jobs.markTurnEnded(TICKET, 'ready')
    now = 1000 + 10 * 60_000
    expect(jobs.sweep()).toEqual([])
    expect(killed).toEqual([])
    expect(jobs.jobsOf(TICKET)[0].state).toBe('running')
  })

  it('stops accepting new job names after the assignment ends and releases running ones', () => {
    const { jobs, killed } = makeRegistry()
    jobs.register({ ticketId: TICKET, assignmentId: ASSIGNMENT, sessionId: SESSION, jobId: 'bash_1', kind: 'shell' })
    jobs.register({ ticketId: TICKET, assignmentId: ASSIGNMENT, sessionId: SESSION, jobId: 'task-1', kind: 'subagent' })
    jobs.endAssignment({ ticketId: TICKET, assignmentId: ASSIGNMENT })

    expect(killed.map((job) => job.jobId)).toEqual(['bash_1'])
    expect(jobs.jobsOf(TICKET).find((job) => job.jobId === 'task-1')?.state).toBe('released')
    expect(
      jobs.register({ ticketId: TICKET, assignmentId: ASSIGNMENT, sessionId: SESSION, jobId: 'bash_2', kind: 'shell' }),
    ).toBeNull()
    // 迟到完成只留历史，不再唤醒。
    expect(jobs.complete('bash_1')).toBeNull()
  })
})

describe('classifySuperAgentBackgroundEvent', () => {
  it('turns a background Bash into a job keyed by the engine task id', () => {
    const kinds = new Map<string, 'shell' | 'subagent'>()
    expect(
      classifySuperAgentBackgroundEvent('tool_use', { id: 'toolu_1', name: 'Bash', input: { run_in_background: true } }, kinds),
    ).toEqual([])
    expect(kinds.get('toolu_1')).toBe('shell')

    const events = classifySuperAgentBackgroundEvent(
      'tool_result',
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: 'Command running in background with ID: bash_1',
      },
      kinds,
    )
    expect(events).toEqual([{ action: 'register', jobId: 'bash_1', kind: 'shell' }])
    // shell 的 tool_result 不是完成信号：只有 task_notification 才算。
    expect(kinds.get('bash_1')).toBe('shell')
  })

  it('completes a shell only on task_notification', () => {
    const kinds = new Map<string, 'shell' | 'subagent'>([['bash_1', 'shell']])
    expect(
      classifySuperAgentBackgroundEvent('system', { subtype: 'task_notification', task_id: 'bash_1', output: 'done' }, kinds),
    ).toEqual([{ action: 'complete', jobId: 'bash_1', kind: 'shell', outputTail: 'done' }])
    expect(kinds.has('bash_1')).toBe(false)
  })

  it('registers and completes subagents through Task tool frames', () => {
    const kinds = new Map<string, 'shell' | 'subagent'>()
    expect(
      classifySuperAgentBackgroundEvent('tool_use', { id: 'task-1', name: 'Task', input: {} }, kinds),
    ).toEqual([{ action: 'register', jobId: 'task-1', kind: 'subagent' }])
    expect(
      classifySuperAgentBackgroundEvent('tool_result', { tool_use_id: 'task-1' }, kinds),
    ).toEqual([{ action: 'complete', jobId: 'task-1', kind: 'subagent' }])
  })

  it('ignores ordinary foreground tools', () => {
    const kinds = new Map<string, 'shell' | 'subagent'>()
    expect(
      classifySuperAgentBackgroundEvent('tool_use', { id: 'toolu_2', name: 'Bash', input: { command: 'ls' } }, kinds),
    ).toEqual([])
  })
})

describe('readBackgroundOutputTail', () => {
  it('returns the bounded tail of an output file and null when missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'super-agent-bg-'))
    const file = join(dir, 'task.output')
    writeFileSync(file, `${'x'.repeat(300)}\nDONE`)
    const tail = readBackgroundOutputTail(file, 20)
    expect(tail).toContain('DONE')
    expect(tail).toBeTruthy()
    expect(tail!.length).toBeLessThanOrEqual(21)
    expect(readBackgroundOutputTail(join(dir, 'nope.output'))).toBeNull()
  })
})
