// @vitest-environment node
/**
 * 飞书 IM Source：消息 → Trigger 映射、bot 消息丢弃、@ 检测、坏事件上送与游标/断档透传（T15 #85）。
 *
 * 通过注入 Fake Client 验证，不访问飞书 Open API。
 */
import { describe, expect, it } from 'vitest'
import {
  FeishuImSource,
  createFeishuImHttpClient,
  feishuMessageToEvent,
  type FeishuImClient,
  type FeishuImMessage,
  type FeishuImPage,
} from '../sources/feishuIm'
import type { SourceEvent, SourcePollPage } from '../sources/types'

const BOT_OPEN_ID = 'ou_bot'

/** 联合返回值窄化为事件：映射成功才有字段可断言。 */
function asEvent(result: ReturnType<typeof feishuMessageToEvent>): SourceEvent {
  if (result.kind !== 'event') throw new Error(`expected event, got ${result.kind}`)
  return result.event
}

function message(partial: Partial<FeishuImMessage> = {}): FeishuImMessage {
  return {
    message_id: 'om_1',
    chat_id: 'oc_1',
    chat_type: 'group',
    sender: { sender_type: 'user', sender_id: { open_id: 'ou_alice' } },
    message_type: 'text',
    content: JSON.stringify({ text: 'hello' }),
    create_time: '1767225600000',
    ...partial,
  }
}

function clientPage(partial: Partial<FeishuImPage> = {}): FeishuImPage {
  return { messages: [], nextCursor: null, hasMore: false, gap: false, ...partial }
}

function fakeClient(pages: FeishuImPage[]): FeishuImClient & { polls: unknown[][] } {
  const polls: unknown[][] = []
  let index = 0
  return {
    polls,
    async listMessages(cursor: string | null, limit: number) {
      polls.push([cursor, limit])
      const next = pages[index]
      index += 1
      return next ?? clientPage()
    },
  }
}

