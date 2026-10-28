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
  /** Docker 沙箱的镜像可构建性；缺省表示未检查。 */
  dockerImageOk?: boolean
  dockerImageDetail?: string
  /** 工作树根与包缓存是否可写（挂载前置条件）。 */
  dockerMountable?: boolean
  /** 代理地址是否能从宿主侧连通；缺省表示未配置代理。 */
  dockerProxyOk?: boolean
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

    // PR 模式必须能把任务分支推上去并建 PR；无写权限时合并按钮不可用。
    if (config.tracker.mergeMode === 'pr') {
      if (!auth?.ok) {
        items.push({ id: 'trackerPush', level: 'warn', params: { reason: 'not-checked' } })
      } else if (auth.canPush === false) {
        items.push({ id: 'trackerPush', level: 'error', params: { reason: 'no-push-permission' } })
      } else if (auth.canPush === true) {
        items.push({ id: 'trackerPush', level: 'ok' })
      } else {
        items.push({ id: 'trackerPush', level: 'warn', params: { reason: 'unknown' } })
      }
    }
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
        ? { id: 'sandbox', level: 'warn', params: { sandbox: 'docker', image: config.sandbox.imageName } }
        : { id: 'sandbox', level: 'error', params: { sandbox: 'docker' } },
    )
    // Docker 可用但镜像/挂载/代理任一不满足都会阻断，避免运行时静默退化成无隔离执行。
    if (input.dockerAvailable && input.dockerImageOk !== undefined) {
      items.push(
        input.dockerImageOk
          ? { id: 'dockerImage', level: 'ok', params: { image: config.sandbox.imageName } }
          : {
              id: 'dockerImage',
              level: 'error',
              params: {
                image: config.sandbox.imageName,
                ...(input.dockerImageDetail ? { detail: input.dockerImageDetail } : {}),
              },
            },
      )
    }
    if (input.dockerAvailable && input.dockerMountable !== undefined) {
      items.push(
        input.dockerMountable
          ? { id: 'dockerMount', level: 'ok' }
          : { id: 'dockerMount', level: 'error' },
      )
    }
    if (input.dockerAvailable && input.dockerProxyOk !== undefined) {
      items.push(
        input.dockerProxyOk
          ? { id: 'dockerProxy', level: 'ok' }
          : { id: 'dockerProxy', level: 'error', params: { reason: 'unreachable' } },
      )
    }
  } else {
    items.push({ id: 'sandbox', level: 'error', params: { sandbox: 'podman' } })
  }

  return {
    items,
    blocking: items.some((item) => item.level === 'error'),
  }
}
