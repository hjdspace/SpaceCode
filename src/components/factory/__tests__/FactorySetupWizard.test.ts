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
  modelProfile: { configured: true, model: 'claude-sonnet-4-5' },
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
  factoryApi.githubRepos.mockResolvedValue({ ok: true, repos: githubRepos })
  factoryApi.preflight.mockResolvedValue(passing)
  factoryApi.save.mockResolvedValue({ ok: true })
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

describe('FactorySetupWizard', () => {
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
})