describe('feishuMessageToEvent', () => {
  it('maps a text message with a bot mention into a mention-addressed event', () => {
    const event = feishuMessageToEvent(
      message({
        content: JSON.stringify({ text: '@SuperAgent 帮我修登录' }),
        mentions: [{ key: '@_user_1', id: { open_id: BOT_OPEN_ID } }],
      }),
      BOT_OPEN_ID,
    )
    expect(asEvent(event)).toMatchObject({
      key: 'feishu:message:om_1',
      source: 'feishu-im',
      threadIds: ['feishu:group:oc_1'],
      actor: 'feishu:user:ou_alice',
      human: true,
      addressed: 'mention',
      channel: 'feishu:chat:oc_1',
      text: '@SuperAgent 帮我修登录',
      at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    })
    expect(asEvent(event).meta).toMatchObject({ chatType: 'group', messageType: 'text' })
  })

  it('maps p2p messages as direct-addressed with a p2p thread', () => {
    const event = feishuMessageToEvent(
      message({ chat_type: 'p2p' }),
      BOT_OPEN_ID,
    )
    expect(asEvent(event)).toMatchObject({
      addressed: 'direct',
      threadIds: ['feishu:p2p:oc_1'],
    })
  })

  it('maps group messages without a bot mention as not addressed', () => {
    const event = feishuMessageToEvent(message(), BOT_OPEN_ID)
    expect(asEvent(event).addressed).toBeNull()
  })

  it('uses the topic thread id when present', () => {
    const event = feishuMessageToEvent(
      message({ thread_id: 'omt_7' }),
      BOT_OPEN_ID,
    )
    expect(asEvent(event).threadIds).toEqual(['feishu:group:oc_1:thread:omt_7'])
  })

  it('drops the own bot messages and non-user senders', () => {
    expect(
      feishuMessageToEvent(
        message({ sender: { sender_type: 'user', sender_id: { open_id: BOT_OPEN_ID } } }),
        BOT_OPEN_ID,
      ),
    ).toEqual({ kind: 'dropped' })
    expect(
      feishuMessageToEvent(
        message({ sender: { sender_type: 'app', sender_id: { open_id: 'ou_other_app' } } }),
        BOT_OPEN_ID,
      ),
    ).toEqual({ kind: 'dropped' })
  })

  it('detects bot mentions in both object and plain-string id forms', () => {
    // 事件回调形态：mentions[].id 为对象
    expect(
      asEvent(
        feishuMessageToEvent(
          message({
            content: JSON.stringify({ text: 'hey' }),
            mentions: [{ key: '@_user_1', id: { open_id: BOT_OPEN_ID } }],
          }),
          BOT_OPEN_ID,
        ),
      ).addressed,
    ).toBe('mention')
    // 列表接口形态：mentions[].id 为纯字符串 open_id
    expect(
      asEvent(
        feishuMessageToEvent(
          message({
            content: JSON.stringify({ text: 'hey' }),
            mentions: [{ key: '@_user_1', id: BOT_OPEN_ID }],
          }),
          BOT_OPEN_ID,
        ),
      ).addressed,
    ).toBe('mention')
    // @ 的是别人：不 addressed
    expect(
      asEvent(
        feishuMessageToEvent(
          message({
            content: JSON.stringify({ text: 'hey' }),
            mentions: [{ key: '@_user_1', id: { open_id: 'ou_bob' } }],
          }),
          BOT_OPEN_ID,
        ),
      ).addressed,
    ).toBeNull()
  })

  it('accepts create_time in both seconds and milliseconds', () => {
    // 秒级（10 位）与毫秒级（13 位）都应得到同一 ISO 时间。
    expect(asEvent(feishuMessageToEvent(message({ create_time: '1767225600' }), BOT_OPEN_ID)).at).toBe(
      '2026-01-01T00:00:00.000Z',
    )
    expect(asEvent(feishuMessageToEvent(message({ create_time: '1767225600000' }), BOT_OPEN_ID)).at).toBe(
      '2026-01-01T00:00:00.000Z',
    )
  })

  it('extracts text from post (rich text) messages including at elements', () => {
    const event = feishuMessageToEvent(
      message({
        message_type: 'post',
        content: JSON.stringify({
          title: '标题',
          content: [
            [
              { tag: 'text', text: '第一段 ' },
              { tag: 'at', user_id: 'ou_bob', user_name: 'Bob' },
            ],
            [{ tag: 'text', text: '第二段' }],
          ],
        }),
      }),
      BOT_OPEN_ID,
    )
    expect(asEvent(event).text).toBe('标题\n第一段 @Bob\n第二段')
  })

  it('marks structurally bad messages as bad so the ingestor quarantines them', () => {
    // 缺 message_id：无法构造稳定事件键。
    expect(feishuMessageToEvent(message({ message_id: '' }), BOT_OPEN_ID)).toEqual({ kind: 'bad' })
    // 文本消息的 content 不是 JSON。
    expect(feishuMessageToEvent(message({ content: 'not-json' }), BOT_OPEN_ID)).toEqual({ kind: 'bad' })
    // create_time 非数字。
    expect(feishuMessageToEvent(message({ create_time: 'yesterday' }), BOT_OPEN_ID)).toEqual({
      kind: 'bad',
    })
  })

  it('maps non-text non-post messages to an empty text with type meta', () => {
    const event = feishuMessageToEvent(
      message({ message_type: 'image', content: JSON.stringify({ image_key: 'img_v2_1' }) }),
      BOT_OPEN_ID,
    )
    expect(asEvent(event).text).toBe('')
    expect(asEvent(event).meta).toMatchObject({ messageType: 'image' })
  })
})

describe('FeishuImSource.poll', () => {
  it('maps client messages, drops bot messages and passes page metadata through', async () => {
    const client = fakeClient([
      clientPage({
        messages: [
          message({ message_id: 'om_1' }),
          message({ message_id: 'om_2', sender: { sender_type: 'user', sender_id: { open_id: BOT_OPEN_ID } } }),
          message({ message_id: 'om_3', chat_type: 'p2p' }),
        ],
        nextCursor: 'next-1',
        hasMore: true,
      }),
    ])
    const source = new FeishuImSource(client, BOT_OPEN_ID)

    const result: SourcePollPage = await source.poll('cursor-1', 50)
    expect(client.polls).toEqual([['cursor-1', 50]])
    expect(result.gap).toBe(false)
    expect(result.nextCursor).toBe('next-1')
    expect(result.hasMore).toBe(true)
    // bot 自身消息被丢弃，其余两条映射为事件。
    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toMatchObject({ key: 'feishu:message:om_1' })
    expect(result.events[1]).toMatchObject({ key: 'feishu:message:om_3', addressed: 'direct' })
  })

  it('propagates gap so the ingestor performs a full re-pull', async () => {
    const client = fakeClient([clientPage({ gap: true, messages: [message()] })])
    const source = new FeishuImSource(client, BOT_OPEN_ID)
    const result = await source.poll('stale', 50)
    expect(result.gap).toBe(true)
    // 断档页的事件不可信，不交付。
    expect(result.events).toHaveLength(0)
  })
})

