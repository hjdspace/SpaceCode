// @vitest-environment node
/**
 * 预览服务的文件读取边界 — 审计第 13 项（[P1]）。
 *
 * 旧行为：URL 里放一个绝对路径就服务任意本机文件，且带 `Access-Control-Allow-Origin: *`，
 * 于是任何知道端口的本机页面都能借 fetch() 读走文件。
 * 期望行为：只有登记过的预览工作区内的文件可读，响应不再放开任意源。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join, parse } from 'path'
import { ipcMain } from 'electron'
import { PreviewServer, previewServer, registerPreviewServerIPCHandlers } from '../previewServer'

/** Windows 上创建符号链接需要特权，探测失败时跳过逃逸用例而不是假装通过。 */
function probeSymlinkSupport(dir: string): boolean {
  try {
    mkdirSync(join(dir, 'probe-target'))
    symlinkSync(join(dir, 'probe-target'), join(dir, 'probe-link'), 'dir')
    return true
  } catch {
    return false
  } finally {
    rmSync(join(dir, 'probe-link'), { force: true })
    rmSync(join(dir, 'probe-target'), { recursive: true, force: true })
  }
}

const dir = mkdtempSync(join(tmpdir(), 'preview-boundary-'))
const canSymlink = probeSymlinkSupport(dir)

let server: PreviewServer
let base: string

async function fetchUrl(url: string) {
  const res = await fetch(url, { redirect: 'manual' })
  return {
    status: res.status,
    acao: res.headers.get('access-control-allow-origin'),
    referrerPolicy: res.headers.get('referrer-policy'),
    body: await res.text(),
  }
}

async function get(pathname: string) {
  return fetchUrl(`${base}${pathname}`)
}

/** 绝对路径拼成旧式 URL（Windows `/C:/Users/...`、POSIX `//tmp/...`），即审计的复现向量。 */
function legacyUrlPath(absPath: string): string {
  return '/' + absPath.replace(/\\/g, '/')
}

/** 预览 URL 的 path 部分 — 服务器只认这个。 */
function pathnameOf(url: string): string {
  return new URL(url).pathname
}

