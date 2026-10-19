// @vitest-environment node
/**
 * validateNodeName 的判定边界。为什么要在校验阶段就拦：见模块头注释。
 */
import { describe, it, expect } from 'vitest'
import { validateNodeName } from '@/utils/validateNodeName'

const CONTROL = 'a' + String.fromCharCode(7) + 'b'

describe('validateNodeName', () => {
  it('accepts ordinary file and folder names', () => {
    expect(validateNodeName('app.ts')).toBeNull()
    expect(validateNodeName('My Folder')).toBeNull()
    expect(validateNodeName('归档-2026.zip')).toBeNull()
    expect(validateNodeName('.gitignore')).toBeNull()
    expect(validateNodeName('a.b.c.tar.gz')).toBeNull()
  })

  it('leaves an empty name to the caller — clearing the input means cancel', () => {
    expect(validateNodeName('')).toBeNull()
    expect(validateNodeName('   ')).toBeNull()
  })

  it('rejects the characters illegal on windows', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(validateNodeName(bad), bad).toBe('invalidChars')
    }
  })

  it('rejects control characters and a trailing dot', () => {
    expect(validateNodeName(CONTROL)).toBe('invalidChars')
    expect(validateNodeName('readme.')).toBe('invalidChars')
  })

  it('rejects windows device names, including when they carry an extension', () => {
    for (const bad of ['CON', 'con', 'NUL', 'nul.txt', 'COM1', 'lpt9.log', 'AUX']) {
      expect(validateNodeName(bad), bad).toBe('reservedName')
    }
  })

  it('accepts names that merely start with a device name', () => {
    expect(validateNodeName('CONFIG.sys')).toBeNull()
    expect(validateNodeName('console.ts')).toBeNull()
  })

  it('rejects names longer than one filesystem component', () => {
    expect(validateNodeName('a'.repeat(256))).toBe('tooLong')
    expect(validateNodeName('a'.repeat(255))).toBeNull()
  })
})
