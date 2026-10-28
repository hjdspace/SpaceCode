/**
 * Speech model installer — download, SHA256 verify, tar extraction and atomic
 * placement of the pinned sherpa-onnx model.
 *
 * The module is deliberately driven by observable disk state: status is
 * re-derived from files on every call, so a crash mid-install can never leave
 * a model that reports "installed". Network and tar are injectable seams for
 * tests; production uses global fetch and the system tar.
 */
import { EventEmitter } from 'events'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { createReadStream, createWriteStream } from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import type {
  VoiceInstallResult,
  VoiceModelErrorCode,
  VoiceModelInstallInfo,
  VoiceModelPhase,
  VoiceModelProgress,
  VoiceModelSource,
  VoiceModelStatus,
  VoiceRemoveResult,
} from '@/shared/channels/voice'
import {
  SPEECH_MODEL_IDENTITY,
  SPEECH_MODEL_MANIFEST,
  expectedInstalledBytes,
  type SpeechModelManifest,
} from './speechModelManifest'
import { GITHUB_MIRROR_PREFIXES } from '@/shared/githubMirrorPrefixes'

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000
const DEFAULT_STALL_TIMEOUT_MS = 30_000

export interface SpeechModelPaths {
  rootDir: string
  modelDir: string
  manifestPath: string
  downloadDir: string
  archivePath: string
  partPath: string
  tmpDir: string
}

export type SpeechModelTarRunner = (
  archivePath: string,
  destDir: string,
  signal: AbortSignal,
) => Promise<void>

export interface SpeechModelManagerOptions {
  rootDir: string
  manifest?: SpeechModelManifest
  /** Test seam / future override: full source list instead of GitHub + mirrors + custom. */
  sources?: VoiceModelSource[]
  getCustomUrl?: () => string | null | undefined
  isRecording?: () => boolean
  fetchImpl?: typeof fetch
  tarRunner?: SpeechModelTarRunner
  tarCommand?: string
  connectTimeoutMs?: number
  stallTimeoutMs?: number
  now?: () => Date
}

export class SpeechModelInstallError extends Error {
  constructor(
    readonly code: VoiceModelErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SpeechModelInstallError'
  }
}

interface ActiveInstall {
  phase: VoiceModelPhase
  progress: VoiceModelProgress
}

interface InstallManifest {
  version: string
  archive: { name: string; bytes: number; sha256: string }
  files: Array<{ name: string; bytes: number; sha256: string }>
  installedAt: string
}

export class SpeechModelManager extends EventEmitter {
  private readonly manifest: SpeechModelManifest
  private readonly fetchImpl: typeof fetch
  private readonly tarRunner: SpeechModelTarRunner
  private readonly connectTimeoutMs: number
  private readonly stallTimeoutMs: number
  private readonly now: () => Date
  private readonly paths: SpeechModelPaths

  private active: ActiveInstall | null = null
  private abortController: AbortController | null = null
  private cancelRequested = false
  private lastError: string | undefined
  private lastErrorCode: VoiceModelErrorCode | undefined

  constructor(private readonly options: SpeechModelManagerOptions) {
    super()
    this.manifest = options.manifest ?? SPEECH_MODEL_MANIFEST
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.tarRunner = options.tarRunner ?? createSystemTarRunner(options.tarCommand ?? 'tar')
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
    this.now = options.now ?? (() => new Date())

    this.paths = {
      rootDir: options.rootDir,
      modelDir: path.join(options.rootDir, 'model'),
      manifestPath: path.join(options.rootDir, 'model', 'manifest.json'),
      downloadDir: path.join(options.rootDir, 'download'),
      archivePath: path.join(options.rootDir, 'download', this.manifest.assetName),
      partPath: path.join(options.rootDir, 'download', `${this.manifest.assetName}.part`),
      tmpDir: path.join(options.rootDir, 'tmp'),
    }
  }

  getPaths(): SpeechModelPaths {
    return this.paths
  }

