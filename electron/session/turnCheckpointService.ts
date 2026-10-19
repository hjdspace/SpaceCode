import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { diffLines } from 'diff'
import { info, warn, error, debug } from '../infra/logger'

interface FileHistoryBackup {
  backupFileName: string | null
  version: number
  backupTime: string
}

interface FileHistorySnapshot {
  messageId: string
  trackedFileBackups: Record<string, FileHistoryBackup>
  timestamp: string
}

interface FileHistorySnapshotEntry {
  type: 'file-history-snapshot'
  messageId: string
  snapshot: FileHistorySnapshot
  isSnapshotUpdate: boolean
}

interface SessionMessage {
  type: string
  uuid?: string
  message?: {
    id?: string
    role?: string
    content?: string | Array<{ type: string; text?: string }>
  }
  messageId?: string
  snapshot?: FileHistorySnapshot
  timestamp?: string
  // file-history-delta 条目（新版引擎 trackEdit 写入）
  snapshotMessageId?: string
  trackingPath?: string
  backup?: FileHistoryBackup
}

/**
 * Anthropic API 协议里 tool_result 作为 `role: 'user'` 的消息发回，
 * 但它不是"真正的用户输入"——前端 props.messages 里也不会出现它，
 * 它被嵌入到 assistant message 的 toolCalls.output 里渲染。
 *
 * 因此后端在计算 userMessageIndex 时必须把 tool_result 消息排除，
 * 否则与前端 MessageList.vue 中累计的 userMsgIndex 错位，导致从
 * 第二轮开始的轮次卡片全部找不到对应 user message（卡片不显示）。
 */
function isRealUserInput(msg: SessionMessage): boolean {
  if (msg.type !== 'user' && msg.message?.role !== 'user') return false
  const content = msg.message?.content
  if (typeof content === 'string') return true
  if (Array.isArray(content) && content.length > 0) {
    // 只要存在任何非 tool_result block，就视为真用户输入
    return content.some(block => block.type !== 'tool_result')
  }
  // content 为空 / undefined / 空数组：视作真用户消息（保留之前的行为）
  return true
}

export interface TurnCheckpointFileChange {
  path: string
  insertions: number
  deletions: number
}

export interface TurnCheckpoint {
  target: {
    targetUserMessageId: string
    userMessageIndex: number
    userMessageCount: number
    turnStartedAt?: number
  }
  code: {
    available: boolean
    reason?: string
    filesChanged: TurnCheckpointFileChange[]
    insertions: number
    deletions: number
  }
  workDir?: string
}

export interface TurnCheckpointDiffResult {
  state: 'ok' | 'missing' | 'not_git_repo' | 'error'
  path: string
  diff?: string
  error?: string
}

function getClaudeConfigHomeDir(): string {
  // 与引擎 envUtils.ts 及 sessionHistoryManager.ts 对齐：CLAUDE_CONFIG_DIR 优先，
  // 否则回退到 XDG_CONFIG_HOME/claude 或 ~/.claude —— 引擎按同样顺序定位
  // projects/ 与 file-history/，这里不一致会导致找不到引擎写入的会话数据。
  if (process.env.CLAUDE_CONFIG_DIR) {
    return process.env.CLAUDE_CONFIG_DIR
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'claude')
  }
  return path.join(os.homedir(), '.claude')
}

function getClaudeProjectsDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'projects')
}

function sanitizePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

function resolveRealPath(p: string): string {
  try {
    return fs.realpathSync(p).normalize('NFC')
  } catch {
    return p.normalize('NFC')
  }
}

function getProjectDir(projectPath: string): string {
  const resolvedPath = resolveRealPath(projectPath)
  return path.join(getClaudeProjectsDir(), sanitizePath(resolvedPath))
}

function getFileHistoryDir(sessionId: string): string {
  return path.join(getClaudeConfigHomeDir(), 'file-history', sessionId)
}

