/**
 * claude-code 的 Bash 工具把 stdout/stderr 直接写进 task output 文件，
 * 但 CLI 协议只在工具结束时回 tool_result。这里旁路 tail 这个文件，
 * 把增量快照合成成 pi 同款的 tool_execution_delta，复用渲染层现成的实时通路。
 *
 * 文件布局（engine 2.1.888 源码与安装版 2.1.227 二进制一致）：
 *   <tmpdir>/claude[-uid]/<sanitized cwd>/<engineSessionId>/tasks/<taskId>.output
 *
 * 找不到目录、认领失败或 CLI 改了布局时静默降级：终态 tool_result 仍是权威输出。
 */
import { promises as fsp, realpathSync, type Dirent, type Stats } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { StringDecoder } from 'string_decoder'
import { debug, warn } from '../infra/logger'

/** 与渲染层 MAX_INMEMORY_TOOL_OUTPUT 对齐：每次只送最后 30k，避免 IPC 被长输出拖垮。 */
const LIVE_TAIL_CHARS = 30_000
/** 单次 tick 最多读 256KB；更大的输出交给后续 tick 追赶，保证最新内容尽快出现。 */
const MAX_READ_BYTES_PER_TICK = 256 * 1024
const DEFAULT_POLL_INTERVAL_MS = 150
const DEFAULT_MAX_TRACK_MS = 30 * 60_000
/** 文件创建时间与本机工具启动时间之间的容差（时钟/落盘延迟）。 */
const FILE_CLAIM_SLACK_MS = 1_000

export function sanitizePath(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '-')
}

export function claudeTempDirName(): string {
  if (process.platform === 'win32') return 'claude'
  return `claude-${process.getuid?.() ?? 0}`
}

export function resolveClaudeTempBase(tempRoot?: string): string {
  const base = tempRoot || process.env.CLAUDE_CODE_TMPDIR || os.tmpdir()
  try {
    return realpathSync(base)
  } catch {
    return base
  }
}

export function resolveExactTasksDir(opts: {
  tempRoot?: string
  cwd?: string
  engineSessionId: string
}): string | null {
  if (!opts.cwd) return null
  let realCwd = opts.cwd
  try {
    realCwd = realpathSync(opts.cwd)
  } catch {
    // cwd 可能已被删除；用原值拼路径，找不到目录时调用方会走扫描兜底
  }
  return path.join(
    resolveClaudeTempBase(opts.tempRoot),
    claudeTempDirName(),
    sanitizePath(realCwd),
    opts.engineSessionId,
    'tasks',
  )
}

/**
 * 输出文件里是子进程的原始字节：颜色转义要剥掉，`\r` 进度条只保留最后一帧。
 */
export function sanitizeTerminalText(text: string): string {
  const withoutOsc = text.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
  const withoutCsi = withoutOsc.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
  const withoutEsc = withoutCsi.replace(/\u001b[@-_]/g, '')
  return withoutEsc
    .split('\n')
    .map(line => {
      const idx = line.lastIndexOf('\r')
      return idx >= 0 ? line.slice(idx + 1) : line
    })
    .join('\n')
}

