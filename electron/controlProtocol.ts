/**
 * Pure control-protocol helpers shared between SessionProcess and tests.
 *
 * The Claude Code engine (when launched with `--print --input-format stream-json
 * --output-format stream-json --permission-prompt-tool stdio`) speaks a JSONL
 * control protocol on stdio in addition to the regular SDK messages.
 *
 * This module owns the parsing/encoding of those control envelopes so the
 * non-Electron-aware logic can be unit-tested without having to spawn a real
 * subprocess.
 *
 * Reference: engine/src/entrypoints/sdk/controlSchemas.ts
 */

import { randomUUID } from 'crypto'

// ──────────────────────────────────────────────────────────────────────────
// Inbound (stdout from engine)
// ──────────────────────────────────────────────────────────────────────────

export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'bypassPermissions'

export interface CanUseToolRequest {
  kind: 'can_use_tool'
  requestId: string
  toolName: string
  input: Record<string, unknown>
  toolUseId: string
  agentId?: string
  description?: string
  title?: string
  displayName?: string
  blockedPath?: string
  decisionReason?: string
  permissionSuggestions?: unknown[]
  raw: any
}

export interface ElicitationRequest {
  kind: 'elicitation'
  requestId: string
  mcpServerName: string
  message: string
  mode?: 'form' | 'url'
  url?: string
  elicitationId?: string
  requestedSchema?: Record<string, unknown>
  raw: any
}

export interface HookCallbackRequest {
  kind: 'hook_callback'
  requestId: string
  callbackId: string
  input: unknown
  toolUseId?: string
  raw: any
}

export interface UnknownControlRequest {
  kind: 'unknown_control_request'
  requestId: string
  subtype: string
  raw: any
}

export interface ControlResponseSuccess {
  kind: 'control_response_success'
  requestId: string
  response?: Record<string, unknown>
  raw: any
}

export interface ControlResponseError {
  kind: 'control_response_error'
  requestId: string
  error: string
  raw: any
}

export interface ControlCancel {
  kind: 'control_cancel_request'
  requestId: string
  raw: any
}

export interface KeepAlive {
  kind: 'keep_alive'
  raw: any
}

export interface PassThroughMessage {
  kind: 'sdk_message'
  raw: any
}

export type ParsedInbound =
  | CanUseToolRequest
  | ElicitationRequest
  | HookCallbackRequest
  | UnknownControlRequest
  | ControlResponseSuccess
  | ControlResponseError
  | ControlCancel
  | KeepAlive
  | PassThroughMessage

/**
 * Classifies a raw JSON-decoded engine stdout message. Anything that isn't a
 * recognized control envelope is wrapped as `sdk_message` so callers can
 * forward it untouched to their existing SDK-message handler.
 */
