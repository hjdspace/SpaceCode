// @vitest-environment node
/**
 * #99 Eval 闭环接线：Source 候选 → EvalDriver 建批 → Router 评估轮 → Decision。
 * 这里只验证 service 把三方接起来，协议细节由 evalDriver / routerRunner 自己的用例覆盖。
 */
import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSuperAgentService, type SuperAgentService } from '../service'
import { FEISHU_IM_SOURCE_ID, type SuperAgentSourcesConfig } from '../sources/config'
import type { ExternalSource, SourcePollPage } from '../sources/types'
import { createFakeBridge } from './fakeBridge'

const REPO = mkdtempSync(join(tmpdir(), 'spacecode-eval-repo-'))
mkdirSync(REPO, { recursive: true })

const CONFIG: SuperAgentSourcesConfig = {
  enabled: [FEISHU_IM_SOURCE_ID],
  feishuIm: {
    botOpenId: 'ou_bot',
    chats: ['oc_chat'],
    pollIntervalMs: 10,
  },
}

const AT = '2026-01-01T00:00:00.000Z'

class ScriptedSource implements ExternalSource {
  readonly id = FEISHU_IM_SOURCE_ID
  private pages: SourcePollPage[]
  constructor(pages: SourcePollPage[]) {
    this.pages = pages
  }
  async poll(): Promise<SourcePollPage> {
    return this.pages.shift() ?? { events: [], nextCursor: null, hasMore: false, gap: false }
  }
}

const services: SuperAgentService[] = []
function makeService(options: Parameters<typeof createSuperAgentService>[0]): SuperAgentService {
  const service = createSuperAgentService(options)
  services.push(service)
  return service
}

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition not met before timeout')
}

function evalIdOf(content: string): string {
  const match = content.match(/evalId: (eval-[0-9a-f-]+)/)
  if (!match) throw new Error('评估卡缺少 evalId')
  return match[1]!
}

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.shutdownAll()))
})

describe('Eval service wiring', () => {
  it('auto 模式下候选经 Router 评估后建单', async () => {
    const source = new ScriptedSource([
      {
        events: [
          {
            key: 'feishu:message:m1',
            source: FEISHU_IM_SOURCE_ID,
            threadIds: ['feishu:thread:t1'],
            actor: 'feishu:user:u1',
            human: true,
            addressed: 'mention',
            channel: 'oc_chat',
            url: null,
            text: '修一下登录页的报错弹窗',
            at: AT,
            meta: {},
          },
        ],
        nextCursor: null,
        hasMore: false,
        gap: false,
      },
    ])
    const fake = createFakeBridge()
    const service = makeService({
      userDataDir: mkdtempSync(join(tmpdir(), 'spacecode-eval-')),
      sources: CONFIG,
      sourceFactory: () => [source],
      bridge: fake.bridge,
      launcher: null,
    })
    service.state(REPO)
    await service.authorizationPolicySet(REPO, {
      acceptMode: 'auto',
      rules: [{ name: 'rule-a', instruction: '先看日志再改代码' }],
      admissions: [{ source: FEISHU_IM_SOURCE_ID, channels: [], allowlist: [], bots: [] }],
    })

    await until(() => fake.sent.length >= 1)
    const sessionId = fake.started[0]!.sessionId
    const evalId = evalIdOf(fake.sent[0]!.content ?? '')
    fake.emit(sessionId, 'result', {
      result: [
        '```super-agent:eval',
        JSON.stringify({
          version: 1,
          evalId,
          action: 'accept',
          matchedRules: ['rule-a'],
          reason: '明确要求修复登录页',
        }),
        '```',
      ].join('\n'),
    })

    await until(() => service.tickets(REPO).tickets.length === 1)
    const ticket = service.tickets(REPO).tickets[0]!
    expect(ticket).toMatchObject({
      title: '修一下登录页的报错弹窗',
      state: 'queued',
    })
  })

  it('observe 模式下评估 accept 只记录不建单', async () => {
    const source = new ScriptedSource([
      {
        events: [
          {
            key: 'feishu:message:m2',
            source: FEISHU_IM_SOURCE_ID,
            threadIds: ['feishu:thread:t2'],
            actor: 'feishu:user:u1',
            human: true,
            addressed: 'mention',
            channel: 'oc_chat',
            url: null,
            text: '把首页文案改一下',
            at: AT,
            meta: {},
          },
        ],
        nextCursor: null,
        hasMore: false,
        gap: false,
      },
    ])
    const fake = createFakeBridge()
    const service = makeService({
      userDataDir: mkdtempSync(join(tmpdir(), 'spacecode-eval-')),
      sources: CONFIG,
      sourceFactory: () => [source],
      bridge: fake.bridge,
      launcher: null,
    })
    service.state(REPO)
    await service.authorizationPolicySet(REPO, {
      acceptMode: 'observe',
      rules: [],
      admissions: [{ source: FEISHU_IM_SOURCE_ID, channels: [], allowlist: [], bots: [] }],
    })

    await until(() => fake.sent.length >= 1)
    const sessionId = fake.started[0]!.sessionId
    const evalId = evalIdOf(fake.sent[0]!.content ?? '')
    fake.emit(sessionId, 'result', {
      result: [
        '```super-agent:eval',
        JSON.stringify({ version: 1, evalId, action: 'accept', matchedRules: [], reason: '明确要求' }),
        '```',
      ].join('\n'),
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(service.tickets(REPO).tickets).toEqual([])
  })
})