function readSessionJsonl(sessionPath: string): SessionMessage[] {
  if (!fs.existsSync(sessionPath)) {
    debug('TurnCheckpoint', `Session file not found: ${sessionPath}`)
    return []
  }

  const messages: SessionMessage[] = []
  const fileContent = fs.readFileSync(sessionPath, 'utf8')
  const lines = fileContent.split('\n').filter(line => line.trim())

  for (const line of lines) {
    try {
      const msg = JSON.parse(line)
      messages.push(msg)
    } catch {
      // skip malformed lines
    }
  }

  return messages
}

function extractUserMessages(
  messages: SessionMessage[]
): Array<{ id: string; index: number; startedAt: number }> {
  let userIndex = -1
  const userMessages: Array<{ id: string; index: number; startedAt: number }> = []

  for (const msg of messages) {
    if (isRealUserInput(msg)) {
      // file-history-snapshot.messageId 是 JSONL 顶层 entry 的 uuid（参见
      // engine/src/QueryEngine.ts 中 fileHistoryMakeSnapshot(..., message.uuid)），
      // 因此优先使用 msg.uuid，再回退到 messageId / message.id 做兼容。
      const id = msg.uuid || msg.messageId || msg.message?.id || ''
      if (id) {
        userIndex += 1
        const ts = msg.timestamp ? Date.parse(msg.timestamp) : NaN
        userMessages.push({ id, index: userIndex, startedAt: Number.isNaN(ts) ? 0 : ts })
      }
    }
  }

  return userMessages
}

function hasAssistantResponse(messages: SessionMessage[], userMessageId: string): boolean {
  let foundUser = false
  for (const msg of messages) {
    if (isRealUserInput(msg)) {
      const id = msg.uuid || msg.messageId || msg.message?.id || ''
      if (id === userMessageId) {
        foundUser = true
        continue
      }
      if (foundUser) {
        return true
      }
    }
    if (foundUser && (msg.type === 'assistant' || msg.message?.role === 'assistant')) {
      return true
    }
  }
  return false
}

function extractFileHistorySnapshots(messages: SessionMessage[]): FileHistorySnapshotEntry[] {
  // 把 JSONL 里所有 file-history-snapshot 条目按 user-message-id 聚合，并取该组的最后一条。
  //
  // 重要：JSONL 中存在两种 file-history-snapshot 条目：
  //   1. isSnapshotUpdate=false  —— 轮次开始时由 fileHistoryMakeSnapshot 写入，初始
  //      trackedFileBackups 通常为空 {}（除非是从上一轮继承的备份）。
  //   2. isSnapshotUpdate=true   —— 轮次中每次 fileHistoryTrackEdit 写入。这里的
  //      trackedFileBackups 是 spread-累积态（包含此前所有备份 + 本次新增），所以
  //      同一组里 **最后一条 update 即为该轮最终快照**，丢弃中间条目无损。
  //
  // 还需注意 update 条目的两个 messageId 字段含义不同：
  //   - 外层 entry.messageId      = 触发本次 edit 的 message uuid（通常是 assistant
  //     tool-use 消息，与 user 消息无对应关系）。
  //   - 内嵌 snapshot.messageId   = 该轮起始的 **user 消息 uuid**，与
  //     extractUserMessages 返回的 id 对齐。
  // 因此聚合 / 匹配都必须用 entry.snapshot.messageId。
  const allEntries = messages.filter(
    (msg): msg is FileHistorySnapshotEntry => msg.type === 'file-history-snapshot'
  )

  const latestByUserMsg = new Map<string, FileHistorySnapshotEntry>()
  const order: string[] = []
  for (const entry of allEntries) {
    const key = entry.snapshot?.messageId
    if (!key) continue
    if (!latestByUserMsg.has(key)) order.push(key)
    latestByUserMsg.set(key, entry)
  }

  // 新版引擎：fileHistoryTrackEdit 改写独立的 file-history-delta 条目（不再写
  // isSnapshotUpdate=true 的 snapshot 条目），snapshotMessageId 指向本轮 user 消息，
  // backup 为编辑前状态（backupFileName=null 表示编辑前文件不存在）。轮次开始快照
  // 不包含本轮新编辑的文件 —— 若不把 delta 合并进对应组，该轮 trackedPaths 为空，
  // filesChanged 恒为空数组，检查点整轮不产出（轮次追踪卡片不显示）。
  for (const msg of messages) {
    if (msg.type !== 'file-history-delta') continue
    const key = msg.snapshotMessageId
    const deltaBackup = msg.backup
    if (!key || !msg.trackingPath || !deltaBackup) continue

    let entry = latestByUserMsg.get(key)
    if (!entry) {
      entry = {
        type: 'file-history-snapshot',
        messageId: key,
        snapshot: { messageId: key, trackedFileBackups: {}, timestamp: '' },
        isSnapshotUpdate: false,
      }
      latestByUserMsg.set(key, entry)
      order.push(key)
    }
    entry.snapshot.trackedFileBackups = {
      ...entry.snapshot.trackedFileBackups,
      [msg.trackingPath]: deltaBackup,
    }
  }

  return order.map(k => latestByUserMsg.get(k)!).filter(Boolean)
}