  async getStatus(): Promise<VoiceModelStatus> {
    const base = await this.readDiskStatus()
    if (!this.active) {
      return {
        ...base,
        state: base.state,
        version: base.version,
        progress: undefined,
        error: this.lastError,
        errorCode: this.lastErrorCode,
      }
    }
    return {
      ...base,
      state: this.active.phase,
      version: this.manifest.version,
      progress: this.active.progress,
      error: this.lastError,
      errorCode: this.lastErrorCode,
    }
  }

  async getInstallInfo(): Promise<VoiceModelInstallInfo> {
    return {
      version: this.manifest.version,
      archiveBytes: this.manifest.archiveBytes,
      installedBytes: expectedInstalledBytes(this.manifest),
      archiveName: this.manifest.assetName,
      model: SPEECH_MODEL_IDENTITY,
      sources: this.resolveSources(),
    }
  }

  async install(): Promise<VoiceInstallResult> {
    if (this.active) {
      return {
        success: false,
        error: 'A model installation is already running',
        errorCode: 'busy',
        status: await this.getStatus(),
      }
    }

    this.cancelRequested = false
    this.lastError = undefined
    this.lastErrorCode = undefined
    const controller = new AbortController()
    this.abortController = controller
    this.active = {
      phase: 'downloading',
      progress: {
        phase: 'downloading',
        transferred: 0,
        total: this.manifest.archiveBytes,
        percent: 0,
      },
    }

    try {
      await fs.mkdir(this.paths.downloadDir, { recursive: true })
      await this.ensureArchive(controller.signal)
      await this.extractAndInstall(controller.signal)
      await fs.rm(this.paths.archivePath, { force: true }).catch(() => {})
      await fs.rm(this.paths.tmpDir, { recursive: true, force: true }).catch(() => {})
      this.active = null
      return { success: true, status: await this.getStatus() }
    } catch (err) {
      const canceled = this.cancelRequested || isAbortError(err)
      const code = canceled ? 'canceled' : errorCodeOf(err)
      if (canceled) {
        this.lastError = undefined
        this.lastErrorCode = undefined
      } else {
        this.lastError = errorMessage(err)
        this.lastErrorCode = code
      }
      this.active = null
      return {
        success: false,
        canceled,
        error: canceled ? undefined : errorMessage(err),
        errorCode: code,
        status: await this.getStatus(),
      }
    } finally {
      this.abortController = null
      this.active = null
    }
  }

  cancelInstall(): { success: boolean; error?: string } {
    if (!this.active) return { success: false, error: 'No installation is running' }
    this.cancelRequested = true
    this.abortController?.abort()
    return { success: true }
  }

  async remove(): Promise<VoiceRemoveResult> {
    if (this.active) {
      return {
        success: false,
        error: 'A model installation is running',
        errorCode: 'busy',
        status: await this.getStatus(),
      }
    }
    if (this.options.isRecording?.()) {
      return {
        success: false,
        error: 'Cannot remove the model while recording',
        errorCode: 'recording',
        status: await this.getStatus(),
      }
    }
    await Promise.all([
      fs.rm(this.paths.modelDir, { recursive: true, force: true }),
      fs.rm(this.paths.partPath, { force: true }),
      fs.rm(this.paths.archivePath, { force: true }),
      fs.rm(this.paths.tmpDir, { recursive: true, force: true }),
    ])
    this.lastError = undefined
    this.lastErrorCode = undefined
    return { success: true, status: await this.getStatus() }
  }

  // ── Download ──────────────────────────────────────────────────

