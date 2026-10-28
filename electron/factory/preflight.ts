/**
 * 向导第 4 步的预检。纯函数：所有外部事实由调用方采集后注入，
 * 这样每条阻断分支都能在单测里被单独覆盖。
 *
 * 规则：`error` 阻断「完成」；`warn` 允许继续（脏工作区、模型 profile、
 * label 缺失等），真正执行前还会再预检一次。
 */
import type {
  FactoryConfig,
  FactoryGithubAuthResult,
  FactoryPreflightItem,
  FactoryPreflightResult,
  FactoryRepoInfo,
} from '@/shared/factory'

export interface FactoryPreflightInput {
  repo: FactoryRepoInfo
  configWritable: boolean
  engineAvailable: boolean
  modelProfileConfigured: boolean
  githubAuth: FactoryGithubAuthResult | null
  dockerAvailable: boolean
  /** npm run <script> 的目标脚本不存在时为 true。 */
  verifyScriptMissing?: boolean
}

function parseGitVersion(version: string | null): [number, number] | null {
  if (!version) return null
  const match = version.match(/(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

export function runFactoryPreflight(config: FactoryConfig, input: FactoryPreflightInput): FactoryPreflightResult {
  const items: FactoryPreflightItem[] = []

  items.push(
    input.repo.isGitRepo
      ? { id: 'gitRepo', level: 'ok' }
      : { id: 'gitRepo', level: 'error' },
  )

  items.push(
    input.repo.dirty
      ? { id: 'gitDirty', level: 'warn' }
      : { id: 'gitDirty', level: 'ok' },
  )

  const gitVersion = parseGitVersion(input.repo.gitVersion)
  if (!gitVersion) {
    items.push({ id: 'gitVersion', level: 'error' })
  } else if (gitVersion[0] < 2 || (gitVersion[0] === 2 && gitVersion[1] < 40)) {
    items.push({ id: 'gitVersion', level: 'error', params: { version: input.repo.gitVersion ?? '' } })
  } else {
    items.push({ id: 'gitVersion', level: 'ok', params: { version: input.repo.gitVersion ?? '' } })
  }

  items.push(input.configWritable ? { id: 'configWritable', level: 'ok' } : { id: 'configWritable', level: 'error' })

  items.push(
    input.engineAvailable
      ? { id: 'engine', level: 'ok', params: { engine: config.agent.engineType } }
      : { id: 'engine', level: 'error', params: { engine: config.agent.engineType } },
  )

  items.push(
    input.modelProfileConfigured
      ? { id: 'modelProfile', level: 'ok', ...(config.agent.model ? { params: { model: config.agent.model } } : {}) }
      : { id: 'modelProfile', level: 'warn' },
  )

  if (config.tracker.type === 'local') {
    items.push({ id: 'trackerAuth', level: 'ok', params: { tracker: 'local' } })
  } else {
    const auth = input.githubAuth
    if (!auth) {
      items.push({ id: 'trackerAuth', level: 'error', params: { reason: 'not-checked' } })
    } else if (auth.ok) {
      items.push({
        id: 'trackerAuth',
        level: 'ok',
        params: { ...(auth.login ? { login: auth.login } : {}), repo: config.tracker.repo },
      })
    } else {
      items.push({ id: 'trackerAuth', level: 'error', params: { reason: auth.reason } })
    }

    items.push(
      auth?.ok && auth.labelCount === 0
        ? { id: 'trackerLabel', level: 'warn', params: { label: config.tracker.label } }
        : { id: 'trackerLabel', level: 'ok', params: { label: config.tracker.label } },
    )
  }

  if (!config.commands.verify.trim()) {
    items.push({ id: 'verifyCommand', level: 'error' })
  } else if (input.verifyScriptMissing) {
    items.push({ id: 'verifyCommand', level: 'warn', params: { command: config.commands.verify } })
  } else {
    items.push({ id: 'verifyCommand', level: 'ok', params: { command: config.commands.verify } })
  }

  if (config.sandbox.type === 'worktree') {
    items.push({ id: 'sandbox', level: 'ok', params: { sandbox: 'worktree' } })
  } else if (config.sandbox.type === 'docker') {
    items.push(
      input.dockerAvailable
        ? { id: 'sandbox', level: 'warn', params: { sandbox: 'docker' } }
        : { id: 'sandbox', level: 'error', params: { sandbox: 'docker' } },
    )
  } else {
    items.push({ id: 'sandbox', level: 'error', params: { sandbox: 'podman' } })
  }

  return {
    items,
    blocking: items.some((item) => item.level === 'error'),
  }
}
