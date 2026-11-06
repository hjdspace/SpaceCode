// @vitest-environment node
/**
 * 宿主注入段与回放剥离之间的漂移守卫。
 *
 * 注入侧（主进程提示词）与剥离侧（`src/shared/promptEnvelope`）分处两个 bundle，
 * 唯一把它们缝在一起的是那批字面量：锚点改了一个字，历史正文的截断就静默失效，
 * 表现是"重开应用后提示词又混进用户气泡"。这里把两边对齐钉住，不靠人记得改两处。
 */
import { describe, expect, it } from 'vitest'
import {
  SUPER_AGENT_ROUTE_REPAIR_PROMPT,
  SUPER_AGENT_ROUTER_ROLE_PROMPT,
  renderSuperAgentRouterEvent,
  renderSuperAgentRouterStatusContext,
} from '../prompts'
import {
  SUPER_AGENT_LEGACY_HOST_ANCHORS,
  parseEngineUserPrompt,
  wrapSuperAgentHostContext,
} from '@/shared/promptEnvelope'
import { createSuperAgentRouterRunner } from '../routerRunner'
import { createFakeBridge } from './fakeBridge'

const REPO = '/repo/a'
const SESSION = 'router-session'

describe('super agent host context anchors', () => {
  it('每个锚点都真的出现在宿主注入的正文里', async () => {
    const snapshot = {
      repoRoot: REPO,
      asOf: '2026-11-06T00:00:00.000Z',
      seq: 1,
      slots: { maxWorkers: 1, running: 0, queued: 0 },
      backgroundJobs: 'unknown' as const,
      pendingAttention: 0,
      tickets: [],
    }
    const produced: Record<string, string> = {
      '# Super Agent Router': SUPER_AGENT_ROUTER_ROLE_PROMPT,
      '[工单快照]': renderSuperAgentRouterStatusContext(snapshot),
      '[工单事件]': renderSuperAgentRouterEvent({
        ticketId: 'ticket-1', title: '补测试', kind: 'ready', summary: '做完了',
      }),
      '[宿主协议校正]': SUPER_AGENT_ROUTE_REPAIR_PROMPT,
    }

    // [人消息索引] 由 routerRunner 现场拼，单独走一次真实投递来取
    const fake = createFakeBridge()
    const runner = createSuperAgentRouterRunner({
      repoRoot: REPO,
      sessionId: SESSION,
      bridge: fake.bridge,
      hooks: {
        dispatch: () => ({ ticketId: 'ticket-1' }),
        attach: () => {},
        retry: () => {},
        stop: () => {},
        onStatusChanged: () => {},
        onFailure: () => {},
        sourceRequests: () => [
          { requestId: 'req-1', text: '分析覆盖率' },
          { requestId: 'req-2', text: '重新执行' },
        ],
      },
    })
    void runner.message({ text: '重新执行', requestId: 'req-2' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    produced['[人消息索引]'] = fake.sent[0]?.content ?? ''
    runner.dispose()

    for (const anchor of SUPER_AGENT_LEGACY_HOST_ANCHORS) {
      expect(produced[anchor], `锚点 ${anchor} 已不再由宿主注入段产出`).toContain(anchor)
    }
  })

  it('注入段包上信封后回放一定剥成空正文', () => {
    const injected = [
      SUPER_AGENT_ROUTER_ROLE_PROMPT,
      renderSuperAgentRouterEvent({
        ticketId: 'ticket-1', title: '补测试', kind: 'ready', summary: '做完了',
      }),
      SUPER_AGENT_ROUTE_REPAIR_PROMPT,
    ]

    for (const text of injected) {
      expect(parseEngineUserPrompt(wrapSuperAgentHostContext([text])).text).toBe('')
      // 旧转录没有信封：整条以锚点开头的注入同样不该留下用户气泡
      expect(parseEngineUserPrompt(text).text).toBe('')
    }
  })

  it('围栏协议不受信封剥离影响，route 块仍能被宿主解析', async () => {
    const fenced = ['```super-agent:route', '{"version":2,"routes":[{"kind":"ignore"}]}', '```'].join('\n')
    const withEnvelope = wrapSuperAgentHostContext([SUPER_AGENT_ROUTER_ROLE_PROMPT])

    expect(parseEngineUserPrompt(withEnvelope).text).toBe('')
    expect(fenced).toContain('super-agent:route')
  })
})
