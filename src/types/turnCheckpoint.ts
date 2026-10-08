export interface SessionTurnCheckpointTarget {
  targetUserMessageId: string
  userMessageIndex: number
  userMessageCount: number
  /** engine 把该轮 user 消息写入 JSONL 的时刻（ms epoch），用于把卡片锚定到前端轮次 */
  turnStartedAt?: number
}

export interface FileChangedEntry {
  path: string
  insertions: number
  deletions: number
}

export interface SessionTurnCheckpointCode {
  available: boolean
  reason?: string
  filesChanged: FileChangedEntry[]
  insertions: number
  deletions: number
}

export interface SessionTurnCheckpoint {
  target: SessionTurnCheckpointTarget
  code: SessionTurnCheckpointCode
  workDir?: string
}

export interface SessionTurnCheckpointsResponse {
  checkpoints: SessionTurnCheckpoint[]
}

export interface TurnCheckpointDiffResult {
  state: 'ok' | 'missing' | 'not_git_repo' | 'error'
  path: string
  diff?: string
  error?: string
}

export interface TurnChangeCardData {
  checkpoint: SessionTurnCheckpoint
  workDir: string | null
  isLatest: boolean
  targetUserMessageId: string
}
