// @vitest-environment node
/**
 * artifactScope 测试 — 产物发现的位置策略。
 *
 * 曾经只有 design / code 扫工作区根（work 走 outputs/ 约定）。但 officecli 技能族
 * （xlsx / docx / pptx 助手）没有 outputs/ 约定，LLM 按用户语义把交付物写在工作
 * 目录任意位置 —— issue #40 问题 4 复测时表格落在了工作目录根，turn 结束收集扫
 * 不到，自动预览从不触发。现在所有模式都扫工作区根（根扫描只收交付物扩展名）。
 */
import { describe, it, expect } from 'vitest'
import { needsWorkspaceRootScan } from '@/utils/artifactScope'

describe('needsWorkspaceRootScan', () => {
  it('scans the workspace root for every mode — officecli skills have no outputs/ convention', () => {
    expect(needsWorkspaceRootScan('work')).toBe(true)
    expect(needsWorkspaceRootScan('design')).toBe(true)
    expect(needsWorkspaceRootScan('code')).toBe(true)
  })

  it('scans the workspace for sessions with no recorded mode', () => {
    // 早期会话没有 mode 字段，回合里写出的交付物同样应该被收集
    expect(needsWorkspaceRootScan(undefined)).toBe(true)
  })
})