  private async ensureArchive(signal: AbortSignal): Promise<void> {
    if (await isFile(this.paths.archivePath)) {
      const ok = await this.verifyArchiveFile(this.paths.archivePath, signal)
      if (ok) return
      await fs.rm(this.paths.archivePath, { force: true })
    }

    const expected = this.manifest.archiveBytes
    const sources = this.resolveSources()
    let lastFailure: unknown

    for (const source of sources) {
      this.throwIfCanceled(signal)
      try {
        const existing = await fileSize(this.paths.partPath)
        if (existing > expected) await fs.rm(this.paths.partPath, { force: true })
        if ((await fileSize(this.paths.partPath)) !== expected) {
          await this.downloadFromSource(source, signal)
        }

        const downloaded = await fileSize(this.paths.partPath)
        if (downloaded !== expected) {
          lastFailure = new Error(`Incomplete download: ${downloaded}/${expected} bytes`)
          continue
        }

        const ok = await this.verifyArchiveFile(this.paths.partPath, signal)
        if (!ok) {
          await fs.rm(this.paths.partPath, { force: true })
          throw new SpeechModelInstallError(
            'hash-mismatch',
            'Downloaded archive does not match the pinned SHA256',
          )
        }

        await fs.rename(this.paths.partPath, this.paths.archivePath)
        return
      } catch (err) {
        if (this.cancelRequested || isAbortError(err)) throw new SpeechModelInstallError('canceled', 'canceled')
        if (err instanceof SpeechModelInstallError && err.code === 'hash-mismatch') throw err
        if (err instanceof SpeechModelInstallError && err.code === 'file-system') throw err
        lastFailure = err
      }
    }

    throw new SpeechModelInstallError(
      'network',
      lastFailure
        ? `All download sources failed: ${errorMessage(lastFailure)}`
        : 'No download source is configured',
    )
  }

