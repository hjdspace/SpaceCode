// electron/preload/session.ts
// 会话域：回合检查点、回退、会话文件 diff。

import type { PreloadIpc } from './types'

export function createSessionApi(ipcRenderer: PreloadIpc) {
  // Turn Checkpoint API - 轮次变更追踪
  return {
    session: {
      getTurnCheckpoints: (sessionId: string, projectPath?: string) =>
        ipcRenderer.invoke('session:getTurnCheckpoints', sessionId, projectPath),
      getTurnRewindPreviewFiles: (
        sessionId: string,
        targetUserMessageId: string,
        userMessageIndex: number | undefined,
        projectPath?: string
      ) =>
        ipcRenderer.invoke(
          'session:getTurnRewindPreviewFiles',
          sessionId,
          targetUserMessageId,
          userMessageIndex,
          projectPath
        ),
      getTurnCheckpointDiff: (
        sessionId: string,
        targetUserMessageId: string,
        filePath: string,
        userMessageIndex?: number,
        projectPath?: string
      ) =>
        ipcRenderer.invoke(
          'session:getTurnCheckpointDiff',
          sessionId,
          targetUserMessageId,
          filePath,
          userMessageIndex,
          projectPath
        ),
      getSessionFileDiff: (sessionId: string, filePath: string, projectPath?: string) =>
        ipcRenderer.invoke('session:getSessionFileDiff', sessionId, filePath, projectPath),
      rewindTurn: (
        sessionId: string,
        options: { targetUserMessageId: string; userMessageIndex?: number },
        projectPath?: string
      ) =>
        ipcRenderer.invoke('session:rewindTurn', sessionId, options, projectPath),
    },
  }
}
