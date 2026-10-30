/**
 * 向导渲染：角色模型下拉、仓库候选、gh 登录入口与预检/完成按钮的可用性。
 * 走真实的 factory store（只 mock IPC），保证组件 ↔ store ↔ api 三层一致。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type {
  FactoryGithubRepo,
  FactoryPreflightResult,
  FactorySetupContext,
} from '@/shared/factory'

const { factoryApi } = vi.hoisted(() => ({
  factoryApi: {
    state: vi.fn(),
    context: vi.fn(),
    preflight: vi.fn(),
    save: vi.fn(),
    githubRepos: vi.fn(),
    testGithubToken: vi.fn(),
    saveGithubToken: vi.fn(),
    checkGhAuth: vi.fn(),
    startGhLogin: vi.fn(),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: { factory: factoryApi } }))
vi.mock('@/stores/chatSession', () => ({ useChatSessionStore: () => ({ allProjects: [] }) }))
vi.mock('@/services/api/shell', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && Object.keys(params).length > 0 ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import { useFactoryStore } from '@/stores/factory'
import FactorySetupWizard from '../FactorySetupWizard.vue'

const context: FactorySetupContext = {
  repo: {
    isGitRepo: true,
    root: 'D:/repo',
    remote: 'git@github.com:hjdspace/SpaceCode.git',
    baseBranch: 'main',
    dirty: false,
    gitVersion: '2.44.0',
  },
  engines: [{ engineType: 'claude-code', available: true, reason: 'ok', version: null, exposed: true }],
  modelProfile: { configured: true, model: 'claude-sonnet-4-5', provider: 'anthropic' },
  models: {
    selectable: ['glm-5.3-flash', 'qwen3.8-max', 'glm-5.3'],
    default: 'qwen3.8-max',
    tiers: { 'glm-5.3-flash': 'haiku', 'qwen3.8-max': 'sonnet', 'glm-5.3': 'opus' },
  },
  dockerAvailable: false,
  encryptionAvailable: true,
  ghLoggedIn: false,
  existingConfig: null,
}

const githubRepos: FactoryGithubRepo[] = [
  { repo: 'hjdspace/SpaceCode', name: 'SpaceCode', private: true },
  { repo: 'acme/other', name: 'other', private: false },
]

const passing: FactoryPreflightResult = { items: [], blocking: false }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  factoryApi.context.mockResolvedValue(context)
  factoryApi.githubRepos.mockResolvedValue({ ok: true, repos: githubRepos })
  factoryApi.preflight.mockResolvedValue(passing)
  factoryApi.save.mockResolvedValue({ ok: true })
  factoryApi.saveGithubToken.mockResolvedValue({ ok: true })
  factoryApi.checkGhAuth.mockResolvedValue({ ok: true, reason: 'ok' })
  factoryApi.startGhLogin.mockResolvedValue({ ok: true, reason: 'ok', code: 'ABCD-1234' })
})

function seed(overrides: Record<string, unknown> = {}) {
  const store = useFactoryStore()
  store.context = context
  store.wizardOpen = true
  store.draft = {
    agent: { engineType: 'claude-code' },
    sandbox: { type: 'worktree' },
    tracker: {
      type: 'github-issues',
      repo: 'hjdspace/SpaceCode',
      label: 'ready-for-agent',
      auth: 'gh',
      mergeMode: 'local',
    },
    commands: { verify: 'npm run test:changed' },
  }
  Object.assign(store, overrides)
  return store
}

function mountWizard() {
  return mount(FactorySetupWizard, { props: { root: 'D:/repo' } })
}

/** 底栏的「完成配置」；用文案取，避免依赖按钮顺序。 */
function finishButton(wrapper: ReturnType<typeof mountWizard>) {
  return wrapper.findAll('button').find((button) => button.text() === 'factory.finish')
}