  private async downloadFromSource(source: VoiceModelSource, signal: AbortSignal): Promise<void> {
    const expected = this.manifest.archiveBytes
    let start = await fileSize(this.paths.partPath)
    if (start > expected) {
      await fs.rm(this.paths.partPath, { force: true })
      start = 0
    }
    if (start === expected) return

    const attempt = new AbortController()
    const onParentAbort = () => attempt.abort()
    signal.addEventListener('abort', onParentAbort, { once: true })

    let timer: ReturnType<typeof setTimeout> | null = null
    let abortReason: 'connect' | 'stall' | null = null
    const arm = (ms: number, reason: 'connect' | 'stall') => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        abortReason = reason
        attempt.abort()
      }, ms)
    }

    let stream: ReturnType<typeof createWriteStream> | null = null
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

    try {
      arm(this.connectTimeoutMs, 'connect')
      const headers: Record<string, string> = {}
      if (start > 0) headers.Range = `bytes=${start}-`
      const response = await this.fetchImpl(source.url, { headers, signal: attempt.signal })
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      if (response.status !== 200 && response.status !== 206) {
        throw new SpeechModelInstallError('network', `HTTP ${response.status} from ${source.url}`)
      }
      if (!response.body) {
        throw new SpeechModelInstallError('network', `Empty response body from ${source.url}`)
      }

      const restart = response.status === 200 && start > 0
      if (restart) start = 0

      stream = createWriteStream(this.paths.partPath, { flags: restart || start === 0 ? 'w' : 'a' })
      let transferError: Error | null = null
      stream.on('error', (err) => {
        transferError = err
      })

      reader = response.body.getReader()
      arm(this.stallTimeoutMs, 'stall')
      let received = 0
      this.emitProgress('downloading', start, expected, source)

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (transferError) throw new SpeechModelInstallError('file-system', errorMessage(transferError))
        if (value && value.byteLength > 0) {
          received += value.byteLength
          try {
            await writeChunk(stream, Buffer.from(value))
          } catch (writeErr) {
            throw new SpeechModelInstallError('file-system', errorMessage(writeErr))
          }
          arm(this.stallTimeoutMs, 'stall')
          this.emitProgress('downloading', start + received, expected, source)
        }
      }

      await endStream(stream)
      stream = null
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (transferError) throw new SpeechModelInstallError('file-system', errorMessage(transferError))
    } catch (err) {
      if (this.cancelRequested || signal.aborted) {
        throw new SpeechModelInstallError('canceled', 'canceled')
      }
      if (abortReason === 'stall') {
        throw new SpeechModelInstallError('network', `Download stalled for ${this.stallTimeoutMs}ms`)
      }
      if (abortReason === 'connect') {
        throw new SpeechModelInstallError('network', `Connection timed out after ${this.connectTimeoutMs}ms`)
      }
      throw err
    } finally {
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', onParentAbort)
      if (reader) await reader.cancel().catch(() => {})
      if (stream) await endStream(stream).catch(() => {})
    }
  }

  // ── Verify / extract ──────────────────────────────────────────

  private async verifyArchiveFile(filePath: string, signal: AbortSignal): Promise<boolean> {
    const total = this.manifest.archiveBytes
    this.emitProgress('verifying', 0, total)
    const hash = createHash('sha256')
    let read = 0
    const stream = createReadStream(filePath)
    try {
      for await (const chunk of stream) {
        this.throwIfCanceled(signal)
        hash.update(chunk as Buffer)
        read += (chunk as Buffer).length
        this.emitProgress('verifying', read, total)
      }
    } catch (err) {
      stream.destroy()
      if (this.cancelRequested || signal.aborted) throw new SpeechModelInstallError('canceled', 'canceled')
      throw err
    }
    this.emitProgress('verifying', total, total)
    return hash.digest('hex') === this.manifest.archiveSha256
  }

  private async extractAndInstall(signal: AbortSignal): Promise<void> {
    this.emitProgress('extracting', 0, 100)
    await fs.mkdir(this.paths.tmpDir, { recursive: true })
    const extractDir = await fs.mkdtemp(path.join(this.paths.tmpDir, 'extract-'))
    const stageDir = await fs.mkdtemp(path.join(this.paths.tmpDir, 'stage-'))

    try {
      await this.tarRunner(this.paths.archivePath, extractDir, signal)
      this.throwIfCanceled(signal)

      const extracted = await findRequiredFiles(extractDir, this.manifest.files.map((file) => file.name))
      for (const spec of this.manifest.files) {
        const source = extracted.get(spec.name)
        if (!source) {
          throw new SpeechModelInstallError('extract-failed', `Archive is missing ${spec.name}`)
        }
        const dest = path.join(stageDir, spec.name)
        await fs.copyFile(source, dest)
        const size = await fileSize(dest)
        if (size !== spec.bytes) {
          throw new SpeechModelInstallError(
            'extract-failed',
            `${spec.name} is ${size} bytes, expected ${spec.bytes}`,
          )
        }
      }

      const installManifest: InstallManifest = {
        version: this.manifest.version,
        archive: {
          name: this.manifest.assetName,
          bytes: this.manifest.archiveBytes,
          sha256: this.manifest.archiveSha256,
        },
        files: this.manifest.files.map((file) => ({ ...file })),
        installedAt: this.now().toISOString(),
      }
      await fs.writeFile(
        path.join(stageDir, 'manifest.json'),
        JSON.stringify(installManifest, null, 2),
        'utf8',
      )

      await this.swapIntoPlace(stageDir)
      this.emitProgress('extracting', 100, 100)
    } finally {
      await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {})
      await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async swapIntoPlace(stageDir: string): Promise<void> {
    const backupDir = path.join(this.paths.tmpDir, `backup-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const hadModel = await isDirectory(this.paths.modelDir)
    if (hadModel) await fs.rename(this.paths.modelDir, backupDir)

    try {
      await fs.rename(stageDir, this.paths.modelDir)
    } catch (err) {
      if (hadModel) await fs.rename(backupDir, this.paths.modelDir).catch(() => {})
      throw new SpeechModelInstallError('file-system', `Could not move model into place: ${errorMessage(err)}`)
    }

    if (hadModel) await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
  }

  // ── Status ────────────────────────────────────────────────────

  private async readDiskStatus(): Promise<Omit<VoiceModelStatus, 'state'> & { state: VoiceModelStatus['state'] }> {
    const [partBytes, archiveBytesOnDisk, modelBytes] = await Promise.all([
      fileSize(this.paths.partPath),
      fileSize(this.paths.archivePath),
      directorySize(this.paths.modelDir),
    ])
    const base = {
      version: null as string | null,
      installedBytes: 0,
      diskUsageBytes: modelBytes + partBytes + archiveBytesOnDisk,
      partialBytes: partBytes,
      archiveBytes: this.manifest.archiveBytes,
      archiveReady: archiveBytesOnDisk > 0,
      installedTotalBytes: expectedInstalledBytes(this.manifest),
      installedAt: null as string | null,
    }

    const installedManifest = await readJson<InstallManifest>(this.paths.manifestPath)
    const modelDirExists = await isDirectory(this.paths.modelDir)
    const manifestVersion =
      typeof installedManifest?.version === 'string' ? installedManifest.version : null

    let actualInstalledBytes = 0
    let valid = modelDirExists
    for (const spec of this.manifest.files) {
      const size = await fileSize(path.join(this.paths.modelDir, spec.name)).catch(() => -1)
      if (size !== spec.bytes) {
        valid = false
      } else {
        actualInstalledBytes += size
      }
    }

    return {
      ...base,
      state: valid ? 'installed' : modelDirExists ? 'corrupted' : 'missing',
      version: modelDirExists ? (manifestVersion ?? (valid ? this.manifest.version : null)) : null,
      installedBytes: actualInstalledBytes,
      installedAt:
        valid && typeof installedManifest?.installedAt === 'string' ? installedManifest.installedAt : null,
    }
  }

  private resolveSources(): VoiceModelSource[] {
    if (this.options.sources) return dedupeSources(this.options.sources)

    const sources: VoiceModelSource[] = [{ kind: 'github', url: this.manifest.url }]
    for (const prefix of GITHUB_MIRROR_PREFIXES) {
      sources.push({ kind: 'mirror', url: prefix + this.manifest.url })
    }
    const custom = this.options.getCustomUrl?.()?.trim()
    if (custom && /^https?:\/\//i.test(custom)) {
      sources.push({ kind: 'custom', url: custom })
    }
    return dedupeSources(sources)
  }

  private emitProgress(
    phase: VoiceModelPhase,
    transferred: number,
    total: number,
    source?: VoiceModelSource,
  ): void {
    const progress: VoiceModelProgress = {
      phase,
      transferred,
      total,
      percent: total > 0 ? Math.min(100, Math.floor((transferred / total) * 100)) : 0,
      ...(source ? { source } : {}),
    }
    this.active = { phase, progress }
    this.emit('progress', progress)
  }

  private throwIfCanceled(signal: AbortSignal): void {
    if (this.cancelRequested || signal.aborted) {
      throw new SpeechModelInstallError('canceled', 'canceled')
    }
  }
}

function createSystemTarRunner(command: string): SpeechModelTarRunner {
  return (archivePath, destDir, signal) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(command, ['-xjf', archivePath, '-C', destDir], {
        windowsHide: true,
        signal,
      })
      let stderr = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (signal.aborted || err.name === 'AbortError') {
          reject(new SpeechModelInstallError('canceled', 'canceled'))
          return
        }
        if (err.code === 'ENOENT') {
          reject(
            new SpeechModelInstallError(
              'tar-unavailable',
              `System tar was not found (${command}); install bsdtar or add tar to PATH`,
            ),
          )
          return
        }
        reject(new SpeechModelInstallError('extract-failed', `Could not run tar: ${err.message}`))
      })
      child.on('close', (code) => {
        if (signal.aborted) {
          reject(new SpeechModelInstallError('canceled', 'canceled'))
          return
        }
        if (code === 0) resolve()
        else reject(new SpeechModelInstallError('extract-failed', `tar exited with ${code}: ${stderr}`))
      })
    })
}

async function findRequiredFiles(dir: string, names: string[]): Promise<Map<string, string>> {
  const wanted = new Set(names)
  const found = new Map<string, string>()
  const walk = async (current: string): Promise<void> => {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && wanted.has(entry.name) && !found.has(entry.name)) {
        found.set(entry.name, full)
      }
    }
  }
  await walk(dir)
  return found
}

function writeChunk(stream: ReturnType<typeof createWriteStream>, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function endStream(stream: ReturnType<typeof createWriteStream>): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err?: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw err
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function isDirectory(dirPath: string): Promise<boolean> {
  try {
    return (await fs.stat(dirPath)).isDirectory()
  } catch {
    return false
  }
}

async function directorySize(dirPath: string): Promise<number> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    let total = 0
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name)
      if (entry.isDirectory()) total += await directorySize(full)
      else if (entry.isFile()) total += await fileSize(full)
    }
    return total
  } catch {
    return 0
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function dedupeSources(sources: VoiceModelSource[]): VoiceModelSource[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ABORT_ERR')
}

function errorCodeOf(err: unknown): VoiceModelErrorCode {
  if (err instanceof SpeechModelInstallError) return err.code
  return 'file-system'
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

