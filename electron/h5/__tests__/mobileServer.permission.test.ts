// @vitest-environment node
/**
 * 手机 → 桌面的授权答复在线格式。
 *
 * 客户端发来的 allow/deny 里带的是 requestId（桌面 pending 表的键），
 * 不是 toolUseId。这里跑真实的 ws 握手与帧解析，把 routeMessage 交给适配器的
 * payload 钉死 —— 手机换了字段名或桌面改回去，这条都会红。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { MobileServer } from '../mobileServer'
import { buildThemeSyncData } from '../themeSyncBuilder'

const SESSION_ID = 'session-aaaa-1111'
const REQUEST_ID = 'permission-request-77'
const TOOL_USE_ID = 'tool-call-1'

let server: MobileServer | null = null
let client: WebSocket | null = null

async function connectPhone(): Promise<MobileServer> {
  const srv = new MobileServer(
    async () => ({ status: 'ok' }),
    async () => buildThemeSyncData('dark'),
  )
  server = srv
  const qr = await srv.start()
  await new Promise<void>((resolve, reject) => {
    client = new WebSocket(`ws://127.0.0.1:${qr.port}?token=${qr.token}`)
    client.once('open', () => resolve())
    client.once('error', reject)
  })
  return srv
}

function nextEvent(srv: MobileServer, event: string): Promise<any> {
  return new Promise(resolve => srv.once(event, resolve))
}

afterEach(async () => {
  client?.close()
  client = null
  await server?.stop()
  server = null
})

describe('allow_permission / deny_permission 路由', () => {
  it('把 requestId 连同会话 id 交给适配器', async () => {
    const srv = await connectPhone()
    const allowed = nextEvent(srv, 'allow_permission')

    client!.send(JSON.stringify({
      type: 'allow_permission',
      data: { sessionId: SESSION_ID, requestId: REQUEST_ID, toolUseId: TOOL_USE_ID },
    }))

    await expect(allowed).resolves.toEqual({ sessionId: SESSION_ID, requestId: REQUEST_ID })
  })

  it('拒绝走同一条 requestId 契约', async () => {
    const srv = await connectPhone()
    const denied = nextEvent(srv, 'deny_permission')

    client!.send(JSON.stringify({
      type: 'deny_permission',
      data: { sessionId: SESSION_ID, requestId: REQUEST_ID, toolUseId: TOOL_USE_ID },
    }))

    await expect(denied).resolves.toEqual({ sessionId: SESSION_ID, requestId: REQUEST_ID })
  })

  it('工具提问仍按 toolUseId 回应（那是另一个接口的键）', async () => {
    const srv = await connectPhone()
    const answered = nextEvent(srv, 'submit_tool_answer')

    client!.send(JSON.stringify({
      type: 'submit_tool_answer',
      data: { sessionId: SESSION_ID, toolUseId: TOOL_USE_ID, answer: '允许一次' },
    }))

    await expect(answered).resolves.toEqual({
      sessionId: SESSION_ID,
      toolUseId: TOOL_USE_ID,
      answer: '允许一次',
    })
  })
})

describe('set_agent / send_message 的 agent 字段', () => {
  it('把 sessionId + agentId 原样交给适配器', async () => {
    const srv = await connectPhone()
    const switched = nextEvent(srv, 'set_agent')

    client!.send(JSON.stringify({
      type: 'set_agent',
      data: { sessionId: SESSION_ID, agentId: 'reviewer' },
    }))

    await expect(switched).resolves.toEqual({
      sessionId: SESSION_ID,
      agentId: 'reviewer',
    })
  })

  it('send_message 透传 agentId', async () => {
    const srv = await connectPhone()
    const sent = nextEvent(srv, 'send_message')

    client!.send(JSON.stringify({
      type: 'send_message',
      data: { sessionId: SESSION_ID, content: 'hi', agentId: 'reviewer' },
    }))

    await expect(sent).resolves.toMatchObject({
      sessionId: SESSION_ID,
      content: 'hi',
      agentId: 'reviewer',
    })
  })

  it('list_agents 只透传 sessionId，不再消费 selectedAgentId', async () => {
    const srv = await connectPhone()
    const listed = nextEvent(srv, 'list_agents')

    client!.send(JSON.stringify({
      type: 'list_agents',
      data: { sessionId: SESSION_ID, selectedAgentId: 'code' },
    }))

    await expect(listed).resolves.toEqual({ sessionId: SESSION_ID })
  })
})