function findSnapshotForTarget(
  snapshots: FileHistorySnapshotEntry[],
  targetUserMessageId: string,
  userMessageIndex?: number
): FileHistorySnapshotEntry | null {
  // Strategy 1: Exact match by messageId (engine's uuid)
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].snapshot?.messageId === targetUserMessageId) {
      debug('TurnCheckpoint', `Found snapshot by exact ID match: ${targetUserMessageId.slice(0, 8)}...`)
      return snapshots[i]
    }
  }

  // Strategy 2: Fallback to index-based matching
  // This handles the case where frontend message.id differs from engine's uuid
  // Frontend generates its own IDs (crypto.randomUUID()), but engine uses internal uuids
  // for file-history-snapshot entries. When userMessageIndex is provided, use position.
  if (userMessageIndex !== undefined && userMessageIndex >= 0) {
    const allUserMessageIds = [...new Set(snapshots.map(s => s.snapshot?.messageId).filter(Boolean))]
    debug('TurnCheckpoint', `Exact ID match failed, trying index-based lookup | targetIndex=${userMessageIndex} | availableSnapshots=${allUserMessageIds.length}`)

    if (userMessageIndex < allUserMessageIds.length) {
      const fallbackId = allUserMessageIds[userMessageIndex]
      const snapshotByIndex = snapshots.find(s => s.snapshot?.messageId === fallbackId)
      if (snapshotByIndex) {
        warn('TurnCheckpoint', `Using index-based fallback matching | index=${userMessageIndex} | matchedSnapshotId=${fallbackId?.slice(0, 8)}... | originalTargetId=${targetUserMessageId.slice(0, 8)}...`)
        return snapshotByIndex
      }
    }

    warn('TurnCheckpoint', `Index-based lookup also failed | targetIndex=${userMessageIndex} | totalSnapshots=${allUserMessageIds.length}`)
  }

  // Log available snapshot IDs for debugging
  const availableIds = snapshots.map(s => s.snapshot?.messageId).filter(Boolean).map(id => id!.slice(0, 8))
  warn('TurnCheckpoint', `No snapshot found for target message | targetId=${targetUserMessageId.slice(0, 8)}... | availableSnapshotIds=[${availableIds.join(', ')}]`)

  return null
}

