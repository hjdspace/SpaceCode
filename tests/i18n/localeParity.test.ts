/**
 * Locale parity test.
 *
 * Asserts that zh-CN and en-US expose identical key sets at every level of
 * the locale object tree.  This catches spelling drift (e.g.
 * `helpTipNewline` vs `helpTipNewLine`) at build time, not at runtime.
 */
import { describe, it, expect } from 'vitest'

import zhCN from '@/i18n/locales/zh-CN/index'
import enUS from '@/i18n/locales/en-US/index'

/**
 * Recursively collect every leaf-key path in a nested object.
 * Arrays are treated as leaves (their indices are not enumerated).
 *
 * @returns a sorted array of dotted paths, e.g. `'chat.send'`
 */
function leafPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') {
    return [prefix]
  }
  if (Array.isArray(obj)) {
    return [prefix] // arrays are leaves — we don't enumerate indices
  }
  const record = obj as Record<string, unknown>
  const keys = Object.keys(record)
  const out: string[] = []
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key
    out.push(...leafPaths(record[key], path))
  }
  return out
}

describe('Locale parity', () => {
  const zhPaths = new Set(leafPaths(zhCN))
  const enPaths = new Set(leafPaths(enUS))

  it('zh-CN and en-US expose identical key sets', () => {
    const zhOnly = [...zhPaths].filter((p) => !enPaths.has(p)).sort()
    const enOnly = [...enPaths].filter((p) => !zhPaths.has(p)).sort()

    const parts: string[] = []
    if (zhOnly.length) parts.push(`zh-CN only: ${zhOnly.join(', ')}`)
    if (enOnly.length) parts.push(`en-US only: ${enOnly.join(', ')}`)

    expect(parts, parts.join('\n')).toEqual([])
  })
})
