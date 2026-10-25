// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'http'
import { createHash } from 'crypto'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  SpeechModelInstallError,
  SpeechModelManager,
  type SpeechModelManagerOptions,
  type SpeechModelTarRunner,
} from '../speechModelManager'
import type { SpeechModelManifest } from '../speechModelManifest'
import type { VoiceModelProgress } from '@/shared/channels/voice'

/**
 * The model installer is the only path that puts a native ASR model on the
 * user's disk. The contracts asserted here are all observable on disk or on
 * the wire:
 *
 *   - a dropped connection leaves a resumable `.part`, never an "installed"
 *     model;
 *   - a server that ignores Range truncates instead of corrupting the file;
 *   - a hash mismatch deletes the artifact and never reaches extraction;
 *   - a failed extraction leaves the previous install untouched and cleans
 *     its staging directories;
 *   - removal reclaims model, archive and `.part`.
 *
 * Chunks are delivered by a real local HTTP server; filesystem assertions are
 * made against a real temp directory. `tar` is injected so extraction can be
 * made to fail deterministically; the default tar runner is exercised by the
 * missing-tar test.
 */

const ARCHIVE_BODY = Buffer.alloc(4096, 7)
const HASH = (data: Buffer) => createHash('sha256').update(data).digest('hex')

const FILE_SPECS = [
  { name: 'encoder.int8.onnx', bytes: 1024 },
  { name: 'decoder.onnx', bytes: 512 },
  { name: 'joiner.int8.onnx', bytes: 256 },
  { name: 'tokens.txt', bytes: 128 },
] as const

function makeManifest(overrides: Partial<SpeechModelManifest> = {}): SpeechModelManifest {
  return {
    version: 'test-2026-06-05',
    assetName: 'test-model.tar.bz2',
    url: 'https://github.com/example/test-model.tar.bz2',
    archiveBytes: ARCHIVE_BODY.length,
    archiveSha256: HASH(ARCHIVE_BODY),
    files: FILE_SPECS.map((file) => ({
      ...file,
      sha256: HASH(Buffer.alloc(file.bytes, file.name.charCodeAt(0))),
    })),
    ...overrides,
  }
}

type ServerMode = 'normal' | 'ignore-range' | 'stall' | 'drop' | 'slow'

interface ServerState {
  mode: ServerMode
  requests: Array<{ range?: string }>
  body: Buffer
  /** Bytes written before a stall/drop. */
  partialChunk: number
}

interface TestServer {
  url: string
  state: ServerState
  close: () => Promise<void>
}

