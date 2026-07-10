import { describe, it, expect } from 'vitest'
import { parsePermissionCommand, buildPermissionCallback } from '@electron/im/adapters/common/permission'

describe('Permission', () => {
  it('should parse callback data format', () => {
    const result = parsePermissionCommand('permit:req123:yes', 0)
    expect(result).toEqual({ action: 'allow', requestId: 'req123' })

    const result2 = parsePermissionCommand('permit:req456:always', 0)
    expect(result2).toEqual({ action: 'always', requestId: 'req456' })

    const result3 = parsePermissionCommand('permit:req789:no', 0)
    expect(result3).toEqual({ action: 'deny', requestId: 'req789' })
  })

  it('should parse explicit commands', () => {
    const result = parsePermissionCommand('/allow Bash', 0)
    expect(result).toEqual({ action: 'allow', toolName: 'Bash' })

    const result2 = parsePermissionCommand('/always Write', 0)
    expect(result2).toEqual({ action: 'always', toolName: 'Write' })

    const result3 = parsePermissionCommand('/deny rm', 0)
    expect(result3).toEqual({ action: 'deny', toolName: 'rm' })
  })

  it('should parse quick reply when single pending', () => {
    const result = parsePermissionCommand('1', 1, 'req123')
    expect(result).toEqual({ action: 'allow', requestId: 'req123' })

    const result2 = parsePermissionCommand('允许', 1, 'req123')
    expect(result2).toEqual({ action: 'allow', requestId: 'req123' })

    const result3 = parsePermissionCommand('2', 1, 'req123')
    expect(result3).toEqual({ action: 'always', requestId: 'req123' })

    const result4 = parsePermissionCommand('3', 1, 'req123')
    expect(result4).toEqual({ action: 'deny', requestId: 'req123' })
  })

  it('should not parse quick reply when multiple pending', () => {
    const result = parsePermissionCommand('1', 2)
    expect(result).toBeNull()
  })

  it('should return null for non-permission messages', () => {
    expect(parsePermissionCommand('hello world', 0)).toBeNull()
    expect(parsePermissionCommand('', 0)).toBeNull()
  })

  it('should handle multiple pending with explicit commands', () => {
    const result = parsePermissionCommand('/allow Bash', 2)
    expect(result).toEqual({ action: 'allow', toolName: 'Bash' })
  })

  it('buildPermissionCallback should generate correct format', () => {
    expect(buildPermissionCallback('req123', 'allow')).toBe('permit:req123:yes')
    expect(buildPermissionCallback('req123', 'always')).toBe('permit:req123:always')
    expect(buildPermissionCallback('req123', 'deny')).toBe('permit:req123:no')
  })
})
