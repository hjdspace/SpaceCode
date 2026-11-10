/**
 * RouterRunner 的 Eval 轮次接缝（#99）：评估轮与中继轮共用串行队列，
 * 但真正开始一轮才记送达（deadline 从此刻起算），结果直接交回 evalDriver，
 * 不走 route 解析或派发。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentRouterRunner } from '../routerRunner'
import { wrapSuperAgentHostContext } from '@/shared/promptEnvelope'
import { createFakeBridge, routeFence } from './fakeBridge'

const REPO = '/repo/a'
const SESSION = 'router-session'

function makeRunner() {
  const fake = createFakeBridge()
  const dispatched: unknown[] = []
  const failures: string[] = []
  const statuses: boolean[] = []
  const runner = createSuperAgentRouterRunner({
    repoRoot: REPO,
    sessionId: SESSION,
    runnerEpoch: 'e1',
    bridge: fake.bridge,
    hooks: {
      dispatch: (input) => {
        dispatched.push(input)
        return { ticketId: `ticket-${dispatched.length}` }
      },
      attach: () => undefined,
      retry: () => undefined,
      stop: () => undefined,
      onStatusChanged: (running) => statuses.push(running),
      onFailure: (code) => failures.push(code),
    },
  })
  return { runner, fake, dispatched, failures, statuses }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function evalFenceText(evalId: string): string {
  return [
    '```super-agent:eval',
    JSON.stringify({ version: 1, evalId, action: 'ignore', matchedRules: [], reason: '只是闲聊' }),
    '```',
  ].join('\n')
}

describe('RouterRunner evaluate', () => {
  it('把评估卡走中继队列：真正开轮才 onDeliver，结果只回调用方、不推气泡也不派发', async () => {
    const h = makeRunner()
    const events: string[] = []
    let received: string | null = null

    h.runner.evaluate({
      text: '评估卡正文',
      onDeliver: () => events.push('deliver'),
      onResult: (text) => {
        received = text
      },
    })
    await flush()

    expect(events).toEqual(['deliver'])
    expect(h.fake.pushed).toHaveLength(0)
    expect(h.fake.sent).toHaveLength(1)
    expect(h.fake.sent[0]!.content).toBe(wrapSuperAgentHostContext(['评估卡正文']))

    h.fake.emit(SESSION, 'result', { result: evalFenceText('eval-1') })
    expect(received).toBe(evalFenceText('eval-1'))
    expect(h.dispatched).toHaveLength(0)
    expect(h.failures).toEqual([])
    expect(h.statuses).toEqual([true, false])
  })

  it('评估轮的结果即使带 route 围栏也不派发', async () => {
    const h = makeRunner()
    let received: string | null = null
    h.runner.evaluate({ text: '评估卡', onResult: (text) => (received = text) })
    await flush()

    const both = `${evalFenceText('eval-1')}\n${routeFence([{ kind: 'accept', title: '不该建的单' }])}`
    h.fake.emit(SESSION, 'result', { result: both })
    expect(received).toBe(both)
    expect(h.dispatched).toHaveLength(0)
  })

  it('isStale 为真时整轮跳过，不占引擎也不记送达', async () => {
    const h = makeRunner()
    const events: string[] = []
    h.runner.evaluate({
      text: '过期评估卡',
      isStale: () => true,
      onDeliver: () => events.push('deliver'),
      onResult: () => undefined,
    })
    await flush()

    expect(events).toEqual([])
    expect(h.fake.sent).toHaveLength(0)
    expect(h.statuses).toEqual([])
  })

  it('与人的消息共用串行队列：忙时评估排队，人轮落定后才开评估轮', async () => {
    const h = makeRunner()
    await h.runner.message({ text: '帮我修一下登录页' })

    let received: string | null = null
    h.runner.evaluate({ text: '评估卡', onResult: (text) => (received = text) })
    await flush()

    expect(h.fake.sent).toHaveLength(1)
    expect(h.fake.sent[0]!.content).toContain('帮我修一下登录页')

    h.fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'ignore', reason: '稍后' }]) })
    await flush()

    expect(h.fake.sent).toHaveLength(2)
    expect(h.fake.sent[1]!.content).toBe(wrapSuperAgentHostContext(['评估卡']))

    h.fake.emit(SESSION, 'result', { result: evalFenceText('eval-1') })
    expect(received).toBe(evalFenceText('eval-1'))
  })
})
