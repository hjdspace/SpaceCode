// @vitest-environment node
/**
 * 配置保存：乐观并发、阶段权限、模型别名解析与合并闸门二次确认。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildFactoryConfig, readFactoryConfig, writeFactoryConfigAtomic } from '../config'
import { updateFactoryConfig, validateStagePolicies } from '../configUpdate'
import type { FactoryConfig } from '@/shared/factory'

let dir: string

function base(): FactoryConfig {
  const built = buildFactoryConfig(
    {
      agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
      sandbox: { type: 'worktree' },
      tracker: { type: 'local', mergeMode: 'local' },
      commands: { verify: 'npm run test' },
    },
    { baseBranch: 'main' },
  )
  if (!built.ok) throw new Error('fixture config invalid')
  return built.config
}

function clone(config: FactoryConfig): FactoryConfig {
  return JSON.parse(JSON.stringify(config)) as FactoryConfig
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-config-update-'))
  writeFactoryConfigAtomic(dir, base())
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('validateStagePolicies', () => {
  it('rejects an illegal permission combination for the plan stage', () => {
    const config = clone(base())
    config.stages.plan.permissionMode = 'acceptEdits'
    expect(validateStagePolicies(config)).toEqual(['stages.plan.permissionMode'])
  })

  it('does not let the verify stage carry an agent model', () => {
    const config = clone(base())
    config.stages.verify.model = 'claude-opus-4-5'
    expect(validateStagePolicies(config)).toContain('stages.verify.model')
  })

  it('完全信任只开给实现阶段', () => {
    // 其余阶段仍逐次审批：规划要只读、合并要人看，放开自动放行等于把闸门拆了。
    for (const key of ['plan', 'verify', 'review', 'merge'] as const) {
      const config = clone(base())
      config.stages[key].permissionMode = 'bypassPermissions'
      expect(validateStagePolicies(config)).toContain(`stages.${key}.permissionMode`)
    }
  })
})

describe('updateFactoryConfig', () => {
  it('bumps the revision and clamps concurrency to 1..20', () => {
    const config = clone(base())
    config.agent.maxConcurrency = 99
    const result = updateFactoryConfig(dir, { config, expectedRevision: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.revision).toBe(2)
    expect(result.config.agent.maxConcurrency).toBe(20)
    expect(readFactoryConfig(dir)?.revision).toBe(2)
  })

  it('normalizes a fractional or non-finite concurrency into a valid integer', () => {
    const fractional = clone(base())
    fractional.agent.maxConcurrency = 2.6
    const first = updateFactoryConfig(dir, { config: fractional, expectedRevision: 1 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.config.agent.maxConcurrency).toBe(2)

    const broken = clone(base())
    broken.agent.maxConcurrency = Number.NaN
    const second = updateFactoryConfig(dir, { config: broken, expectedRevision: 2 })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.config.agent.maxConcurrency).toBe(1)
  })

  it('refuses to overwrite a newer revision', () => {
    const result = updateFactoryConfig(dir, { config: clone(base()), expectedRevision: 0 })
    expect(result).toEqual({ ok: false, error: 'revision-conflict', current: 1 })
  })

  it('reports invalid permission options without writing', () => {
    const config = clone(base())
    config.stages.review.permissionMode = 'plan'
    const result = updateFactoryConfig(dir, { config, expectedRevision: 1 })
    expect(result).toEqual({
      ok: false,
      error: 'invalid-config',
      errors: ['stages.review.permissionMode'],
    })
    expect(readFactoryConfig(dir)?.revision).toBe(1)
  })

  it('rejects model aliases the engine cannot resolve', () => {
    const config = clone(base())
    config.stages.implement.model = 'unknown-model'
    const result = updateFactoryConfig(dir, { config, expectedRevision: 1 }, {
      resolveModel: (model) => (model === 'unknown-model' ? null : model),
    })
    expect(result).toEqual({
      ok: false,
      error: 'invalid-config',
      errors: ['stages.implement.model'],
    })
  })

  it('requires explicit confirmation before closing the merge gate', () => {
    const config = clone(base())
    config.stages.merge.humanGate = false
    expect(updateFactoryConfig(dir, { config, expectedRevision: 1 })).toEqual({
      ok: false,
      error: 'confirm-required',
    })

    const confirmed = updateFactoryConfig(dir, {
      config,
      expectedRevision: 1,
      confirmGateOff: true,
    })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.config.stages.merge.humanGate).toBe(false)
    expect(confirmed.config.revision).toBe(2)
  })

  it('accepts aliases resolved by the engine', () => {
    const config = clone(base())
    config.stages.plan.model = 'claude-opus-4-5'
    const result = updateFactoryConfig(dir, { config, expectedRevision: 1 }, {
      resolveModel: (model, engineType) => (engineType === 'claude-code' ? 'opus' : model),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.stages.plan.model).toBe('claude-opus-4-5')
  })
})
