/**
 * Tests for the pure control-protocol helpers shared between SessionProcess
 * and any future SDK callers. Run with:
 *
 *   node --experimental-strip-types --test tests/electron/*.test.ts
 *
 * These tests cover:
 *  - Inbound classification (control_request can_use_tool / elicitation /
 *    hook_callback / unknown subtype, control_response success/error,
 *    control_cancel_request, keep_alive, plain SDK messages).
 *  - Outbound builders (permission response, interrupt, set_permission_mode,
 *    set_model, mcp_status, get_context_usage, get_settings, stop_task,
 *    cancel, initialize) match the schemas defined in
 *    engine/src/entrypoints/sdk/controlSchemas.ts.
 *  - JSONL line splitter handles partial fragments and ignores blank lines.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyInboundMessage,
  buildPermissionResponse,
  buildControlResponseSuccess,
  buildControlResponseError,
  buildInterruptRequest,
  buildSetPermissionModeRequest,
  buildSetModelRequest,
  buildMcpStatusRequest,
  buildGetContextUsageRequest,
  buildGetSettingsRequest,
  buildStopTaskRequest,
  buildCancelControlRequest,
  buildInitializeRequest,
  encodeJsonLine,
  takeCompleteLines,
} from '../../electron/controlProtocol.ts'

describe('classifyInboundMessage', () => {
  it('parses can_use_tool with all optional fields', () => {
    const raw = {
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'ls' },
        tool_use_id: 'tu-1',
        agent_id: 'agent-1',
        description: 'List files',
        title: 'Run command',
        display_name: 'Bash: ls',
        blocked_path: '/etc/passwd',
        decision_reason: 'always_ask',
        permission_suggestions: [{ kind: 'allowOnce' }],
      },
    }
    const parsed = classifyInboundMessage(raw)
    assert.equal(parsed.kind, 'can_use_tool')
    if (parsed.kind !== 'can_use_tool') return
    assert.equal(parsed.requestId, 'req-1')
    assert.equal(parsed.toolName, 'Bash')
    assert.deepEqual(parsed.input, { command: 'ls' })
    assert.equal(parsed.toolUseId, 'tu-1')
    assert.equal(parsed.agentId, 'agent-1')
    assert.equal(parsed.description, 'List files')
    assert.equal(parsed.title, 'Run command')
    assert.equal(parsed.displayName, 'Bash: ls')
    assert.equal(parsed.blockedPath, '/etc/passwd')
    assert.equal(parsed.decisionReason, 'always_ask')
    assert.deepEqual(parsed.permissionSuggestions, [{ kind: 'allowOnce' }])
    assert.equal(parsed.raw, raw)
  })

  it('parses can_use_tool with minimum required fields', () => {
    const raw = {
      type: 'control_request',
      request_id: 'req-2',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Read',
        input: {},
        tool_use_id: 'tu-2',
      },
    }
    const parsed = classifyInboundMessage(raw)
    assert.equal(parsed.kind, 'can_use_tool')
    if (parsed.kind !== 'can_use_tool') return
    assert.equal(parsed.toolName, 'Read')
    assert.deepEqual(parsed.input, {})
    assert.equal(parsed.agentId, undefined)
    assert.equal(parsed.description, undefined)
    assert.equal(parsed.permissionSuggestions, undefined)
  })

  it('parses elicitation control_request', () => {
    const raw = {
      type: 'control_request',
      request_id: 'req-3',
      request: {
        subtype: 'elicitation',
        mcp_server_name: 'github',
        message: 'Provide token',
        mode: 'form',
        elicitation_id: 'el-1',
        requested_schema: { type: 'object' },
      },
    }
    const parsed = classifyInboundMessage(raw)
    assert.equal(parsed.kind, 'elicitation')
    if (parsed.kind !== 'elicitation') return
    assert.equal(parsed.mcpServerName, 'github')
    assert.equal(parsed.message, 'Provide token')
    assert.equal(parsed.mode, 'form')
    assert.equal(parsed.elicitationId, 'el-1')
    assert.deepEqual(parsed.requestedSchema, { type: 'object' })
  })

  it('parses hook_callback control_request', () => {
    const raw = {
      type: 'control_request',
      request_id: 'req-hook',
      request: {
        subtype: 'hook_callback',
        callback_id: 'cb-1',
        input: { hook_event_name: 'PreToolUse' },
        tool_use_id: 'tu-x',
      },
    }
    const parsed = classifyInboundMessage(raw)
    assert.equal(parsed.kind, 'hook_callback')
    if (parsed.kind !== 'hook_callback') return
    assert.equal(parsed.callbackId, 'cb-1')
    assert.equal(parsed.toolUseId, 'tu-x')
    assert.deepEqual(parsed.input, { hook_event_name: 'PreToolUse' })
  })

  it('marks unknown control_request subtypes so caller can reply with an error', () => {
    const raw = {
      type: 'control_request',
      request_id: 'req-x',
      request: { subtype: 'definitely_not_real', payload: 1 },
    }
    const parsed = classifyInboundMessage(raw)
    assert.equal(parsed.kind, 'unknown_control_request')
    if (parsed.kind !== 'unknown_control_request') return
    assert.equal(parsed.requestId, 'req-x')
    assert.equal(parsed.subtype, 'definitely_not_real')
  })

  it('parses control_response success', () => {
    const raw = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-7',
        response: { ok: true },
      },
    }
    const parsed = classifyInboundMessage(raw)
    assert.equal(parsed.kind, 'control_response_success')
    if (parsed.kind !== 'control_response_success') return
    assert.equal(parsed.requestId, 'req-7')
    assert.deepEqual(parsed.response, { ok: true })
  })

  it('parses control_response success with no payload', () => {
    const raw = {
      type: 'control_response',
      response: { subtype: 'success', request_id: 'req-8' },
    }
    const parsed = classifyInboundMessage(raw)
    assert.equal(parsed.kind, 'control_response_success')
    if (parsed.kind !== 'control_response_success') return
    assert.equal(parsed.response, undefined)
  })

  it('parses control_response error', () => {
    const raw = {
      type: 'control_response',
      response: { subtype: 'error', request_id: 'req-9', error: 'oops' },
    }
    const parsed = classifyInboundMessage(raw)
    assert.equal(parsed.kind, 'control_response_error')
    if (parsed.kind !== 'control_response_error') return
    assert.equal(parsed.error, 'oops')
  })

  it('parses control_cancel_request', () => {
    const parsed = classifyInboundMessage({
      type: 'control_cancel_request',
      request_id: 'req-cancel',
    })
    assert.equal(parsed.kind, 'control_cancel_request')
    if (parsed.kind !== 'control_cancel_request') return
    assert.equal(parsed.requestId, 'req-cancel')
  })

  it('parses keep_alive', () => {
    const parsed = classifyInboundMessage({ type: 'keep_alive' })
    assert.equal(parsed.kind, 'keep_alive')
  })

  it('passes through plain SDK messages (assistant/user/result/system/tool_use etc.) untouched', () => {
    const cases = [
      { type: 'assistant', message: { content: [] } },
      { type: 'user', message: { content: 'hi' } },
      { type: 'tool_use', id: 'tu-1', name: 'Bash' },
      { type: 'tool_result', tool_use_id: 'tu-1' },
      { type: 'result', cost_usd: 0 },
      { type: 'system', subtype: 'init', session_id: 'sess' },
      { type: 'stream_event', event: { type: 'message_start' } },
    ]
    for (const raw of cases) {
      const parsed = classifyInboundMessage(raw)
      assert.equal(parsed.kind, 'sdk_message', `expected sdk_message for ${raw.type}`)
      assert.equal(parsed.raw, raw)
    }
  })

  it('treats null / non-object inputs as sdk_message instead of throwing', () => {
    assert.equal(classifyInboundMessage(null).kind, 'sdk_message')
    assert.equal(classifyInboundMessage(undefined).kind, 'sdk_message')
    assert.equal(classifyInboundMessage(42 as any).kind, 'sdk_message')
    assert.equal(classifyInboundMessage('hello' as any).kind, 'sdk_message')
  })

  it('coerces missing tool_name / input fields to safe defaults', () => {
    const parsed = classifyInboundMessage({
      type: 'control_request',
      request_id: 'req-empty',
      request: { subtype: 'can_use_tool' },
    })
    assert.equal(parsed.kind, 'can_use_tool')
    if (parsed.kind !== 'can_use_tool') return
    assert.equal(parsed.toolName, '')
    assert.deepEqual(parsed.input, {})
    assert.equal(parsed.toolUseId, '')
  })
})

describe('buildPermissionResponse', () => {
  it('encodes an allow decision with updatedInput', () => {
    const msg = buildPermissionResponse('req-1', {
      behavior: 'allow',
      updatedInput: { command: 'ls' },
    })
    assert.deepEqual(msg, {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: { behavior: 'allow', updatedInput: { command: 'ls' } },
      },
    })
  })

  it('encodes an allow decision carrying updatedPermissions and classification', () => {
    const msg = buildPermissionResponse('req-2', {
      behavior: 'allow',
      updatedInput: { x: 1 },
      updatedPermissions: [{ type: 'addRules' }],
      decisionClassification: 'user_permanent',
    })
    const inner = (msg as any).response.response
    assert.equal(inner.behavior, 'allow')
    assert.deepEqual(inner.updatedPermissions, [{ type: 'addRules' }])
    assert.equal(inner.decisionClassification, 'user_permanent')
  })

  it('encodes a deny decision with optional interrupt flag', () => {
    const msg = buildPermissionResponse('req-3', {
      behavior: 'deny',
      message: 'nope',
      interrupt: true,
      decisionClassification: 'user_reject',
    })
    const inner = (msg as any).response.response
    assert.equal(inner.behavior, 'deny')
    assert.equal(inner.message, 'nope')
    assert.equal(inner.interrupt, true)
    assert.equal(inner.decisionClassification, 'user_reject')
  })
})

describe('buildControlResponseSuccess / Error', () => {
  it('omits the response field when no payload is provided', () => {
    const msg: any = buildControlResponseSuccess('req-1')
    assert.equal(msg.response.subtype, 'success')
    assert.equal(msg.response.request_id, 'req-1')
    assert.equal('response' in msg.response, false)
  })

  it('includes the payload when provided', () => {
    const msg: any = buildControlResponseSuccess('req-2', { ok: true })
    assert.deepEqual(msg.response.response, { ok: true })
  })

  it('encodes errors with the provided message', () => {
    const msg: any = buildControlResponseError('req-3', 'fail')
    assert.equal(msg.response.subtype, 'error')
    assert.equal(msg.response.error, 'fail')
  })
})

describe('control_request builders', () => {
  it('buildInterruptRequest', () => {
    const msg: any = buildInterruptRequest('rid-1')
    assert.equal(msg.type, 'control_request')
    assert.equal(msg.request_id, 'rid-1')
    assert.deepEqual(msg.request, { subtype: 'interrupt' })
  })

  it('buildSetPermissionModeRequest', () => {
    const msg: any = buildSetPermissionModeRequest('plan', 'rid-2')
    assert.deepEqual(msg.request, { subtype: 'set_permission_mode', mode: 'plan' })
  })

  it('buildSetModelRequest with model', () => {
    const msg: any = buildSetModelRequest('claude-sonnet-4', 'rid-3')
    assert.deepEqual(msg.request, { subtype: 'set_model', model: 'claude-sonnet-4' })
  })

  it('buildSetModelRequest without model (clears override)', () => {
    const msg: any = buildSetModelRequest(undefined, 'rid-4')
    assert.deepEqual(msg.request, { subtype: 'set_model' })
  })

  it('buildMcpStatusRequest / buildGetContextUsageRequest / buildGetSettingsRequest', () => {
    assert.deepEqual((buildMcpStatusRequest('a') as any).request, { subtype: 'mcp_status' })
    assert.deepEqual((buildGetContextUsageRequest('b') as any).request, { subtype: 'get_context_usage' })
    assert.deepEqual((buildGetSettingsRequest('c') as any).request, { subtype: 'get_settings' })
  })

  it('buildStopTaskRequest', () => {
    const msg: any = buildStopTaskRequest('task-7', 'rid-5')
    assert.deepEqual(msg.request, { subtype: 'stop_task', task_id: 'task-7' })
  })

  it('buildCancelControlRequest', () => {
    const msg: any = buildCancelControlRequest('rid-6')
    assert.equal(msg.type, 'control_cancel_request')
    assert.equal(msg.request_id, 'rid-6')
  })

  it('buildInitializeRequest copies only provided fields', () => {
    const msg: any = buildInitializeRequest({}, 'rid-7')
    assert.deepEqual(msg.request, { subtype: 'initialize' })

    const msg2: any = buildInitializeRequest(
      {
        sdkMcpServers: ['s1'],
        systemPrompt: 'sp',
        appendSystemPrompt: 'ap',
        promptSuggestions: true,
        agents: { coder: { description: 'd' } },
      },
      'rid-8',
    )
    assert.equal(msg2.request.subtype, 'initialize')
    assert.deepEqual(msg2.request.sdkMcpServers, ['s1'])
    assert.equal(msg2.request.systemPrompt, 'sp')
    assert.equal(msg2.request.appendSystemPrompt, 'ap')
    assert.equal(msg2.request.promptSuggestions, true)
    assert.deepEqual(msg2.request.agents, { coder: { description: 'd' } })
  })
})

describe('encodeJsonLine', () => {
  it('terminates the JSON with a newline', () => {
    const out = encodeJsonLine({ type: 'x' })
    assert.equal(out, '{"type":"x"}\n')
  })

  it('throws on circular references', () => {
    const obj: any = {}
    obj.self = obj
    assert.throws(() => encodeJsonLine(obj))
  })
})

describe('takeCompleteLines', () => {
  it('returns full lines and an empty remainder when buffer ends with newline', () => {
    const { lines, remainder } = takeCompleteLines('{"a":1}\n{"b":2}\n')
    assert.deepEqual(lines, ['{"a":1}', '{"b":2}'])
    assert.equal(remainder, '')
  })

  it('keeps the trailing partial fragment as remainder', () => {
    const { lines, remainder } = takeCompleteLines('{"a":1}\n{"b":2')
    assert.deepEqual(lines, ['{"a":1}'])
    assert.equal(remainder, '{"b":2')
  })

  it('skips blank / whitespace-only lines while keeping non-whitespace fragments as remainder', () => {
    const { lines, remainder } = takeCompleteLines('\n  \n{"a":1}\n')
    assert.deepEqual(lines, ['{"a":1}'])
    assert.equal(remainder, '')

    // When the trailing fragment is whitespace-only, the splitter still
    // returns it as remainder rather than discarding it (the next chunk may
    // continue the line).
    const r2 = takeCompleteLines('{"a":1}\n   ')
    assert.deepEqual(r2.lines, ['{"a":1}'])
    assert.equal(r2.remainder, '   ')
  })

  it('handles buffer with no newline at all', () => {
    const { lines, remainder } = takeCompleteLines('{"partial":')
    assert.deepEqual(lines, [])
    assert.equal(remainder, '{"partial":')
  })

  it('round-trips multiple writes preserving message order', () => {
    let buf = ''
    const collect: string[] = []
    for (const chunk of ['{"a":', '1}\n{"b":2', '}\n{"c":3}\n']) {
      buf += chunk
      const { lines, remainder } = takeCompleteLines(buf)
      buf = remainder
      collect.push(...lines)
    }
    assert.deepEqual(collect, ['{"a":1}', '{"b":2}', '{"c":3}'])
    assert.equal(buf, '')
  })
})
