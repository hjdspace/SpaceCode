// @vitest-environment node
/**
 * #103：外部来源工单的 reply 走平台通道 —— 飞书发起的工单，acknowledgement
 * 回到原飞书话题（带 reply 目标），并由组合通道路由到飞书发送器。
 */
import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSuperAgentService, type SuperAgentService } from '../service'
import { FEISHU_IM_SOURCE_ID, type SuperAgentSourcesConfig } from '../sources/config'
import type { ExternalSource, SourcePollPage } from '../sources/types'
import type { SuperAgentOutboxChannel } from '../outbox'
import { createFakeBridge } from './fakeBridge'

const REPO = mkdtempSync(join(tmpdir(), 'spacecode-external-replies-'))
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

describe('external source replies use platform outbox channels', () => {
  it('routes a feishu-origin acknowledgement back to its topic with a reply target', async () => {
    const source = new ScriptedSource([
      {
        events: [
          {
            key: 'feishu:message:om_human',
            source: FEISHU_IM_SOURCE_ID,
            threadIds: ['feishu:chat:oc_chat'],
            actor: 'feishu:user:u1',
            human: true,
            addressed: 'mention',
            channel: 'feishu:chat:oc_chat',
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
    const delivered: string[] = []
    const feishuChannel: SuperAgentOutboxChannel = async (message) => {
      delivered.push(message.channel)
      return { outcome: 'sent', receipt: `om_fake_${message.messageId}` }
    }
    const service = makeService({
      userDataDir: mkdtempSync(join(tmpdir(), 'spacecode-external-replies-')),
      sources: CONFIG,
      sourceFactory: () => [source],
      bridge: fake.bridge,
      launcher: { launch: async () => {} },
      outbox: {
        desktop: false,
        feishu: feishuChannel,
        limits: { reply: 0 },
        sweepIntervalMs: 60_000,
      },
    })
    service.state(REPO)
    await service.authorizationPolicySet(REPO, {
      acceptMode: 'auto',
      rules: [],
      admissions: [{ source: FEISHU_IM_SOURCE_ID, channels: [], allowlist: [], bots: [] }],
    })

    await until(() => fake.sent.length >= 1)
    const sessionId = fake.started[0]!.sessionId
    const evalId = evalIdOf(fake.sent[0]!.content ?? '')
    fake.emit(sessionId, 'result', {
      result: [
        '```super-agent:eval',
        JSON.stringify({ version: 1, evalId, action: 'accept', matchedRules: [], reason: '明确要求修复' }),
        '```',
      ].join('\n'),
    })

    await until(() => service.outboxQueue(REPO).some((message) => message.kind === 'reply'))
    const ack = service.outboxQueue(REPO).find((message) => message.kind === 'reply')!
    expect(ack.channel).toBe('feishu:chat:oc_chat:reply:om_human')
    expect(ack.status).toBe('sent')
    expect(delivered).toEqual(['feishu:chat:oc_chat:reply:om_human'])
  })
})