async function readFileContent(filePath: string): Promise<string | null> {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

async function readBackupContent(
  sessionId: string,
  backupFileName: string | null
): Promise<string | null> {
  if (!backupFileName) {
    return null
  }

  const backupPath = path.join(getFileHistoryDir(sessionId), backupFileName)
  return readFileContent(backupPath)
}

/**
 * 备份的三种状态，必须区分开：
 *  - absent = 引擎记录"编辑前文件不存在"（backupFileName 为 null），本会话新建的文件
 *  - content = 读到了编辑前的真实内容
 *  - lost    = 记录指向的备份文件在盘上找不到了（file-history 目录被清理）
 *
 * 只按"内容是否为 null"处理会把 lost 当成 absent，于是整份文件被渲染成全量新增 ——
 * 轮次卡片于是报出"本会话新增了 800 行"这种根本没发生过的改动。
 */
type BackupState =
  | { kind: 'absent' }
  | { kind: 'content'; text: string }
  | { kind: 'lost' }

async function readBackupState(
  sessionId: string,
  backup: FileHistoryBackup | undefined
): Promise<BackupState> {
  if (!backup) return { kind: 'absent' }
  if (!backup.backupFileName) return { kind: 'absent' }
  const text = await readBackupContent(sessionId, backup.backupFileName)
  if (text === null) return { kind: 'lost' }
  return { kind: 'content', text }
}

/**
 * 引擎写进 JSONL 的 trackingPath 有两种形态：仓库内是相对 workDir 的路径且带
 * 反斜杠（maybeShortenFilePath 的产物），仓库外是绝对路径。前端传回来的键是
 * 正斜杠口径，所以比较要同时做斜杠归一和盘符大小写归一。
 */
function sameTrackingPath(a: string, b: string): boolean {
  const left = a.replace(/\\/g, '/').replace(/\/+$/, '')
  const right = b.replace(/\\/g, '/').replace(/\/+$/, '')
  const driveLetter = /^[a-zA-Z]:\//
  if (driveLetter.test(left) || driveLetter.test(right)) {
    return left.toLowerCase() === right.toLowerCase()
  }
  return left === right
}

function expandTrackingPath(trackingPath: string, workDir: string): string {
  return path.isAbsolute(trackingPath) ? trackingPath : path.join(workDir, trackingPath)
}

/** 在本轮跟踪表里找 filePath 对应的跟踪键（可能存相对、查的是绝对，反之亦然）。 */
function findTrackingKey(
  tracked: Record<string, FileHistoryBackup>,
  filePath: string,
  workDir: string
): string | null {
  const wanted = filePath.replace(/\\/g, '/')
  const wantedAbs = expandTrackingPath(filePath, workDir).replace(/\\/g, '/')
  for (const key of Object.keys(tracked)) {
    if (sameTrackingPath(key, wanted)) return key
    if (sameTrackingPath(expandTrackingPath(key, workDir), wantedAbs)) return key
  }
  return null
}

function patchHeader(filePath: string): string {
  const shown = filePath.replace(/\\/g, '/')
  return `diff --git a/${shown} b/${shown}\n--- a/${shown}\n+++ b/${shown}\n`
}

async function computeFileDiff(
  beforeContent: string | null,
  afterContent: string | null
): Promise<{ insertions: number; deletions: number; diff: string }> {
  if (beforeContent === null && afterContent === null) {
    return { insertions: 0, deletions: 0, diff: '' }
  }

  const before = beforeContent ?? ''
  const after = afterContent ?? ''

  const changes = diffLines(before, after)
  let insertions = 0
  let deletions = 0

  const CONTEXT_LINES = 3
  type LineEntry = { type: 'context' | 'added' | 'removed'; text: string; oldLine?: number; newLine?: number }
  const outputLines: LineEntry[] = []

  let oldLineNum = 1
  let newLineNum = 1

  for (const change of changes) {
    const changeLines = change.value.split('\n')
    if (changeLines[changeLines.length - 1] === '') {
      changeLines.pop()
    }

    if (!change.added && !change.removed) {
      for (const line of changeLines) {
        outputLines.push({ type: 'context', text: line, oldLine: oldLineNum, newLine: newLineNum })
        oldLineNum++
        newLineNum++
      }
    } else if (change.removed) {
      for (const line of changeLines) {
        outputLines.push({ type: 'removed', text: line, oldLine: oldLineNum })
        oldLineNum++
        deletions++
      }
    } else if (change.added) {
      for (const line of changeLines) {
        outputLines.push({ type: 'added', text: line, newLine: newLineNum })
        newLineNum++
        insertions++
      }
    }
  }

  function collectHunk(startIdx: number): { hunkLines: string[]; nextIdx: number } {
    const hunkRaw: LineEntry[] = []
    let i = startIdx
    let hasChange = false

    while (i < outputLines.length) {
      const entry = outputLines[i]
      if (entry.type !== 'context') {
        hasChange = true
        hunkRaw.push(entry)
        i++
        continue
      }

      let ctxCount = 0
      const ctxStart = i
      while (i < outputLines.length && outputLines[i].type === 'context' && ctxCount < CONTEXT_LINES) {
        hunkRaw.push(outputLines[i])
        ctxCount++
        i++
      }

      if (i >= outputLines.length || outputLines[i].type !== 'context') break

      const remainingCtx = []
      let j = i
      while (j < outputLines.length && outputLines[j].type === 'context') {
        remainingCtx.push(outputLines[j])
        j++
      }

      if (j < outputLines.length) {
        const take = Math.min(CONTEXT_LINES, remainingCtx.length)
        for (let k = 0; k < take; k++) {
          hunkRaw.push(remainingCtx[k])
        }
        i = ctxStart + take
        break
      } else {
        i = j
        break
      }
    }

    if (!hasChange) return { hunkLines: [], nextIdx: i }

    const firstOldLine = hunkRaw.find(e => e.oldLine !== undefined)?.oldLine ?? 1
    const firstNewLine = hunkRaw.find(e => e.newLine !== undefined)?.newLine ?? 1
    let oldCount = 0
    let newCount = 0
    const lines: string[] = []

    for (const entry of hunkRaw) {
      if (entry.type === 'context') {
        lines.push(` ${entry.text}`)
        oldCount++
        newCount++
      } else if (entry.type === 'removed') {
        lines.push(`-${entry.text}`)
        oldCount++
      } else if (entry.type === 'added') {
        lines.push(`+${entry.text}`)
        newCount++
      }
    }

    const hunkHeader = `@@ -${firstOldLine},${oldCount} +${firstNewLine},${newCount} @@`
    return { hunkLines: [hunkHeader, ...lines], nextIdx: i }
  }

  const diffParts: string[] = []
  let idx = 0
  while (idx < outputLines.length) {
    if (outputLines[idx].type === 'context') {
      idx++
      continue
    }
    const { hunkLines, nextIdx } = collectHunk(idx)
    if (hunkLines.length > 0) {
      diffParts.push(hunkLines.join('\n'))
    }
    idx = nextIdx
  }

  const diffOutput = diffParts.join('\n')
  return { insertions, deletions, diff: diffOutput }
}

async function buildTurnCodePreview(
  sessionId: string,
  targetSnapshot: FileHistorySnapshotEntry,
  nextSnapshot: FileHistorySnapshotEntry | null,
  workDir: string
): Promise<{
  available: boolean
  filesChanged: TurnCheckpointFileChange[]
  insertions: number
  deletions: number
}> {
  const trackedPaths = Object.keys(targetSnapshot.snapshot.trackedFileBackups)
  const filesChanged: TurnCheckpointFileChange[] = []
  let totalInsertions = 0
  let totalDeletions = 0

  for (const trackingPath of trackedPaths) {
    const targetBackup = targetSnapshot.snapshot.trackedFileBackups[trackingPath]
    const filePath = path.isAbsolute(trackingPath) ? trackingPath : path.join(workDir, trackingPath)

    let beforeContent: string | null = null
    let afterContent: string | null = null

    // 本轮快照的备份（开始快照的继承备份 + delta 合并的本轮编辑前备份）= 本轮
    // 开始前的状态 → before；下一轮开始快照的备份 = 本轮结束后的状态 → after；
    // 最新一轮的 after = 磁盘当前文件。
    if (nextSnapshot) {
      const nextBackup = nextSnapshot.snapshot.trackedFileBackups[trackingPath]
      if (nextBackup) {
        afterContent = await readBackupContent(sessionId, nextBackup.backupFileName)
      } else {
        // File wasn't tracked in next snapshot, try reading from disk
        afterContent = await readFileContent(filePath)
      }
      beforeContent = await readBackupContent(sessionId, targetBackup?.backupFileName ?? null)
    } else {
      // This is the latest snapshot — compare backup (before) with current file (after)
      beforeContent = await readBackupContent(sessionId, targetBackup?.backupFileName ?? null)
      afterContent = await readFileContent(filePath)
    }

    const { insertions, deletions } = await computeFileDiff(beforeContent, afterContent)

    if (insertions > 0 || deletions > 0) {
      filesChanged.push({
        path: trackingPath,
        insertions,
        deletions,
      })
      totalInsertions += insertions
      totalDeletions += deletions
    }
  }

  return {
    available: true,
    filesChanged,
    insertions: totalInsertions,
    deletions: totalDeletions,
  }
}

export async function listSessionTurnCheckpoints(
  sessionId: string,
  projectPath: string
): Promise<TurnCheckpoint[]> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)

  if (!fs.existsSync(sessionPath)) {
    debug('TurnCheckpoint', `Session file not found: ${sessionPath}`)
    return []
  }

  const messages = readSessionJsonl(sessionPath)
  const userMessages = extractUserMessages(messages)

  if (userMessages.length === 0) {
    debug('TurnCheckpoint', `No user messages found in session ${sessionId}`)
    return []
  }

  const snapshots = extractFileHistorySnapshots(messages)

  if (snapshots.length === 0) {
    debug('TurnCheckpoint', `No file-history-snapshot entries found in session ${sessionId}`)
    return []
  }

  const workDir = projectPath
  const checkpoints: TurnCheckpoint[] = []

  for (const userMsg of userMessages) {
    if (!hasAssistantResponse(messages, userMsg.id)) {
      continue
    }

    const targetSnapshot = findSnapshotForTarget(snapshots, userMsg.id, userMsg.index)
    if (!targetSnapshot) {
      continue
    }

    const nextSnapshot = findNextSnapshotAfter(snapshots, targetSnapshot)

    try {
      const preview = await buildTurnCodePreview(
        sessionId,
        targetSnapshot,
        nextSnapshot,
        workDir
      )

      if (!preview.available || preview.filesChanged.length === 0) {
        continue
      }

      checkpoints.push({
        target: {
          targetUserMessageId: userMsg.id,
          userMessageIndex: userMsg.index,
          userMessageCount: userMessages.length,
          turnStartedAt: userMsg.startedAt || undefined,
        },
        code: {
          available: true,
          filesChanged: preview.filesChanged,
          insertions: preview.insertions,
          deletions: preview.deletions,
        },
        workDir,
      })
    } catch (err) {
      warn('TurnCheckpoint', `Failed to build preview for user message ${userMsg.id}`, {
        error: String(err),
      })
    }
  }

  info('TurnCheckpoint', `Found ${checkpoints.length} turn checkpoints for session ${sessionId}`)
  return checkpoints
}

