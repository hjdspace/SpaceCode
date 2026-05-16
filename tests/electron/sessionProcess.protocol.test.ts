/**
 * Behavioral tests for the ControlProtocolHandler — the testable extraction
 * of the control-protocol logic that SessionProcess delegates to. These
 * cover the permission-request lifecycle, control_request/response promise
 * matching, fragmentation handling, and process-exit cleanup.
 *
 * Run with:
 *   node --experimental-strip-types --test tests/electron/*.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ControlProtocolHandler,
  encodeJsonLine,
  buildSetPermissionModeRequest,
} from '../../electron/controlProtocol.ts'

function makeHandler() {
  const written: any[] = []
  const handler = new ControlProtocolHandler(message => {
    written.push(message)
  })
  return { handler, written }
}

describe('ControlProtocolHandler — inbound', () => {
  it('emits permission_request when the engine sends can_use_tool', () => {
    const { handler } = makeHandler()
    const events: any[] = []
    handler.on('permission_request', e => events.push(e))

    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'req-A',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input: { command: 'ls' },
          tool_use_id: 'tu-A',
          agent_id: 'main',
        },
      }),
    )

    assert.equal(events.length, 1)
    assert.equal(events[0].kind, 'can_use_tool')
    assert.equal(events[0].requestId, 'req-A')
    assert.equal(events[0].toolName, 'Bash')
    assert.equal(events[0].agentId, 'main')
    assert.deepEqual(handler.getPendingPermissionRequestIds(), ['req-A'])
  })

  it('forwards plain SDK messages via sdk_message event', () => {
    const { handler } = makeHandler()
    const messages: any[] = []
    handler.on('sdk_message', m => messages.push(m))

    handler.feedStdoutChunk(
      encodeJsonLine({ type: 'system', subtype: 'init', session_id: 'sess-1' }),
    )
    handler.feedStdoutChunk(
      encodeJsonLine({ type: 'assistant', message: { content: [] } }),
    )

    assert.equal(messages.length, 2)
    assert.equal(messages[0].type, 'system')
    assert.equal(messages[1].type, 'assistant')
  })

  it('keep_alive lines do NOT bubble up as sdk_message', () => {
    const { handler } = makeHandler()
    const messages: any[] = []
    handler.on('sdk_message', m => messages.push(m))
    handler.feedStdoutChunk(encodeJsonLine({ type: 'keep_alive' }))
    assert.equal(messages.length, 0)
  })

  it('replies with control_response error to unknown control_request subtypes', () => {
    const { handler, written } = makeHandler()
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'req-?',
        request: { subtype: 'totally_made_up' },
      }),
    )
    assert.equal(written.length, 1)
    assert.equal((written[0] as any).type, 'control_response')
    assert.equal((written[0] as any).response.subtype, 'error')
    assert.equal((written[0] as any).response.request_id, 'req-?')
  })

  it('replies with control_response error to unsolicited hook_callback', () => {
    const { handler, written } = makeHandler()
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'req-hook',
        request: { subtype: 'hook_callback', callback_id: 'cb-1', input: {} },
      }),
    )
    assert.equal(written.length, 1)
    assert.equal((written[0] as any).response.subtype, 'error')
  })

  it('emits parseErrors for malformed lines without crashing', () => {
    const { handler } = makeHandler()
    const messages: any[] = []
    handler.on('sdk_message', m => messages.push(m))
    const { parseErrors } = handler.feedStdoutChunk(
      'not-valid-json\n' + encodeJsonLine({ type: 'assistant' }),
    )
    assert.equal(parseErrors.length, 1)
    assert.match(parseErrors[0].line, /not-valid-json/)
    assert.equal(messages.length, 1)
  })

  it('handles fragmented chunks across multiple feedStdoutChunk calls', () => {
    const { handler } = makeHandler()
    const events: any[] = []
    handler.on('permission_request', e => events.push(e))

    const fullLine = encodeJsonLine({
      type: 'control_request',
      request_id: 'req-frag',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Edit',
        input: {},
        tool_use_id: 'tu-frag',
      },
    })

    handler.feedStdoutChunk(fullLine.slice(0, 10))
    assert.equal(events.length, 0)
    handler.feedStdoutChunk(fullLine.slice(10, 50))
    assert.equal(events.length, 0)
    handler.feedStdoutChunk(fullLine.slice(50))
    assert.equal(events.length, 1)
    assert.equal(events[0].requestId, 'req-frag')
  })
})

describe('ControlProtocolHandler — permission decisions', () => {
  it('respondPermission writes the correct control_response shape', () => {
    const { handler, written } = makeHandler()
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'req-1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input: { command: 'ls' },
          tool_use_id: 'tu-1',
        },
      }),
    )
    handler.respondPermission('req-1', {
      behavior: 'allow',
      updatedInput: { command: 'ls -la' },
    })
    assert.equal(written.length, 1)
    assert.deepEqual(written[0], {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: { behavior: 'allow', updatedInput: { command: 'ls -la' } },
      },
    })
    // Pending list cleared
    assert.deepEqual(handler.getPendingPermissionRequestIds(), [])
  })

  it('allowPermission defaults updatedInput to the original input', () => {
    const { handler, written } = makeHandler()
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'req-2',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Read',
          input: { file_path: '/tmp/x' },
          tool_use_id: 'tu-2',
        },
      }),
    )
    handler.allowPermission('req-2')
    assert.deepEqual((written[0] as any).response.response, {
      behavior: 'allow',
      updatedInput: { file_path: '/tmp/x' },
    })
  })

  it('allowPermission honors decisionClassification', () => {
    const { handler, written } = makeHandler()
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'req-3',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Write',
          input: {},
          tool_use_id: 'tu-3',
        },
      }),
    )
    handler.allowPermission('req-3', undefined, 'user_permanent')
    assert.equal((written[0] as any).response.response.decisionClassification, 'user_permanent')
  })

  it('denyPermission encodes deny + interrupt + user_reject classification', () => {
    const { handler, written } = makeHandler()
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'req-4',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input: {},
          tool_use_id: 'tu-4',
        },
      }),
    )
    handler.denyPermission('req-4', 'no thanks', { interrupt: true })
    assert.deepEqual((written[0] as any).response.response, {
      behavior: 'deny',
      message: 'no thanks',
      interrupt: true,
      decisionClassification: 'user_reject',
    })
  })

  it('respondPermission throws when the request_id is unknown', () => {
    const { handler } = makeHandler()
    assert.throws(
      () => handler.respondPermission('nonexistent', { behavior: 'allow', updatedInput: {} }),
      /No pending permission request/,
    )
  })

  it('engine cancellation drops the pending prompt and emits permission_request_cancelled', () => {
    const { handler } = makeHandler()
    const cancellations: any[] = []
    handler.on('permission_request_cancelled', e => cancellations.push(e))
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'req-cancel',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input: {},
          tool_use_id: 'tu-cancel',
        },
      }),
    )
    assert.deepEqual(handler.getPendingPermissionRequestIds(), ['req-cancel'])
    handler.feedStdoutChunk(
      encodeJsonLine({ type: 'control_cancel_request', request_id: 'req-cancel' }),
    )
    assert.deepEqual(handler.getPendingPermissionRequestIds(), [])
    assert.equal(cancellations.length, 1)
    assert.equal(cancellations[0].requestId, 'req-cancel')
  })
})

describe('ControlProtocolHandler — outbound control_request', () => {
  it('resolves the pending promise on a matching control_response success', async () => {
    const { handler, written } = makeHandler()
    const promise = handler.setPermissionMode('plan', 'fixed-id-1')
    assert.equal(written.length, 1)
    assert.equal((written[0] as any).request_id, 'fixed-id-1')
    assert.equal((written[0] as any).request.subtype, 'set_permission_mode')
    assert.equal((written[0] as any).request.mode, 'plan')

    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_response',
        response: { subtype: 'success', request_id: 'fixed-id-1' },
      }),
    )
    await promise
  })

  it('rejects the pending promise on a matching control_response error', async () => {
    const { handler } = makeHandler()
    const promise = handler.setModel('m', 'fixed-id-2')
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_response',
        response: { subtype: 'error', request_id: 'fixed-id-2', error: 'boom' },
      }),
    )
    await assert.rejects(promise, /boom/)
  })

  it('engine-side cancellation rejects the pending promise', async () => {
    const { handler } = makeHandler()
    const promise = handler.getMcpStatus('fixed-id-3')
    handler.feedStdoutChunk(
      encodeJsonLine({ type: 'control_cancel_request', request_id: 'fixed-id-3' }),
    )
    await assert.rejects(promise, /cancelled/)
  })

  it('rejectAllPending rejects every in-flight outbound request', async () => {
    const { handler } = makeHandler()
    const a = handler.getMcpStatus('fixed-id-a')
    const b = handler.getSettings('fixed-id-b')
    handler.rejectAllPending('process exited')
    await assert.rejects(a, /process exited/)
    await assert.rejects(b, /process exited/)
  })

  it('rejectAllPending fires permission_request_cancelled for every open prompt', () => {
    const { handler } = makeHandler()
    const cancellations: any[] = []
    handler.on('permission_request_cancelled', e => cancellations.push(e))
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'open-1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input: {},
          tool_use_id: 't1',
        },
      }),
    )
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'open-2',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Read',
          input: {},
          tool_use_id: 't2',
        },
      }),
    )
    handler.rejectAllPending('process exited')
    assert.equal(cancellations.length, 2)
    assert.deepEqual(cancellations.map(c => c.requestId).sort(), ['open-1', 'open-2'])
    assert.deepEqual(handler.getPendingPermissionRequestIds(), [])
  })

  it('sendControlRequest times out and sends a cancel when the engine never responds', async () => {
    const { handler, written } = makeHandler()
    // Use a tiny timeout so the test is fast.
    const promise = handler.sendControlRequest(
      buildSetPermissionModeRequest('default', 'fixed-id-timeout') as any,
      25,
    )
    await assert.rejects(promise, /timed out/)
    // After the timeout it should have queued a cancel.
    const cancel = written.find(w => (w as any).type === 'control_cancel_request')
    assert.ok(cancel, 'Expected a control_cancel_request to be sent on timeout')
    assert.equal((cancel as any).request_id, 'fixed-id-timeout')
  })

  it('sendControlRequest rejects synchronously when writeLine throws', async () => {
    const handler = new ControlProtocolHandler(() => {
      throw new Error('stdin closed')
    })
    await assert.rejects(
      handler.sendControlRequest(
        buildSetPermissionModeRequest('default', 'fixed-id-throw') as any,
        50,
      ),
      /stdin closed/,
    )
  })
})

describe('encodeJsonLine round-trip', () => {
  it('producer encodes a message that the handler can parse back', () => {
    const { handler } = makeHandler()
    const messages: any[] = []
    handler.on('sdk_message', m => messages.push(m))
    const line = encodeJsonLine({ type: 'result', cost_usd: 0.01 })
    handler.feedStdoutChunk(line)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].cost_usd, 0.01)
  })
})