describe('createFeishuImHttpClient', () => {
  interface ScriptedResponse {
    url: string
    status?: number
    body: unknown
  }

  function fetchScript(responses: ScriptedResponse[]): typeof fetch & { calls: string[] } {
    const calls: string[] = []
    let index = 0
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      const scripted = responses[index]
      index += 1
      if (!scripted) throw new Error(`unexpected fetch: ${url}`)
      return new Response(JSON.stringify(scripted.body), {
        status: scripted.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch & { calls: string[] }
    impl.calls = calls
    return impl
  }

  it('authenticates, lists watched chats, merges by create_time and encodes watermarks', async () => {
    const responses: ScriptedResponse[] = [
      { url: 'auth', body: { code: 0, tenant_access_token: 't0', expire: 7200 } },
      {
        url: 'chat-a',
        body: {
          code: 0,
          data: {
            items: [message({ message_id: 'om_a2', chat_id: 'oc_a', create_time: '2000' })],
            has_more: false,
          },
        },
      },
      {
        url: 'chat-b',
        body: {
          code: 0,
          data: {
            items: [message({ message_id: 'om_b1', chat_id: 'oc_b', create_time: '1000' })],
            has_more: false,
          },
        },
      },
    ]
    const fetchImpl = fetchScript(responses)
    const client = createFeishuImHttpClient({
      appId: 'app',
      appSecret: 'secret',
      chats: ['oc_a', 'oc_b'],
      fetch: fetchImpl,
    })

    const page = await client.listMessages(null, 50)
    expect(page.gap).toBe(false)
    expect(page.messages.map((m) => m.message_id)).toEqual(['om_b1', 'om_a2'])
    expect(page.hasMore).toBe(false)

    const cursor = JSON.parse(page.nextCursor ?? 'null')
    expect(cursor.chats.oc_a).toEqual({ startTime: '2000', pageToken: null })
    expect(cursor.chats.oc_b).toEqual({ startTime: '1000', pageToken: null })

    // 下一轮：token 复用不重新鉴权，以水位作为 start_time 续读。
    fetchImpl.calls.length = 0
    responses.push(
      { url: 'chat-a', body: { code: 0, data: { items: [], has_more: false } } },
      { url: 'chat-b', body: { code: 0, data: { items: [], has_more: false } } },
    )
    const page2 = await client.listMessages(page.nextCursor, 50)
    expect(fetchImpl.calls).toHaveLength(2)
    expect(page2.messages).toEqual([])
    expect(fetchImpl.calls[0]).toContain('start_time=2000')
    expect(fetchImpl.calls[1]).toContain('start_time=1000')
  })

  it('maps configured gap error codes into a gap page instead of throwing', async () => {
    const fetchImpl = fetchScript([
      { url: 'auth', body: { code: 0, tenant_access_token: 't0', expire: 7200 } },
      { url: 'chat-a', body: { code: 230002, msg: 'invalid page token' } },
    ])
    const client = createFeishuImHttpClient({
      appId: 'app',
      appSecret: 'secret',
      chats: ['oc_a'],
      fetch: fetchImpl,
      gapErrorCodes: [230002],
    })
    const page = await client.listMessages(null, 50)
    expect(page.gap).toBe(true)
    expect(page.messages).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it('throws on unexpected API errors so the ingestor can back off', async () => {
    const fetchImpl = fetchScript([
      { url: 'auth', body: { code: 0, tenant_access_token: 't0', expire: 7200 } },
      { url: 'chat-a', body: { code: 99999, msg: 'server busy' } },
    ])
    const client = createFeishuImHttpClient({
      appId: 'app',
      appSecret: 'secret',
      chats: ['oc_a'],
      fetch: fetchImpl,
    })
    await expect(client.listMessages(null, 50)).rejects.toThrow('99999')
  })
})
