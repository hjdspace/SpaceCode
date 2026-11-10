/**
 * Worker 指令协议（#100，设计 §6.2/§6.6）。
 *
 * Worker 的最终回复除 Report 外还可以携带三种围栏动作：
 *   `super-agent:handback`（交回一条人消息）
 *   `super-agent:thread-unrelated`（退掉无关 Thread 的订阅）
 *   `super-agent:thread-follow`（把相关 Thread 登记为仅上下文订阅）
 *
 * 严格解析：字段白名单、块唯一性、未知字段一律按稳定错误码拒绝，不猜意图。
 * 本文件只测解析，接线（领域命令调用与投影）见 service-worker-actions.test.ts。
 */
import { describe, expect, it } from 'vitest'
import { isSuperAgentDomainError } from '../errors'
import { parseSuperAgentWorkerActions } from '../workerActions'

function fence(name: string, payload: unknown): string {
  return ['```' + name, JSON.stringify(payload), '```'].join('\n')
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (isSuperAgentDomainError(error)) return error.code
    throw error
  }
  throw new Error('expected the parser to throw')
}

describe('parseSuperAgentWorkerActions', () => {
  it('returns no actions when the reply carries no worker fences', () => {
    const parsed = parseSuperAgentWorkerActions('已处理完成，没有问题。')
    expect(parsed.actions).toEqual([])
  })

  it('ignores report / route / eval fences owned by other parsers', () => {
    const text = [
      fence('super-agent:report', { assignmentId: 'a-1', reportId: 'r-1', kind: 'ready', summary: '完成' }),
      fence('super-agent:route', { version: 2, routes: [] }),
    ].join('\n\n')
    expect(parseSuperAgentWorkerActions(text).actions).toEqual([])
  })

  it('parses a handback with trigger id and reason', () => {
    const parsed = parseSuperAgentWorkerActions(
      fence('super-agent:handback', { triggerId: 'trigger-1', reason: '超出本次范围' }),
    )
    expect(parsed.actions).toEqual([
      { kind: 'handback', triggerId: 'trigger-1', reason: '超出本次范围' },
    ])
  })

  it('parses thread-unrelated with thread id and reason', () => {
    const parsed = parseSuperAgentWorkerActions(
      fence('super-agent:thread-unrelated', { threadId: 'th-other', reason: '与本工单无关' }),
    )
    expect(parsed.actions).toEqual([
      { kind: 'threadUnrelated', threadId: 'th-other', reason: '与本工单无关' },
    ])
  })

  it('parses thread-follow with only a thread id', () => {
    const parsed = parseSuperAgentWorkerActions(
      fence('super-agent:thread-follow', { threadId: 'github:pr:o/r:7' }),
    )
    expect(parsed.actions).toEqual([{ kind: 'threadFollow', threadId: 'github:pr:o/r:7' }])
  })

  it('keeps a deterministic order when all three fences appear together', () => {
    const text = [
      fence('super-agent:thread-follow', { threadId: 'th-ref' }),
      fence('super-agent:thread-unrelated', { threadId: 'th-noise', reason: '无关' }),
      fence('super-agent:handback', { triggerId: 'trigger-9', reason: '换一张工单' }),
    ].join('\n\n')
    expect(parseSuperAgentWorkerActions(text).actions).toEqual([
      { kind: 'handback', triggerId: 'trigger-9', reason: '换一张工单' },
      { kind: 'threadUnrelated', threadId: 'th-noise', reason: '无关' },
      { kind: 'threadFollow', threadId: 'th-ref' },
    ])
  })

  it('rejects a duplicated fence of the same kind', () => {
    const text = [
      fence('super-agent:handback', { triggerId: 'trigger-1', reason: '一' }),
      fence('super-agent:handback', { triggerId: 'trigger-2', reason: '二' }),
    ].join('\n\n')
    const code = codeOf(() => parseSuperAgentWorkerActions(text))
    expect(code).toBe('workerActionNotUnique')
  })

  it('rejects invalid JSON in a worker fence', () => {
    const code = codeOf(() =>
      parseSuperAgentWorkerActions(['```super-agent:thread-follow', 'not-json', '```'].join('\n')),
    )
    expect(code).toBe('workerActionUnparsable')
  })

  it('rejects a missing required field', () => {
    const code = codeOf(() =>
      parseSuperAgentWorkerActions(fence('super-agent:handback', { reason: '缺 triggerId' })),
    )
    expect(code).toBe('workerActionInvalid')
  })

  it('rejects an empty required string', () => {
    const code = codeOf(() =>
      parseSuperAgentWorkerActions(fence('super-agent:thread-unrelated', { threadId: '  ', reason: '无关' })),
    )
    expect(code).toBe('workerActionInvalid')
  })

  it('rejects unknown fields instead of guessing intent', () => {
    const code = codeOf(() =>
      parseSuperAgentWorkerActions(
        fence('super-agent:handback', { triggerId: 'trigger-1', reason: '超范围', note: '附带说明' }),
      ),
    )
    expect(code).toBe('workerActionInvalid')
    expect(codeOf(() =>
      parseSuperAgentWorkerActions(fence('super-agent:thread-follow', { threadId: 'th-1', reason: '参考' })),
    )).toBe('workerActionInvalid')
  })

  it('rejects a non-object JSON root', () => {
    const code = codeOf(() => parseSuperAgentWorkerActions(fence('super-agent:handback', ['trigger-1'])))
    expect(code).toBe('workerActionInvalid')
  })

  it('trims accepted strings but keeps the action value stable', () => {
    const parsed = parseSuperAgentWorkerActions(
      fence('super-agent:handback', { triggerId: '  trigger-1 ', reason: '  超范围  ' }),
    )
    expect(parsed.actions[0]).toMatchObject({ triggerId: 'trigger-1', reason: '超范围' })
  })
})
