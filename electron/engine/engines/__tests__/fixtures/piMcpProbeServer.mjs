/**
 * 真 pi 探针用的最小 stdio MCP server（零依赖，手写 JSON-RPC over 换行分帧）。
 *
 * 为什么不用 @modelcontextprotocol/sdk：仓库里没有装它，装一个只为了给一个
 * 权限闸测试铺管道不值当。这里只需要 pi 会问的那几个方法。
 *
 * 它存在的唯一理由：`tools/call` 会往探针目录里落一个真文件。这样
 * 「plan 闸把 MCP 挡住了」才有两种可区分的结局 —— 文件没出现 + 模型收到了
 * 一句 block 原因，而不是「server 压根没连上所以什么都没发生」。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'

const outDir = process.env.PI_MCP_PROBE_DIR || process.cwd()

const TOOLS = [
  {
    name: 'note',
    description: 'Write a small note file into the probe directory.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'basename of the file to write' },
        text: { type: 'string', description: 'file content' },
      },
      required: ['file', 'text'],
    },
    // 声明成非只读：plan 闸要按「可变」待它，这正是本探针要验的语义。
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
]

const send = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const replyError = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32601, message } })

readline
  .createInterface({ input: process.stdin, terminal: false })
  .on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const { id, method, params } = message
    // 通知没有 id，按协议不该回
    if (id === undefined) return

    switch (method) {
      case 'initialize':
        reply(id, {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'pi-mcp-probe', version: '1.0.0' },
        })
        return
      case 'ping':
        return reply(id, {})
      case 'tools/list':
        return reply(id, { tools: TOOLS })
      case 'resources/list':
        return reply(id, { resources: [] })
      case 'resource_templates/list':
      case 'prompts/list':
        return reply(id, method === 'prompts/list' ? { prompts: [] } : { resourceTemplates: [] })
      case 'tools/call': {
        if (params?.name !== 'note') {
          return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: `unknown tool: ${String(params?.name)}` }] } })
        }
        const target = path.join(outDir, path.basename(String(params?.arguments?.file ?? 'note.txt')))
        fs.writeFileSync(target, String(params?.arguments?.text ?? ''), 'utf8')
        return reply(id, { content: [{ type: 'text', text: `wrote ${target}` }] })
      }
      default:
        return replyError(id, `method not found: ${String(method)}`)
    }
  })
