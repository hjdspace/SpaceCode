/**
 * Tests for the in-memory pending-permission registry (src/services/permissionService.ts).
 * The tool cards read from this store while the answer IPC removes entries, so the
 * session/toolUseId indexing and the cross-session lookup need direct coverage.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { PermissionService, type PermissionRequest } from '@/services/permissionService'

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    sessionId: 'session-1',
    requestId: 'req-1',
    toolName: 'Bash',
    toolUseId: 'toolu_1',
    input: { command: 'ls' },
    ...overrides,
  }
}

describe('PermissionService', () => {
  let service: PermissionService

  beforeEach(() => {
    service = new PermissionService()
  })

  describe('addPermissionRequest', () => {
    it('stores a request under its session keyed by toolUseId', () => {
      service.addPermissionRequest('s1', makeRequest())

      expect(service.getPendingPermissionForToolUse('toolu_1', 's1')).toMatchObject({
        requestId: 'req-1',
        toolName: 'Bash',
        sessionId: 's1',
      })
    })

    it('forces the stored sessionId to the map key even when the payload disagrees', () => {
      service.addPermissionRequest('s1', makeRequest({ sessionId: 'stale' }))

      expect(service.getPendingPermissionForToolUse('toolu_1', 's1')?.sessionId).toBe('s1')
    })

    it('overwrites an existing request for the same toolUseId', () => {
      service.addPermissionRequest('s1', makeRequest())
      service.addPermissionRequest('s1', makeRequest({ requestId: 'req-2', toolName: 'Write' }))

      const stored = service.getPendingPermissionForToolUse('toolu_1', 's1')
      expect(stored?.requestId).toBe('req-2')
      expect(stored?.toolName).toBe('Write')
      expect(service.getPendingPermissions().get('s1')?.size).toBe(1)
    })

    it('keeps sessions isolated from each other', () => {
      service.addPermissionRequest('s1', makeRequest())
      service.addPermissionRequest('s2', makeRequest({ toolUseId: 'toolu_2', requestId: 'req-2' }))

      expect(service.getPendingPermissionForToolUse('toolu_2', 's1')).toBeUndefined()
      expect(service.getPendingPermissionForToolUse('toolu_1', 's2')).toBeUndefined()
    })

    it('replaces the outer Map so Vue reactivity notifies watchers', () => {
      const before = service.getPendingPermissions()
      service.addPermissionRequest('s1', makeRequest())

      expect(service.getPendingPermissions()).not.toBe(before)
    })
  })

  describe('removePermissionByRequestId', () => {
    it('is a no-op for an unknown session', () => {
      expect(() => service.removePermissionByRequestId('nope', 'req-1')).not.toThrow()
      expect(service.getPendingPermissions().size).toBe(0)
    })

    it('removes the request whose requestId matches (entries are indexed by toolUseId)', () => {
      service.addPermissionRequest('s1', makeRequest())

      service.removePermissionByRequestId('s1', 'req-1')

      expect(service.getPendingPermissionForToolUse('toolu_1', 's1')).toBeUndefined()
    })

    it('drops the session key once its last request is removed', () => {
      service.addPermissionRequest('s1', makeRequest())

      service.removePermissionByRequestId('s1', 'req-1')

      expect(service.getPendingPermissions().has('s1')).toBe(false)
    })

    it('keeps the session and sibling requests when others remain', () => {
      service.addPermissionRequest('s1', makeRequest())
      service.addPermissionRequest('s1', makeRequest({ toolUseId: 'toolu_2', requestId: 'req-2' }))

      service.removePermissionByRequestId('s1', 'req-1')

      expect(service.getPendingPermissionForToolUse('toolu_1', 's1')).toBeUndefined()
      expect(service.getPendingPermissionForToolUse('toolu_2', 's1')).toBeDefined()
      expect(service.getPendingPermissions().has('s1')).toBe(true)
    })

    it('leaves everything untouched when the requestId does not match', () => {
      service.addPermissionRequest('s1', makeRequest())

      service.removePermissionByRequestId('s1', 'req-unknown')

      expect(service.getPendingPermissionForToolUse('toolu_1', 's1')).toBeDefined()
    })
  })

  describe('getPendingPermissionForToolUse', () => {
    it('returns undefined when no sessionId is given', () => {
      service.addPermissionRequest('s1', makeRequest())

      expect(service.getPendingPermissionForToolUse('toolu_1')).toBeUndefined()
      expect(service.getPendingPermissionForToolUse('toolu_1', undefined)).toBeUndefined()
    })

    it('returns undefined for an unknown session or toolUseId', () => {
      service.addPermissionRequest('s1', makeRequest())

      expect(service.getPendingPermissionForToolUse('toolu_1', 's2')).toBeUndefined()
      expect(service.getPendingPermissionForToolUse('toolu_9', 's1')).toBeUndefined()
    })
  })

  describe('findPendingPermissionByToolUse', () => {
    it('finds a request across sessions by the globally-unique toolUseId', () => {
      service.addPermissionRequest('s1', makeRequest())
      service.addPermissionRequest('s2', makeRequest({ toolUseId: 'toolu_2', requestId: 'req-2' }))

      expect(service.findPendingPermissionByToolUse('toolu_2')?.sessionId).toBe('s2')
    })

    it('returns undefined when no session holds the toolUseId', () => {
      service.addPermissionRequest('s1', makeRequest())

      expect(service.findPendingPermissionByToolUse('toolu_9')).toBeUndefined()
    })
  })

  describe('hasPendingPermissionForToolUse', () => {
    it('reports presence only for the matching session', () => {
      service.addPermissionRequest('s1', makeRequest())

      expect(service.hasPendingPermissionForToolUse('toolu_1', 's1')).toBe(true)
      expect(service.hasPendingPermissionForToolUse('toolu_1', 's2')).toBe(false)
      expect(service.hasPendingPermissionForToolUse('toolu_1')).toBe(false)
    })
  })

  describe('consumePermissionFor', () => {
    it('returns the request and removes it in one step', () => {
      service.addPermissionRequest('s1', makeRequest())

      const consumed = service.consumePermissionFor('toolu_1', 's1')

      expect(consumed?.requestId).toBe('req-1')
      expect(service.getPendingPermissionForToolUse('toolu_1', 's1')).toBeUndefined()
    })

    it('returns undefined for an unknown session or toolUseId', () => {
      service.addPermissionRequest('s1', makeRequest())

      expect(service.consumePermissionFor('toolu_1', 's2')).toBeUndefined()
      expect(service.consumePermissionFor('toolu_9', 's1')).toBeUndefined()
      expect(service.getPendingPermissionForToolUse('toolu_1', 's1')).toBeDefined()
    })

    it('drops the session key when the consumed request was the last one', () => {
      service.addPermissionRequest('s1', makeRequest())

      service.consumePermissionFor('toolu_1', 's1')

      expect(service.getPendingPermissions().has('s1')).toBe(false)
    })

    it('keeps the session and sibling requests when others remain', () => {
      service.addPermissionRequest('s1', makeRequest())
      service.addPermissionRequest('s1', makeRequest({ toolUseId: 'toolu_2', requestId: 'req-2' }))

      service.consumePermissionFor('toolu_1', 's1')

      expect(service.getPendingPermissions().get('s1')?.size).toBe(1)
      expect(service.getPendingPermissionForToolUse('toolu_2', 's1')).toBeDefined()
    })
  })

  describe('setPendingPermissions / clear', () => {
    it('replaces the whole map with the given one', () => {
      const restored = new Map([
        ['s9', new Map([['toolu_9', makeRequest({ sessionId: 's9', toolUseId: 'toolu_9' })]])],
      ])

      service.setPendingPermissions(restored)

      // ref() wraps the Map in a reactive proxy, so compare contents not identity
      expect(service.getPendingPermissions().size).toBe(1)
      expect(service.getPendingPermissionForToolUse('toolu_9', 's9')).toMatchObject({
        sessionId: 's9',
        requestId: 'req-1',
      })
    })

    it('clear() empties all sessions', () => {
      service.addPermissionRequest('s1', makeRequest())
      service.addPermissionRequest('s2', makeRequest({ toolUseId: 'toolu_2' }))

      service.clear()

      expect(service.getPendingPermissions().size).toBe(0)
      expect(service.findPendingPermissionByToolUse('toolu_1')).toBeUndefined()
    })
  })
})
