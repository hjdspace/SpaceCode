// @vitest-environment node
/**
 * Factory 配置契约：从向导草稿合成配置、严格校验、版本迁移与原子写。
 *
 * 断言的是落盘可复现的产物：相对路径、默认阶段、重复保存可覆盖，
 * 以及未来版本不会被静默接受（否则运行时会读到缺字段的配置）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildFactoryConfig,
  validateFactoryConfig,
  migrateFactoryConfig,
  readFactoryConfig,
  writeFactoryConfigAtomic,
  factoryConfigPath,
  FACTORY_CONFIG_RELATIVE_PATH,
} from '../config'
import type { FactoryConfig, FactorySetupDraft } from '@/shared/factory'

const baseDraft: FactorySetupDraft = {
  agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
  sandbox: { type: 'worktree' },
  tracker: {
    type: 'github-issues',
    repo: 'hjdspace/SpaceCode',
    label: 'ready-for-agent',
    auth: 'gh',
    mergeMode: 'local',
    commentIssue: true,
    closeIssue: true,
  },
  commands: { verify: 'npm run test:changed' },
}

function validConfig(overrides: Partial<FactoryConfig> = {}): FactoryConfig {
  const built = buildFactoryConfig(baseDraft, {
    remote: 'git@github.com:hjdspace/SpaceCode.git',
    baseBranch: 'main',
  })
  if (!built.ok) throw new Error('fixture draft should be valid')
  return { ...built.config, ...overrides }
}

describe('buildFactoryConfig', () => {
  it('fills defaults and keeps every path relative', () => {
    const result = buildFactoryConfig(baseDraft, { remote: 'git@github.com:hjdspace/SpaceCode.git', baseBranch: 'main' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const c = result.config
    expect(c.version).toBe(1)
    expect(c.template).toBe('parallel-planner-with-review')
    expect(c.repo).toEqual({ root: '.', remote: 'git@github.com:hjdspace/SpaceCode.git', baseBranch: 'main' })
    expect(c.agent.maxIterations).toBe(5)
    expect(c.agent.maxConcurrency).toBe(4)
    expect(c.sandbox).toEqual({ type: 'worktree', root: '.spacecode/worktrees' })
    expect(c.commands.verify).toBe('npm run test:changed')
    expect(c.prompts.plan).toBe('.spacecode/factory/prompts/plan.md')
    expect(c.prompts['merge-conflict']).toBe('.spacecode/factory/prompts/merge-conflict.md')
    expect(Object.keys(c.prompts)).toHaveLength(5)
    expect(c.stages.plan.permissionMode).toBe('plan')
    expect(c.stages.implement.enabled).toBe(true)
    expect(c.stages.merge.humanGate).toBe(true)
    expect(c.limits.keepDoneRuns).toBe(20)
  })

  it('applies per-role model overrides from the wizard draft', () => {
    const result = buildFactoryConfig(
      { ...baseDraft, stages: { plan: { model: 'opus' }, review: { model: 'claude-haiku' } } },
      { baseBranch: 'main' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.stages.plan.model).toBe('opus')
    expect(result.config.stages.review.model).toBe('claude-haiku')
    expect(result.config.stages.implement.model).toBeUndefined()
    expect(result.config.stages.verify.model).toBeUndefined()
  })

  it('builds a local tracker without github-only fields', () => {    const result = buildFactoryConfig(
      { ...baseDraft, tracker: { type: 'local', mergeMode: 'local' } },
      { baseBranch: 'main' },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.tracker).toEqual({ type: 'local', backlogPath: '.spacecode/factory/backlog.json', mergeMode: 'local' })
  })

  it('rejects unknown engine, empty verify command and missing github repo', () => {
    const badEngine = buildFactoryConfig(
      { ...baseDraft, agent: { engineType: 'codex' as never } },
      { baseBranch: 'main' },
    )
    expect(badEngine.ok).toBe(false)

    const badVerify = buildFactoryConfig({ ...baseDraft, commands: { verify: '   ' } }, { baseBranch: 'main' })
    expect(badVerify.ok).toBe(false)

    const badRepo = buildFactoryConfig(
      { ...baseDraft, tracker: { type: 'github-issues', repo: '', label: 'x', auth: 'gh', mergeMode: 'local', commentIssue: false, closeIssue: false } },
      { baseBranch: 'main' },
    )
    expect(badRepo.ok).toBe(false)
  })

  it('rejects not-yet-supported sandbox and keeps PR mode available for GitHub', () => {
    expect(buildFactoryConfig({ ...baseDraft, sandbox: { type: 'podman' } }, { baseBranch: 'main' }).ok).toBe(false)
    const pr = buildFactoryConfig(
      { ...baseDraft, tracker: { ...baseDraft.tracker!, mergeMode: 'pr' } },
      { baseBranch: 'main' },
    )
    expect(pr.ok).toBe(true)
    if (!pr.ok) return
    expect(pr.config.tracker).toMatchObject({ type: 'github-issues', mergeMode: 'pr' })
  })
})

describe('validateFactoryConfig', () => {
  it('accepts a built config', () => {
    expect(validateFactoryConfig(validConfig()).ok).toBe(true)
  })

  it('rejects absolute and escaping paths', () => {
    expect(validateFactoryConfig(validConfig({ sandbox: { type: 'worktree', root: '/tmp/wt' as never } })).ok).toBe(false)
    expect(validateFactoryConfig(validConfig({ prompts: { ...validConfig().prompts, plan: '../plan.md' } })).ok).toBe(false)
  })

  it('rejects out-of-range concurrency and unknown versions', () => {
    expect(validateFactoryConfig(validConfig({ agent: { ...validConfig().agent, maxConcurrency: 21 } })).ok).toBe(false)
    expect(validateFactoryConfig({ ...validConfig(), version: 2 as never }).ok).toBe(false)
  })
})

describe('migrateFactoryConfig', () => {
  it('migrates a version-less payload by filling defaults', () => {
    const legacy = { repo: { baseBranch: 'main' }, commands: { verify: 'npm test' } }
    const result = migrateFactoryConfig(legacy)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.version).toBe(1)
    expect(result.config.agent.engineType).toBe('claude-code')
    expect(result.config.sandbox.type).toBe('worktree')
    expect(result.config.tracker.type).toBe('local')
  })

  it('rejects a future version instead of guessing', () => {
    expect(migrateFactoryConfig({ ...validConfig(), version: 9 }).ok).toBe(false)
  })
})

describe('atomic config write', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'factory-config-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates the fixed directory, writes and reads back', () => {
    const config = validConfig()
    const path = writeFactoryConfigAtomic(dir, config)
    expect(path).toBe(join(dir, FACTORY_CONFIG_RELATIVE_PATH))
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(config)
    expect(readFactoryConfig(dir)).toEqual(config)
    expect(factoryConfigPath(dir)).toBe(path)
  })

  it('overwrites on repeated saves without failing because the directory exists', () => {
    mkdirSync(join(dir, '.spacecode', 'factory'), { recursive: true })
    expect(() => writeFactoryConfigAtomic(dir, validConfig())).not.toThrow()
    const updated = validConfig({ commands: { verify: 'npm run build' } })
    expect(() => writeFactoryConfigAtomic(dir, updated)).not.toThrow()
    expect(readFactoryConfig(dir)?.commands.verify).toBe('npm run build')
  })

  it('returns null for missing or corrupt config', () => {
    expect(readFactoryConfig(dir)).toBeNull()
    mkdirSync(join(dir, '.spacecode', 'factory'), { recursive: true })
    writeFileSync(join(dir, FACTORY_CONFIG_RELATIVE_PATH), '{not json')
    expect(readFactoryConfig(dir)).toBeNull()
  })
})
