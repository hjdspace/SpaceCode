/**
 * 向导逐步校验：引擎未选 / 仓库不是 Git / 验证命令为空等必须能挡住「下一步」。
 * 这些判定与组件解耦，直接对 store 依赖的纯函数断言。
 */
import { describe, it, expect } from 'vitest'
import {
  canAdvance,
  canJumpToStep,
  defaultDraft,
  draftFromConfig,
  setupStepErrors,
  type FactorySetupContextLike,
} from '../setup'
import { buildFactoryConfig } from '@electron/factory/config'

function context(overrides: Partial<FactorySetupContextLike> = {}): FactorySetupContextLike {
  return {
    repo: { isGitRepo: true, root: '/repo', baseBranch: 'main', dirty: false, gitVersion: '2.44.0' },
    engines: [
      { engineType: 'claude-code', available: true, reason: 'ok', version: null, exposed: true },
      { engineType: 'pi', available: false, reason: 'not-found', version: null, exposed: true },
    ],
    modelProfile: { configured: true, model: 'claude-sonnet-4-5' },
    models: { selectable: ['claude-sonnet-4-5'], default: 'claude-sonnet-4-5' },
    dockerAvailable: false,
    encryptionAvailable: true,
    ghLoggedIn: false,
    existingConfig: null,
    ...overrides,
  }
}

describe('defaultDraft', () => {
  it('starts on claude-code + worktree and prefers github when an origin exists', () => {
    const draft = defaultDraft(context({ repo: { ...context().repo, remote: 'git@github.com:a/b.git' } }))
    expect(draft.agent).toEqual({ engineType: 'claude-code' })
    expect(draft.sandbox).toEqual({ type: 'worktree' })
    expect(draft.tracker).toMatchObject({ type: 'github-issues', repo: 'a/b', auth: 'gh', mergeMode: 'local' })
    expect(draft.commands?.verify).toBe('npm run test:changed')
  })

  it('falls back to local backlog without an origin', () => {
    expect(defaultDraft(context()).tracker).toEqual({ type: 'local', mergeMode: 'local' })
  })
})

describe('setupStepErrors', () => {
  it('step 1 requires an available engine', () => {
    const draft = defaultDraft(context())
    expect(setupStepErrors(1, draft, context())).toEqual([])
    expect(setupStepErrors(1, { ...draft, agent: {} }, context())).toContain('engineRequired')

    const pi = { ...draft, agent: { engineType: 'pi' as const } }
    expect(setupStepErrors(1, pi, context())).toContain('engineUnavailable')
  })

  it('step 2 requires a git repository and gates docker behind availability', () => {
    const draft = defaultDraft(context())
    expect(setupStepErrors(2, draft, context())).toEqual([])
    expect(setupStepErrors(2, draft, context({ repo: { ...context().repo, isGitRepo: false } }))).toContain('notGitRepo')

    const docker = { ...draft, sandbox: { type: 'docker' as const } }
    expect(setupStepErrors(2, docker, context({ dockerAvailable: true }))).toContain('sandboxImageRequired')
    expect(
      setupStepErrors(2, { ...docker, sandbox: { type: 'docker', imageName: 'spacecode-factory:latest' } }, context()),
    ).toContain('dockerUnavailable')
    expect(
      setupStepErrors(
        2,
        { ...docker, sandbox: { type: 'docker', imageName: 'spacecode-factory:latest' } },
        context({ dockerAvailable: true }),
      ),
    ).toEqual([])

    const podman = { ...draft, sandbox: { type: 'podman' as const, imageName: 'x' } }
    expect(setupStepErrors(2, podman, context({ dockerAvailable: true }))).toContain('sandboxUnsupported')
  })

  it('step 3 requires repo/label for github and rejects token without encryption', () => {
    const github = defaultDraft(context({ repo: { ...context().repo, remote: 'git@github.com:a/b.git' } }))
    expect(setupStepErrors(3, github, context({ repo: { ...context().repo, remote: 'git@github.com:a/b.git' } }))).toEqual([])

    expect(
      setupStepErrors(3, { ...github, tracker: { ...github.tracker!, repo: '' } }, context({ repo: { ...context().repo, remote: 'git@github.com:a/b.git' } })),
    ).toContain('repoRequired')

    expect(
      setupStepErrors(3, { ...github, tracker: { ...github.tracker!, label: '' } }, context()),
    ).toContain('labelRequired')

    expect(
      setupStepErrors(
        3,
        { ...github, tracker: { ...github.tracker!, auth: 'token' } },
        context({ encryptionAvailable: false }),
      ),
    ).toContain('encryptionUnavailable')

    expect(setupStepErrors(3, { ...github, tracker: { type: 'local', mergeMode: 'local' } }, context())).toEqual([])
  })

  it('step 4 requires a non-empty verify command', () => {
    const draft = defaultDraft(context())
    expect(setupStepErrors(4, draft, context())).toEqual([])
    expect(setupStepErrors(4, { ...draft, commands: { verify: '  ' } }, context())).toContain('verifyRequired')
  })

  it('canAdvance chains the steps', () => {
    const draft = defaultDraft(context())
    expect(canAdvance(1, draft, context())).toBe(true)
    expect(canAdvance(4, { ...draft, commands: { verify: '' } }, context())).toBe(false)
  })
})