describe('FactorySetupWizard', () => {
  it('occupies the board area as a page and names the task source on top', async () => {
    const store = seed()
    const wrapper = mountWizard()

    expect(wrapper.find('[data-setup-page]').exists()).toBe(true)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.find('[data-setup-heading]').text()).toBe('factory.wizardDescription')
    expect(wrapper.find('[data-setup-repo]').text()).toBe('hjdspace/SpaceCode')

    store.draft = { ...store.draft, tracker: { type: 'local', mergeMode: 'local' } }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-setup-repo]').text()).toBe('repo')
  })

  it('jumps the stepper backwards and greys out a step behind an unvalidated one', async () => {
    const store = seed({ step: 3 })
    const wrapper = mountWizard()

    await wrapper.findAll('[data-step-link]')[1].trigger('click')
    expect(store.step).toBe(2)

    store.draft = { ...store.draft, agent: {} }
    await wrapper.vm.$nextTick()

    const third = wrapper.findAll('[data-step-link]')[2]
    expect(third.attributes('disabled')).toBeDefined()
    await third.trigger('click')
    expect(store.step).toBe(2)
    // 第 1 步本身永远能回去修。
    expect(wrapper.findAll('[data-step-link]')[0].attributes('disabled')).toBeUndefined()
  })

  it('binds the token field to the wizard session so it survives a tab close', async () => {
    const store = seed({ step: 3 })
    store.draft = { ...store.draft, tracker: { ...store.draft.tracker!, auth: 'token' } }
    store.wizardToken = 'ghp_reused'
    const wrapper = mountWizard()

    const field = wrapper.find('input[type="password"]')
    expect(field.element).toHaveProperty('value', 'ghp_reused')

    await field.setValue('ghp_typed')
    expect(store.wizardToken).toBe('ghp_typed')
  })

  it('offers the first plan to the board shell and leaves via 查看看板', async () => {
    const store = seed({ step: 4, wizardDone: true })
    const wrapper = mountWizard()

    await wrapper.find('[data-done-plan]').trigger('click')
    expect(wrapper.emitted('new-run')).toHaveLength(1)

    await wrapper.find('[data-done-board]').trigger('click')
    expect(store.wizardOpen).toBe(false)
  })

  it('replaces the steps with a ready page listing what was written and chosen', () => {
    const store = seed({ step: 4, wizardDone: true, configPath: '.spacecode/factory/config.json' })
    const wrapper = mountWizard()

    expect(wrapper.find('[data-setup-done]').exists()).toBe(true)
    expect(wrapper.find('[data-step-link]').exists()).toBe(false)
    expect(store.wizardOpen).toBe(true)

    expect(wrapper.findAll('[data-done-summary]').map((item) => item.text())).toEqual([
      'Claude Code',
      'factory.sandboxWorktree',
      'factory.trackerGithub',
    ])
    expect(wrapper.find('[data-done-fact="config"] dd').text()).toBe('.spacecode/factory/config.json')
    expect(wrapper.find('[data-done-fact="token"] dd').text()).toBe('factory.wizardDone.tokenGh')
    expect(wrapper.find('[data-done-fact="model"] dd').text()).toBe('factory.wizardDone.modelReused')
  })

  it('marks the credential as vault-stored only when a token is in play', async () => {
    const store = seed({ step: 4, wizardDone: true })
    store.draft = {
      ...store.draft,
      tracker: { ...store.draft.tracker!, auth: 'token' },
      sandbox: { type: 'docker', imageName: 'spacecode-factory:latest' },
    }
    const wrapper = mountWizard()

    expect(wrapper.find('[data-done-fact="token"] dd').text()).toBe('factory.wizardDone.tokenVault')
    expect(wrapper.findAll('[data-done-summary]')[1].text()).toBe('factory.sandboxDocker')
  })

  it('lists real models only and shows the tier as a marker', async () => {
    const store = seed()
    const wrapper = mountWizard()

    const selects = wrapper.findAll('select.role-select')
    expect(selects).toHaveLength(4)

    const options = selects[0].findAll('option')
    const values = options.map((option) => option.attributes('value'))
    expect(values).toEqual(['', 'glm-5.3-flash', 'qwen3.8-max', 'glm-5.3'])
    expect(values).not.toContain('opus')

    const labels = options.map((option) => option.text())
    expect(labels).toContain('glm-5.3（opus）')
    expect(labels).toContain('glm-5.3-flash（haiku）')

    await selects[0].setValue('glm-5.3')
    expect(store.draft.stages?.plan).toEqual({ model: 'glm-5.3' })

    await selects[0].setValue('')
    expect(store.draft.stages?.plan).toBeUndefined()
  })

  it('lists repositories from GitHub once gh is signed in', async () => {
    const store = seed({ step: 3, context: { ...context, ghLoggedIn: true } })
    const wrapper = mountWizard()
    await vi.waitFor(() => expect(wrapper.find('.repo-picker select').exists()).toBe(true))
    expect(factoryApi.githubRepos).toHaveBeenCalledWith('gh', undefined)

    const picker = wrapper.find('.repo-picker select')
    const values = picker.findAll('option').map((option) => option.attributes('value'))
    expect(values).toEqual(['', 'hjdspace/SpaceCode', 'acme/other'])

    await picker.setValue('acme/other')
    expect(store.draft.tracker?.repo).toBe('acme/other')
  })

  it('starts the browser gh login when not signed in, and refreshes when signed in', async () => {
    const store = seed({ step: 3 })
    const wrapper = mountWizard()

    const loginButton = wrapper.find('[data-gh-login]')
    expect(loginButton.exists()).toBe(true)
    await loginButton.trigger('click')
    expect(factoryApi.startGhLogin).toHaveBeenCalledTimes(1)

    store.context = { ...context, ghLoggedIn: true }
    store.ghLogin = { running: false }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-gh-login]').exists()).toBe(false)

    const refresh = wrapper.findAll('button').find((button) => button.text() === 'factory.refresh')
    await refresh!.trigger('click')
    expect(factoryApi.checkGhAuth).toHaveBeenCalledTimes(1)

    store.closeWizard()
  })

  it('explains what a warning item means instead of leaving only the yellow icon', async () => {
    seed({
      step: 4,
      preflight: {
        blocking: false,
        items: [
          { id: 'gitRepo', level: 'ok' },
          { id: 'gitDirty', level: 'warn', params: { files: 3 } },
        ],
      },
    })
    const wrapper = mountWizard()

    const hints = wrapper.findAll('.item-hint')
    expect(hints).toHaveLength(1)
    expect(hints[0].text()).toBe('factory.preflightHint.gitDirty|{"count":3}')
  })

  it('re-runs preflight and enables finish once it passes', async () => {
    seed({ step: 4 })
    const wrapper = mountWizard()

    const finish = wrapper.findAll('button').find((button) => button.text() === 'factory.finish')
    expect(finish!.attributes('disabled')).toBeDefined()

    const rerun = wrapper.findAll('button').find((button) => button.text() === 'factory.refreshPreflight')
    await rerun!.trigger('click')
    await vi.waitFor(() => {
      const enabled = wrapper.findAll('button').find((button) => button.text() === 'factory.finish')
      expect(enabled!.attributes('disabled')).toBeUndefined()
    })
    expect(factoryApi.preflight).toHaveBeenCalledTimes(1)
  })

  it('leads with what this run will use: engine, isolation, source, label and merge mode', () => {
    seed({ step: 4 })
    const wrapper = mountWizard()

    expect(
      wrapper.findAll('[data-setup-summary] .sum-item').map((chip) => chip.attributes('data-summary')),
    ).toEqual(['engine', 'sandbox', 'tracker', 'label', 'merge'])
    expect(wrapper.find('[data-summary="engine"] .sum-value').text()).toBe('Claude Code')
    expect(wrapper.find('[data-summary="sandbox"] .sum-value').text()).toBe('factory.sandboxWorktree')
    expect(wrapper.find('[data-summary="tracker"] .sum-value').text()).toBe('factory.trackerGithub')
    expect(wrapper.find('[data-summary="label"] .sum-value').text()).toBe('ready-for-agent')
    expect(wrapper.find('[data-summary="merge"] .sum-value').text()).toBe('factory.mergeLocal')
  })

  it('leaves the claim label out of the summary for the local backlog', () => {
    const store = seed({ step: 4 })
    store.draft = { ...store.draft, tracker: { type: 'local', mergeMode: 'local' } }
    const wrapper = mountWizard()

    expect(
      wrapper.findAll('[data-setup-summary] .sum-item').map((chip) => chip.attributes('data-summary')),
    ).toEqual(['engine', 'sandbox', 'tracker', 'merge'])
  })

  it('routes a blocking item back to the step that owns that choice', async () => {
    const store = seed({
      step: 4,
      preflight: {
        blocking: true,
        items: [{ id: 'trackerAuth', level: 'error', params: { reason: 'gh-not-logged-in' } }],
      },
    })
    const wrapper = mountWizard()

    await wrapper.find('[data-preflight-item="trackerAuth"] [data-preflight-fix]').trigger('click')
    expect(store.step).toBe(3)
    // 跳去修问题不该重跑预检。
    expect(factoryApi.preflight).not.toHaveBeenCalled()
  })

  it('routes an engine problem to the engine step', async () => {
    const store = seed({
      step: 4,
      preflight: { blocking: true, items: [{ id: 'engine', level: 'error', params: { engine: 'pi' } }] },
    })
    const wrapper = mountWizard()

    await wrapper.find('[data-preflight-item="engine"] [data-preflight-fix]').trigger('click')
    expect(store.step).toBe(1)
  })

  it('re-checks a preflight item this page can fix without leaving it', async () => {
    const store = seed({
      step: 4,
      preflight: { blocking: true, items: [{ id: 'verifyCommand', level: 'warn', params: { command: 'npm run x' } }] },
    })
    const wrapper = mountWizard()

    await wrapper.find('[data-preflight-item="verifyCommand"] [data-preflight-fix]').trigger('click')
    expect(store.step).toBe(4)
    await vi.waitFor(() => expect(factoryApi.preflight).toHaveBeenCalledTimes(1))
  })

  it('grey-outs the fix entry when an earlier step still blocks the jump', async () => {
    const store = seed({
      step: 4,
      preflight: { blocking: true, items: [{ id: 'trackerAuth', level: 'error', params: { reason: 'gh-not-logged-in' } }] },
    })
    store.draft = { ...store.draft, agent: {} }
    const wrapper = mountWizard()

    const fix = wrapper.find('[data-preflight-item="trackerAuth"] [data-preflight-fix]')
    expect(fix.attributes('disabled')).toBeDefined()
    await fix.trigger('click')
    expect(store.step).toBe(4)
  })

  it('passes ok items without any fix entry', () => {
    seed({ step: 4, preflight: { blocking: false, items: [{ id: 'gitRepo', level: 'ok' }] } })
    const wrapper = mountWizard()

    expect(wrapper.find('[data-preflight-item="gitRepo"]').exists()).toBe(true)
    expect(wrapper.find('[data-preflight-fix]').exists()).toBe(false)
  })

  it('spells out where the config lands and where the credential lives', () => {
    seed({ step: 4, configPath: '.spacecode/factory/config.json' })
    const wrapper = mountWizard()

    expect(wrapper.find('[data-write-fact="config"] dd').text()).toBe('.spacecode/factory/config.json')
    expect(wrapper.find('[data-write-fact="token"] dd').text()).toBe('factory.wizardDone.tokenGh')
    expect(wrapper.find('[data-write-fact="model"] dd').text()).toBe('factory.wizardDone.modelReused')
  })

  it('only promises the credential store when a token is in play', async () => {
    const store = seed({ step: 4 })
    store.draft = { ...store.draft, tracker: { ...store.draft.tracker!, auth: 'token' } }
    const wrapper = mountWizard()

    expect(wrapper.find('[data-write-fact="token"] dd').text()).toBe('factory.wizardDone.tokenVault')

    store.draft = { ...store.draft, tracker: { type: 'local', mergeMode: 'local' } }
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-write-fact="token"] dd').text()).toBe('factory.wizardDone.tokenUnused')
  })

  it('explains why finish is locked and says the run is clear to start once it passes', async () => {
    const store = seed({
      step: 4,
      preflight: { blocking: true, items: [{ id: 'sandbox', level: 'error', params: { sandbox: 'docker' } }] },
    })
    const wrapper = mountWizard()

    expect(wrapper.find('[data-blocking-note]').exists()).toBe(true)
    expect(wrapper.find('[data-ready-note]').exists()).toBe(false)
    expect(finishButton(wrapper)!.attributes('disabled')).toBeDefined()

    store.preflight = passing
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-blocking-note]').exists()).toBe(false)
    expect(wrapper.find('[data-ready-note]').exists()).toBe(true)
    expect(finishButton(wrapper)!.attributes('disabled')).toBeUndefined()
  })

  it('re-runs preflight on its own after the verify command changes', async () => {
    seed({ step: 4, preflight: passing })
    const wrapper = mountWizard()
    expect(finishButton(wrapper)!.attributes('disabled')).toBeUndefined()

    await wrapper.find('[data-verify-command]').setValue('npm run lint')

    // 旧结果当场作废：不让人拿着上一条结论点完成
    expect(finishButton(wrapper)!.attributes('disabled')).toBeDefined()
    expect(factoryApi.preflight).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(factoryApi.preflight).toHaveBeenCalledTimes(1))
    expect(factoryApi.preflight.mock.calls[0][0]).toBe('D:/repo')
    expect(factoryApi.preflight.mock.calls[0][1]).toMatchObject({ commands: { verify: 'npm run lint' } })
    await vi.waitFor(() => expect(finishButton(wrapper)!.attributes('disabled')).toBeUndefined())
  })

  it('keeps finish locked when the automatic re-check comes back blocking', async () => {
    factoryApi.preflight.mockResolvedValue({
      blocking: true,
      items: [{ id: 'verifyCommand', level: 'error' }],
    })
    seed({ step: 4, preflight: passing })
    const wrapper = mountWizard()

    await wrapper.find('[data-verify-command]').setValue('')

    await vi.waitFor(() => expect(factoryApi.preflight).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      expect(finishButton(wrapper)!.attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-blocking-note]').exists()).toBe(true)
    })
  })
})