export function classifyInboundMessage(msg: any): ParsedInbound {
  if (!msg || typeof msg !== 'object') {
    return { kind: 'sdk_message', raw: msg }
  }

  if (msg.type === 'control_request') {
    const requestId: string =
      typeof msg.request_id === 'string' ? msg.request_id : ''
    const inner = msg.request ?? {}
    const subtype: string =
      typeof inner.subtype === 'string' ? inner.subtype : ''

    switch (subtype) {
      case 'can_use_tool':
        return {
          kind: 'can_use_tool',
          requestId,
          toolName: String(inner.tool_name ?? ''),
          input: (inner.input ?? {}) as Record<string, unknown>,
          toolUseId: String(inner.tool_use_id ?? ''),
          agentId:
            typeof inner.agent_id === 'string' ? inner.agent_id : undefined,
          description:
            typeof inner.description === 'string'
              ? inner.description
              : undefined,
          title: typeof inner.title === 'string' ? inner.title : undefined,
          displayName:
            typeof inner.display_name === 'string'
              ? inner.display_name
              : undefined,
          blockedPath:
            typeof inner.blocked_path === 'string'
              ? inner.blocked_path
              : undefined,
          decisionReason:
            typeof inner.decision_reason === 'string'
              ? inner.decision_reason
              : undefined,
          permissionSuggestions: Array.isArray(inner.permission_suggestions)
            ? inner.permission_suggestions
            : undefined,
          raw: msg,
        }
      case 'elicitation':
        return {
          kind: 'elicitation',
          requestId,
          mcpServerName: String(inner.mcp_server_name ?? ''),
          message: String(inner.message ?? ''),
          mode: inner.mode === 'form' || inner.mode === 'url' ? inner.mode : undefined,
          url: typeof inner.url === 'string' ? inner.url : undefined,
          elicitationId:
            typeof inner.elicitation_id === 'string'
              ? inner.elicitation_id
              : undefined,
          requestedSchema:
            inner.requested_schema && typeof inner.requested_schema === 'object'
              ? (inner.requested_schema as Record<string, unknown>)
              : undefined,
          raw: msg,
        }
      case 'hook_callback':
        return {
          kind: 'hook_callback',
          requestId,
          callbackId: String(inner.callback_id ?? ''),
          input: inner.input,
          toolUseId:
            typeof inner.tool_use_id === 'string'
              ? inner.tool_use_id
              : undefined,
          raw: msg,
        }
      default:
        return {
          kind: 'unknown_control_request',
          requestId,
          subtype,
          raw: msg,
        }
    }
  }

  if (msg.type === 'control_response') {
    const resp = msg.response ?? {}
    const requestId: string =
      typeof resp.request_id === 'string' ? resp.request_id : ''
    if (resp.subtype === 'success') {
      return {
        kind: 'control_response_success',
        requestId,
        response:
          resp.response && typeof resp.response === 'object'
            ? (resp.response as Record<string, unknown>)
            : undefined,
        raw: msg,
      }
    }
    return {
      kind: 'control_response_error',
      requestId,
      error: typeof resp.error === 'string' ? resp.error : 'Unknown error',
      raw: msg,
    }
  }

  if (msg.type === 'control_cancel_request') {
    return {
      kind: 'control_cancel_request',
      requestId: typeof msg.request_id === 'string' ? msg.request_id : '',
      raw: msg,
    }
  }

  if (msg.type === 'keep_alive') {
    return { kind: 'keep_alive', raw: msg }
  }

  return { kind: 'sdk_message', raw: msg }
}

// ──────────────────────────────────────────────────────────────────────────
// Outbound (stdin into engine)
// ──────────────────────────────────────────────────────────────────────────

export interface PermissionAllowDecision {
  behavior: 'allow'
  updatedInput: Record<string, unknown>
  updatedPermissions?: unknown[]
  decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
}

export interface PermissionDenyDecision {
  behavior: 'deny'
  message: string
  interrupt?: boolean
  decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject'
}

export type PermissionDecision =
  | PermissionAllowDecision
  | PermissionDenyDecision

/**
 * Build the JSON object for `control_response` carrying a permission decision.
 *
 * Shape matches PermissionPromptToolResultSchema in
 * engine/src/utils/permissions/PermissionPromptToolResultSchema.ts.
 */
export function buildPermissionResponse(
  requestId: string,
  decision: PermissionDecision,
): Record<string, unknown> {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: { ...decision },
    },
  }
}

export function buildControlResponseSuccess(
  requestId: string,
  payload?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      ...(payload ? { response: payload } : {}),
    },
  }
}

export function buildControlResponseError(
  requestId: string,
  errorMessage: string,
): Record<string, unknown> {
  return {
    type: 'control_response',
    response: {
      subtype: 'error',
      request_id: requestId,
      error: errorMessage,
    },
  }
}

export function buildInterruptRequest(
  requestId: string = randomUUID(),
): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'interrupt' },
  }
}

export function buildSetPermissionModeRequest(
  mode: PermissionMode,
  requestId: string = randomUUID(),
): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'set_permission_mode', mode },
  }
}

export function buildSetModelRequest(
  model: string | undefined,
  requestId: string = randomUUID(),
): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'set_model', ...(model ? { model } : {}) },
  }
}

export function buildMcpStatusRequest(
  requestId: string = randomUUID(),
): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'mcp_status' },
  }
}

export function buildGetContextUsageRequest(
  requestId: string = randomUUID(),
): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'get_context_usage' },
  }
}

export function buildGetSettingsRequest(
  requestId: string = randomUUID(),
): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'get_settings' },
  }
}

