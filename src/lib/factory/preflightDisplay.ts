/**
 * 预检项的展示文案。预检结果只带「码 + 参数」（`not-checked`、`no-push-permission`
 * 之类），裸码不能直接给用户看，这里统一按 id 翻成详情、一行解释和一条出路。
 */
import type { FactoryPreflightItem } from '@/shared/factory'

/** i18n `t()` 的子集；由渲染层注入，便于单测。 */
export type PreflightTranslate = (key: string, params?: Record<string, unknown>) => string

export interface PreflightText {
  detail: string
  hint: string
}

/**
 * 预检项的出路。判据只有一条，和该项 hint 里写的补救动作对齐：
 * 能靠改向导里的某个选择解决的，跳回那一步；补救在向导之外（环境、桌面设置、
 * 本页字段）的，就地重新检测——跳回去也改不动它。
 */
export type PreflightFix = { kind: 'step'; step: 1 | 2 | 3 } | { kind: 'recheck' }

const FIX_BY_ITEM: Record<FactoryPreflightItem['id'], PreflightFix> = {
  engine: { kind: 'step', step: 1 },
  sandbox: { kind: 'step', step: 2 },
  trackerAuth: { kind: 'step', step: 3 },
  trackerPush: { kind: 'step', step: 3 },
  trackerLabel: { kind: 'step', step: 3 },
  verifyCommand: { kind: 'recheck' },
  gitRepo: { kind: 'recheck' },
  gitDirty: { kind: 'recheck' },
  gitVersion: { kind: 'recheck' },
  configWritable: { kind: 'recheck' },
  modelProfile: { kind: 'recheck' },
  dockerImage: { kind: 'recheck' },
  dockerMount: { kind: 'recheck' },
  dockerProxy: { kind: 'recheck' },
}

/** 通过的项不需要出路；`Record` 保证新增预检项时这里不会漏。 */
export function preflightFix(item: FactoryPreflightItem): PreflightFix | null {
  return item.level === 'ok' ? null : FIX_BY_ITEM[item.id]
}

const EMPTY: PreflightText = { detail: '', hint: '' }

function param(item: FactoryPreflightItem, key: string): string {
  const value = item.params?.[key]
  return typeof value === 'string' ? value : ''
}

function engineLabel(engine: string): string {
  if (engine === 'claude-code') return 'Claude Code'
  if (engine === 'pi') return 'Pi'
  return engine
}

/** 鉴权失败的原因码 → 文案；`not-checked` 与未知码单独处理。 */
function authHintKey(reason: string): string {
  switch (reason) {
    case 'gh-not-logged-in':
      return 'factory.tokenGhNotLoggedIn'
    case 'invalid-token':
      return 'factory.tokenInvalid'
    case 'repo-permission':
      return 'factory.tokenRepoPermission'
    case 'network':
      return 'factory.tokenNetwork'
    default:
      return 'factory.preflightHint.authUnknown'
  }
}

export function preflightText(item: FactoryPreflightItem, t: PreflightTranslate): PreflightText {
  const reason = param(item, 'reason')

  switch (item.id) {
    case 'gitRepo':
      if (item.level === 'ok') return EMPTY
      return {
        detail: '',
        hint: t(reason === 'invalid-draft' ? 'factory.preflightHint.invalidDraft' : 'factory.preflightHint.notGitRepo'),
      }

    case 'gitDirty': {
      if (item.level !== 'warn') return EMPTY
      const files = item.params?.files
      return {
        detail: '',
        hint:
          typeof files === 'number'
            ? t('factory.preflightHint.gitDirty', { count: files })
            : t('factory.preflightHint.gitDirtyUnknown'),
      }
    }

    case 'gitVersion': {
      const version = param(item, 'version')
      if (item.level === 'ok') return { detail: version, hint: '' }
      return {
        detail: version,
        hint: t(version ? 'factory.preflightHint.gitVersionOld' : 'factory.preflightHint.gitVersionMissing'),
      }
    }

    case 'configWritable':
      return item.level === 'ok' ? EMPTY : { detail: '', hint: t('factory.preflightHint.configNotWritable') }

    case 'engine':
      return {
        detail: engineLabel(param(item, 'engine')),
        hint: item.level === 'ok' ? '' : t('factory.preflightHint.engineUnavailable'),
      }

    case 'modelProfile':
      return item.level === 'ok'
        ? { detail: param(item, 'model'), hint: '' }
        : { detail: '', hint: t('factory.preflightHint.modelMissing') }

    case 'trackerAuth': {
      if (item.level === 'ok') {
        return {
          detail: param(item, 'tracker') === 'local' ? t('factory.preflightDetail.localTracker') : param(item, 'login') || param(item, 'repo'),
          hint: '',
        }
      }
      return {
        detail: '',
        hint: t(reason === 'not-checked' ? 'factory.preflightHint.authNotChecked' : authHintKey(reason)),
      }
    }

    case 'trackerPush': {
      if (item.level === 'ok') return EMPTY
      if (reason === 'no-push-permission') return { detail: '', hint: t('factory.preflightHint.pushDenied') }
      if (reason === 'unknown') return { detail: '', hint: t('factory.preflightHint.pushUnknown') }
      return { detail: '', hint: t('factory.preflightHint.authNotChecked') }
    }

    case 'trackerLabel': {
      const label = param(item, 'label')
      return item.level === 'warn'
        ? { detail: label, hint: t('factory.preflightHint.labelMissing', { label }) }
        : { detail: label, hint: '' }
    }

    case 'verifyCommand': {
      const command = param(item, 'command')
      if (item.level === 'ok') return { detail: command, hint: '' }
      return {
        detail: command,
        hint: t(command ? 'factory.preflightHint.verifyScriptMissing' : 'factory.preflightHint.verifyRequired'),
      }
    }

    case 'sandbox': {
      if (item.level === 'ok') return { detail: t('factory.preflightDetail.sandboxWorktree'), hint: '' }
      if (param(item, 'sandbox') === 'podman') return { detail: '', hint: t('factory.preflightHint.podman') }
      return {
        detail: param(item, 'image'),
        hint: t(item.level === 'error' ? 'factory.preflightHint.dockerMissing' : 'factory.preflightHint.dockerCredentials'),
      }
    }

    case 'dockerImage':
      if (item.level === 'ok') return { detail: param(item, 'image'), hint: '' }
      return {
        detail: param(item, 'detail') || param(item, 'image'),
        hint: t('factory.preflightHint.imageBuildFailed'),
      }

    case 'dockerMount':
      return item.level === 'ok' ? EMPTY : { detail: '', hint: t('factory.preflightHint.mountNotWritable') }

    case 'dockerProxy':
      return item.level === 'ok' ? EMPTY : { detail: '', hint: t('factory.preflightHint.proxyUnreachable') }

    default:
      return EMPTY
  }
}