function findNextSnapshotAfter(
  snapshots: FileHistorySnapshotEntry[],
  targetSnapshot: FileHistorySnapshotEntry
): FileHistorySnapshotEntry | null {
  const index = snapshots.findIndex(snapshot => snapshot === targetSnapshot)
  if (index >= 0 && index < snapshots.length - 1) {
    return snapshots[index + 1]
  }
  return null
}

export async function getTurnRewindPreviewFiles(
  sessionId: string,
  projectPath: string,
  targetUserMessageId: string,
  userMessageIndex?: number
): Promise<{ ok: boolean; files: string[]; error: string | null }> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)

  if (!fs.existsSync(sessionPath)) {
    return { ok: false, files: [], error: 'Session file not found' }
  }

  const messages = readSessionJsonl(sessionPath)
  const snapshots = extractFileHistorySnapshots(messages)
  const targetSnapshot = findSnapshotForTarget(snapshots, targetUserMessageId, userMessageIndex)

  if (!targetSnapshot) {
    return { ok: true, files: [], error: null }
  }

  const nextSnapshot = findNextSnapshotAfter(snapshots, targetSnapshot)

  try {
    const preview = await buildTurnCodePreview(
      sessionId,
      targetSnapshot,
      nextSnapshot,
      projectPath
    )

    return {
      ok: true,
      files: preview.filesChanged.map(file => file.path),
      error: null,
    }
  } catch (err) {
    warn('TurnCheckpoint', 'Failed to build rewind preview', { error: String(err) })
    return { ok: false, files: [], error: 'Failed to build rewind preview' }
  }
}

