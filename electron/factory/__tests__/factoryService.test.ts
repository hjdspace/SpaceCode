// @vitest-environment node
/**
 * IPC 编排层：预检阻断时绝不落盘；通过后配置/prompt/.gitignore 一次写齐；
 * token 认证沿用凭据库，不把凭据混进配置。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createFactoryService, type FactoryServiceDeps } from '../factoryService'
import { createFactorySecretStore } from '../secrets'
import type { FactorySetupDraft } from '@/shared/factory'

const draft: FactorySetupDraft = {
  agent: { engineType: 'claude-code', model: 'claude-sonnet-4-5' },
  sandbox: { type: 'worktree' },
  tracker: { type: 'local', mergeMode: 'local' },
  commands: { verify: 'npm run test:changed' },
}

let dir: string

function makeDeps(overrides: Partial<FactoryServiceDeps> = {}): FactoryServiceDeps {
  const secrets = createFactorySecretStore({
    filePath: join(dir, 'userData', 'factory-secrets.json'),
    crypto: {
      isEncryptionAvailable: () => true,
      encryptString: (v) => Buffer.from(`enc:${v}`),
      decryptString: (b) => b.toString().replace(/^enc:/, ''),
    },
  })
  return {
    getRepoInfo: async (root) => ({
      isGitRepo: true,
      root,
      remote: 'git@github.com:hjdspace/SpaceCode.git',
      baseBranch: 'main',
      dirty: false,
      gitVersion: '2.44.0',
    }),
    getEngineAvailability: async () => ({ available: true, reason: 'ok', version: '1.0.0' }),
    getModelProfile: () => ({ configured: true, model: 'claude-sonnet-4-5', provider: 'anthropic' }),
    isConfigWritable: () => true,
    isDockerAvailable: async () => false,
    checkGhAuth: async () => ({ ok: true, reason: 'ok' }),
    verifyToken: async () => ({ ok: true, reason: 'ok', login: 'hjdspace' }),
    verifyScriptMissing: () => false,
    secrets,
    ...overrides,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-service-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('createFactoryService', () => {
  it('reports unconfigured state before init', () => {
    const service = createFactoryService(makeDeps())
    expect(service.getState(dir)).toMatchObject({ configured: false, config: null })
  })

  it('refuses to write when preflight is blocking', async () => {
    const service = createFactoryService(
      makeDeps({
        getRepoInfo: async (root) => ({ isGitRepo: false, root, baseBranch: 'main', dirty: false, gitVersion: null }),
      }),
    )
    const result = await service.save(dir, draft)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('preflight-failed')
    expect(result.preflight?.blocking).toBe(true)
    expect(existsSync(join(dir, '.spacecode/factory/config.json'))).toBe(false)
  })

  it('writes config, prompts and gitignore, then reads them back across restarts', async () => {
    const service = createFactoryService(makeDeps())
    const result = await service.save(dir, draft)
    expect(result.ok).toBe(true)

    const configPath = join(dir, '.spacecode/factory/config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    expect(config.version).toBe(1)
    expect(config.repo).toMatchObject({ root: '.' })
    expect(config.agent).toMatchObject({ maxIterations: 5, maxConcurrency: 4 })

    for (const key of ['plan', 'implement', 'review', 'fix', 'merge-conflict']) {
      expect(existsSync(join(dir, '.spacecode/factory/prompts', `${key}.md`))).toBe(true)
    }
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toContain('.spacecode/worktrees/')

    // 新实例等价于重启：仍能读到已保存配置
    const restarted = createFactoryService(makeDeps())
    expect(restarted.getState(dir).configured).toBe(true)
    expect(restarted.getState(dir).config?.agent.model).toBe('claude-sonnet-4-5')
  })

  it('treats a token tracker without a stored secret as invalid auth', async () => {
    const service = createFactoryService(makeDeps())
    const result = await service.save(dir, {
      ...draft,
      tracker: {
        type: 'github-issues',
        repo: 'hjdspace/SpaceCode',
        label: 'ready-for-agent',
        auth: 'token',
        mergeMode: 'local',
        commentIssue: true,
        closeIssue: true,
      },
    })
    expect(result.ok).toBe(false)
    const authItem = result.preflight?.items.find((i) => i.id === 'trackerAuth')
    expect(authItem?.params?.reason).toBe('invalid-token')
  })

  it('rejects an invalid draft before touching the filesystem', async () => {
    const service = createFactoryService(makeDeps())
    const result = await service.save(dir, { ...draft, commands: { verify: '' } })
    expect(result).toEqual({ ok: false, error: 'invalid-draft' })
    expect(existsSync(join(dir, '.spacecode'))).toBe(false)
  })

  it('exposes context with available engines and encryption state', async () => {
    const service = createFactoryService(makeDeps())
    const context = await service.getContext(dir)
    expect(context.repo.isGitRepo).toBe(true)
    expect(context.engines.map((e) => e.engineType)).toEqual(['claude-code', 'pi'])
    expect(context.encryptionAvailable).toBe(true)
    expect(context.modelProfile.model).toBe('claude-sonnet-4-5')
    expect(context.models).toEqual({ selectable: [], default: 'claude-sonnet-4-5' })
  })

  it('surfaces per-role model options and github repos from injected deps', async () => {
    const service = createFactoryService(
      makeDeps({
        getModelOptions: () => ({
          selectable: ['glm-5.3-flash', 'qwen3.8-max'],
          default: 'qwen3.8-max',
          tiers: { 'glm-5.3-flash': 'haiku', 'qwen3.8-max': 'sonnet' },
        }),
        listRepos: async () => ({
          ok: true,
          repos: [{ repo: 'hjdspace/SpaceCode', name: 'SpaceCode', private: true }],
        }),
      }),
    )
    const context = await service.getContext(dir)
    expect(context.models).toEqual({
      selectable: ['glm-5.3-flash', 'qwen3.8-max'],
      default: 'qwen3.8-max',
      tiers: { 'glm-5.3-flash': 'haiku', 'qwen3.8-max': 'sonnet' },
    })
    await expect(service.githubRepos('gh')).resolves.toEqual({
      ok: true,
      repos: [{ repo: 'hjdspace/SpaceCode', name: 'SpaceCode', private: true }],
    })
  })

  it('reports gh login as unsupported when the dependency is missing', async () => {
    const service = createFactoryService(makeDeps())
    await expect(service.startGhLogin()).resolves.toEqual({ ok: false, reason: 'unsupported' })
  })
})