export function buildStopTaskRequest(
  taskId: string,
  requestId: string = randomUUID(),
): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'stop_task', task_id: taskId },
  }
}

export function buildCancelControlRequest(
  requestId: string,
): Record<string, unknown> {
  return {
    type: 'control_cancel_request',
    request_id: requestId,
  }
}

export function buildInitializeRequest(
  options: {
    hooks?: Record<string, unknown>
    sdkMcpServers?: string[]
    systemPrompt?: string
    appendSystemPrompt?: string
    agents?: Record<string, unknown>
    promptSuggestions?: boolean
    agentProgressSummaries?: boolean
  } = {},
  requestId: string = randomUUID(),
): Record<string, unknown> {
  const inner: Record<string, unknown> = { subtype: 'initialize' }
  if (options.hooks) inner.hooks = options.hooks
  if (options.sdkMcpServers) inner.sdkMcpServers = options.sdkMcpServers
  if (options.systemPrompt !== undefined) inner.systemPrompt = options.systemPrompt
  if (options.appendSystemPrompt !== undefined) {
    inner.appendSystemPrompt = options.appendSystemPrompt
  }
  if (options.agents) inner.agents = options.agents
  if (options.promptSuggestions !== undefined) {
    inner.promptSuggestions = options.promptSuggestions
  }
  if (options.agentProgressSummaries !== undefined) {
    inner.agentProgressSummaries = options.agentProgressSummaries
  }
  return {
    type: 'control_request',
    request_id: requestId,
    request: inner,
  }
}

/**
 * Encodes a message as a JSONL line (single JSON object terminated by `\n`).
 * Throws if the message cannot be serialized (e.g. circular reference).
 */
export function encodeJsonLine(message: unknown): string {
  return JSON.stringify(message) + '\n'
}

/**
 * Splits a buffer of accumulated stdout chunks into complete JSONL lines.
 * Returns the trailing partial fragment (if any) so the caller can carry it
 * into the next read.
 */
export function takeCompleteLines(buffer: string): {
  lines: string[]
  remainder: string
} {
  const parts = buffer.split('\n')
  const remainder = parts.pop() ?? ''
  return { lines: parts.filter(line => line.trim().length > 0), remainder }
}

// ──────────────────────────────────────────────────────────────────────────
// ControlProtocolHandler
//
// Owns:
//   - the JSONL line buffer for incoming stdout chunks
//   - the in-flight `can_use_tool` permission requests (engine asked, user
//     hasn't answered yet)
//   - the in-flight `control_request` promises we sent to the engine
//
// It is deliberately decoupled from the actual child process: callers pass in
// a `writeLine(message)` callback which is responsible for putting the line
// onto the engine's stdin (or, in tests, into a buffer).
//
// Events emitted (synchronously, in-order):
//   - 'sdk_message'                   → any non-control engine message
//   - 'permission_request'            → engine wants user authorization
//   - 'permission_request_cancelled'  → engine cancelled / process exited
//   - 'elicitation_request'           → MCP elicitation
// ──────────────────────────────────────────────────────────────────────────

import { EventEmitter } from 'events'
import { randomUUID as randomUUIDFn } from 'crypto'

export interface ControlProtocolHandlerEvents {
  sdk_message: (msg: any) => void
  permission_request: (req: CanUseToolRequest) => void
  permission_request_cancelled: (info: { requestId: string; reason?: string }) => void
  elicitation_request: (req: ElicitationRequest) => void
}

type WriteLine = (message: unknown) => void

export class ControlProtocolHandler extends EventEmitter {
  private buffer: string = ''
  private readonly writeLine: WriteLine
  private readonly pendingPermissionRequests: Map<string, CanUseToolRequest> = new Map()
  private readonly pendingControlRequests: Map<
    string,
    {
      subtype: string
      resolve: (response: Record<string, unknown> | undefined) => void
      reject: (err: Error) => void
    }
  > = new Map()

  constructor(writeLine: WriteLine) {
    super()
    this.writeLine = writeLine
  }

