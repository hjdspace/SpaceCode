/**
 * 测试ID不匹配问题的修复
 *
 * 运行方式：node --experimental-strip-types --test tests/bug-reproduction/rewind-id-mismatch-fix.test.ts
 *
 * 这个测试验证了：
 * 1. 当前端message.id与engine的uuid不匹配时，回退到index-based查找
 * 2. 通过位置（index）成功找到对应的snapshot
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Types ─────────────────────────────────────────────────────────

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
  messageId?: string
  snapshot: FileHistorySnapshot
  isSnapshotUpdate: boolean
}

// ── 模拟修复后的findSnapshotForTarget ─────────────────────────────

function findSnapshotForTarget(
  snapshots: FileHistorySnapshotEntry[],
  targetUserMessageId: string,
  userMessageIndex?: number
): FileHistorySnapshotEntry | null {
  // Strategy 1: Exact match by messageId (engine's uuid)
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].snapshot?.messageId === targetUserMessageId) {
      console.log(`[FIXED] Found snapshot by exact ID match: ${targetUserMessageId.slice(0, 8)}...`)
      return snapshots[i]
    }
  }

  // Strategy 2: Fallback to index-based matching
  if (userMessageIndex !== undefined && userMessageIndex >= 0) {
    const allUserMessageIds = [...new Set(snapshots.map(s => s.snapshot?.messageId).filter(Boolean))]
    console.log(`[FIXED] Exact ID match failed, trying index-based lookup | targetIndex=${userMessageIndex} | availableSnapshots=${allUserMessageIds.length}`)

    if (userMessageIndex < allUserMessageIds.length) {
      const fallbackId = allUserMessageIds[userMessageIndex]
      const snapshotByIndex = snapshots.find(s => s.snapshot?.messageId === fallbackId)
      if (snapshotByIndex) {
        console.log(`[FIXED] Using index-based fallback matching | index=${userMessageIndex} | matchedSnapshotId=${fallbackId?.slice(0, 8)}...`)
        return snapshotByIndex
      }
    }
  }

  console.log(`[FIXED] No snapshot found for target: ${targetUserMessageId.slice(0, 8)}...`)
  return null
}

// ── 测试数据 ──────────────────────────────────────────────────────

function createTestSnapshots(): FileHistorySnapshotEntry[] {
  // 模拟engine生成的snapshots，使用engine的uuid
  return [
    {
      type: 'file-history-snapshot',
      messageId: 'assistant-msg-1',
      snapshot: {
        messageId: 'engine-uuid-msg-1',  // engine的uuid
        trackedFileBackups: {},
        timestamp: '2024-01-01T10:00:00Z'
      },
      isSnapshotUpdate: false
    },
    {
      type: 'file-history-snapshot',
      messageId: 'assistant-msg-2',
      snapshot: {
        messageId: 'engine-uuid-msg-2',  // engine的uuid
        trackedFileBackups: {
          'README.md': {
            backupFileName: 'backup-readme-v1.txt',
            version: 1,
            backupTime: '2024-01-01T11:00:00Z'
          }
        },
        timestamp: '2024-01-01T11:00:00Z'
      },
      isSnapshotUpdate: true
    },
    {
      type: 'file-history-snapshot',
      messageId: 'assistant-msg-3',
      snapshot: {
        messageId: 'engine-uuid-msg-3',  // engine的uuid
        trackedFileBackups: {
          'README.md': {
            backupFileName: 'backup-readme-v2.txt',
            version: 2,
            backupTime: '2024-01-01T12:00:00Z'
          },
          'src/index.ts': {
            backupFileName: 'backup-index-v1.txt',
            version: 1,
            backupTime: '2024-01-01T12:00:00Z'
          }
        },
        timestamp: '2024-01-01T12:00:00Z'
      },
      isSnapshotUpdate: true
    }
  ]
}

// ── 测试用例 ──────────────────────────────────────────────────────

describe('Fix Verification - ID Mismatch Handling', () => {
  describe('Scenario 1: ID mismatch with index fallback', () => {
    it('should find snapshot by index when exact ID match fails', () => {
      const snapshots = createTestSnapshots()

      // 前端生成的ID（与engine的uuid不同）
      const frontendMessageId = 'frontend-uuid-abc-123'

      // 用户选择了第3个user message（index=2，对应engine-uuid-msg-3）
      const userMessageIndex = 2

      console.log('\n=== Test Case: ID Mismatch with Index Fallback ===')
      console.log(`Frontend ID: ${frontendMessageId}`)
      console.log(`Target index: ${userMessageIndex}`)
      console.log(`Available engine UUIDs: ${snapshots.map(s => s.snapshot.messageId).join(', ')}`)

      const result = findSnapshotForTarget(snapshots, frontendMessageId, userMessageIndex)

      assert.ok(result, 'Should find snapshot using index fallback')
      assert.strictEqual(result?.snapshot.messageId, 'engine-uuid-msg-3')
      assert.strictEqual(Object.keys(result!.snapshot.trackedFileBackups).length, 2)

      console.log('✅ SUCCESS: Found correct snapshot via index fallback!')
    })

    it('should still use exact match when IDs align', () => {
      const snapshots = createTestSnapshots()

      // 直接使用engine的uuid（理想情况）
      const engineUuid = 'engine-uuid-msg-2'

      console.log('\n=== Test Case: Exact ID Match (Ideal) ===')
      console.log(`Using engine UUID: ${engineUuid}`)

      const result = findSnapshotForTarget(snapshots, engineUuid)

      assert.ok(result, 'Should find snapshot by exact ID match')
      assert.strictEqual(result?.snapshot.messageId, 'engine-uuid-msg-2')

      console.log('✅ SUCCESS: Found snapshot by exact ID match!')
    })
  })

  describe('Scenario 2: Boundary cases', () => {
    it('should handle out-of-range index gracefully', () => {
      const snapshots = createTestSnapshots()
      const frontendId = 'frontend-xyz'

      console.log('\n=== Test Case: Out-of-Range Index ===')

      // index超出范围
      const result = findSnapshotForTarget(snapshots, frontendId, 99)

      assert.strictEqual(result, null, 'Should return null for out-of-range index')

      console.log('✅ Correctly handled out-of-range index')
    })

    it('should handle negative index', () => {
      const snapshots = createTestSnapshots()
      const frontendId = 'frontend-xyz'

      console.log('\n=== Test Case: Negative Index ===')

      const result = findSnapshotForTarget(snapshots, frontendId, -1)

      assert.strictEqual(result, null, 'Should return null for negative index')

      console.log('✅ Correctly handled negative index')
    })

    it('should handle undefined index (no fallback)', () => {
      const snapshots = createTestSnapshots()
      const frontendId = 'nonexistent-id'

      console.log('\n=== Test Case: No Index Provided ===')

      const result = findSnapshotForTarget(snapshots, frontendId, undefined)

      assert.strictEqual(result, null, 'Should return null when no index and no match')

      console.log('✅ Correctly handled missing index parameter')
    })

    it('should handle empty snapshots array', () => {
      console.log('\n=== Test Case: Empty Snapshots ===')

      const result = findSnapshotForTarget([], 'some-id', 0)

      assert.strictEqual(result, null, 'Should return null for empty snapshots')

      console.log('✅ Correctly handled empty snapshots')
    })
  })

  describe('Scenario 3: Real-world simulation', () => {
    it('should simulate complete rewind flow with ID mismatch', async () => {
      const snapshots = createTestSnapshots()

      // 模拟真实场景：
      // 1. 前端有3个user messages，IDs是前端自己生成的
      const frontendMessages = [
        { id: 'frontend-msg-001', role: 'user' as const, content: 'First message' },
        { id: 'frontend-msg-002', role: 'assistant' as const, content: 'Response 1' },
        { id: 'frontend-msg-003', role: 'user' as const, content: 'Second message - modify README' },
        { id: 'frontend-msg-004', role: 'assistant' as const, content: 'Response 2 - modified README' },
        { id: 'frontend-msg-005', role: 'user' as const, content: 'Third message' },
        { id: 'frontend-msg-006', role: 'assistant' as const, content: 'Response 3' },
      ]

      // 2. 用户选择第2个user message（index=1，即"Second message - modify README"）
      const selectedMessage = frontendMessages[2] // frontend-msg-003
      const userMessages = frontendMessages.filter(m => m.role === 'user')
      const selectedIndex = userMessages.findIndex(m => m.id === selectedMessage.id)

      console.log('\n=== Real-World Simulation ===')
      console.log(`Selected message: ${selectedMessage.content}`)
      console.log(`Frontend ID: ${selectedMessage.id}`)
      console.log(`User message index: ${selectedIndex}`)

      // 3. 调用findSnapshotForTarget（带index）
      const snapshot = findSnapshotForTarget(snapshots, selectedMessage.id, selectedIndex)

      // 4. 验证结果
      assert.ok(snapshot, 'Should find snapshot for the selected message')
      assert.ok(snapshot!.snapshot.trackedFileBackups['README.md'], 'Should have README.md in backups')

      console.log(`\n✅ REWIND SIMULATION SUCCESSFUL:`)
      console.log(`   • Selected: "${selectedMessage.content}"`)
      console.log(`   • Matched to snapshot: ${snapshot!.snapshot.messageId.slice(0, 12)}...`)
      console.log(`   • Files to restore: ${Object.keys(snapshot!.snapshot.trackedFileBackups).join(', ')}`)
      console.log(`\n🎉 The fix works! Even though frontend/engine IDs don't match,`)
      console.log(`   the index-based fallback found the correct snapshot.`)
    })
  })
})
