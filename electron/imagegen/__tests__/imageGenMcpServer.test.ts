// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// 真实的 MCP 客户端来自引擎自带的 SDK：生图工具能不能被 Agent 调起来，
// 只有让真正的协议实现握一次手才算数，自造客户端只能证明「我和我自己一致」。
import { Client } from '../../../engine/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../../../engine/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'
import type { ImageGenConfig } from '@/shared/imageGenReference'
import type { ExtensionDialogClosedEvent, ExtensionDialogRequest } from '@/shared/channels/claudeCode'
import { respondImageGenDialog } from '../imageGenAuthorization'
import { getImageGenMcpEntry, startImageGenMcpServer, stopImageGenMcpServer } from '../imageGenMcpServer'

type DialogFrame = { sessionId: string; data: ExtensionDialogRequest | ExtensionDialogClosedEvent }

const mockState = vi.hoisted(() => {
  const sent: Array<{ channel: string; payload: DialogFrame }> = []
  return { sent }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: DialogFrame) => { mockState.sent.push({ channel, payload }) },
      },
    }],
  },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

const CONFIG: ImageGenConfig = {
  presetId: 'openai',
  dialect: 'openai',
  baseUrl: 'https://api.test/v1',
  apiKey: 'sk-test',
  model: 'gpt-image-1',
  disableWatermark: false,
}
// 完整签名的最小 PNG：8 字节魔数 + IHDR 首块 + 宽高，过签名闸门也能读出尺寸。
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00,
  0x08, 0x06, 0x00, 0x00, 0x00,
])

let root: string
let client: Client | null = null

function provider(): typeof fetch {
  return vi.fn(async () => new Response(
    JSON.stringify({ data: [{ b64_json: PNG.toString('base64'), size: '1024x1024' }] }),
    { status: 200 },
  )) as unknown as typeof fetch
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'spacecode-imagegen-mcp-'))
  mockState.sent.splice(0)
})

afterEach(async () => {
  if (client) {
    await client.close()
    client = null
  }
  await stopImageGenMcpServer()
  rmSync(root, { recursive: true, force: true })
})

describe('生图 MCP 服务器', () => {
  it('真实 SDK 客户端握手后能列出工具，授权答完才落盘', async () => {
    const server = await startImageGenMcpServer({
      permissionMode: () => 'default',
      loadConfig: () => CONFIG,
      fetchImpl: provider(),
      locale: () => 'zh-CN',
    })

    client = new Client({ name: 'spacecode-test-client', version: '1.0.0' })
    const entry = getImageGenMcpEntry('session-live', root)!
    expect(entry.url).toContain(`:${server.port}/mcp/session-live`)
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers } }),
    )

    const tools = await client.listTools()
    expect(tools.tools.map(tool => tool.name)).toEqual(['generate_image', 'edit_image'])
    expect(client.getServerVersion()?.name).toBe('spacecode-imagegen')
    expect(client.getInstructions()).toContain('generate_image')

    const calling = client.callTool({ name: 'generate_image', arguments: { prompt: 'a cover', nameHint: 'cover' } })

    // 卡片走的是既有宿主问答通道，不是新通道
    await vi.waitFor(() => expect(mockState.sent).toHaveLength(1))
    const frame = mockState.sent[0]
    expect(frame.channel).toBe('claude-code:extension_dialog_request')
    expect(frame.payload.sessionId).toBe('session-live')
    expect(frame.payload.data.method).toBe('select')
    expect(respondImageGenDialog(frame.payload.data.dialogId, { kind: 'value', value: '允许一次' })).toBe(true)

    const result = await calling
    expect(result.isError).toBeFalsy()
    const body = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    expect(body.images[0].path).toBe(join(root, 'outputs', 'imagegen', 'cover.png'))
    expect(existsSync(body.images[0].path)).toBe(true)

    // 答完卡片按既有约定收口
    const closed = mockState.sent[mockState.sent.length - 1]
    expect(closed.channel).toBe('claude-code:extension_dialog_closed')
    expect(closed.payload.data).toEqual({ dialogId: frame.payload.data.dialogId, method: 'select', reason: 'answered' })
  })

  it('真实 SDK 客户端能调改图：授权卡写明改图与张数，走 edits 且不覆盖源文件', async () => {
    const source = join(root, 'src.png')
    writeFileSync(source, PNG)
    const fetchImpl = provider()
    await startImageGenMcpServer({
      permissionMode: () => 'default',
      loadConfig: () => CONFIG,
      fetchImpl,
      locale: () => 'zh-CN',
    })

    client = new Client({ name: 'spacecode-test-client', version: '1.0.0' })
    const entry = getImageGenMcpEntry('session-edit', root)!
    await client.connect(
      new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers: entry.headers } }),
    )

    const calling = client.callTool({
      name: 'edit_image',
      arguments: { prompt: 'make it warm', imagePaths: ['src.png'], nameHint: 'warm' },
    })

    await vi.waitFor(() => expect(mockState.sent).toHaveLength(1))
    const dialog = mockState.sent[0].payload.data as ExtensionDialogRequest
    expect(dialog.title).toBe('允许这次改图吗？')
    expect(dialog.message ?? '').toContain('参考图：1 张')
    expect(respondImageGenDialog(dialog.dialogId, { kind: 'value', value: '允许一次' })).toBe(true)

    const result = await calling
    expect(result.isError).toBeFalsy()
    const body = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    expect(body.referenceCount).toBe(1)
    expect(body.images[0].path).toBe(join(root, 'outputs', 'imagegen', 'warm.png'))
    expect(existsSync(body.images[0].path)).toBe(true)
    expect(readFileSync(source).equals(PNG)).toBe(true)

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/images/edits')
    expect((init.body as FormData).getAll('image')).toHaveLength(1)
  })

  it('没在监听时不给条目，绝不递一个连不上的地址', async () => {
    expect(getImageGenMcpEntry('s1', root)).toBeNull()

    const server = await startImageGenMcpServer({
      permissionMode: () => 'default',
      loadConfig: () => CONFIG,
      fetchImpl: provider(),
    })
    expect(getImageGenMcpEntry('s1', root)?.url).toContain(`:${server.port}/mcp/s1`)

    await stopImageGenMcpServer()
    expect(getImageGenMcpEntry('s1', root)).toBeNull()
  })
})