  /**
   * Feed a raw stdout chunk in. Complete JSONL lines will be parsed; the
   * trailing partial line (if any) is carried over until the next call.
   * Parse errors are surfaced via the `parse_error` event so callers can log.
   */
  feedStdoutChunk(chunk: string): { parseErrors: { line: string; error: Error }[] } {
    this.buffer += chunk
    const { lines, remainder } = takeCompleteLines(this.buffer)
    this.buffer = remainder
    const parseErrors: { line: string; error: Error }[] = []
    for (const line of lines) {
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch (e) {
        parseErrors.push({ line, error: e instanceof Error ? e : new Error(String(e)) })
        continue
      }
      this.routeInbound(parsed)
    }
    return { parseErrors }
  }

  private routeInbound(msg: any): void {
    const parsed = classifyInboundMessage(msg)
    switch (parsed.kind) {
      case 'can_use_tool':
        this.pendingPermissionRequests.set(parsed.requestId, parsed)
        this.emit('permission_request', parsed)
        return
      case 'elicitation':
        this.emit('elicitation_request', parsed)
        return
      case 'hook_callback':
        // No SDK hook handlers registered on the desktop side — refuse so
        // the engine doesn't hang.
        this.writeLine(buildControlResponseError(parsed.requestId, 'No hook callbacks registered'))
        return
      case 'unknown_control_request':
        this.writeLine(
          buildControlResponseError(parsed.requestId, `Unsupported subtype: ${parsed.subtype}`),
        )
        return
      case 'control_response_success': {
        const pending = this.pendingControlRequests.get(parsed.requestId)
        if (pending) {
          this.pendingControlRequests.delete(parsed.requestId)
          pending.resolve(parsed.response)
        }
        return
      }
      case 'control_response_error': {
        const pending = this.pendingControlRequests.get(parsed.requestId)
        if (pending) {
          this.pendingControlRequests.delete(parsed.requestId)
          pending.reject(new Error(parsed.error))
        }
        return
      }
      case 'control_cancel_request': {
        // Cancel an outbound control_request we sent
        const pending = this.pendingControlRequests.get(parsed.requestId)
        if (pending) {
          this.pendingControlRequests.delete(parsed.requestId)
          pending.reject(new Error('control_request cancelled by engine'))
        }
        // Cancel an inbound permission prompt (engine retracted the question)
        if (this.pendingPermissionRequests.delete(parsed.requestId)) {
          this.emit('permission_request_cancelled', { requestId: parsed.requestId })
        }
        return
      }
      case 'keep_alive':
        return
      case 'sdk_message':
      default:
        this.emit('sdk_message', parsed.raw)
        return
    }
  }

  /**
   * Reply to an open `can_use_tool` request. Throws if the requestId is
   * unknown (caller should treat that as a programming bug).
   */
  respondPermission(requestId: string, decision: PermissionDecision): void {
    if (!this.pendingPermissionRequests.has(requestId)) {
      throw new Error(`No pending permission request with id=${requestId}`)
    }
    this.pendingPermissionRequests.delete(requestId)
    this.writeLine(buildPermissionResponse(requestId, decision))
  }

  /**
   * Helper: allow the in-flight request, defaulting `updatedInput` to the
   * original input if the caller doesn't override it.
   */
  allowPermission(
    requestId: string,
    updatedInput?: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
  ): void {
    const pending = this.pendingPermissionRequests.get(requestId)
    if (!pending) {
      throw new Error(`No pending permission request with id=${requestId}`)
    }
    this.pendingPermissionRequests.delete(requestId)
    this.writeLine(
      buildPermissionResponse(requestId, {
        behavior: 'allow',
        updatedInput: updatedInput ?? pending.input,
        ...(decisionClassification ? { decisionClassification } : {}),
      }),
    )
  }

  denyPermission(
    requestId: string,
    message: string = 'User denied',
    options: { interrupt?: boolean } = {},
  ): void {
    if (!this.pendingPermissionRequests.has(requestId)) {
      throw new Error(`No pending permission request with id=${requestId}`)
    }
    this.pendingPermissionRequests.delete(requestId)
    this.writeLine(
      buildPermissionResponse(requestId, {
        behavior: 'deny',
        message,
        ...(options.interrupt ? { interrupt: true } : {}),
        decisionClassification: 'user_reject',
      }),
    )
  }

