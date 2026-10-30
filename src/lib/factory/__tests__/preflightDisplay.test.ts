/**
 * 预检展示层：结果只带码 + 参数，裸码（`not-checked`、`no-push-permission` 等）
 * 不能出现在界面上；每个非 ok 项都必须有一句能照着做的解释。
 */
import { describe, it, expect } from 'vitest'
import { preflightFix, preflightText } from '../preflightDisplay'
import type { FactoryPreflightItem } from '@/shared/factory'

const t = (key: string, params?: Record<string, unknown>): string =>
  params && Object.keys(params).length > 0 ? `${key}|${JSON.stringify(params)}` : key

function text(item: FactoryPreflightItem) {
  return preflightText(item, t)
}

function fix(item: FactoryPreflightItem) {
  return preflightFix(item)
}

describe('preflightText', () => {
  it('explains a dirty workspace with the change count', () => {
    const row = text({ id: 'gitDirty', level: 'warn', params: { files: 3 } })
    expect(row.hint).toBe('factory.preflightHint.gitDirty|{"count":3}')
    expect(text({ id: 'gitDirty', level: 'warn' }).hint).toBe('factory.preflightHint.gitDirtyUnknown')
    expect(text({ id: 'gitDirty', level: 'ok' })).toEqual({ detail: '', hint: '' })
  })

  it('explains a missing model profile instead of a bare warning', () => {
    expect(text({ id: 'modelProfile', level: 'warn' }).hint).toBe('factory.preflightHint.modelMissing')
    expect(text({ id: 'modelProfile', level: 'ok', params: { model: 'glm-5.3' } })).toEqual({
      detail: 'glm-5.3',
      hint: '',
    })
  })

  it('says why the verify command is warned about', () => {
    const row = text({ id: 'verifyCommand', level: 'warn', params: { command: 'npm run test:changed' } })
    expect(row.detail).toBe('npm run test:changed')
    expect(row.hint).toBe('factory.preflightHint.verifyScriptMissing')
    expect(text({ id: 'verifyCommand', level: 'error' }).hint).toBe('factory.preflightHint.verifyRequired')
  })

  it('distinguishes a running Docker setup from a missing one', () => {
    const healthy = text({ id: 'sandbox', level: 'warn', params: { sandbox: 'docker', image: 'img' } })
    expect(healthy.detail).toBe('img')
    expect(healthy.hint).toBe('factory.preflightHint.dockerCredentials')
    expect(
      text({ id: 'sandbox', level: 'error', params: { sandbox: 'docker' } }).hint,
    ).toBe('factory.preflightHint.dockerMissing')
    expect(text({ id: 'sandbox', level: 'error', params: { sandbox: 'podman' } }).hint).toBe(
      'factory.preflightHint.podman',
    )
    expect(text({ id: 'sandbox', level: 'ok', params: { sandbox: 'worktree' } }).detail).toBe(
      'factory.preflightDetail.sandboxWorktree',
    )
  })

  /** 回归：曾经把 `params.reason` 原样当详情，用户看到的是 `not-checked` 这种码。 */
  it('never renders a raw reason code', () => {
    const items: FactoryPreflightItem[] = [
      { id: 'gitRepo', level: 'error', params: { reason: 'invalid-draft' } },
      { id: 'gitVersion', level: 'error', params: { version: '2.30.0' } },
      { id: 'configWritable', level: 'error' },
      { id: 'engine', level: 'error', params: { engine: 'claude-code' } },
      { id: 'trackerAuth', level: 'error', params: { reason: 'not-checked' } },
      { id: 'trackerAuth', level: 'error', params: { reason: 'gh-not-logged-in' } },
      { id: 'trackerAuth', level: 'error', params: { reason: 'invalid-token' } },
      { id: 'trackerAuth', level: 'error', params: { reason: 'repo-permission' } },
      { id: 'trackerAuth', level: 'error', params: { reason: 'network' } },
      { id: 'trackerPush', level: 'warn', params: { reason: 'not-checked' } },
      { id: 'trackerPush', level: 'warn', params: { reason: 'unknown' } },
      { id: 'trackerPush', level: 'error', params: { reason: 'no-push-permission' } },
      { id: 'trackerLabel', level: 'warn', params: { label: 'ready-for-agent' } },
      { id: 'modelProfile', level: 'warn' },
      { id: 'verifyCommand', level: 'warn', params: { command: 'npm run test' } },
      { id: 'sandbox', level: 'warn', params: { sandbox: 'docker', image: 'img' } },
      { id: 'dockerImage', level: 'error', params: { image: 'img', detail: 'boom' } },
      { id: 'dockerMount', level: 'error' },
      { id: 'dockerProxy', level: 'error', params: { reason: 'unreachable' } },
    ]

    for (const item of items) {
      const row = text(item)
      expect(row.hint, `${item.id} (${item.level}) should explain itself`).not.toBe('')
      expect(row.hint.startsWith('factory.'), `${item.id} hint must be an i18n key`).toBe(true)
      const reason = item.params?.reason
      if (typeof reason === 'string') {
        expect(row.detail, `${item.id} must not render the reason code`).not.toBe(reason)
        expect(row.hint, `${item.id} hint must not be the reason code`).not.toBe(reason)
      }
    }
  })

  it('keeps the raw build tail for a failed image and maps auth reasons', () => {
    expect(text({ id: 'dockerImage', level: 'error', params: { image: 'img', detail: '#12 ERROR' } }).detail).toBe(
      '#12 ERROR',
    )
    expect(text({ id: 'trackerAuth', level: 'error', params: { reason: 'gh-not-logged-in' } }).hint).toBe(
      'factory.tokenGhNotLoggedIn',
    )
    expect(text({ id: 'trackerAuth', level: 'ok', params: { login: 'hjdspace', repo: 'a/b' } }).detail).toBe(
      'hjdspace',
    )
    expect(text({ id: 'trackerAuth', level: 'ok', params: { tracker: 'local' } }).detail).toBe(
      'factory.preflightDetail.localTracker',
    )
  })
})

