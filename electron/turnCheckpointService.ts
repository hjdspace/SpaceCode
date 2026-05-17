import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { diffLines } from 'diff'
import { info, warn, error, debug } from './logger'

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

function getProjectDir(projectPath: string): string {
  return path.join(getClaudeProjectsDir(), sanitizePath(projectPath))
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

function extractUserMessages(messages: SessionMessage[]): Array<{ id: string; index: number }> {
  let userIndex = -1
  const userMessages: Array<{ id: string; index: number }> = []

  for (const msg of messages) {
    if (msg.type === 'user' || msg.message?.role === 'user') {
      // file-history-snapshot.messageId 是 JSONL 顶层 entry 的 uuid（参见
      // engine/src/QueryEngine.ts 中 fileHistoryMakeSnapshot(..., message.uuid)），
      // 因此优先使用 msg.uuid，再回退到 messageId / message.id 做兼容。
      const id = msg.uuid || msg.messageId || msg.message?.id || ''
      if (id) {
        userIndex += 1
        userMessages.push({ id, index: userIndex })
      }
    }
  }

  return userMessages
}

function hasAssistantResponse(messages: SessionMessage[], userMessageId: string): boolean {
  let foundUser = false
  for (const msg of messages) {
    if (msg.type === 'user' || msg.message?.role === 'user') {
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
  return messages
    .filter((msg): msg is FileHistorySnapshotEntry => msg.type === 'file-history-snapshot')
    .filter(entry => !entry.isSnapshotUpdate)
}

function findSnapshotForTarget(
  snapshots: FileHistorySnapshotEntry[],
  targetUserMessageId: string
): FileHistorySnapshotEntry | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].messageId === targetUserMessageId) {
      return snapshots[i]
    }
  }
  return null
}

function findNextSnapshot(
  snapshots: FileHistorySnapshotEntry[],
  targetUserMessageId: string
): FileHistorySnapshotEntry | null {
  let foundTarget = false
  for (const snapshot of snapshots) {
    if (snapshot.messageId === targetUserMessageId) {
      foundTarget = true
      continue
    }
    if (foundTarget) {
      return snapshot
    }
  }
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
  let diffOutput = ''

  for (const change of changes) {
    const lines = change.value.split('\n')
    // Remove trailing empty line from split
    if (lines[lines.length - 1] === '') {
      lines.pop()
    }

    for (const line of lines) {
      if (change.added) {
        insertions++
        diffOutput += `+${line}\n`
      } else if (change.removed) {
        deletions++
        diffOutput += `-${line}\n`
      } else {
        diffOutput += ` ${line}\n`
      }
    }
  }

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

    // "Before" = the state before this turn's changes
    // If there's a next snapshot, the "before" for this file is the backup in the next snapshot
    // Otherwise, the "after" is the current file on disk
    if (nextSnapshot) {
      const nextBackup = nextSnapshot.snapshot.trackedFileBackups[trackingPath]
      if (nextBackup) {
        beforeContent = await readBackupContent(sessionId, nextBackup.backupFileName)
      } else {
        // File wasn't tracked in next snapshot, try reading from disk
        beforeContent = await readFileContent(filePath)
      }
    } else {
      // This is the latest snapshot — compare backup (before) with current file (after)
      beforeContent = await readBackupContent(sessionId, targetBackup?.backupFileName ?? null)
      afterContent = await readFileContent(filePath)
    }

    if (nextSnapshot) {
      // For historical turns: "after" = backup from target snapshot
      afterContent = await readBackupContent(sessionId, targetBackup?.backupFileName ?? null)
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

    const targetSnapshot = findSnapshotForTarget(snapshots, userMsg.id)
    if (!targetSnapshot) {
      continue
    }

    const nextSnapshot = findNextSnapshot(snapshots, userMsg.id)

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

  const targetSnapshot = findSnapshotForTarget(snapshots, targetUserMessageId)
  if (!targetSnapshot) {
    return { state: 'missing', path: filePath, error: 'No snapshot found for target message' }
  }

  const expandedPath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath)
  const trackingPath = Object.keys(targetSnapshot.snapshot.trackedFileBackups).find(
    p => p === filePath || (path.isAbsolute(p) ? p : path.join(workDir, p)) === expandedPath
  )

  if (!trackingPath) {
    return { state: 'missing', path: filePath, error: 'File not found in snapshot' }
  }

  const targetBackup = targetSnapshot.snapshot.trackedFileBackups[trackingPath]
  const nextSnapshot = findNextSnapshot(snapshots, targetUserMessageId)

  let beforeContent: string | null = null
  let afterContent: string | null = null

  if (nextSnapshot) {
    const nextBackup = nextSnapshot.snapshot.trackedFileBackups[trackingPath]
    beforeContent = await readBackupContent(sessionId, nextBackup?.backupFileName ?? null)
    afterContent = await readBackupContent(sessionId, targetBackup?.backupFileName ?? null)
  } else {
    beforeContent = await readBackupContent(sessionId, targetBackup?.backupFileName ?? null)
    afterContent = await readFileContent(expandedPath)
  }

  const { diff } = await computeFileDiff(beforeContent, afterContent)

  if (!diff) {
    return { state: 'missing', path: filePath, error: 'No diff content available' }
  }

  const header = `diff --git a/${filePath} b/${filePath}\n--- a/${filePath}\n+++ b/${filePath}\n`
  return {
    state: 'ok',
    path: filePath,
    diff: header + diff,
  }
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

  const targetSnapshot = findSnapshotForTarget(snapshots, targetUserMessageId)
  if (!targetSnapshot) {
    return { ok: false, error: 'No snapshot found for target message' }
  }

  let restoredCount = 0
  let failedCount = 0

  for (const [trackingPath, backup] of Object.entries(targetSnapshot.snapshot.trackedFileBackups)) {
    const expandedPath = path.isAbsolute(trackingPath) ? trackingPath : path.join(workDir, trackingPath)

    try {
      if (backup.backupFileName === null) {
        // File didn't exist before this turn — delete it
        if (fs.existsSync(expandedPath)) {
          fs.unlinkSync(expandedPath)
          restoredCount++
        }
      } else {
        // Restore the backup
        const backupPath = path.join(getFileHistoryDir(sessionId), backup.backupFileName)
        if (fs.existsSync(backupPath)) {
          const dir = path.dirname(expandedPath)
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }
          fs.copyFileSync(backupPath, expandedPath)
          restoredCount++
        } else {
          warn('TurnCheckpoint', `Backup file not found: ${backupPath}`)
          failedCount++
        }
      }
    } catch (err) {
      error('TurnCheckpoint', `Failed to restore file ${expandedPath}`, { error: String(err) })
      failedCount++
    }
  }

  if (failedCount > 0 && restoredCount === 0) {
    return { ok: false, error: `Failed to restore all ${failedCount} files` }
  }

  info('TurnCheckpoint', `Rewind completed: ${restoredCount} files restored, ${failedCount} failed`)
  return { ok: true, error: failedCount > 0 ? `${failedCount} files could not be restored` : null }
}
