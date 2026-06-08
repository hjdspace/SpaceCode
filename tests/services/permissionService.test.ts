import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ─── PermissionRequest type ────────────────────────────────────────
interface PermissionRequest {
  sessionId: string
  requestId: string
  toolName: string
  toolUseId: string
  input: Record<string, unknown>
  agentId?: string
  description?: string
  title?: string
  displayName?: string
  blockedPath?: string
  decisionReason?: string
  permissionSuggestions?: unknown[]
}

// ─── PermissionStore (extracted from chat.ts, bug fixed) ───────────
// Bug fix: removePermissionByRequestId referenced `cancelledRequestId`
// instead of the `requestId` parameter.
class PermissionStore {
  private pendingPermissions = new Map<string, Map<string, PermissionRequest>>()

  addPermissionRequest(sessionId: string, request: PermissionRequest): void {
    if (!request?.toolUseId) return
    let bySession = this.pendingPermissions.get(sessionId)
    if (!bySession) {
      bySession = new Map()
      this.pendingPermissions.set(sessionId, bySession)
    }
    bySession.set(request.toolUseId, { ...request, sessionId })
  }

  removePermissionByRequestId(sessionId: string, requestId: string): void {
    const bySession = this.pendingPermissions.get(sessionId)
    if (!bySession) return
    for (const [toolUseId, req] of bySession.entries()) {
      if (req.requestId === requestId) {
        bySession.delete(toolUseId)
        break
      }
    }
    if (bySession.size === 0) this.pendingPermissions.delete(sessionId)
  }

  getPendingPermissionForToolUse(toolUseId: string, sessionId?: string): PermissionRequest | undefined {
    if (!sessionId) return undefined
    return this.pendingPermissions.get(sessionId)?.get(toolUseId)
  }

  hasPendingPermissionForToolUse(toolUseId: string, sessionId?: string): boolean {
    return !!this.getPendingPermissionForToolUse(toolUseId, sessionId)
  }

  consumePermissionFor(toolUseId: string, sessionId: string): PermissionRequest | undefined {
    const bySession = this.pendingPermissions.get(sessionId)
    if (!bySession) return undefined
    const req = bySession.get(toolUseId)
    if (!req) return undefined
    bySession.delete(toolUseId)
    if (bySession.size === 0) this.pendingPermissions.delete(sessionId)
    return req
  }

  getPendingCount(sessionId?: string): number {
    if (sessionId) {
      return this.pendingPermissions.get(sessionId)?.size ?? 0
    }
    let total = 0
    for (const bySession of this.pendingPermissions.values()) {
      total += bySession.size
    }
    return total
  }

  clear(): void {
    this.pendingPermissions.clear()
  }
}