function keepTail(text: string, max: number): string {
  if (text.length <= max) return text
  const tail = text.slice(-max)
  const firstNewline = tail.indexOf('\n')
  return firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fsp.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

export interface ShellOutputStreamOptions {
  engineSessionId: string
  cwd?: string
  /** 把某个 Bash tool 的最新快照送回渲染层。 */
  onSnapshot: (toolUseId: string, text: string) => void
  /** 测试/诊断用覆盖；默认 CLAUDE_CODE_TMPDIR || os.tmpdir()。 */
  tempRoot?: string
  pollIntervalMs?: number
  maxTrackMs?: number
}

interface TrackedTool {
  toolUseId: string
  startedAt: number
  filePath?: string
  tailer?: FileTailer
}

interface OutputCandidate {
  filePath: string
  bornAt: number
}

class FileTailer {
  private offset = 0
  private buffer = ''
  private lastSent = ''
  private readonly decoder = new StringDecoder('utf8')

  constructor(
    private readonly filePath: string,
    private readonly onSnapshot: (text: string) => void,
  ) {}

  async read(): Promise<void> {
    let size: number
    try {
      size = (await fsp.stat(this.filePath)).size
    } catch {
      return
    }
    if (size <= this.offset) return

    const length = Math.min(size - this.offset, MAX_READ_BYTES_PER_TICK)
    const handle = await fsp.open(this.filePath, 'r')
    let chunk = ''
    try {
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset)
      if (bytesRead <= 0) return
      this.offset += bytesRead
      // StringDecoder 保留跨 chunk 的半截 UTF-8 字符
      chunk = this.decoder.write(buffer.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }

    this.buffer += chunk
    if (this.buffer.length > LIVE_TAIL_CHARS) {
      this.buffer = keepTail(this.buffer, LIVE_TAIL_CHARS)
    }
    const snapshot = sanitizeTerminalText(this.buffer)
    if (snapshot === this.lastSent) return
    this.lastSent = snapshot
    this.onSnapshot(snapshot)
  }

  close(): void {
    this.buffer = ''
    this.lastSent = ''
  }
}

export class ShellOutputStream {
  private readonly pending = new Map<string, TrackedTool>()
  private readonly claimedFiles = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false
  private disposed = false
  private cachedTasksDirs: string[] | null = null

  constructor(private readonly options: ShellOutputStreamOptions) {}

  registerTool(toolUseId: string, startedAt = Date.now()): void {
    if (this.disposed || !toolUseId || this.pending.has(toolUseId)) return
    this.pending.set(toolUseId, { toolUseId, startedAt })
    this.startTimer()
    debug(
      'ShellOutputStream',
      `Tracking Bash output | toolId=${toolUseId.slice(0, 8)} | session=${this.options.engineSessionId.slice(0, 8)}`,
    )
  }

  releaseTool(toolUseId: string): void {
    const tracked = this.pending.get(toolUseId)
    if (!tracked) return
    tracked.tailer?.close()
    this.pending.delete(toolUseId)
    this.stopTimerIfIdle()
  }

  dispose(): void {
    this.disposed = true
    for (const tracked of this.pending.values()) tracked.tailer?.close()
    this.pending.clear()
    this.claimedFiles.clear()
    this.cachedTasksDirs = null
    this.stopTimerIfIdle()
  }

  hasPendingTools(): boolean {
    return this.pending.size > 0
  }

  private startTimer(): void {
    if (this.timer || this.disposed || this.pending.size === 0) return
    this.timer = setInterval(
      () => void this.tick(),
      this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    )
    this.timer.unref?.()
  }

  private stopTimerIfIdle(): void {
    if (this.pending.size > 0) return
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.disposed) return
    this.ticking = true
    try {
      await this.claimPendingFiles()
      await this.drainTailers()
      this.expireStaleTools()
    } catch (err) {
      debug('ShellOutputStream', `tick failed | error=${String(err)}`)
    } finally {
      this.ticking = false
    }
  }

  private async resolveTasksDirs(): Promise<string[]> {
    if (this.cachedTasksDirs && this.cachedTasksDirs.length > 0) return this.cachedTasksDirs

    const exact = resolveExactTasksDir({
      tempRoot: this.options.tempRoot,
      cwd: this.options.cwd,
      engineSessionId: this.options.engineSessionId,
    })
    if (exact && (await isDirectory(exact))) {
      this.cachedTasksDirs = [exact]
      return this.cachedTasksDirs
    }

    // cwd 口径对不上（realpath/大小写/用户自定义 TMPDIR）时按 sessionId 扫描一层项目目录
    const claudeDir = path.join(resolveClaudeTempBase(this.options.tempRoot), claudeTempDirName())
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(claudeDir, { withFileTypes: true })
    } catch {
      return []
    }
    const dirs: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const candidate = path.join(claudeDir, entry.name, this.options.engineSessionId, 'tasks')
      if (await isDirectory(candidate)) dirs.push(candidate)
    }
    if (dirs.length > 0) this.cachedTasksDirs = dirs
    return dirs
  }

  private async claimPendingFiles(): Promise<void> {
    const unclaimed = [...this.pending.values()]
      .filter(tool => !tool.filePath)
      .sort((a, b) => a.startedAt - b.startedAt)
    if (unclaimed.length === 0) return

    const dirs = await this.resolveTasksDirs()
    if (dirs.length === 0) return

    const candidates: OutputCandidate[] = []
    for (const dir of dirs) {
      let names: string[]
      try {
        names = await fsp.readdir(dir)
      } catch {
        continue
      }
      for (const name of names) {
        if (!name.endsWith('.output')) continue
        const filePath = path.join(dir, name)
        if (this.claimedFiles.has(filePath)) continue
        let stat: Stats
        try {
          stat = await fsp.stat(filePath)
        } catch {
          continue
        }
        const bornAt = stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs
        // 早于本次工具启动的是后台任务/历史残留，不能认领
        if (bornAt < unclaimed[0].startedAt - FILE_CLAIM_SLACK_MS) continue
        candidates.push({ filePath, bornAt })
      }
    }
    if (candidates.length === 0) return
    candidates.sort((a, b) => a.bornAt - b.bornAt)

    for (const candidate of candidates) {
      // 顺序执行时文件创建顺序与 tool_use 顺序一致；始终认领最早的未认领工具
      const target = unclaimed.find(
        tool => !tool.filePath && candidate.bornAt >= tool.startedAt - FILE_CLAIM_SLACK_MS,
      )
      if (!target) continue
      this.claimedFiles.add(candidate.filePath)
      target.filePath = candidate.filePath
      target.tailer = new FileTailer(candidate.filePath, text =>
        this.options.onSnapshot(target.toolUseId, text),
      )
      debug(
        'ShellOutputStream',
        `Claimed Bash output file | toolId=${target.toolUseId.slice(0, 8)} | file=${candidate.filePath}`,
      )
    }
  }

  private async drainTailers(): Promise<void> {
    const tracked = [...this.pending.values()].filter(tool => tool.tailer)
    await Promise.all(
      tracked.map(async tool => {
        try {
          await tool.tailer!.read()
        } catch (err) {
          debug(
            'ShellOutputStream',
            `read failed | toolId=${tool.toolUseId.slice(0, 8)} | error=${String(err)}`,
          )
          tool.tailer?.close()
          tool.tailer = undefined
        }
      }),
    )
  }

  private expireStaleTools(): void {
    const maxTrackMs = this.options.maxTrackMs ?? DEFAULT_MAX_TRACK_MS
    const now = Date.now()
    for (const tool of [...this.pending.values()]) {
      if (now - tool.startedAt <= maxTrackMs) continue
      warn(
        'ShellOutputStream',
        `Stopping stale live output tracker | toolId=${tool.toolUseId.slice(0, 8)} | ageMs=${now - tool.startedAt}`,
      )
      this.releaseTool(tool.toolUseId)
    }
  }
}
