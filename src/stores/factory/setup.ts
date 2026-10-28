/**
 * 向导纯逻辑：默认草稿、从既有配置回填、逐步校验与「下一步」判定。
 *
 * 组件只负责渲染；能不能进入下一步由这里决定，便于单测覆盖
 * 「引擎未选 / 仓库不是 Git / 验证命令为空」这类阻断。
 */
import type { FactoryConfig, FactorySetupContext, FactorySetupDraft } from '@/shared/factory'
import { isValidRepoSlug, parseRepoFromRemote } from '@/utils/factoryRepo'

export type FactorySetupContextLike = FactorySetupContext

export type SetupStep = 1 | 2 | 3 | 4

export const SETUP_STEPS = ['engine', 'sandbox', 'tracker', 'preflight'] as const

/** Docker 沙箱的默认镜像名；用户可在向导第 2 步改写。 */
export const DEFAULT_DOCKER_IMAGE = 'spacecode-factory:latest'

export function defaultDraft(context: FactorySetupContextLike): FactorySetupDraft {
  const repo = parseRepoFromRemote(context.repo.remote)
  return {
    agent: { engineType: 'claude-code' },
    sandbox: { type: 'worktree' },
    tracker: repo
      ? {
          type: 'github-issues',
          repo,
          label: 'ready-for-agent',
          auth: 'gh',
          mergeMode: 'local',
          commentIssue: true,
          closeIssue: true,
        }
      : { type: 'local', mergeMode: 'local' },
    commands: { verify: 'npm run test:changed' },
  }
}

export function draftFromConfig(config: FactoryConfig): FactorySetupDraft {
  return {
    agent: {
      engineType: config.agent.engineType,
      ...(config.agent.model ? { model: config.agent.model } : {}),
    },
    sandbox:
      config.sandbox.type === 'docker'
        ? { type: 'docker', imageName: config.sandbox.imageName }
        : { type: config.sandbox.type },
    tracker:
      config.tracker.type === 'github-issues'
        ? {
            type: 'github-issues',
            repo: config.tracker.repo,
            label: config.tracker.label,
            auth: config.tracker.auth,
            mergeMode: config.tracker.mergeMode,
            commentIssue: config.tracker.commentIssue,
            closeIssue: config.tracker.closeIssue,
          }
        : { type: 'local', mergeMode: 'local' },
    commands: {
      verify: config.commands.verify,
      ...(config.commands.install ? { install: config.commands.install } : {}),
    },
  }
}

export function setupStepErrors(
  step: SetupStep,
  draft: FactorySetupDraft,
  context: FactorySetupContextLike,
): string[] {
  const errors: string[] = []
  if (step === 1) {
    const engine = draft.agent?.engineType
    if (!engine) {
      errors.push('engineRequired')
    } else {
      const option = context.engines.find((item) => item.engineType === engine)
      if (!option?.available) errors.push('engineUnavailable')
    }
    return errors
  }

  if (step === 2) {
    if (!context.repo.isGitRepo) errors.push('notGitRepo')
    const sandbox = draft.sandbox ?? { type: 'worktree' }
    if (sandbox.type === 'podman') {
      errors.push('sandboxUnsupported')
    } else if (sandbox.type === 'docker') {
      if (!context.dockerAvailable) errors.push('dockerUnavailable')
      if (!(sandbox.imageName ?? '').trim()) errors.push('sandboxImageRequired')
    }
    return errors
  }

  if (step === 3) {
    const tracker = draft.tracker
    if (!tracker || tracker.type === 'local') return errors
    if (!isValidRepoSlug(tracker.repo ?? '')) errors.push('repoRequired')
    if (!(tracker.label ?? '').trim()) errors.push('labelRequired')
    if ((tracker.auth ?? 'gh') === 'token' && !context.encryptionAvailable) {
      errors.push('encryptionUnavailable')
    }
    return errors
  }

  if (!(draft.commands?.verify ?? '').trim()) errors.push('verifyRequired')
  return errors
}

export function canAdvance(
  step: SetupStep,
  draft: FactorySetupDraft,
  context: FactorySetupContextLike,
): boolean {
  return setupStepErrors(step, draft, context).length === 0
}
