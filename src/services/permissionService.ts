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
  private pendingPermissions = new Map<string, Map<string, PermissionRequest>>()

  addPermissionRequest(sessionId: string, request: PermissionRequest): void {
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
    // Find by requestId (we index by toolUseId, so we need a scan).
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

  getPendingPermissions(): Map<string, Map<string, PermissionRequest>> {
    return this.pendingPermissions
  }

  setPendingPermissions(map: Map<string, Map<string, PermissionRequest>>): void {
    this.pendingPermissions = map
  }

  clear(): void {
    this.pendingPermissions.clear()
  }
}

export const permissionService = new PermissionService()
