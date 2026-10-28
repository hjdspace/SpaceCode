// @vitest-environment node
/**
 * 预检矩阵：每条阻断路径都必须被单独钉住，否则向导的「完成」按钮
 * 可能在一个实际不可跑的配置上被点亮。
 */
import { describe, it, expect } from 'vitest'
import { runFactoryPreflight, type FactoryPreflightInput } from '../preflight'
import { buildFactoryConfig } from '../config'
import type { FactoryConfig, FactorySetupDraft } from '@/shared/factory'

const draft: FactorySetupDraft = {
  agent: { engineType: 'claude-code' },
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

function config(overrides: Partial<FactorySetupDraft> = {}): FactoryConfig {
  const built = buildFactoryConfig({ ...draft, ...overrides }, { baseBranch: 'main', remote: 'origin' })
  if (!built.ok) throw new Error(JSON.stringify(built.errors))
  return built.config
}

function input(overrides: Partial<FactoryPreflightInput> = {}): FactoryPreflightInput {
  return {
    repo: {
      isGitRepo: true,
      root: '/repo',
      baseBranch: 'main',
      dirty: false,
      gitVersion: '2.44.0',
    },
    configWritable: true,
    engineAvailable: true,
    modelProfileConfigured: true,
    githubAuth: { ok: true, reason: 'ok', login: 'hjdspace' },
    dockerAvailable: false,
    ...overrides,
  }
}

function item(result: ReturnType<typeof runFactoryPreflight>, id: string) {
  return result.items.find((i) => i.id === id)
}

describe('runFactoryPreflight', () => {
  it('passes a healthy worktree + gh configuration', () => {
    const result = runFactoryPreflight(config(), input())
    expect(result.blocking).toBe(false)
    expect(item(result, 'gitRepo')?.level).toBe('ok')
    expect(item(result, 'engine')?.level).toBe('ok')
    expect(item(result, 'trackerAuth')?.level).toBe('ok')
    expect(item(result, 'sandbox')?.level).toBe('ok')
  })

  it('blocks when the folder is not a git repository or git is too old', () => {
    expect(runFactoryPreflight(config(), input({ repo: { ...input().repo, isGitRepo: false } })).blocking).toBe(true)
    expect(runFactoryPreflight(config(), input({ repo: { ...input().repo, gitVersion: '2.30.0' } })).blocking).toBe(true)
    expect(runFactoryPreflight(config(), input({ repo: { ...input().repo, gitVersion: null } })).blocking).toBe(true)
  })

  it('warns but does not block on a dirty workspace', () => {
    const result = runFactoryPreflight(config(), input({ repo: { ...input().repo, dirty: true } }))
    expect(item(result, 'gitDirty')?.level).toBe('warn')
    expect(result.blocking).toBe(false)
  })

  it('blocks on unwritable config dir, unavailable engine or empty verify command', () => {
    expect(runFactoryPreflight(config(), input({ configWritable: false })).blocking).toBe(true)
    expect(runFactoryPreflight(config(), input({ engineAvailable: false })).blocking).toBe(true)
    expect(
      runFactoryPreflight(
        { ...config(), commands: { verify: ' ' } },
        input(),
      ).blocking,
    ).toBe(true)
  })

  it('warns when the desktop model profile is missing or the npm script does not exist', () => {
    const noProfile = runFactoryPreflight(config(), input({ modelProfileConfigured: false }))
    expect(item(noProfile, 'modelProfile')?.level).toBe('warn')
    expect(noProfile.blocking).toBe(false)

    const missingScript = runFactoryPreflight(config(), input({ verifyScriptMissing: true }))
    expect(item(missingScript, 'verifyCommand')?.level).toBe('warn')
    expect(missingScript.blocking).toBe(false)
  })

  it('blocks github tracker without valid auth, and reports the reason', () => {
    const ghBad = runFactoryPreflight(config(), input({ githubAuth: { ok: false, reason: 'gh-not-logged-in' } }))
    expect(item(ghBad, 'trackerAuth')?.level).toBe('error')
    expect(item(ghBad, 'trackerAuth')?.params?.reason).toBe('gh-not-logged-in')
    expect(ghBad.blocking).toBe(true)

    const tokenBad = runFactoryPreflight(
      config({ tracker: { ...draft.tracker, auth: 'token' } }),
      input({ githubAuth: { ok: false, reason: 'invalid-token' } }),
    )
    expect(item(tokenBad, 'trackerAuth')?.params?.reason).toBe('invalid-token')
  })

  it('warns when the configured label is absent', () => {
    const result = runFactoryPreflight(
      config(),
      input({ githubAuth: { ok: true, reason: 'ok', labelCount: 0 } }),
    )
    expect(item(result, 'trackerLabel')?.level).toBe('warn')
    expect(result.blocking).toBe(false)
  })

  it('local tracker needs no auth and blocks unsupported sandboxes', () => {
    const local = runFactoryPreflight(config({ tracker: { type: 'local' } }), input({ githubAuth: null }))
    expect(item(local, 'trackerAuth')?.level).toBe('ok')
    expect(local.blocking).toBe(false)

    const docker = runFactoryPreflight(config({ sandbox: { type: 'docker', imageName: 'img' } }), input({ dockerAvailable: false }))
    expect(item(docker, 'sandbox')?.level).toBe('error')
    expect(docker.blocking).toBe(true)

    const dockerOk = runFactoryPreflight(config({ sandbox: { type: 'docker', imageName: 'img' } }), input({ dockerAvailable: true }))
    expect(item(dockerOk, 'sandbox')?.level).toBe('warn')
    expect(dockerOk.blocking).toBe(false)
  })

  it('blocks docker when the image, mounts or proxy are not usable', () => {
    const docker = config({ sandbox: { type: 'docker', imageName: 'img' } })

    const badImage = runFactoryPreflight(
      docker,
      input({
        dockerAvailable: true,
        dockerImageOk: false,
        dockerImageDetail: 'npm ERR! build failed',
        dockerMountable: true,
        dockerProxyOk: true,
      }),
    )
    expect(item(badImage, 'dockerImage')).toMatchObject({ level: 'error' })
    expect(item(badImage, 'dockerImage')?.params).toMatchObject({ detail: 'npm ERR! build failed' })
    expect(badImage.blocking).toBe(true)

    const badMount = runFactoryPreflight(
      docker,
      input({ dockerAvailable: true, dockerImageOk: true, dockerMountable: false, dockerProxyOk: true }),
    )
    expect(item(badMount, 'dockerMount')?.level).toBe('error')
    expect(badMount.blocking).toBe(true)

    const badProxy = runFactoryPreflight(
      docker,
      input({ dockerAvailable: true, dockerImageOk: true, dockerMountable: true, dockerProxyOk: false }),
    )
    expect(item(badProxy, 'dockerProxy')).toMatchObject({ level: 'error', params: { reason: 'unreachable' } })
    expect(badProxy.blocking).toBe(true)

    const healthy = runFactoryPreflight(
      docker,
      input({ dockerAvailable: true, dockerImageOk: true, dockerMountable: true, dockerProxyOk: true }),
    )
    expect(healthy.blocking).toBe(false)
    expect(item(healthy, 'dockerImage')?.level).toBe('ok')
    expect(item(healthy, 'dockerMount')?.level).toBe('ok')
    expect(item(healthy, 'dockerProxy')?.level).toBe('ok')
  })
})