beforeAll(async () => {
  server = new PreviewServer()
  const port = await server.start()
  base = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('PreviewServer 文件读取边界', () => {
  it('未登记为预览工作区的绝对路径请求被拒且不泄露内容', async () => {
    const secret = join(dir, 'audit-only-sentinel.txt')
    writeFileSync(secret, 'audit-only-sentinel')

    const res = await get(legacyUrlPath(secret))

    // 没有 grant 的路径与不存在的路径同码，服务不再充当本机文件探测的 oracle
    expect(res.status).toBe(404)
    expect(res.body).not.toContain('audit-only-sentinel')
  })

  it('响应不再放开任意源', async () => {
    const secret = join(dir, 'audit-only-sentinel.txt')
    writeFileSync(secret, 'audit-only-sentinel')

    const res = await get(legacyUrlPath(secret))

    expect(res.acao).toBeNull()
  })

  it('登记过的工作区内文件正常访问，且不放开任意源', async () => {
    const workspace = join(dir, 'ws-a')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'index.html'), '<h1>preview ok</h1>')

    const url = server.toPreviewUrl(join(workspace, 'index.html'))
    expect(typeof url).toBe('string')

    const res = await get(pathnameOf(url!))

    expect(res.status).toBe(200)
    expect(res.body).toContain('preview ok')
    expect(res.acao).toBeNull()
    expect(res.referrerPolicy).toBe('no-referrer')
  })

  it('预览页的相对子资源命中同一工作区', async () => {
    const workspace = join(dir, 'ws-b')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'index.html'), '<link href="./style.css">')
    writeFileSync(join(workspace, 'style.css'), 'body{color:red}')

    const docUrl = server.toPreviewUrl(join(workspace, 'index.html'))!
    const assetUrl = new URL('./style.css', docUrl)

    const res = await get(assetUrl.pathname)

    expect(res.status).toBe(200)
    expect(res.body).toContain('color:red')
  })

  it('越过登记根的百分号编码穿越被拦截', async () => {
    const workspace = join(dir, 'ws-c')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'index.html'), '<h1>doc</h1>')
    writeFileSync(join(dir, 'ws-c-secret.txt'), 'outside-workspace-secret')

    const token = pathnameOf(server.toPreviewUrl(join(workspace, 'index.html'))!).split('/')[1]

    const res = await get(`/${token}/%2e%2e%2f%2e%2e%2fws-c-secret.txt`)

    expect(res.status).toBe(403)
    expect(res.body).not.toContain('outside-workspace-secret')
  })

  it('传入的 workspaceRoot 只在确实包含文件时放宽范围', async () => {
    const project = join(dir, 'ws-d')
    const docDir = join(project, 'docs', 'prototypes')
    mkdirSync(docDir, { recursive: true })
    writeFileSync(join(docDir, 'icon-preview.html'), '<img src="../../icons/a.svg">')
    mkdirSync(join(project, 'icons'))
    writeFileSync(join(project, 'icons', 'a.svg'), '<svg></svg>')

    const url = server.toPreviewUrl(join(docDir, 'icon-preview.html'), project)!
    const asset = await get(new URL('../../icons/a.svg', url).pathname)
    expect(asset.status).toBe(200)

    // 未登记 project 根时，可读范围只剩文件所在目录，同目录之外的引用被边界拒掉
    const narrow = server.toPreviewUrl(join(docDir, 'icon-preview.html'))!
    const narrowToken = pathnameOf(narrow).split('/')[1]
    const denied = await get(`/${narrowToken}/%2e%2e%2f%2e%2e%2ficons%2fa.svg`)

    expect(denied.status).toBe(403)
    expect(denied.body).not.toContain('<svg>')
  })

  it.skipIf(!canSymlink)('符号链接指向工作区外时被 realpath 边界拦截', async () => {
    const workspace = join(dir, 'ws-e')
    const outside = join(dir, 'ws-e-outside')
    mkdirSync(workspace)
    mkdirSync(outside)
    writeFileSync(join(workspace, 'index.html'), '<h1>doc</h1>')
    writeFileSync(join(outside, 'secret.txt'), 'symlink-target-secret')
    symlinkSync(outside, join(workspace, 'link'), 'dir')

    const url = server.toPreviewUrl(join(workspace, 'index.html'))!
    const token = pathnameOf(url).split('/')[1]

    const res = await get(`/${token}/link/secret.txt`)

    expect(res.status).toBe(403)
    expect(res.body).not.toContain('symlink-target-secret')
  })

  it.skipIf(!canSymlink)('目录分支补的 index.html 链接出界时同样被拒', async () => {
    const workspace = join(dir, 'ws-f')
    const outside = join(dir, 'ws-f-outside')
    mkdirSync(join(workspace, 'sub'), { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(workspace, 'home.html'), '<h1>home</h1>')
    writeFileSync(join(outside, 'index.html'), '<h1>outside index</h1>')
    symlinkSync(join(outside, 'index.html'), join(workspace, 'sub', 'index.html'), 'file')

    const token = pathnameOf(server.toPreviewUrl(join(workspace, 'home.html'))!).split('/')[1]

    const escape = await get(`/${token}/sub/`)
    expect(escape.status).toBe(403)
    expect(escape.body).not.toContain('outside index')

    // 目录 → index.html 的正常能力不能因为这道闸门而失效
    writeFileSync(join(workspace, 'sub', 'real.txt'), 'plain')
    expect((await get(`/${token}/sub/real.txt`)).body).toContain('plain')
  })

  it('文件系统根不会被登记为工作区', () => {
    const driveRootFile = join(parse(dir).root, 'spacecode-preview-probe.html')

    expect(server.toPreviewUrl(driveRootFile)).toBeNull()
    expect(server.toPreviewUrl(driveRootFile, parse(dir).root)).toBeNull()
  })

  it('预览 iframe 的专用源 URL 与 HTTP URL 共用同一份登记', async () => {
    const workspace = join(dir, 'ws-frame')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'index.html'), '<h1>frame</h1>')

    const frameUrl = server.toFrameUrl(join(workspace, 'index.html'), workspace)
    const httpUrl = server.toPreviewUrl(join(workspace, 'index.html'), workspace)

    expect(frameUrl).toMatch(/^spacecode-preview:\/\/artifact\/[0-9a-f]{32}\/index\.html$/)
    expect(new URL(frameUrl!).pathname).toBe(new URL(httpUrl!).pathname)
  })

  it('白名单之外的扩展名不服务（脚本执行后登记根里的未知类型也不能照发）', async () => {
    const workspace = join(dir, 'ws-unsupported')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'index.html'), '<h1>doc</h1>')
    writeFileSync(join(workspace, 'payload.bin'), 'binary-sentinel')

    const token = pathnameOf(server.toPreviewUrl(join(workspace, 'index.html'))!).split('/')[1]
    const res = await get(`/${token}/payload.bin`)

    expect(res.status).toBe(404)
    expect(res.body).not.toContain('binary-sentinel')
  })

  it('服务器未启动时不签发 URL', async () => {
    expect(new PreviewServer().toPreviewUrl(join(dir, 'ws-a', 'index.html'))).toBeNull()
  })
})