export async function getTurnCheckpointDiff(
  sessionId: string,
  projectPath: string,
  targetUserMessageId: string,
  filePath: string,
  userMessageIndex?: number
): Promise<TurnCheckpointDiffResult> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)

  if (!fs.existsSync(sessionPath)) {
    return { state: 'error', path: filePath, error: 'Session file not found' }
  }

  const messages = readSessionJsonl(sessionPath)
  const snapshots = extractFileHistorySnapshots(messages)
  const workDir = projectPath

  const targetSnapshot = findSnapshotForTarget(snapshots, targetUserMessageId, userMessageIndex)
  if (!targetSnapshot) {
    return { state: 'missing', path: filePath, error: 'No snapshot found for target message' }
  }

  const trackingPath = findTrackingKey(targetSnapshot.snapshot.trackedFileBackups, filePath, workDir)

  if (!trackingPath) {
    return { state: 'missing', path: filePath, error: 'File not found in snapshot' }
  }

  const expandedPath = expandTrackingPath(trackingPath, workDir)

  const targetBackup = targetSnapshot.snapshot.trackedFileBackups[trackingPath]
  const nextSnapshot = findNextSnapshotAfter(snapshots, targetSnapshot)

  let beforeContent: string | null = null
  let afterContent: string | null = null

  beforeContent = await readBackupContent(sessionId, targetBackup?.backupFileName ?? null)
  if (nextSnapshot) {
    // 与 buildTurnCodePreview 同口径：下一轮快照里有这个键才用它的备份，
    // 缺键说明下一轮没再动这个文件 —— 必须回落到磁盘，否则 after 会被读成 null，
    // 把"本轮改了两行"渲染成"整份文件被删光"。
    const nextBackup = nextSnapshot.snapshot.trackedFileBackups[trackingPath]
    afterContent = nextBackup
      ? await readBackupContent(sessionId, nextBackup.backupFileName)
      : await readFileContent(expandedPath)
  } else {
    afterContent = await readFileContent(expandedPath)
  }

  const { diff } = await computeFileDiff(beforeContent, afterContent)

  if (!diff) {
    return { state: 'missing', path: filePath, error: 'No diff content available' }
  }

  return {
    state: 'ok',
    path: filePath,
    diff: patchHeader(filePath) + diff,
  }
}

