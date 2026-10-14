// @vitest-environment node
/**
 * artifactScope 测试 — 产物发现的位置策略。
 *
 * work 助手约定把交付物写进 `<工作目录>/outputs/`；design / code 会话的 agent
 * 直接写在工作区里。判断写成一处，避免各调用点各猜一遍"这个模式算不算有产物"。
 */
import { describe, it, expect } from 'vitest'
import { needsWorkspaceRootScan } from '@/utils/artifactScope'

describe('needsWorkspaceRootScan', () => {
  it('keeps work sessions on the outputs/ convention', () => {
    expect(needsWorkspaceRootScan('work')).toBe(false)
  })

  it('scans the workspace for design and code sessions', () => {
    expect(needsWorkspaceRootScan('design')).toBe(true)
    expect(needsWorkspaceRootScan('code')).toBe(true)
  })

  it('scans the workspace for sessions with no recorded mode', () => {
    // 早期会话没有 mode 字段，回合里写出的交付物同样应该被收集
    expect(needsWorkspaceRootScan(undefined)).toBe(true)
  })
})

