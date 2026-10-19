// @vitest-environment node
/**
 * isPermissionGrantPermanent 的判定边界：只有落盘到 settings 文件的授权
 * 才能在引擎重启后存活；session/cliArg 落点必须判为"非永久"，
 * 否则按钮文案会对会话级授权过度承诺（见模块头注释）。
 */
import { describe, it, expect } from 'vitest'
import { isPermissionGrantPermanent } from '@/utils/permissionScope'
import type { PermissionUpdate, PermissionUpdateDestination } from '@/shared/channels/claudeCode'

function addRules(destination: PermissionUpdateDestination): PermissionUpdate {
  return {
    type: 'addRules',
    destination,
    rules: [{ toolName: 'Bash', ruleContent: 'npm test' }],
    behavior: 'allow',
  }
}

describe('isPermissionGrantPermanent', () => {
  it('returns false for undefined or empty updates — nothing was granted', () => {
    expect(isPermissionGrantPermanent(undefined)).toBe(false)
    expect(isPermissionGrantPermanent([])).toBe(false)
  })

  it('returns true when any update lands in a settings file', () => {
    for (const dest of ['userSettings', 'projectSettings', 'localSettings'] as const) {
      expect(isPermissionGrantPermanent([addRules(dest)]), dest).toBe(true)
    }
  })

  it('returns false for session-only and cliArg updates — gone after restart', () => {
    expect(isPermissionGrantPermanent([addRules('session')])).toBe(false)
    expect(isPermissionGrantPermanent([addRules('cliArg')])).toBe(false)
  })

  it('returns true when a persistable update is mixed with session-only ones', () => {
    expect(isPermissionGrantPermanent([addRules('session'), addRules('localSettings')])).toBe(true)
  })

  it('judges by destination regardless of update variant (setMode / directories)', () => {
    const setModeSession: PermissionUpdate = { type: 'setMode', destination: 'session', mode: 'acceptEdits' }
    const addDirPersisted: PermissionUpdate = { type: 'addDirectories', destination: 'projectSettings', directories: ['/tmp'] }
    expect(isPermissionGrantPermanent([setModeSession])).toBe(false)
    expect(isPermissionGrantPermanent([setModeSession, addDirPersisted])).toBe(true)
  })
})