export interface SessionFileDiffResult {
  /**
   * no_evidence   = 本会话的文件跟踪表里没有它（命令/外部改动，或从未跟踪）
   * evidence_lost = 跟踪表指向的备份文件已不在盘上，不能拿空内容冒充"编辑前不存在"
   */
  state: 'ok' | 'no_evidence' | 'evidence_lost' | 'error'
  path: string
  diff?: string
  error?: string
}

/**
 * 本会话对某个文件"从头到尾改了什么"，完全不查 git。
 *
 * before 取会话第一次动它之前的备份，after 取当前磁盘，所以 git 给不出答案的两种情况
 * 都有解：仓库外文件（agent 记忆目录、临时输出）根本没有 numstat；改动已经 commit 掉、
 * 工作区与 HEAD 无差异的文件也仍能看到本会话做了什么。
 *
 * after 用磁盘意味着"会话结束之后的人工改动一并算进来"，这跟 git 工作区口径同病。
 * 想剔除它得把面板的轮次序号对齐到 JSONL 的 user uuid，而那套对齐只能靠时间锚点猜
 * （见 src/utils/turnCheckpointUtils.ts），不值得为此少显示内容。
 */
export async function getSessionFileDiff(
  sessionId: string,
  projectPath: string,
  filePath: string
): Promise<SessionFileDiffResult> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)
  if (!fs.existsSync(sessionPath)) {
    return { state: 'error', path: filePath, error: 'Session file not found' }
  }

  const groups = extractFileHistorySnapshots(readSessionJsonl(sessionPath))
  let firstGroup: FileHistorySnapshotEntry | null = null
  let trackingKey: string | null = null
  for (const group of groups) {
    const key = findTrackingKey(group.snapshot.trackedFileBackups, filePath, projectPath)
    if (key) {
      firstGroup = group
      trackingKey = key
      break
    }
  }

  if (!firstGroup || !trackingKey) {
    return { state: 'no_evidence', path: filePath }
  }

  const before = await readBackupState(sessionId, firstGroup.snapshot.trackedFileBackups[trackingKey])
  if (before.kind === 'lost') {
    return { state: 'evidence_lost', path: filePath }
  }

  const afterText = await readFileContent(expandTrackingPath(trackingKey, projectPath))
  const { diff } = await computeFileDiff(before.kind === 'content' ? before.text : null, afterText)
  if (!diff) {
    return { state: 'no_evidence', path: filePath }
  }

  return { state: 'ok', path: filePath, diff: patchHeader(filePath) + diff }
}

