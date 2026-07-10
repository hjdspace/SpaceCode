/**
 * Permission — Permission command parsing for IM users
 *
 * Parses user replies to permission requests. Supports:
 * 1. Explicit commands: /allow, /always, /allow-always, /deny + tool name
 * 2. Single-pending quick replies: 1/allow/y/允许, 2/deny/n/拒绝, etc.
 * 3. Callback data format: permit:{requestId}:{yes|always|no}
 */

export type PermissionAction = 'allow' | 'always' | 'deny'

export interface ParsedPermission {
  action: PermissionAction
  requestId?: string
  toolName?: string
}

// Explicit command: /allow <tool>, /always <tool>, /deny <tool>
const EXPLICIT_RE = /^(\/(?:allow|always|allow-always|deny)\s+(\S+))/i

// Callback data: permit:{requestId}:{yes|always|no}
const CALLBACK_RE = /^permit:([a-zA-Z0-9_-]+):(yes|always|no)$/i

// Quick reply mappings (when only one pending permission exists)
const QUICK_ALLOW = new Set(['1', 'allow', 'y', 'yes', '允许', 'ok', '好', '好的', '同意'])
const QUICK_ALWAYS = new Set(['2', 'always', 'always-allow', '永久允许', '永久', '始终允许'])
const QUICK_DENY = new Set(['3', 'deny', 'n', 'no', '拒绝', '不', '不要'])

/**
 * Parse a user message as a permission command.
 * Returns null if the message is not a permission command.
 *
 * @param text The user's message text
 * @param pendingCount Number of currently pending permission requests
 * @param singleRequestId If pendingCount === 1, the requestId of the pending request
 */
export function parsePermissionCommand(
  text: string,
  pendingCount: number,
  singleRequestId?: string
): ParsedPermission | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // 1. Check callback data format
  const callbackMatch = trimmed.match(CALLBACK_RE)
  if (callbackMatch) {
    const [, reqId, action] = callbackMatch
    return {
      action: action === 'yes' ? 'allow' : action === 'no' ? 'deny' : 'always',
      requestId: reqId,
    }
  }

  // 2. Check explicit command
  const explicitMatch = trimmed.match(EXPLICIT_RE)
  if (explicitMatch) {
    const [, , toolName] = explicitMatch
    const cmd = trimmed.split(/\s+/)[0].toLowerCase()
    const action: PermissionAction =
      cmd === '/deny' ? 'deny' : cmd === '/always' || cmd === '/allow-always' ? 'always' : 'allow'
    return { action, toolName }
  }

  // 3. Quick reply (only when exactly one pending permission)
  if (pendingCount === 1 && singleRequestId) {
    const lower = trimmed.toLowerCase()
    if (QUICK_ALLOW.has(lower) || QUICK_ALLOW.has(trimmed)) {
      return { action: 'allow', requestId: singleRequestId }
    }
    if (QUICK_ALWAYS.has(lower) || QUICK_ALWAYS.has(trimmed)) {
      return { action: 'always', requestId: singleRequestId }
    }
    if (QUICK_DENY.has(lower) || QUICK_DENY.has(trimmed)) {
      return { action: 'deny', requestId: singleRequestId }
    }
  }

  return null
}

/**
 * Build callback data string for a permission button.
 * Format: permit:{requestId}:{yes|always|no}
 */
export function buildPermissionCallback(requestId: string, action: PermissionAction): string {
  const suffix = action === 'allow' ? 'yes' : action === 'always' ? 'always' : 'no'
  return `permit:${requestId}:${suffix}`
}
