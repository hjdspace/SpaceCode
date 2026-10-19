// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import * as os from 'os'
import * as path from 'path'

/**
 * Multi-page screenshot rendering (issue #41 / ticket 14).
 *
 * `officecli view … screenshot` renders a page RANGE into ONE PNG with the
 * pages stacked top-to-bottom, and `-o` only ever takes a single file path —
 * it cannot emit per-page files. So the main process has to hand the renderer
 * enough geometry to slice that sheet apart: how many pages the document has,
 * which pages this image covers, and its pixel size.
 */

const cp = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }))
type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>
const electronMock = vi.hoisted(() => ({ handlers: new Map<string, IpcHandler>() }))
const fsMock = vi.hoisted(() => ({
  exists: new Set<string>(),
  pngSize: { width: 0, height: 0 },
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
}))

vi.mock('child_process', () => ({ spawn: cp.spawn, spawnSync: cp.spawnSync }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => path.join(process.cwd(), 'app'),
    getPath: (name: string) => path.join(os.homedir(), name),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      electronMock.handlers.set(channel, handler)
    }),
    on: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => fsMock.exists.has(String(p)),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  openSync: fsMock.openSync,
  readSync: fsMock.readSync,
  closeSync: fsMock.closeSync,
  createWriteStream: vi.fn(),
  unlinkSync: vi.fn(),
  renameSync: vi.fn(),
  chmodSync: vi.fn(),
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { getOfficeCliBinaryPath, registerOfficeCliIPCHandlers } from '../officeCliService'

interface SpawnCall {
  args: string[]
}

/** Scripted `officecli` process: matches on a substring of its argv. */
interface Script {
  match: string
  stdout?: string
  stderr?: string
  exitCode?: number
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function fakePngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(26)
  PNG_SIGNATURE.copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

function spawnScript(scripts: Script[]): void {
  cp.spawn.mockImplementation((_bin: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number
      stdout: EventEmitter
      stderr: EventEmitter
    }
    child.pid = 1
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const argv = args.join(' ')
    const hit = scripts.find((s) => argv.includes(s.match))
    setImmediate(() => {
      if (!hit) {
        child.stdout.emit('data', Buffer.from(''))
        child.emit('close', 127)
        return
      }
      if (hit.stdout) child.stdout.emit('data', Buffer.from(hit.stdout))
      if (hit.stderr) child.stderr.emit('data', Buffer.from(hit.stderr))
      child.emit('close', hit.exitCode ?? 0)
    })
    return child
  })
}

function spawnCalls(): SpawnCall[] {
  return cp.spawn.mock.calls.map(([, args]) => ({ args: args as string[] }))
}

function findCall(needle: string): string[] | undefined {
  return spawnCalls().find((c) => c.args.includes(needle))?.args
}

function getHandler(channel: string): IpcHandler {
  const handler = electronMock.handlers.get(channel)
  if (!handler) throw new Error(`IPC handler not registered: ${channel}`)
  return handler
}

interface SheetResult {
  path: string
  pageCount: number
  start: number
  end: number
  width: number
  height: number
}

const OUT_DIR = path.join(process.cwd(), 'shots')

/** officecli 的 -o 只接一个文件路径，主进程按页区间给它命名 */
function shotFile(start: number, end: number): string {
  return path.join(OUT_DIR, `doc-pages-${start}-${end}.png`)
}

const SHOT = shotFile(1, 6)

function declareOutputExists(file = SHOT): void {
  fsMock.exists.add(file)
}

async function screenshot(filePath: string, start?: number): Promise<SheetResult> {
  const sheet = await getHandler('officecli:viewScreenshot')({}, filePath, OUT_DIR, start)
  return sheet as SheetResult
}

