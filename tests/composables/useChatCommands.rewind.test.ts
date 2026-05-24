/**
 * useChatCommands rewind command tests - run with:
 *   node --experimental-strip-types --test tests/composables/useChatCommands.rewind.test.ts
 *
 * These tests verify the /rewind and /checkpoint command detection and execution.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Types (mirroring src/composables/useChatCommands.ts) ───────────

interface UseChatCommandsOptions {
  sessionId: string
  messages: Array<{ id: string; role: string; content: string }>
  workingDirectory?: string
  onClearMessages?: () => void
  onOpenTerminal?: (command?: string) => void
  onOpenSettings?: () => void
  onOpenSkills?: () => void
  onOpenMcp?: () => void
  onOpenRewind?: () => void
}

// ── Mock Command Registry ──────────────────────────────────────────

function findCommand(command: string): { name: string; immediate: boolean; kind: string; description: string } | undefined {
  const commands: Record<string, { name: string; immediate: boolean; kind: string; description: string }> = {
    help: { name: 'help', immediate: true, kind: 'immediate', description: 'Show help' },
    clear: { name: 'clear', immediate: true, kind: 'immediate', description: 'Clear chat' },
    rewind: { name: 'rewind', immediate: true, kind: 'immediate', description: 'Rewind to a message' },
    checkpoint: { name: 'checkpoint', immediate: true, kind: 'immediate', description: 'Alias for rewind' },
  }
  return commands[command.toLowerCase()]
}

// ── Command Logic (extracted from useChatCommands.ts) ──────────────

function executeImmediateCommand(command: string, options: UseChatCommandsOptions): string | null {
  switch (command.toLowerCase()) {
    case 'help':
      return 'Help message'

    case 'clear':
    case 'reset':
    case 'new':
      options.onClearMessages?.()
      return 'Conversation cleared. Start a new chat!'

    case 'rewind':
    case 'checkpoint':
      options.onOpenRewind?.()
      return null

    default:
      return null
  }
}

function resolveSlashCommand(content: string, options: UseChatCommandsOptions): { type: string; content?: string | null } {
  if (!content.startsWith('/')) {
    return { type: 'unknown' }
  }

  const parts = content.slice(1).split(/\s+/, 2)
  const commandName = parts[0]

  const cmd = findCommand(commandName)

  if (!cmd) {
    return { type: 'unknown' }
  }

  if (cmd.immediate || cmd.kind === 'immediate') {
    const result = executeImmediateCommand(commandName, options)
    return {
      type: 'immediate',
      content: result ?? `Executed /${commandName}`,
    }
  }

  return { type: 'unknown' }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('useChatCommands - Rewind Command Detection', () => {
  let options: UseChatCommandsOptions
  let rewindCalled: boolean

  beforeEach(() => {
    rewindCalled = false
    options = {
      sessionId: 'session-1',
      messages: [],
      onOpenRewind: () => {
        rewindCalled = true
      },
    }
  })

  it('should detect /rewind command', () => {
    const result = executeImmediateCommand('rewind', options)
    assert.strictEqual(rewindCalled, true)
    assert.strictEqual(result, null)
  })

  it('should detect /checkpoint alias', () => {
    const result = executeImmediateCommand('checkpoint', options)
    assert.strictEqual(rewindCalled, true)
    assert.strictEqual(result, null)
  })

  it('should be case insensitive for rewind', () => {
    const result1 = executeImmediateCommand('REWIND', options)
    assert.strictEqual(rewindCalled, true)
    assert.strictEqual(result1, null)

    rewindCalled = false
    const result2 = executeImmediateCommand('Rewind', options)
    assert.strictEqual(rewindCalled, true)
    assert.strictEqual(result2, null)
  })

  it('should be case insensitive for checkpoint', () => {
    const result1 = executeImmediateCommand('CHECKPOINT', options)
    assert.strictEqual(rewindCalled, true)
    assert.strictEqual(result1, null)

    rewindCalled = false
    const result2 = executeImmediateCommand('Checkpoint', options)
    assert.strictEqual(rewindCalled, true)
    assert.strictEqual(result2, null)
  })

  it('should call onOpenRewind callback when executing rewind', () => {
    let callbackInvoked = false
    const opts: UseChatCommandsOptions = {
      sessionId: 'session-1',
      messages: [],
      onOpenRewind: () => {
        callbackInvoked = true
      },
    }

    executeImmediateCommand('rewind', opts)
    assert.strictEqual(callbackInvoked, true)
  })

  it('should call onOpenRewind callback when executing checkpoint', () => {
    let callbackInvoked = false
    const opts: UseChatCommandsOptions = {
      sessionId: 'session-1',
      messages: [],
      onOpenRewind: () => {
        callbackInvoked = true
      },
    }

    executeImmediateCommand('checkpoint', opts)
    assert.strictEqual(callbackInvoked, true)
  })

  it('should return null to prevent message sending for rewind', () => {
    const result = executeImmediateCommand('rewind', options)
    assert.strictEqual(result, null)
  })

  it('should return null to prevent message sending for checkpoint', () => {
    const result = executeImmediateCommand('checkpoint', options)
    assert.strictEqual(result, null)
  })

  it('should not call onOpenRewind if callback is not provided', () => {
    const opts: UseChatCommandsOptions = {
      sessionId: 'session-1',
      messages: [],
    }

    // Should not throw
    assert.doesNotThrow(() => {
      executeImmediateCommand('rewind', opts)
    })
  })
})

describe('useChatCommands - Rewind via resolveSlashCommand', () => {
  it('should resolve /rewind as immediate command', () => {
    let rewindCalled = false
    const options: UseChatCommandsOptions = {
      sessionId: 'session-1',
      messages: [],
      onOpenRewind: () => {
        rewindCalled = true
      },
    }

    const result = resolveSlashCommand('/rewind', options)
    assert.strictEqual(result.type, 'immediate')
    assert.strictEqual(rewindCalled, true)
  })

  it('should resolve /checkpoint as immediate command', () => {
    let checkpointCalled = false
    const options: UseChatCommandsOptions = {
      sessionId: 'session-1',
      messages: [],
      onOpenRewind: () => {
        checkpointCalled = true
      },
    }

    const result = resolveSlashCommand('/checkpoint', options)
    assert.strictEqual(result.type, 'immediate')
    assert.strictEqual(checkpointCalled, true)
  })

  it('should resolve /rewind with arguments as immediate command', () => {
    let rewindCalled = false
    const options: UseChatCommandsOptions = {
      sessionId: 'session-1',
      messages: [],
      onOpenRewind: () => {
        rewindCalled = true
      },
    }

    const result = resolveSlashCommand('/rewind msg-123', options)
    assert.strictEqual(result.type, 'immediate')
    assert.strictEqual(rewindCalled, true)
  })
})

describe('useChatCommands - Options Interface', () => {
  it('should accept onOpenRewind in options', () => {
    const options: UseChatCommandsOptions = {
      sessionId: 'session-1',
      messages: [],
      onOpenRewind: () => {},
    }

    assert.strictEqual(typeof options.onOpenRewind, 'function')
  })

  it('should work without onOpenRewind callback', () => {
    const options: UseChatCommandsOptions = {
      sessionId: 'session-1',
      messages: [],
    }

    assert.strictEqual(options.onOpenRewind, undefined)
  })
})