/** 步骤条是整页向导里的导航：能回到已填过的步骤，但不能越过还没校验通过的步骤。 */
describe('canJumpToStep', () => {
  it('lets the user jump back regardless of the step being left', () => {
    const halfFilledGithub = {
      ...defaultDraft(context()),
      tracker: { type: 'github-issues' as const, mergeMode: 'local' as const, repo: '', label: '' },
    }
    expect(canJumpToStep(1, halfFilledGithub, context())).toBe(true)
    expect(canJumpToStep(2, halfFilledGithub, context())).toBe(true)
  })

  it('reaches the last step once every earlier step passes', () => {
    expect(canJumpToStep(4, defaultDraft(context()), context())).toBe(true)
  })

  it('refuses to cross a step whose own validation fails', () => {
    const draft = defaultDraft(context())
    const noEngine = { ...draft, agent: {} }
    expect(canJumpToStep(2, noEngine, context())).toBe(false)
    expect(canJumpToStep(4, noEngine, context())).toBe(false)

    const notGit = { ...draft, sandbox: { type: 'worktree' as const } }
    const repoContext = context({ repo: { ...context().repo, isGitRepo: false } })
    expect(canJumpToStep(2, notGit, repoContext)).toBe(true)
    expect(canJumpToStep(3, notGit, repoContext)).toBe(false)
  })

  it('does not gate the target step itself, only the ones before it', () => {
    const emptyVerify = { ...defaultDraft(context()), commands: { verify: '' } }
    expect(canJumpToStep(4, emptyVerify, context())).toBe(true)
  })
})

describe('draftFromConfig', () => {
  it('round-trips an existing config for the edit flow', () => {
    const built = buildFactoryConfig(
      {
        agent: { engineType: 'pi', model: 'qwen' },
        sandbox: { type: 'worktree' },
        tracker: {
          type: 'github-issues',
          repo: 'a/b',
          label: 'agent',
          auth: 'token',
          mergeMode: 'local',
          commentIssue: false,
          closeIssue: false,
        },
        commands: { verify: 'npm run build' },
      },
      { remote: 'origin', baseBranch: 'main' },
    )
    if (!built.ok) throw new Error('fixture invalid')
    const draft = draftFromConfig(built.config)
    expect(draft).toMatchObject({
      agent: { engineType: 'pi', model: 'qwen' },
      sandbox: { type: 'worktree' },
      tracker: { type: 'github-issues', repo: 'a/b', label: 'agent', auth: 'token', commentIssue: false, closeIssue: false },
      commands: { verify: 'npm run build' },
    })
  })

  it('round-trips per-role models so the edit flow keeps them', () => {
    const built = buildFactoryConfig(
      {
        agent: { engineType: 'claude-code' },
        stages: { plan: { model: 'opus' }, implement: { model: 'sonnet' } },
        sandbox: { type: 'worktree' },
        tracker: { type: 'local', mergeMode: 'local' },
        commands: { verify: 'npm run build' },
      },
      { baseBranch: 'main' },
    )
    if (!built.ok) throw new Error('fixture invalid')
    expect(draftFromConfig(built.config).stages).toEqual({
      plan: { model: 'opus' },
      implement: { model: 'sonnet' },
    })
  })

  it('keeps the docker image name when editing an existing config', () => {    const built = buildFactoryConfig(
      {
        agent: { engineType: 'claude-code' },
        sandbox: { type: 'docker', imageName: 'spacecode-factory:latest' },
        tracker: { type: 'local', mergeMode: 'local' },
        commands: { verify: 'npm run build' },
      },
      { baseBranch: 'main' },
    )
    if (!built.ok) throw new Error('fixture invalid')
    expect(draftFromConfig(built.config).sandbox).toEqual({
      type: 'docker',
      imageName: 'spacecode-factory:latest',
    })
  })
})