export async function rewindTurn(
  sessionId: string,
  projectPath: string,
  targetUserMessageId: string,
  userMessageIndex?: number
): Promise<{ ok: boolean; error: string | null }> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)

  if (!fs.existsSync(sessionPath)) {
    return { ok: false, error: 'Session file not found' }
  }

  const messages = readSessionJsonl(sessionPath)
  const snapshots = extractFileHistorySnapshots(messages)
  const workDir = projectPath

  const targetSnapshot = findSnapshotForTarget(snapshots, targetUserMessageId, userMessageIndex)
  if (!targetSnapshot) {
    return { ok: false, error: 'No snapshot found for target message' }
  }

  // 找到下一个快照，用于判断哪些文件在该轮实际发生了变化
  const nextSnapshot = findNextSnapshotAfter(snapshots, targetSnapshot)

  let restoredCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const [trackingPath, backup] of Object.entries(targetSnapshot.snapshot.trackedFileBackups)) {
    const expandedPath = path.isAbsolute(trackingPath) ? trackingPath : path.join(workDir, trackingPath)

    try {
      if (backup.backupFileName === null) {
        // File didn't exist before this turn — delete it (only if it currently exists)
        if (fs.existsSync(expandedPath)) {
          fs.unlinkSync(expandedPath)
          restoredCount++
        } else {
          skippedCount++
        }
      } else {
        // Restore the backup — but only if the file actually differs from the backup
        const backupPath = path.join(getFileHistoryDir(sessionId), backup.backupFileName)
        if (!fs.existsSync(backupPath)) {
          warn('TurnCheckpoint', `Backup file not found: ${backupPath}`)
          failedCount++
          continue
        }

        // 读取备份内容，确定该轮开始前的文件状态
        const backupContent = fs.readFileSync(backupPath, 'utf8')

        // 确定回滚后应该恢复到的目标内容
        // 对于非最新轮次：目标是下一个快照中该文件的备份（即该轮结束后的状态）
        // 对于最新轮次：目标是当前磁盘上的文件（即该轮结束后的状态）
        // 我们需要恢复的是该轮开始前的状态（即 backupContent）
        // 所以只需比较 backupContent 与当前文件内容
        let currentContent: string | null = null
        if (nextSnapshot) {
          // 非最新轮次：当前文件可能已被后续轮次修改
          // 需要恢复到该轮开始前的状态，即 backupContent
          // 但如果当前文件内容已经等于 backupContent，说明该文件在该轮及之后都没被修改，跳过
          const nextBackup = nextSnapshot.snapshot.trackedFileBackups[trackingPath]
          if (nextBackup?.backupFileName) {
            const nextBackupPath = path.join(getFileHistoryDir(sessionId), nextBackup.backupFileName)
            if (fs.existsSync(nextBackupPath)) {
              currentContent = fs.readFileSync(nextBackupPath, 'utf8')
            }
          }
        }

        if (currentContent === null) {
          // 最新轮次或无法从下一快照获取内容，直接读磁盘
          currentContent = await readFileContent(expandedPath)
        }

        // 如果当前内容与备份内容相同，说明该文件在该轮没有实际变化，跳过恢复
        if (currentContent === backupContent) {
          skippedCount++
          continue
        }

        const dir = path.dirname(expandedPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.copyFileSync(backupPath, expandedPath)
        restoredCount++
      }
    } catch (err) {
      error('TurnCheckpoint', `Failed to restore file ${expandedPath}`, { error: String(err) })
      failedCount++
    }
  }

  if (failedCount > 0 && restoredCount === 0) {
    return { ok: false, error: `Failed to restore all ${failedCount} files` }
  }

  info('TurnCheckpoint', `Rewind completed: ${restoredCount} files restored, ${skippedCount} unchanged (skipped), ${failedCount} failed`)
  return { ok: true, error: failedCount > 0 ? `${failedCount} files could not be restored` : null }
}
