// @vitest-environment node
/**
 * Tests for the host-side bypass gate.
 *
 * Background: the engine's permission pipeline runs the
 * `requiresUserInteraction()` branch (step 1e) *before* the bypassPermissions
 * branch (step 2a), so ExitPlanMode is still asked even in full-trust mode.
 * The gate below decides that a full-trust session auto-approves it without
 * ever reaching the renderer.
 *
 * The second describe block crosses the real ControlProtocolHandler seam to
 * pin the two invariants the auto-approve reply depends on:
 *  - `updatedInput` must fall back to the ORIGINAL tool input (the engine
 *    treats it as a full replacement), and
 *  - `updatedPermissions` must NOT be sent — a `setMode` update would rewrite
 *    the mode before ExitPlanModeV2Tool.call() runs, making its plan-exit
 *    transaction short-circuit and silently drop the exit-state cleanup.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  EXIT_PLAN_MODE_TOOL_NAME,
  shouldAutoApprovePermission,
} from '../../../electron/session/permissionAutoApprove.ts'
import {
  ControlProtocolHandler,
  encodeJsonLine,
} from '../../../electron/session/controlProtocol.ts'

describe('shouldAutoApprovePermission', () => {
  it('full trust + ExitPlanMode → auto-approve', () => {
    assert.equal(
      shouldAutoApprovePermission('bypassPermissions', EXIT_PLAN_MODE_TOOL_NAME),
      true,
    )
  })

  it('full trust + AskUserQuestion → still prompt (needs real user input)', () => {
    assert.equal(
      shouldAutoApprovePermission('bypassPermissions', 'AskUserQuestion'),
      false,
    )
  })

  it('full trust + ordinary tool → not the gate\u2019s business', () => {
    for (const tool of ['Bash', 'Edit', 'Write', 'Read', 'EnterPlanMode']) {
      assert.equal(shouldAutoApprovePermission('bypassPermissions', tool), false)
    }
  })

  it('every other mode + ExitPlanMode → keep the human approval step', () => {
    for (const mode of ['default', 'plan', 'acceptEdits', 'dontAsk']) {
      assert.equal(shouldAutoApprovePermission(mode, EXIT_PLAN_MODE_TOOL_NAME), false)
    }
  })

  it('unknown / empty modes never auto-approve', () => {
    for (const mode of ['', 'BYPASSPERMISSIONS', 'auto']) {
      assert.equal(shouldAutoApprovePermission(mode, EXIT_PLAN_MODE_TOOL_NAME), false)
    }
  })
})

describe('auto-approve reply shape', () => {
  function makeExitPlanModeRequest() {
    const written: any[] = []
    const handler = new ControlProtocolHandler(message => {
      written.push(message)
    })
    const events: any[] = []
    handler.on('permission_request', e => events.push(e))

    // Mirrors what the engine emits for ExitPlanMode: the plan is injected into
    // the tool input by normalizeToolInput, so the input is not empty.
    const input = { plan: '# Plan\n\n1. do the thing', planFilePath: '/tmp/plan.md' }
    handler.feedStdoutChunk(
      encodeJsonLine({
        type: 'control_request',
        request_id: 'req-exit-plan',
        request: {
          subtype: 'can_use_tool',
          tool_name: EXIT_PLAN_MODE_TOOL_NAME,
          input,
          tool_use_id: 'tu-exit-plan',
        },
      }),
    )
    return { handler, written, events, input }
  }

  it('carries the original tool input and omits updatedPermissions', () => {
    const { handler, written, events, input } = makeExitPlanModeRequest()
    assert.equal(events.length, 1)
    assert.equal(events[0].toolName, EXIT_PLAN_MODE_TOOL_NAME)

    // Exactly what SessionProcess does on the auto-approve path.
    handler.allowPermission('req-exit-plan', undefined, 'user_permanent')

    assert.equal(written.length, 1)
    const response = written[0].response
    assert.equal(response.subtype, 'success')
    assert.equal(response.request_id, 'req-exit-plan')
    assert.equal(response.response.behavior, 'allow')
    assert.equal(response.response.decisionClassification, 'user_permanent')
    // updatedInput omitted by the caller → handler backfills the original input,
    // so the engine's full-replace semantics keep the plan intact.
    assert.deepEqual(response.response.updatedInput, input)
    // A setMode update here would short-circuit the engine's plan-exit
    // transaction — it must never be present.
    assert.equal('updatedPermissions' in response.response, false)
  })

  it('leaves no pending request behind, so a cancelled event cannot double-fire', () => {
    const { handler } = makeExitPlanModeRequest()
    handler.allowPermission('req-exit-plan', undefined, 'user_permanent')
    assert.deepEqual(handler.getPendingPermissionRequestIds(), [])
    assert.equal(handler.getPendingPermissionRequest('req-exit-plan'), undefined)
  })
})