async function startServer(state: ServerState): Promise<TestServer> {
  const sockets = new Set<import('net').Socket>()
  const server: Server = createServer((req, res) => {
    state.requests.push({ range: req.headers.range })
    res.on('error', () => {})
    req.on('error', () => {})
    serve(state, res)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no server address')
  return {
    url: `http://127.0.0.1:${address.port}/model.tar.bz2`,
    state,
    close: () => {
      for (const socket of sockets) socket.destroy()
      return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    },
  }
}

function serve(state: ServerState, res: ServerResponse): void {
  const { body } = state
  const range = res.req.headers.range
  const start = range ? Number(range.match(/^bytes=(\d+)-/)?.[1] ?? 0) : 0

  if (state.mode === 'ignore-range') {
    res.statusCode = 200
    res.setHeader('content-length', String(body.length))
    res.end(body)
    return
  }

  if (start > 0) {
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${start}-${body.length - 1}/${body.length}`)
    res.setHeader('content-length', String(body.length - start))
  } else {
    res.statusCode = 200
    res.setHeader('content-length', String(body.length))
  }

  const payload = body.subarray(start)
  if (payload.length === 0) {
    res.end()
    return
  }

  if (state.mode === 'stall') {
    res.write(payload.subarray(0, Math.min(state.partialChunk, payload.length)))
    return
  }

  if (state.mode === 'drop') {
    res.write(payload.subarray(0, Math.floor(payload.length / 2)))
    setTimeout(() => res.destroy(), 10)
    return
  }

  if (state.mode === 'slow') {
    let offset = 0
    const timer = setInterval(() => {
      if (offset >= payload.length) {
        clearInterval(timer)
        res.end()
        return
      }
      res.write(payload.subarray(offset, offset + state.partialChunk))
      offset += state.partialChunk
    }, 40)
    res.on('close', () => clearInterval(timer))
    return
  }

  res.end(payload)
}

interface TarCall {
  archivePath: string
  archive: Buffer
}

function makeTarRunner(
  manifest: SpeechModelManifest,
  calls: TarCall[],
  failFile?: string,
  extraFiles: Record<string, number> = {},
): SpeechModelTarRunner {
  return async (archivePath, destDir) => {
    calls.push({ archivePath, archive: await fs.readFile(archivePath) })
    const nested = path.join(destDir, 'model-root')
    await fs.mkdir(nested, { recursive: true })
    for (const file of manifest.files) {
      const size = file.name === failFile ? file.bytes - 1 : file.bytes
      await fs.writeFile(path.join(nested, file.name), Buffer.alloc(size, file.name.charCodeAt(0)))
    }
    for (const [name, bytes] of Object.entries(extraFiles)) {
      await fs.writeFile(path.join(nested, name), Buffer.alloc(bytes, 1))
    }
  }
}

describe('SpeechModelManager', () => {
  let tmpRoot: string
  let rootDir: string
  let manifest: SpeechModelManifest
  let tarCalls: TarCall[]
  let server: TestServer | null

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spacecode-voice-'))
    rootDir = path.join(tmpRoot, 'voice')
    manifest = makeManifest()
    tarCalls = []
    server = null
  })

  afterEach(async () => {
    if (server) await server.close().catch(() => {})
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  function makeManager(options: Partial<SpeechModelManagerOptions> = {}): SpeechModelManager {
    return new SpeechModelManager({
      rootDir,
      manifest,
      tarRunner: makeTarRunner(manifest, tarCalls),
      connectTimeoutMs: 500,
      stallTimeoutMs: 1_000,
      now: () => new Date('2026-10-25T12:00:00.000Z'),
      ...options,
    })
  }

  async function withServer(mode: ServerMode, overrides: Partial<ServerState> = {}): Promise<TestServer> {
    server = await startServer({
      mode,
      requests: [],
      body: ARCHIVE_BODY,
      partialChunk: 256,
      ...overrides,
    })
    return server
  }

  async function installAndExpectSuccess(manager: SpeechModelManager, srv: TestServer) {
    const progress: VoiceModelProgress[] = []
    manager.on('progress', (event: VoiceModelProgress) => progress.push(event))
    const result = await manager.install()
    expect(result.success).toBe(true)
    expect(result.status.state).toBe('installed')
    expect(srv.state.requests.length).toBeGreaterThan(0)
    return { progress, result }
  }

  it('installs end to end, records the manifest, and deletes the archive', async () => {
    const srv = await withServer('normal')
    const manager = makeManager({ sources: [{ kind: 'custom', url: srv.url }] })

    expect((await manager.getStatus()).state).toBe('missing')
    const info = await manager.getInstallInfo()
    expect(info.archiveBytes).toBe(ARCHIVE_BODY.length)
    expect(info.installedBytes).toBe(FILE_SPECS.reduce((sum, file) => sum + file.bytes, 0))

    const { progress } = await installAndExpectSuccess(manager, srv)

    const paths = manager.getPaths()
    for (const spec of FILE_SPECS) {
      const stat = await fs.stat(path.join(paths.modelDir, spec.name))
      expect(stat.size).toBe(spec.bytes)
    }
    const installed = JSON.parse(await fs.readFile(paths.manifestPath, 'utf8'))
    expect(installed.version).toBe(manifest.version)
    expect(installed.archive.sha256).toBe(manifest.archiveSha256)
    expect(installed.installedAt).toBe('2026-10-25T12:00:00.000Z')
    expect(installed.files.map((file: { name: string }) => file.name)).toEqual(
      manifest.files.map((file) => file.name),
    )

    await expect(fs.stat(paths.partPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(paths.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(tarCalls).toHaveLength(1)
    expect(tarCalls[0].archive.equals(ARCHIVE_BODY)).toBe(true)

    expect(progress.some((event) => event.phase === 'downloading')).toBe(true)
    expect(progress.some((event) => event.phase === 'verifying')).toBe(true)
    expect(progress.some((event) => event.phase === 'extracting')).toBe(true)
    for (const event of progress.filter((event) => event.phase === 'downloading')) {
      expect(event.total).toBe(ARCHIVE_BODY.length)
      expect(event.transferred).toBeGreaterThanOrEqual(0)
      expect(event.percent).toBeGreaterThanOrEqual(0)
      expect(event.percent).toBeLessThanOrEqual(100)
    }

    const status = await manager.getStatus()
    expect(status.state).toBe('installed')
    expect(status.installedBytes).toBe(info.installedBytes)
    expect(status.diskUsageBytes).toBeGreaterThanOrEqual(info.installedBytes)
    expect(status.installedAt).toBe('2026-10-25T12:00:00.000Z')
  })

  it('resumes from an existing .part with an HTTP Range request', async () => {
    const srv = await withServer('normal')
    const manager = makeManager({ sources: [{ kind: 'custom', url: srv.url }] })
    const paths = manager.getPaths()
    await fs.mkdir(paths.downloadDir, { recursive: true })
    await fs.writeFile(paths.partPath, ARCHIVE_BODY.subarray(0, 1024))

    await installAndExpectSuccess(manager, srv)

    expect(srv.state.requests[0].range).toBe('bytes=1024-')
    expect(tarCalls[0].archive.equals(ARCHIVE_BODY)).toBe(true)
  })

  it('truncates when the server ignores Range and returns 200', async () => {
    const srv = await withServer('ignore-range')
    const manager = makeManager({ sources: [{ kind: 'custom', url: srv.url }] })
    const paths = manager.getPaths()
    await fs.mkdir(paths.downloadDir, { recursive: true })
    await fs.writeFile(paths.partPath, Buffer.alloc(1024, 1))

    await installAndExpectSuccess(manager, srv)

    expect(srv.state.requests[0].range).toBe('bytes=1024-')
    expect(tarCalls[0].archive.length).toBe(ARCHIVE_BODY.length)
    expect(tarCalls[0].archive.equals(ARCHIVE_BODY)).toBe(true)
  })

  it('deletes the artifact and never extracts when the SHA256 does not match', async () => {
    const srv = await withServer('normal')
    const manager = makeManager({
      manifest: makeManifest({ archiveSha256: '0'.repeat(64) }),
      sources: [{ kind: 'custom', url: srv.url }],
      tarRunner: makeTarRunner(manifest, tarCalls),
    })

    const result = await manager.install()

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('hash-mismatch')
    expect(tarCalls).toHaveLength(0)
    const paths = manager.getPaths()
    await expect(fs.stat(paths.partPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(paths.modelDir)).rejects.toMatchObject({ code: 'ENOENT' })
    const status = await manager.getStatus()
    expect(status.state).toBe('missing')
    expect(status.partialBytes).toBe(0)
  })

  it('keeps the .part on cancel and resumes it on the next install', async () => {
    const srv = await withServer('stall', { partialChunk: 128 })
    const manager = makeManager({
      sources: [{ kind: 'custom', url: srv.url }],
      stallTimeoutMs: 10_000,
    })
    const paths = manager.getPaths()
    const progress: VoiceModelProgress[] = []
    manager.on('progress', (event: VoiceModelProgress) => progress.push(event))

    const first = manager.install()
    await waitFor(() => progress.some((event) => event.phase === 'downloading' && event.transferred >= 128))
    const during = await manager.getStatus()
    expect(during.state).toBe('downloading')
    expect(during.partialBytes).toBe(128)

    expect(manager.cancelInstall()).toEqual({ success: true })
    const canceled = await first
    expect(canceled.success).toBe(false)
    expect(canceled.canceled).toBe(true)
    expect((await fs.stat(paths.partPath)).size).toBe(128)

    srv.state.mode = 'normal'
    const second = await manager.install()
    expect(second.success).toBe(true)
    expect(srv.state.requests[srv.state.requests.length - 1]?.range).toBe('bytes=128-')
    expect(tarCalls[0].archive.equals(ARCHIVE_BODY)).toBe(true)
  })

  it('leaves no installed model after the connection drops mid-download', async () => {
    const srv = await withServer('drop')
    const manager = makeManager({ sources: [{ kind: 'custom', url: srv.url }] })

    const result = await manager.install()

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('network')
    const paths = manager.getPaths()
    await expect(fs.stat(paths.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(paths.modelDir)).rejects.toMatchObject({ code: 'ENOENT' })
    const part = await fs.stat(paths.partPath)
    expect(part.size).toBeGreaterThan(0)
    expect(part.size).toBeLessThan(ARCHIVE_BODY.length)
    const status = await manager.getStatus()
    expect(status.state).toBe('missing')
    expect(status.partialBytes).toBe(part.size)
    expect(tarCalls).toHaveLength(0)
  })

  it('falls back to the next source when the first one cannot connect', async () => {
    const good = await withServer('normal')
    const manager = makeManager({
      sources: [
        { kind: 'github', url: 'http://127.0.0.1:1/model.tar.bz2' },
        { kind: 'custom', url: good.url },
      ],
    })

    const result = await manager.install()

    expect(result.success).toBe(true)
    expect(tarCalls[0].archive.equals(ARCHIVE_BODY)).toBe(true)
  })

  it('falls back when a source stalls without progress', async () => {
    const stalled = await withServer('stall', { partialChunk: 64 })
    const goodState: ServerState = {
      mode: 'normal',
      requests: [],
      body: ARCHIVE_BODY,
      partialChunk: 256,
    }
    const good = await startServer(goodState)
    const servers = [stalled, good]
    server = null
    try {
      const manager = makeManager({
        sources: [
          { kind: 'github', url: stalled.url },
          { kind: 'mirror', url: good.url },
        ],
        stallTimeoutMs: 120,
      })
      const result = await manager.install()
      expect(result.success).toBe(true)
      expect(tarCalls[0].archive.equals(ARCHIVE_BODY)).toBe(true)
    } finally {
      for (const srv of servers) await srv.close().catch(() => {})
    }
  })

  it('does not treat a slow but moving transfer as stalled', async () => {
    const srv = await withServer('slow', { partialChunk: 256 })
    const manager = makeManager({
      sources: [{ kind: 'custom', url: srv.url }],
      stallTimeoutMs: 150,
    })

    const result = await manager.install()

    expect(result.success).toBe(true)
    expect(tarCalls[0].archive.equals(ARCHIVE_BODY)).toBe(true)
  })

  it('rolls back staging after extraction fails and reuses the archive on retry', async () => {
    const srv = await withServer('normal')
    let failExtract = true
    const manager = makeManager({
      sources: [{ kind: 'custom', url: srv.url }],
      tarRunner: async (archivePath, destDir, signal) => {
        if (failExtract) throw new SpeechModelInstallError('extract-failed', 'tar exploded')
        await makeTarRunner(manifest, tarCalls)(archivePath, destDir, signal)
      },
    })
    const paths = manager.getPaths()

    const failed = await manager.install()
    expect(failed.success).toBe(false)
    expect(failed.errorCode).toBe('extract-failed')
    await expect(fs.stat(paths.modelDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(paths.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.stat(paths.archivePath)).size).toBe(ARCHIVE_BODY.length)
    expect(await listDir(paths.tmpDir)).toEqual([])
    expect((await manager.getStatus()).state).toBe('missing')

    failExtract = false
    const retried = await manager.install()
    expect(retried.success).toBe(true)
    expect(srv.state.requests).toHaveLength(1)
    expect(tarCalls[0].archive.equals(ARCHIVE_BODY)).toBe(true)
  })

  it('reports a missing system tar without leaving a half install', async () => {
    const srv = await withServer('normal')
    const manager = makeManager({
      sources: [{ kind: 'custom', url: srv.url }],
      tarRunner: undefined,
      tarCommand: 'spacecode-definitely-missing-tar',
    })

    const result = await manager.install()

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('tar-unavailable')
    const paths = manager.getPaths()
    await expect(fs.stat(paths.modelDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(paths.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.stat(paths.archivePath)).size).toBe(ARCHIVE_BODY.length)
    expect(await listDir(paths.tmpDir)).toEqual([])
  })

  it('refuses to install files whose size does not match the manifest', async () => {
    const srv = await withServer('normal')
    const manager = makeManager({
      sources: [{ kind: 'custom', url: srv.url }],
      tarRunner: makeTarRunner(manifest, tarCalls, 'decoder.onnx'),
    })

    const result = await manager.install()

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('extract-failed')
    const paths = manager.getPaths()
    await expect(fs.stat(paths.modelDir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await listDir(paths.tmpDir)).toEqual([])
  })

  it('reports corrupted when an installed file disappears or changes size', async () => {
    const srv = await withServer('normal')
    const manager = makeManager({ sources: [{ kind: 'custom', url: srv.url }] })
    await installAndExpectSuccess(manager, srv)
    const paths = manager.getPaths()

    const encoder = path.join(paths.modelDir, 'encoder.int8.onnx')
    await fs.writeFile(encoder, Buffer.alloc(10))

    const status = await manager.getStatus()
    expect(status.state).toBe('corrupted')
    expect(status.version).toBe(manifest.version)

    await fs.rm(path.join(paths.modelDir, 'tokens.txt'))
    expect((await manager.getStatus()).state).toBe('corrupted')
  })

  it('treats the four file sizes as the installation truth when the manifest is lost', async () => {
    const srv = await withServer('normal')
    const manager = makeManager({ sources: [{ kind: 'custom', url: srv.url }] })
    await installAndExpectSuccess(manager, srv)
    const paths = manager.getPaths()

    await fs.rm(paths.manifestPath)

    const status = await manager.getStatus()
    expect(status.state).toBe('installed')
    expect(status.version).toBe(manifest.version)
    expect(status.installedBytes).toBe(FILE_SPECS.reduce((sum, file) => sum + file.bytes, 0))
    expect(status.installedAt).toBeNull()
  })

  it('marks the job active before the first byte so cancel and the guards agree', async () => {
    const srv = await withServer('stall')
    const manager = makeManager({ sources: [{ kind: 'custom', url: srv.url }] })

    const running = manager.install()

    const status = await manager.getStatus()
    expect(status.state).toBe('downloading')
    expect((await manager.install()).errorCode).toBe('busy')
    expect((await manager.remove()).errorCode).toBe('busy')

    expect(manager.cancelInstall().success).toBe(true)
    const result = await running
    expect(result.canceled).toBe(true)
  })

  it('reinstalls over a corrupted model and keeps only the four whitelisted files', async () => {
    const srv = await withServer('normal')
    const manager = makeManager({
      sources: [{ kind: 'custom', url: srv.url }],
      tarRunner: (archivePath, destDir, signal) =>
        makeTarRunner(manifest, tarCalls, undefined, { 'junk.bin': 32 })(archivePath, destDir, signal),
    })
    await installAndExpectSuccess(manager, srv)
    const paths = manager.getPaths()

    await fs.writeFile(path.join(paths.modelDir, 'encoder.int8.onnx'), Buffer.alloc(10))
    await fs.writeFile(path.join(paths.modelDir, 'old-junk.txt'), 'stale')

    const result = await manager.install()

    expect(result.success).toBe(true)
    expect(result.status.state).toBe('installed')
    expect((await fs.readdir(paths.modelDir)).sort()).toEqual([
      'decoder.onnx',
      'encoder.int8.onnx',
      'joiner.int8.onnx',
      'manifest.json',
      'tokens.txt',
    ])
    expect((await fs.stat(path.join(paths.modelDir, 'encoder.int8.onnx'))).size).toBe(1024)
    expect(await listDir(paths.tmpDir)).toEqual([])
  })

  it('removes model, archive and .part, but refuses while recording', async () => {
    const srv = await withServer('normal')
    let recording = false
    const manager = makeManager({
      sources: [{ kind: 'custom', url: srv.url }],
      isRecording: () => recording,
    })
    const paths = manager.getPaths()
    await installAndExpectSuccess(manager, srv)
    await fs.writeFile(paths.partPath, Buffer.alloc(100, 1))

    recording = true
    const refused = await manager.remove()
    expect(refused.success).toBe(false)
    expect(refused.errorCode).toBe('recording')
    await expect(fs.stat(paths.modelDir)).resolves.toBeTruthy()

    recording = false
    const removed = await manager.remove()
    expect(removed.success).toBe(true)
    expect(removed.status.state).toBe('missing')
    await expect(fs.stat(paths.modelDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(paths.partPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(paths.archivePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await listDir(paths.tmpDir)).toEqual([])
  })

  it('orders GitHub, mirrors and the custom URL as sources', async () => {
    const customUrl = 'https://mirror.example.com/model.tar.bz2'
    const manager = makeManager({ getCustomUrl: () => customUrl })
    const info = await manager.getInstallInfo()
    expect(info.sources[0].kind).toBe('github')
    expect(info.sources[1].kind).toBe('mirror')
    expect(info.sources[2].kind).toBe('mirror')
    expect(info.sources[3]).toEqual({ kind: 'custom', url: customUrl })
    expect(info.installedBytes).toBe(FILE_SPECS.reduce((sum, file) => sum + file.bytes, 0))
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
