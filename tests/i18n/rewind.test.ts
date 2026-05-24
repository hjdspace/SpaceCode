/**
 * Rewind i18n tests - run with:
 *   node --experimental-strip-types --test tests/i18n/rewind.test.ts
 *
 * These tests verify all rewind-related translation keys exist in both zh-CN and en-US.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** All rewind-related translation keys expected in chat namespace */
const REWIND_KEYS = [
  'rewindTitle',
  'rewindSubtitle',
  'rewindSelectMessage',
  'rewindOptionBoth',
  'rewindOptionConversation',
  'rewindOptionCode',
  'rewindOptionSummarize',
  'rewindOptionCancel',
  'rewindOptionBothDesc',
  'rewindOptionConversationDesc',
  'rewindOptionCodeDesc',
  'rewindOptionSummarizeDesc',
  'rewindConfirm',
  'rewindCancel',
  'rewindClose',
  'rewindSummarizePlaceholder',
  'rewindSummarizeLabel',
  'rewindDiffStats',
  'rewindFilesChanged',
  'rewindInsertions',
  'rewindDeletions',
  'rewindInProgress',
  'rewindError',
  'rewindSuccess',
]

function extractChatKeys(filePath: string): Set<string> {
  const content = readFileSync(filePath, 'utf-8')
  const keys = new Set<string>()

  // Match patterns like: keyName: 'value' or keyName: "value"
  const regex = /(\w+):\s*['"`]/g
  let match: RegExpExecArray | null

  // Find the chat object section
  const chatMatch = content.match(/chat:\s*\{/)
  if (!chatMatch) {
    return keys
  }

  // Extract all keys within the chat object (simple approach)
  const lines = content.split('\n')
  let inChat = false
  let braceDepth = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('chat:')) {
      inChat = true
      braceDepth = 0
    }

    if (inChat) {
      // Count braces to track depth
      for (const char of trimmed) {
        if (char === '{') braceDepth++
        if (char === '}') braceDepth--
      }

      // Match key at the start of a line (before colon)
      const keyMatch = trimmed.match(/^(\w+):/)
      if (keyMatch && braceDepth > 0) {
        keys.add(keyMatch[1])
      }

      // Exit chat object when braces close
      if (braceDepth <= 0 && trimmed.includes('}')) {
        inChat = false
      }
    }
  }

  return keys
}

describe('Rewind i18n keys', () => {
  const zhCNPath = resolve(process.cwd(), 'src/i18n/locales/zh-CN.ts')
  const enUSPath = resolve(process.cwd(), 'src/i18n/locales/en-US.ts')

  it('zh-CN should have all rewind keys in chat namespace', () => {
    const chatKeys = extractChatKeys(zhCNPath)

    for (const key of REWIND_KEYS) {
      assert(chatKeys.has(key), `zh-CN chat.${key} should exist`)
    }
  })

  it('en-US should have all rewind keys in chat namespace', () => {
    const chatKeys = extractChatKeys(enUSPath)

    for (const key of REWIND_KEYS) {
      assert(chatKeys.has(key), `en-US chat.${key} should exist`)
    }
  })

  it('should have exactly 24 rewind keys', () => {
    assert.strictEqual(REWIND_KEYS.length, 24)
  })
})