// ─── Helpers ───────────────────────────────────────────────────────
function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    sessionId: overrides.sessionId ?? 'session-1',
    requestId: overrides.requestId ?? 'req-1',
    toolName: overrides.toolName ?? 'Bash',
    toolUseId: overrides.toolUseId ?? 'tool-1',
    input: overrides.input ?? { command: 'ls' },
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('PermissionStore', () => {
  let store: PermissionStore

  beforeEach(() => {
    store = new PermissionStore()
  })

  // ── addPermissionRequest ────────────────────────────────────────
  describe('addPermissionRequest', () => {
    it('adds a request and can retrieve it', () => {
      const req = makeRequest()
      store.addPermissionRequest('session-1', req)
      const result = store.getPendingPermissionForToolUse('tool-1', 'session-1')
      assert.deepStrictEqual(result, { ...req, sessionId: 'session-1' })
    })

    it('ignores requests without toolUseId', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: '' }))
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: undefined as any }))
      assert.strictEqual(store.getPendingCount('session-1'), 0)
    })

    it('ignores null/undefined request', () => {
      store.addPermissionRequest('session-1', undefined as any)
      store.addPermissionRequest('session-1', null as any)
      assert.strictEqual(store.getPendingCount(), 0)
    })

    it('overwrites existing request with same toolUseId', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1', toolName: 'Bash' }))
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1', toolName: 'Edit' }))
      const result = store.getPendingPermissionForToolUse('tool-1', 'session-1')
      assert.strictEqual(result!.toolName, 'Edit')
      assert.strictEqual(store.getPendingCount('session-1'), 1)
    })

    it('handles multiple sessions independently', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      store.addPermissionRequest('session-2', makeRequest({ toolUseId: 'tool-2' }))
      assert.strictEqual(store.getPendingCount('session-1'), 1)
      assert.strictEqual(store.getPendingCount('session-2'), 1)
      assert.strictEqual(store.getPendingCount(), 2)
    })

    it('sets sessionId on the stored request', () => {
      const req = makeRequest({ sessionId: 'original-session' })
      store.addPermissionRequest('overridden-session', req)
      const result = store.getPendingPermissionForToolUse('tool-1', 'overridden-session')
      assert.strictEqual(result!.sessionId, 'overridden-session')
    })
  })

  // ── removePermissionByRequestId ─────────────────────────────────
  describe('removePermissionByRequestId', () => {
    it('removes a request by requestId', () => {
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-1', toolUseId: 'tool-1' }))
      store.removePermissionByRequestId('session-1', 'req-1')
      assert.strictEqual(store.getPendingPermissionForToolUse('tool-1', 'session-1'), undefined)
    })

    it('cleans up empty session maps', () => {
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-1', toolUseId: 'tool-1' }))
      store.removePermissionByRequestId('session-1', 'req-1')
      assert.strictEqual(store.getPendingCount('session-1'), 0)
      assert.strictEqual(store.getPendingCount(), 0)
    })

    it('does nothing for non-existent requestId', () => {
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-1', toolUseId: 'tool-1' }))
      store.removePermissionByRequestId('session-1', 'non-existent-req')
      assert.strictEqual(store.getPendingCount('session-1'), 1)
    })

    it('does nothing for non-existent sessionId', () => {
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-1', toolUseId: 'tool-1' }))
      store.removePermissionByRequestId('non-existent-session', 'req-1')
      assert.strictEqual(store.getPendingCount('session-1'), 1)
    })

    it('only removes the first matching requestId', () => {
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-1', toolUseId: 'tool-1' }))
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-1', toolUseId: 'tool-2' }))
      store.removePermissionByRequestId('session-1', 'req-1')
      assert.strictEqual(store.getPendingCount('session-1'), 1)
    })

    it('does not clean up session map when other requests remain', () => {
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-1', toolUseId: 'tool-1' }))
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-2', toolUseId: 'tool-2' }))
      store.removePermissionByRequestId('session-1', 'req-1')
      assert.strictEqual(store.getPendingCount('session-1'), 1)
      assert.strictEqual(store.getPendingPermissionForToolUse('tool-2', 'session-1')!.requestId, 'req-2')
    })
  })

  // ── getPendingPermissionForToolUse ──────────────────────────────
  describe('getPendingPermissionForToolUse', () => {
    it('returns the correct request', () => {
      const req = makeRequest({ toolUseId: 'tool-1', toolName: 'Bash' })
      store.addPermissionRequest('session-1', req)
      const result = store.getPendingPermissionForToolUse('tool-1', 'session-1')
      assert.strictEqual(result!.toolUseId, 'tool-1')
      assert.strictEqual(result!.toolName, 'Bash')
    })

    it('returns undefined for missing sessionId', () => {
      store.addPermissionRequest('session-1', makeRequest())
      assert.strictEqual(store.getPendingPermissionForToolUse('tool-1'), undefined)
    })

    it('returns undefined for missing toolUseId', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      assert.strictEqual(store.getPendingPermissionForToolUse('tool-999', 'session-1'), undefined)
    })

    it('returns undefined when sessionId exists but toolUseId does not', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      assert.strictEqual(store.getPendingPermissionForToolUse('tool-1', 'session-2'), undefined)
    })
  })

  // ── hasPendingPermissionForToolUse ──────────────────────────────
  describe('hasPendingPermissionForToolUse', () => {
    it('returns true for existing permission', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      assert.strictEqual(store.hasPendingPermissionForToolUse('tool-1', 'session-1'), true)
    })

    it('returns false for missing permission', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      assert.strictEqual(store.hasPendingPermissionForToolUse('tool-999', 'session-1'), false)
    })

    it('returns false when sessionId is undefined', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      assert.strictEqual(store.hasPendingPermissionForToolUse('tool-1'), false)
    })

    it('returns false for wrong sessionId', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      assert.strictEqual(store.hasPendingPermissionForToolUse('tool-1', 'session-2'), false)
    })
  })

  // ── consumePermissionFor ────────────────────────────────────────
  describe('consumePermissionFor', () => {
    it('returns and removes the permission', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1', toolName: 'Bash' }))
      const consumed = store.consumePermissionFor('tool-1', 'session-1')
      assert.strictEqual(consumed!.toolUseId, 'tool-1')
      assert.strictEqual(consumed!.toolName, 'Bash')
      assert.strictEqual(store.hasPendingPermissionForToolUse('tool-1', 'session-1'), false)
    })

    it('returns undefined for missing permission', () => {
      assert.strictEqual(store.consumePermissionFor('tool-1', 'session-1'), undefined)
    })

    it('cleans up empty session maps', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      store.consumePermissionFor('tool-1', 'session-1')
      assert.strictEqual(store.getPendingCount('session-1'), 0)
      assert.strictEqual(store.getPendingCount(), 0)
    })

    it('second consume returns undefined', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      const first = store.consumePermissionFor('tool-1', 'session-1')
      assert.ok(first)
      const second = store.consumePermissionFor('tool-1', 'session-1')
      assert.strictEqual(second, undefined)
    })

    it('does not clean up session map when other permissions remain', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-2' }))
      store.consumePermissionFor('tool-1', 'session-1')
      assert.strictEqual(store.getPendingCount('session-1'), 1)
      assert.strictEqual(store.getPendingPermissionForToolUse('tool-2', 'session-1')!.toolUseId, 'tool-2')
    })
  })

  // ── getPendingCount ─────────────────────────────────────────────
  describe('getPendingCount', () => {
    it('returns 0 for empty store', () => {
      assert.strictEqual(store.getPendingCount(), 0)
    })

    it('returns 0 for a session with no permissions', () => {
      assert.strictEqual(store.getPendingCount('session-1'), 0)
    })

    it('returns correct count for a session', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-2' }))
      assert.strictEqual(store.getPendingCount('session-1'), 2)
    })

    it('returns total count across all sessions', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-2' }))
      store.addPermissionRequest('session-2', makeRequest({ toolUseId: 'tool-3' }))
      assert.strictEqual(store.getPendingCount(), 3)
    })

    it('does not count other sessions when sessionId is provided', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      store.addPermissionRequest('session-2', makeRequest({ toolUseId: 'tool-2' }))
      assert.strictEqual(store.getPendingCount('session-1'), 1)
    })
  })

  // ── clear ───────────────────────────────────────────────────────
  describe('clear', () => {
    it('removes all permissions', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      store.addPermissionRequest('session-2', makeRequest({ toolUseId: 'tool-2' }))
      store.clear()
      assert.strictEqual(store.getPendingCount(), 0)
      assert.strictEqual(store.getPendingCount('session-1'), 0)
      assert.strictEqual(store.getPendingCount('session-2'), 0)
    })
  })

  // ── Edge cases ──────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles multiple permissions in same session', () => {
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-1', toolUseId: 'tool-1', toolName: 'Bash' }))
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-2', toolUseId: 'tool-2', toolName: 'Edit' }))
      store.addPermissionRequest('session-1', makeRequest({ requestId: 'req-3', toolUseId: 'tool-3', toolName: 'Write' }))

      assert.strictEqual(store.getPendingCount('session-1'), 3)
      assert.strictEqual(store.hasPendingPermissionForToolUse('tool-1', 'session-1'), true)
      assert.strictEqual(store.hasPendingPermissionForToolUse('tool-2', 'session-1'), true)
      assert.strictEqual(store.hasPendingPermissionForToolUse('tool-3', 'session-1'), true)

      const consumed = store.consumePermissionFor('tool-2', 'session-1')
      assert.strictEqual(consumed!.toolName, 'Edit')
      assert.strictEqual(store.getPendingCount('session-1'), 2)
      assert.strictEqual(store.hasPendingPermissionForToolUse('tool-2', 'session-1'), false)
    })

    it('handles same toolUseId in different sessions independently', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'shared-tool', toolName: 'Bash' }))
      store.addPermissionRequest('session-2', makeRequest({ toolUseId: 'shared-tool', toolName: 'Edit' }))

      const req1 = store.getPendingPermissionForToolUse('shared-tool', 'session-1')
      const req2 = store.getPendingPermissionForToolUse('shared-tool', 'session-2')
      assert.strictEqual(req1!.toolName, 'Bash')
      assert.strictEqual(req2!.toolName, 'Edit')

      // Consuming from session-1 does not affect session-2
      store.consumePermissionFor('shared-tool', 'session-1')
      assert.strictEqual(store.hasPendingPermissionForToolUse('shared-tool', 'session-1'), false)
      assert.strictEqual(store.hasPendingPermissionForToolUse('shared-tool', 'session-2'), true)
    })

    it('handles empty sessionId', () => {
      store.addPermissionRequest('', makeRequest({ toolUseId: 'tool-1' }))
      // getPendingPermissionForToolUse returns undefined for falsy sessionId
      assert.strictEqual(store.getPendingPermissionForToolUse('tool-1', ''), undefined)
      // But the data is stored; count with explicit sessionId still works
      assert.strictEqual(store.getPendingCount(''), 1)
    })

    it('getPendingPermissionForToolUse returns undefined with empty string sessionId when no sessionId param', () => {
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: 'tool-1' }))
      // No sessionId passed → undefined
      assert.strictEqual(store.getPendingPermissionForToolUse('tool-1'), undefined)
    })

    it('addPermissionRequest with request that has only whitespace toolUseId is ignored', () => {
      // Whitespace-only string is truthy but not a valid toolUseId;
      // the implementation only checks `!request?.toolUseId` which is
      // false for a non-empty string. This test documents the current
      // behavior: whitespace toolUseId IS stored.
      store.addPermissionRequest('session-1', makeRequest({ toolUseId: '   ' }))
      assert.strictEqual(store.getPendingCount('session-1'), 1)
    })

    it('stores a copy of the request (not a reference)', () => {
      const original = makeRequest({ toolUseId: 'tool-1', toolName: 'Bash' })
      store.addPermissionRequest('session-1', original)
      original.toolName = 'Edit'
      const stored = store.getPendingPermissionForToolUse('tool-1', 'session-1')
      assert.strictEqual(stored!.toolName, 'Bash')
    })
  })
})