/**
 * 修复入口：预检项只说明「哪里不对」，用户还需要一条出路。
 * 选择造成的问题跳回拥有该选择的步骤，环境/本页字段造成的问题就地重新检测。
 */
describe('preflightFix', () => {
  it('sends a choice problem back to the step that owns it', () => {
    expect(fix({ id: 'engine', level: 'error', params: { engine: 'pi' } })).toEqual({ kind: 'step', step: 1 })
    expect(fix({ id: 'sandbox', level: 'error', params: { sandbox: 'docker' } })).toEqual({ kind: 'step', step: 2 })
    expect(fix({ id: 'sandbox', level: 'warn', params: { sandbox: 'docker', image: 'img' } })).toEqual({
      kind: 'step',
      step: 2,
    })
    expect(fix({ id: 'trackerAuth', level: 'error', params: { reason: 'gh-not-logged-in' } })).toEqual({
      kind: 'step',
      step: 3,
    })
    expect(fix({ id: 'trackerPush', level: 'error', params: { reason: 'no-push-permission' } })).toEqual({
      kind: 'step',
      step: 3,
    })
    expect(fix({ id: 'trackerLabel', level: 'warn', params: { label: 'ready-for-agent' } })).toEqual({
      kind: 'step',
      step: 3,
    })
  })

  /**
   * 出路要和该项 hint 里写的补救动作一致：`gitRepo` 让人先 git init，`modelProfile`
   * 让人去桌面设置，镜像/挂载/代理是环境事实——跳回步骤改不动它们，只能重检。
   */
  it('re-checks in place what this page or the machine outside the wizard controls', () => {
    expect(fix({ id: 'verifyCommand', level: 'error' })).toEqual({ kind: 'recheck' })
    expect(fix({ id: 'verifyCommand', level: 'warn', params: { command: 'npm run test' } })).toEqual({
      kind: 'recheck',
    })
    expect(fix({ id: 'gitRepo', level: 'error' })).toEqual({ kind: 'recheck' })
    expect(fix({ id: 'modelProfile', level: 'warn' })).toEqual({ kind: 'recheck' })
    expect(fix({ id: 'gitDirty', level: 'warn', params: { files: 2 } })).toEqual({ kind: 'recheck' })
    expect(fix({ id: 'gitVersion', level: 'error', params: { version: '2.30.0' } })).toEqual({ kind: 'recheck' })
    expect(fix({ id: 'configWritable', level: 'error' })).toEqual({ kind: 'recheck' })
    expect(fix({ id: 'dockerImage', level: 'error', params: { image: 'img' } })).toEqual({ kind: 'recheck' })
    expect(fix({ id: 'dockerMount', level: 'error' })).toEqual({ kind: 'recheck' })
    expect(fix({ id: 'dockerProxy', level: 'error' })).toEqual({ kind: 'recheck' })
  })

  it('offers no entry for an item that passed', () => {
    expect(fix({ id: 'engine', level: 'ok', params: { engine: 'claude-code' } })).toBeNull()
    expect(fix({ id: 'gitDirty', level: 'ok' })).toBeNull()
    expect(fix({ id: 'trackerLabel', level: 'ok', params: { label: 'ready-for-agent' } })).toBeNull()
  })
})
