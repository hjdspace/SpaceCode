/**
 * 附件图片如何送达引擎。
 *
 * 回归目标：图片必须以 user 轮的 image content block 内联下发。旧实现只把
 * `@"<落盘路径>"` 拼进正文，模型转而调用 Read 工具，而引擎的 OpenAI 兼容转换
 * 会把 tool_result 压成纯文本、丢掉其中的 image block —— 非 Anthropic 网关的
 * 模型于是看不到新图，会拿上下文里的旧图作答。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { SessionProcess, SessionConfig } from '../session/sessionProcess'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => os.tmpdir()),
  },
}))

vi.mock('../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  processRaw: vi.fn(),
  sdkMessage: vi.fn(),
  setSessionLogPath: vi.fn(),
  traceEvent: vi.fn(),
}))

const PNG_BASE64 = Buffer.from('png-bytes').toString('base64')

function pngAttachment(name = 'shot.png') {
  return {
    id: 'img-1',
    name,
    type: 'image' as const,
    mimeType: 'image/png',
    previewUrl: `data:image/png;base64,${PNG_BASE64}`,
    data: `data:image/png;base64,${PNG_BASE64}`,
  }
}

function makeProc(): SessionProcess {
  const config: SessionConfig = { cwd: os.tmpdir(), permissionMode: 'default' }
  const proc = new SessionProcess('sess-images-test', config)
  proc.process = {
    pid: 4321,
    killed: false,
    stdin: { writable: true, write: vi.fn() },
  } as any
  return proc
}

/** 取回写入 stdin 的那一行 JSON（去掉行尾换行） */
function writtenMessage(proc: SessionProcess): any {
  const write = (proc.process!.stdin as any).write as ReturnType<typeof vi.fn>
  expect(write).toHaveBeenCalledTimes(1)
  return JSON.parse(String(write.mock.calls[0][0]))
}

describe('SessionProcess.sendMessage — 附件图片', () => {
  let uploadRoot: string

  beforeEach(() => {
    uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-uploads-'))
    process.env.CLAUDE_CONFIG_DIR = uploadRoot
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CLAUDE_CONFIG_DIR
    fs.rmSync(uploadRoot, { recursive: true, force: true })
  })

  it('无附件时正文仍是纯字符串', () => {
    const proc = makeProc()
    proc.sendMessage('识别图片中的文字')

    const msg = writtenMessage(proc)
    expect(msg.message.content).toBe('识别图片中的文字')
    proc.removeAllListeners()
  })

  it('PNG 附件内联为 image block，正文作为最后一个 text block', () => {
    const proc = makeProc()
    proc.sendMessage('识别图片中的文字', [pngAttachment()])

    const blocks = writtenMessage(proc).message.content
    expect(Array.isArray(blocks)).toBe(true)
    expect(blocks[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 },
    })
    // 引擎只在末块为 text 时提取 inputString，正文顺序不能反
    expect(blocks[blocks.length - 1]).toEqual({
      type: 'text',
      text: '识别图片中的文字',
    })
    proc.removeAllListeners()
  })

  it('不再把上传路径拼进正文', () => {
    const proc = makeProc()
    proc.sendMessage('看图', [pngAttachment()])

    const textBlock = writtenMessage(proc).message.content
      .find((b: any) => b.type === 'text')
    expect(textBlock.text).toBe('看图')
    expect(textBlock.text).not.toMatch(/uploads|@"/)
    proc.removeAllListeners()
  })

  it('多张附件按顺序全部内联', () => {
    const proc = makeProc()
    proc.sendMessage('对比这两张图', [
      pngAttachment('a.png'),
      { ...pngAttachment('b.jpg'), data: `data:image/jpeg;base64,${PNG_BASE64}` },
    ])

    const blocks = writtenMessage(proc).message.content
    expect(blocks.map((b: any) => b.type)).toEqual(['image', 'image', 'text'])
    expect(blocks[1].source.media_type).toBe('image/jpeg')
    proc.removeAllListeners()
  })

  it('image/jpg 别名归一成 image/jpeg', () => {
    const proc = makeProc()
    proc.sendMessage('看图', [{ ...pngAttachment(), data: `data:image/jpg;base64,${PNG_BASE64}` }])

    const blocks = writtenMessage(proc).message.content
    expect(blocks[0].source.media_type).toBe('image/jpeg')
    proc.removeAllListeners()
  })

  it('API 不认的类型退回文件路径引用，并落盘', () => {
    const proc = makeProc()
    proc.sendMessage('看图', [
      { ...pngAttachment('diagram.svg'), data: `data:image/svg+xml;base64,${PNG_BASE64}` },
    ])

    const content = writtenMessage(proc).message.content
    expect(typeof content).toBe('string')
    const savedPath = content.match(/@"(.+)"/)![1]
    expect(fs.existsSync(savedPath)).toBe(true)
    expect(fs.readFileSync(savedPath)).toEqual(Buffer.from(PNG_BASE64, 'base64'))
    proc.removeAllListeners()
  })

  it('可内联与不可内联混合时，内联图走 block、其余走路径', () => {
    const proc = makeProc()
    proc.sendMessage('看图', [
      pngAttachment('shot.png'),
      { ...pngAttachment('clip.bmp'), data: `data:image/bmp;base64,${PNG_BASE64}` },
    ])

    const blocks = writtenMessage(proc).message.content
    expect(blocks.map((b: any) => b.type)).toEqual(['image', 'text'])
    expect(blocks[1].text).toMatch(/@".+\.bmp"/)
    proc.removeAllListeners()
  })

  it('只有图片没有正文时补默认提示语，避免空 text block', () => {
    const proc = makeProc()
    proc.sendMessage('', [pngAttachment()])

    const blocks = writtenMessage(proc).message.content
    expect(blocks[blocks.length - 1].type).toBe('text')
    expect(blocks[blocks.length - 1].text.length).toBeGreaterThan(0)
    proc.removeAllListeners()
  })
})