describe('preview:getUrl / preview:getFrameUrl IPC 入口', () => {
  type GetUrlHandler = (event: unknown, filePath: string, workspaceRoot?: string) => Promise<string | null>

  let handler: GetUrlHandler
  let frameHandler: GetUrlHandler

  beforeAll(() => {
    registerPreviewServerIPCHandlers()
    const calls = vi.mocked(ipcMain.handle).mock.calls
    handler = calls.find(([channel]) => channel === 'preview:getUrl')?.[1] as GetUrlHandler
    frameHandler = calls.find(([channel]) => channel === 'preview:getFrameUrl')?.[1] as GetUrlHandler
  })

  afterAll(() => {
    previewServer.stop()
  })

  it('渲染进程传入的项目根成为预览工作区，其内文件可读', async () => {
    const project = join(dir, 'ws-ipc')
    mkdirSync(project)
    writeFileSync(join(project, 'index.html'), '<h1>ipc doc</h1>')

    const url = await handler({}, join(project, 'index.html'), project)
    expect(typeof url).toBe('string')

    const res = await fetchUrl(url!)
    expect(res.status).toBe(200)
    expect(res.body).toContain('ipc doc')
    expect(res.acao).toBeNull()
  })

  it('空白或非字符串路径不签发 URL', async () => {
    expect(await handler({}, '')).toBeNull()
    expect(await handler({}, '   ')).toBeNull()
    expect(await handler({}, 42 as unknown as string)).toBeNull()
  })

  it('未带项目根时范围只到文件所在目录', async () => {
    const project = join(dir, 'ws-ipc-narrow')
    const docs = join(project, 'docs')
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, 'index.html'), '<h1>narrow doc</h1>')
    writeFileSync(join(project, 'outside.css'), 'body{color:blue}')

    const url = await handler({}, join(docs, 'index.html'))
    const token = pathnameOf(url!).split('/')[1]
    const up = await fetchUrl(`http://127.0.0.1:${previewServer.getPort()}/${token}/%2e%2e%2foutside.css`)

    expect(up.status).toBe(403)
    expect(up.body).not.toContain('color:blue')
  })

  it('frame URL 不依赖 HTTP 端口，直接返回专用源并登记工作区', async () => {
    const project = join(dir, 'ws-ipc-frame')
    mkdirSync(project)
    writeFileSync(join(project, 'index.html'), '<h1>frame doc</h1>')

    const url = await frameHandler({}, join(project, 'index.html'), project)

    expect(url).toMatch(/^spacecode-preview:\/\/artifact\/[0-9a-f]{32}\/index\.html$/)
    expect(previewServer.toFrameUrl(join(project, 'index.html'), project)).toBe(url)
  })

  it('frame URL 同样拒绝空白路径', async () => {
    expect(await frameHandler({}, '')).toBeNull()
    expect(await frameHandler({}, '   ')).toBeNull()
    expect(await frameHandler({}, 42 as unknown as string)).toBeNull()
  })
})
