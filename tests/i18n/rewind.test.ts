/**
 * Rewind i18n coverage.
 *
 * Asserts against the real locale objects the app consumes, rather than parsing
 * the locale source text. Checks that both locales carry the full rewind key set
 * as non-empty strings, and that the two key sets agree.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

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
] as const

function chatNamespace(locale: unknown): Record<string, unknown> {
  const chat = (locale as { chat?: unknown } | null | undefined)?.chat
  return chat && typeof chat === 'object' ? (chat as Record<string, unknown>) : {}
}

function assertRewindKeysPresent(name: string, locale: unknown): void {
  const chat = chatNamespace(locale)

  const missing = REWIND_KEYS.filter((key) => !(key in chat))
  assert.deepEqual(
    missing,
    [],
    `${name} is missing rewind keys in the chat namespace: ${missing.join(', ')}`,
  )

  for (const key of REWIND_KEYS) {
    const value = chat[key]
    assert.equal(typeof value, 'string', `${name} chat.${key} should be a string`)
    assert.ok(
      (value as string).trim().length > 0,
      `${name} chat.${key} should not be blank`,
    )
  }
}

function rewindKeysOf(locale: unknown): string[] {
  const chat = chatNamespace(locale)
  return REWIND_KEYS.filter((key) => key in chat).slice().sort()
}

describe('Rewind i18n keys', () => {
  it('zh-CN provides every rewind key as a non-empty string', () => {
    assertRewindKeysPresent('zh-CN', zhCN)
  })

  it('en-US provides every rewind key as a non-empty string', () => {
    assertRewindKeysPresent('en-US', enUS)
  })

  it('zh-CN and en-US expose the same rewind key set', () => {
    assert.deepEqual(
      rewindKeysOf(zhCN),
      rewindKeysOf(enUS),
      'zh-CN and en-US rewind key sets have diverged',
    )
  })
})
