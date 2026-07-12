import { electronAPI } from './_context'
import type { SessionTurnCheckpoint, TurnCheckpointDiffResult } from '@/types'

export const session = {
  getTurnCheckpoints: (sessionId: string, projectPath?: string): Promise<{
    ok: boolean
    checkpoints: SessionTurnCheckpoint[]
    error: string | null
  }> =>
    electronAPI?.session?.getTurnCheckpoints(sessionId, projectPath) ||
    Promise.resolve({ ok: false, checkpoints: [], error: 'Session API not available' }),

  getTurnRewindPreviewFiles: (
    sessionId: string,
    targetUserMessageId: string,
    userMessageIndex?: number,
    projectPath?: string
  ): Promise<{ ok: boolean; files: string[]; error: string | null }> =>
    electronAPI?.session?.getTurnRewindPreviewFiles(
      sessionId,
      targetUserMessageId,
      userMessageIndex,
      projectPath
    ) ||
    Promise.resolve({ ok: false, files: [], error: 'Session API not available' }),

  getTurnCheckpointDiff: (
    sessionId: string,
    targetUserMessageId: string,
    filePath: string,
    userMessageIndex?: number,
    projectPath?: string
  ): Promise<TurnCheckpointDiffResult> =>
    electronAPI?.session?.getTurnCheckpointDiff(
      sessionId,
      targetUserMessageId,
      filePath,
      userMessageIndex,
      projectPath
    ) ||
    Promise.resolve({
      state: 'error',
      path: filePath,
      error: 'Session API not available'
    }),

  rewindTurn: (
    sessionId: string,
    options: { targetUserMessageId: string; userMessageIndex?: number },
    projectPath?: string
  ): Promise<{ ok: boolean; error: string | null }> =>
    electronAPI?.session?.rewindTurn(sessionId, options, projectPath) ||
    Promise.resolve({ ok: false, error: 'Session API not available' }),
}
