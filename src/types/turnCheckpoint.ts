export interface SessionTurnCheckpointTarget {
  targetUserMessageId: string
  userMessageIndex: number
  userMessageCount: number
}

export interface SessionTurnCheckpointCode {
  available: boolean
  reason?: string
  filesChanged: string[]
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