describe('FactorySetupWizard · isolation and task source detail', () => {
  it('reports Docker as missing, blocks it, and re-detects on demand', async () => {
    const store = seed({ step: 2 })
    const wrapper = mountWizard()

    const docker = wrapper.find('[data-sandbox-option="docker"]')
    expect(docker.attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-docker-status]').text()).toBe('factory.dockerMissing')
    expect(wrapper.find('[data-docker-guidance]').text()).toContain('factory.dockerNotRunningHint')

    factoryApi.context.mockResolvedValue({ ...context, dockerAvailable: true })
    await wrapper.find('[data-docker-recheck]').trigger('click')
    await vi.waitFor(() => expect(store.context?.dockerAvailable).toBe(true))
    expect(factoryApi.context).toHaveBeenCalledWith('D:/repo')

    const enabled = wrapper.find('[data-sandbox-option="docker"]')
    expect(enabled.attributes('disabled')).toBeUndefined()
    await enabled.trigger('click')
    expect(store.draft.sandbox?.type).toBe('docker')
    // 检测成功后仍然保留重新检测入口：Docker 之后退出也能再查。
    expect(wrapper.find('[data-docker-recheck]').exists()).toBe(true)
  })

  it('marks Podman as not installed and keeps custom trackers as unavailable', async () => {
    const store = seed({ step: 2 })
    const wrapper = mountWizard()

    const podman = wrapper.find('[data-sandbox-option="podman"]')
    expect(podman.attributes('disabled')).toBeDefined()
    expect(podman.text()).toContain('factory.sandboxPodmanMissing')

    store.step = 3
    await wrapper.vm.$nextTick()
    const custom = wrapper.find('[data-tracker-option="custom"]')
    expect(custom.attributes('disabled')).toBeDefined()
    expect(custom.text()).toContain('factory.comingSoon')
  })

  it('shows identity, repo and issue/label counts when the token test succeeds', async () => {
    const store = seed({ step: 3 })
    store.draft = { ...store.draft, tracker: { ...store.draft.tracker!, auth: 'token' } }
    factoryApi.testGithubToken.mockResolvedValue({
      ok: true,
      reason: 'ok',
      login: 'hjdspace',
      repo: 'hjdspace/SpaceCode',
      private: true,
      issueCount: 12,
      labelCount: 3,
    })
    const wrapper = mountWizard()

    await wrapper.find('input[type="password"]').setValue('ghp_typed')
    const testButton = wrapper.findAll('button').find((button) => button.text() === 'factory.testToken')
    await testButton!.trigger('click')

    await vi.waitFor(() => expect(wrapper.find('[data-token-result]').exists()).toBe(true))
    expect(factoryApi.testGithubToken).toHaveBeenCalledWith(
      'D:/repo',
      'ghp_typed',
      'hjdspace/SpaceCode',
      'ready-for-agent',
    )
    const result = wrapper.find('[data-token-result]')
    expect(result.text()).toContain('@hjdspace')
    expect(result.text()).toContain('hjdspace/SpaceCode')
    expect(result.text()).toContain('factory.repoPrivate')
    expect(result.text()).toContain('factory.tokenOpenCount|{"count":12}')
    expect(result.text()).toContain('factory.tokenLabelHits|{"label":"ready-for-agent","count":3}')
    expect(result.text()).toContain('factory.tokenWriteNote')
  })

  it('explains 401/403/404 when the token test fails', async () => {
    const store = seed({ step: 3 })
    store.draft = { ...store.draft, tracker: { ...store.draft.tracker!, auth: 'token' } }
    factoryApi.testGithubToken.mockResolvedValue({ ok: false, reason: 'repo-permission', status: 404 })
    const wrapper = mountWizard()

    await wrapper.find('input[type="password"]').setValue('ghp_wrong')
    const testButton = wrapper.findAll('button').find((button) => button.text() === 'factory.testToken')
    await testButton!.trigger('click')

    await vi.waitFor(() => expect(wrapper.find('[data-token-error]').exists()).toBe(true))
    const error = wrapper.find('[data-token-error]')
    expect(error.text()).toContain('factory.tokenStatusFromGithub|{"status":404}')
    expect(error.text()).toContain('factory.tokenHint404')
    // 只给与状态码对应的排查方向，不把 401/403 的建议一起倾倒。
    expect(error.text()).not.toContain('factory.tokenHint401')
    expect(error.text()).not.toContain('factory.tokenHint403')
  })

  it('forgets the previous test when the token text changes', async () => {
    const store = seed({ step: 3 })
    store.draft = { ...store.draft, tracker: { ...store.draft.tracker!, auth: 'token' } }
    store.tokenResult = { ok: true, reason: 'ok', login: 'hjdspace', repo: 'hjdspace/SpaceCode', private: true }
    const wrapper = mountWizard()

    expect(wrapper.find('[data-token-result]').exists()).toBe(true)
    await wrapper.find('input[type="password"]').setValue('ghp_other')
    await wrapper.vm.$nextTick()
    expect(store.tokenResult).toBeNull()
    expect(wrapper.find('[data-token-result]').exists()).toBe(false)
  })

  it('shows the token guide for gh login too', () => {
    seed({ step: 3 })
    const wrapper = mountWizard()

    expect(wrapper.find('[data-token-guide]').exists()).toBe(true)
  })

  it('keeps the token guide collapsed until asked and lists the four permissions', async () => {
    const store = seed({ step: 3 })
    store.draft = { ...store.draft, tracker: { ...store.draft.tracker!, auth: 'token' } }
    const wrapper = mountWizard()

    expect(wrapper.find('[data-token-guide-body]').exists()).toBe(false)
    await wrapper.find('[data-token-guide]').trigger('click')

    expect(wrapper.find('[data-token-guide-body]').exists()).toBe(true)
    const permissions = wrapper.findAll('[data-token-perm]').map((row) => row.text())
    expect(permissions).toHaveLength(4)
    for (const name of ['Metadata', 'Issues', 'Contents', 'Pull requests']) {
      expect(permissions.join(' ')).toContain(name)
    }
  })

  it('points at the desktop model profile and opens model settings', async () => {
    const store = seed({ step: 3 })
    store.draft = { ...store.draft, tracker: { type: 'local', mergeMode: 'local' } }
    const wrapper = mountWizard()

    const row = wrapper.find('[data-reuse-row]')
    expect(row.text()).toContain('factory.reuseModelTitle')
    expect(row.text()).toContain('anthropic · claude-sonnet-4-5')

    const listener = vi.fn()
    window.addEventListener('open-settings', listener)
    await row.find('[data-open-model-settings]').trigger('click')
    window.removeEventListener('open-settings', listener)

    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: 'model' })
  })

  it('does not claim reuse when the desktop model profile is not configured', () => {
    seed({
      step: 3,
      context: { ...context, modelProfile: { configured: false }, models: { selectable: [], default: 'qwen3.8-max' } },
    })
    const wrapper = mountWizard()

    expect(wrapper.find('[data-reuse-row]').text()).toContain('factory.reuseModelUnset')
  })

  it('states where the local backlog lives and how it is claimed', async () => {
    const store = seed({ step: 3 })
    store.draft = { ...store.draft, tracker: { type: 'local', mergeMode: 'local' } }
    const wrapper = mountWizard()

    expect(wrapper.find('[data-backlog-fact="storage"] dd').text()).toBe('.spacecode/factory/backlog.json')
    expect(wrapper.find('[data-backlog-fact="credentials"] dd').text()).toBe('factory.backlogNoCredentials')
    expect(wrapper.find('[data-backlog-fact="claim"] dd').text()).toBe('factory.backlogClaimManual')
  })
})