beforeEach(() => {
  cp.spawn.mockReset()
  cp.spawnSync.mockReset().mockReturnValue({ status: 0, stdout: '' })
  fsMock.exists.clear()
  fsMock.exists.add(getOfficeCliBinaryPath())
  fsMock.openSync.mockReturnValue(7)
  fsMock.readSync.mockImplementation((_fd: number, buffer: Buffer) => {
    fakePngHeader(fsMock.pngSize.width, fsMock.pngSize.height).copy(buffer, 0)
    return 26
  })
  fsMock.closeSync.mockReturnValue(undefined)
  fsMock.pngSize = { width: 1280, height: 4320 }
  electronMock.handlers.clear()
  registerOfficeCliIPCHandlers()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('page count lookup', () => {
  it('asks pptx stats for slides and slices the sheet to what the document has', async () => {
    const file = path.join(process.cwd(), 'doc.pptx')
    declareOutputExists()
    spawnScript([
      { match: 'stats --json', stdout: JSON.stringify({ success: true, data: { slides: 6 } }) },
      { match: 'screenshot', stdout: `${SHOT}\n[pages] total=6` },
    ])

    const result = await screenshot(file, 1)

    // 已知 6 页，就只索要 1-6，不把超界的方向丢给 officecli 去截断
    expect(findCall('screenshot')).toContain('--page')
    expect(findCall('screenshot')![findCall('screenshot')!.indexOf('--page') + 1]).toBe('1-6')
    expect(result).toMatchObject({ pageCount: 6, start: 1, end: 6, width: 1280, height: 4320 })
    expect(result.path).toBe(SHOT)
  })

  it('keeps a middle chunk when the document has more pages than the chunk', async () => {
    const file = path.join(process.cwd(), 'doc.pptx')
    declareOutputExists(shotFile(9, 16))
    spawnScript([
      { match: 'stats --json', stdout: JSON.stringify({ success: true, data: { slides: 20 } }) },
      { match: 'screenshot', stdout: shotFile(9, 16) },
    ])

    const result = await screenshot(file, 9)

    const args = findCall('screenshot')!
    expect(args[args.indexOf('--page') + 1]).toBe('9-16')
    expect(result).toMatchObject({ pageCount: 20, start: 9, end: 16 })
  })

  it('uses Word repagination for docx page count', async () => {
    const file = path.join(process.cwd(), 'doc.docx')
    const shot = shotFile(1, 3)
    declareOutputExists(shot)
    spawnScript([
      {
        match: 'stats --page-count --json',
        stdout: JSON.stringify({ success: true, data: { pages: 3 } }),
      },
      { match: 'screenshot', stdout: shot },
    ])

    const result = await screenshot(file, 1)

    const args = findCall('screenshot')!
    expect(args[args.indexOf('--page') + 1]).toBe('1-3')
    expect(findCall('stats')).toContain('--page-count')
    expect(result).toMatchObject({ pageCount: 3, start: 1, end: 3, path: shot })
  })

  it('reports a single page when the docx page count is unavailable', async () => {
    const file = path.join(process.cwd(), 'doc.docx')
    declareOutputExists(shotFile(1, 1))
    spawnScript([
      { match: 'stats', stdout: '', stderr: 'Word is required', exitCode: 1 },
      { match: 'screenshot', stdout: shotFile(1, 1) },
    ])

    const result = await screenshot(file, 1)

    // 页数拿不到就只能渲染一页：交出一张 8 页长图却对外称第 1 页，等于骗渲染层
    const args = findCall('screenshot')!
    expect(args[args.indexOf('--page') + 1]).toBe('1-1')
    expect(result).toMatchObject({ pageCount: 1, start: 1, end: 1 })
  })

  it('does not probe page counts for xlsx and renders a single sheet page', async () => {
    const file = path.join(process.cwd(), 'book.xlsx')
    declareOutputExists(path.join(OUT_DIR, 'book-pages-1-1.png'))
    spawnScript([
      { match: 'screenshot', stdout: path.join(OUT_DIR, 'book-pages-1-1.png') },
    ])
    fsMock.pngSize = { width: 1600, height: 1200 }

    const result = await screenshot(file, 1)

    expect(findCall('stats')).toBeUndefined()
    const args = findCall('screenshot')!
    expect(args[args.indexOf('--page') + 1]).toBe('1-1')
    expect(result).toMatchObject({ pageCount: 1, start: 1, end: 1, width: 1600, height: 1200 })
  })
})

describe('screenshot failures', () => {
  it('surfaces officecli stderr when the render fails', async () => {
    const file = path.join(process.cwd(), 'doc.pptx')
    spawnScript([
      { match: 'stats --json', stdout: JSON.stringify({ success: true, data: { slides: 6 } }) },
      { match: 'screenshot', stdout: '', stderr: 'No headless browser', exitCode: 1 },
    ])

    await expect(screenshot(file, 1)).rejects.toThrow('No headless browser')
  })

  it('rejects when no output image exists on disk', async () => {
    const file = path.join(process.cwd(), 'doc.pptx')
    spawnScript([
      { match: 'stats --json', stdout: JSON.stringify({ success: true, data: { slides: 6 } }) },
      { match: 'screenshot', stdout: `${SHOT}\n[pages] total=6` },
    ])

    await expect(screenshot(file, 1)).rejects.toThrow(/produced no output/)
  })

  it('leaves width and height at zero when the image is not a PNG', async () => {
    const file = path.join(process.cwd(), 'doc.pptx')
    declareOutputExists()
    fsMock.readSync.mockImplementation(() => 26)
    spawnScript([
      { match: 'stats --json', stdout: JSON.stringify({ success: true, data: { slides: 6 } }) },
      { match: 'screenshot', stdout: SHOT },
    ])

    const result = await screenshot(file, 1)

    expect(result).toMatchObject({ width: 0, height: 0, pageCount: 6, end: 6 })
  })
})