  getPendingPermissionRequest(requestId: string): CanUseToolRequest | undefined {
    return this.pendingPermissionRequests.get(requestId)
  }

  getPendingPermissionRequestIds(): string[] {
    return Array.from(this.pendingPermissionRequests.keys())
  }

  /**
   * Send a `control_request` and return a promise that resolves when the
   * matching `control_response` arrives, or rejects on engine error / timeout
   * / process exit. The caller must invoke {@link rejectAllPending} on exit.
   */
  sendControlRequest(
    message: { request_id: string } & Record<string, unknown>,
    timeoutMs: number = 30_000,
  ): Promise<Record<string, unknown> | undefined> {
    return new Promise((resolve, reject) => {
      const requestId = message.request_id
      const subtype = String((message.request as any)?.subtype ?? message.type ?? 'unknown')
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              const pending = this.pendingControlRequests.get(requestId)
              if (pending) {
                this.pendingControlRequests.delete(requestId)
                try {
                  this.writeLine(buildCancelControlRequest(requestId))
                } catch {}
                pending.reject(
                  new Error(`control_request '${pending.subtype}' timed out after ${timeoutMs}ms`),
                )
              }
            }, timeoutMs)
          : null

      this.pendingControlRequests.set(requestId, {
        subtype,
        resolve: resp => {
          if (timer) clearTimeout(timer)
          resolve(resp)
        },
        reject: err => {
          if (timer) clearTimeout(timer)
          reject(err)
        },
      })
      try {
        this.writeLine(message)
      } catch (err) {
        const pending = this.pendingControlRequests.get(requestId)
        if (pending) {
          this.pendingControlRequests.delete(requestId)
          if (timer) clearTimeout(timer)
          pending.reject(err instanceof Error ? err : new Error(String(err)))
        }
      }
    })
  }

  /** Rejects every pending outbound control_request and cancels every open
   * inbound permission prompt. Call from process.on('exit'). */
  rejectAllPending(reason: string): void {
    for (const [requestId, pending] of this.pendingControlRequests.entries()) {
      pending.reject(new Error(`Process exited before control_request '${pending.subtype}' (requestId=${requestId}) responded: ${reason}`))
    }
    this.pendingControlRequests.clear()
    for (const requestId of this.pendingPermissionRequests.keys()) {
      this.emit('permission_request_cancelled', { requestId, reason })
    }
    this.pendingPermissionRequests.clear()
  }

  // Convenience wrappers for the most common control_request subtypes.
  setPermissionMode(mode: PermissionMode, requestId: string = randomUUIDFn()): Promise<void> {
    return this.sendControlRequest(
      buildSetPermissionModeRequest(mode, requestId) as { request_id: string } & Record<
        string,
        unknown
      >,
    ).then(() => undefined)
  }

  setModel(model: string | undefined, requestId: string = randomUUIDFn()): Promise<void> {
    return this.sendControlRequest(
      buildSetModelRequest(model, requestId) as { request_id: string } & Record<string, unknown>,
    ).then(() => undefined)
  }

  interrupt(requestId: string = randomUUIDFn()): void {
    this.writeLine(buildInterruptRequest(requestId))
  }

  getMcpStatus(requestId: string = randomUUIDFn()) {
    return this.sendControlRequest(
      buildMcpStatusRequest(requestId) as { request_id: string } & Record<string, unknown>,
    )
  }

  getContextUsage(requestId: string = randomUUIDFn(), timeoutMs: number = 5_000) {
    return this.sendControlRequest(
      buildGetContextUsageRequest(requestId) as { request_id: string } & Record<string, unknown>,
      timeoutMs,
    )
  }

  getSettings(requestId: string = randomUUIDFn()) {
    return this.sendControlRequest(
      buildGetSettingsRequest(requestId) as { request_id: string } & Record<string, unknown>,
    )
  }

  stopTask(taskId: string, requestId: string = randomUUIDFn()): Promise<void> {
    return this.sendControlRequest(
      buildStopTaskRequest(taskId, requestId) as { request_id: string } & Record<string, unknown>,
    ).then(() => undefined)
  }
}
