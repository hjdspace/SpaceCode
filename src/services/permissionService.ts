import { ref, type Ref } from 'vue'

export interface PermissionRequest {
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

export class PermissionService {
  private pendingPermissions: Ref<Map<string, Map<string, PermissionRequest>>> = ref(new Map())

  addPermissionRequest(sessionId: string, request: PermissionRequest): void {
    const next = new Map(this.pendingPermissions.value)
    let bySession = next.get(sessionId)
    if (!bySession) {
      bySession = new Map()
      next.set(sessionId, bySession)
    }
    bySession.set(request.toolUseId, { ...request, sessionId })
    this.pendingPermissions.value = next
  }

  removePermissionByRequestId(sessionId: string, requestId: string): void {
    const bySession = this.pendingPermissions.value.get(sessionId)
    if (!bySession) return
    // Find by requestId (we index by toolUseId, so we need a scan).
    const nextBySession = new Map(bySession)
    for (const [toolUseId, req] of nextBySession.entries()) {
      if (req.requestId === requestId) {
        nextBySession.delete(toolUseId)
        break
      }
    }
    const next = new Map(this.pendingPermissions.value)
    if (nextBySession.size === 0) {
      next.delete(sessionId)
    } else {
      next.set(sessionId, nextBySession)
    }
    this.pendingPermissions.value = next
  }

  getPendingPermissionForToolUse(toolUseId: string, sessionId?: string): PermissionRequest | undefined {
    if (!sessionId) return undefined
    return this.pendingPermissions.value.get(sessionId)?.get(toolUseId)
  }

  hasPendingPermissionForToolUse(toolUseId: string, sessionId?: string): boolean {
    return !!this.getPendingPermissionForToolUse(toolUseId, sessionId)
  }

  consumePermissionFor(toolUseId: string, sessionId: string): PermissionRequest | undefined {
    const bySession = this.pendingPermissions.value.get(sessionId)
    if (!bySession) return undefined
    const req = bySession.get(toolUseId)
    if (!req) return undefined
    const nextBySession = new Map(bySession)
    nextBySession.delete(toolUseId)
    const next = new Map(this.pendingPermissions.value)
    if (nextBySession.size === 0) {
      next.delete(sessionId)
    } else {
      next.set(sessionId, nextBySession)
    }
    this.pendingPermissions.value = next
    return req
  }

  getPendingPermissions(): Map<string, Map<string, PermissionRequest>> {
    return this.pendingPermissions.value
  }

  setPendingPermissions(map: Map<string, Map<string, PermissionRequest>>): void {
    this.pendingPermissions.value = map
  }

  clear(): void {
    this.pendingPermissions.value = new Map()
  }
}

export const permissionService = new PermissionService()
