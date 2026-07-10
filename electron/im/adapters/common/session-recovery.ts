/**
 * SessionRecovery — 6-step session recovery algorithm
 *
 * On adapter startup or new message arrival, restores the WS connection
 * to a previously active session. Uses dependency injection (Pick types)
 * for testability.
 *
 * Algorithm:
 * 1. sessionStore.get(chatId) → stored binding
 *    If empty and bridge has old session → resetStaleBridge + clearTransientState → return null
 * 2. If bridge.sessionId !== stored.sessionId → resetSession + clearTransientState
 * 3. If bridge is already OPEN for this sessionId → reuse, skip HTTP check
 * 4. httpClient.sessionExists(stored.sessionId) → GET /api/sessions/:id
 *    404 → delete store + resetStaleBridge + clearTransientState → return null
 * 5. bridge.connectSession(sessionId, workDir)
 * 6. Return binding
 */

import type { SessionBinding } from './types'

// ──────────────────────────────────────────────────────────────────────────
// Dependency injection interfaces (Pick types for testability)
// ──────────────────────────────────────────────────────────────────────────

export interface RecoverySessionStore {
  get(chatId: string): SessionBinding | null
  delete(chatId: string): void
}

export interface RecoveryBridge {
  sessionId: string | null
  isConnected: boolean
  connectSession(sessionId: string, workDir: string): Promise<void>
  resetSession(): void
}

export interface RecoveryHttpClient {
  sessionExists(sessionId: string): Promise<boolean>
}

export interface SessionRecoveryDeps {
  store: RecoverySessionStore
  bridge: RecoveryBridge
  httpClient: RecoveryHttpClient
}

export class SessionRecovery {
  constructor(private deps: SessionRecoveryDeps) {}

  /**
   * Attempt to recover a session for the given chatId.
   * Returns the session binding if recovery succeeds, null otherwise.
   */
  async recover(chatId: string): Promise<SessionBinding | null> {
    const { store, bridge, httpClient } = this.deps

    // Step 1: Look up stored binding
    const stored = store.get(chatId)

    if (!stored) {
      // No stored binding — if bridge has an old session, reset it
      if (bridge.sessionId) {
        bridge.resetSession()
      }
      return null
    }

    // Step 2: If bridge has a different session, reset it
    if (bridge.sessionId && bridge.sessionId !== stored.sessionId) {
      bridge.resetSession()
    }

    // Step 3: If bridge is already OPEN for this session, reuse it
    if (bridge.isConnected && bridge.sessionId === stored.sessionId) {
      return stored
    }

    // Step 4: Check if session still exists on the server
    let exists: boolean
    try {
      exists = await httpClient.sessionExists(stored.sessionId)
    } catch {
      // Network error — assume session exists, try to connect
      exists = true
    }

    if (!exists) {
      // Session is dead — clean up
      store.delete(chatId)
      bridge.resetSession()
      return null
    }

    // Step 5: Connect to the session
    try {
      await bridge.connectSession(stored.sessionId, stored.workDir)
    } catch {
      // Connection failed — clean up
      store.delete(chatId)
      return null
    }

    // Step 6: Return the binding
    return stored
  }
}
