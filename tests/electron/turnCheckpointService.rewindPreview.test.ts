/**
 * getTurnRewindPreviewFiles logic tests - run with:
 *   node --experimental-strip-types --test tests/electron/turnCheckpointService.rewindPreview.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

interface FileHistorySnapshotEntry {
  type: 'file-history-snapshot'
  messageId: string
  snapshot: {
    messageId: string
    trackedFileBackups: Record<string, { backupFileName: string | null; version: number; backupTime: string }>
    timestamp: string
  }
  isSnapshotUpdate: boolean
}

function findSnapshotForTarget(
  snapshots: FileHistorySnapshotEntry[],
  targetUserMessageId: string,
  userMessageIndex?: number
): FileHistorySnapshotEntry | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].snapshot?.messageId === targetUserMessageId) {
      return snapshots[i]
    }
  }

  if (userMessageIndex !== undefined && userMessageIndex >= 0) {
    const allUserMessageIds = [...new Set(snapshots.map(s => s.snapshot?.messageId).filter(Boolean))]
    if (userMessageIndex < allUserMessageIds.length) {
      const fallbackId = allUserMessageIds[userMessageIndex]
      return snapshots.find(s => s.snapshot?.messageId === fallbackId) ?? null
    }
  }

  return null
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

function getPreviewFiles(
  snapshots: FileHistorySnapshotEntry[],
  targetUserMessageId: string,
  userMessageIndex?: number
): string[] {
  const targetSnapshot = findSnapshotForTarget(snapshots, targetUserMessageId, userMessageIndex)
  if (!targetSnapshot) return []
  return Object.keys(targetSnapshot.snapshot.trackedFileBackups)
}

function getListCheckpointSnapshotIds(
  snapshots: FileHistorySnapshotEntry[],
  userMessages: Array<{ id: string; index: number }>
): Array<{ targetId: string; nextId: string | null }> {
  return userMessages.flatMap(userMsg => {
    const targetSnapshot = findSnapshotForTarget(snapshots, userMsg.id, userMsg.index)
    if (!targetSnapshot) return []

    const nextSnapshot = findNextSnapshotAfter(snapshots, targetSnapshot)
    return [{
      targetId: targetSnapshot.snapshot.messageId,
      nextId: nextSnapshot?.snapshot.messageId ?? null,
    }]
  })
}

function createSnapshots(): FileHistorySnapshotEntry[] {
  return [
    {
      type: 'file-history-snapshot',
      messageId: 'assistant-1',
      snapshot: {
        messageId: 'engine-uuid-0',
        trackedFileBackups: {},
        timestamp: '2024-01-01T10:00:00Z',
      },
      isSnapshotUpdate: false,
    },
    {
      type: 'file-history-snapshot',
      messageId: 'assistant-2',
      snapshot: {
        messageId: 'engine-uuid-1',
        trackedFileBackups: {
          'README.md': {
            backupFileName: 'backup-readme.txt',
            version: 1,
            backupTime: '2024-01-01T11:00:00Z',
          },
        },
        timestamp: '2024-01-01T11:00:00Z',
      },
      isSnapshotUpdate: true,
    },
    {
      type: 'file-history-snapshot',
      messageId: 'assistant-3',
      snapshot: {
        messageId: 'engine-uuid-2',
        trackedFileBackups: {
          'CHANGELOG.md': {
            backupFileName: 'backup-changelog.txt',
            version: 1,
            backupTime: '2024-01-01T12:00:00Z',
          },
        },
        timestamp: '2024-01-01T12:00:00Z',
      },
      isSnapshotUpdate: true,
    },
  ]
}

describe('getTurnRewindPreviewFiles matching', () => {
  it('returns tracked files via index fallback when frontend ID differs', () => {
    const files = getPreviewFiles(createSnapshots(), 'frontend-msg-id', 1)
    assert.deepStrictEqual(files, ['README.md'])
  })

  it('returns empty when no snapshot matches', () => {
    const files = getPreviewFiles(createSnapshots(), 'unknown-id', 99)
    assert.deepStrictEqual(files, [])
  })
})

describe('turn checkpoint list matching', () => {
  it('uses index fallback for list targets and finds the following snapshot from the matched target', () => {
    const checkpoints = getListCheckpointSnapshotIds(createSnapshots(), [
      { id: 'frontend-msg-id-1', index: 1 },
    ])

    assert.deepStrictEqual(checkpoints, [{
      targetId: 'engine-uuid-1',
      nextId: 'engine-uuid-2',
    }])
  })
})
