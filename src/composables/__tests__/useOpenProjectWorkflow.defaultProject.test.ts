import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const {
  ensureDefaultWorkspaceMock,
  showAlertSpy,
  setProjectRootSpy,
  saveSettingsSpy,
  addProjectSpy,
  switchProjectSpy,
  createSessionSpy,
} = vi.hoisted(() => ({
  ensureDefaultWorkspaceMock: vi.fn(),
  showAlertSpy: vi.fn().mockResolvedValue(undefined),
  setProjectRootSpy: vi.fn(),
  saveSettingsSpy: vi.fn(),
  addProjectSpy: vi.fn(),
  switchProjectSpy: vi.fn(),
  createSessionSpy: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({ showAlert: showAlertSpy }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    ensureDefaultWorkspace: ensureDefaultWorkspaceMock,
    selectFolder: vi.fn(),
  },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    setProjectRoot: setProjectRootSpy,
    mode: 'chat',
  }),
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    projectRoot: '',
    saveSettings: saveSettingsSpy,
  }),
}))

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => ({
    addProject: addProjectSpy,
    switchProject: switchProjectSpy,
    createSession: createSessionSpy,
  }),
}))

import { useOpenProjectWorkflow } from '../useOpenProjectWorkflow'

const DEFAULT_DIR = 'C:\\Users\\test\\Documents\\SpaceCode'

describe('useOpenProjectWorkflow.openDefaultProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    ensureDefaultWorkspaceMock.mockResolvedValue(DEFAULT_DIR)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('在默认工作区目录建会话，并同步 projectRoot / recent / settings，返回 true', async () => {
    const { openDefaultProject } = useOpenProjectWorkflow()
    await expect(openDefaultProject()).resolves.toBe(true)

    expect(ensureDefaultWorkspaceMock).toHaveBeenCalledTimes(1)
    expect(setProjectRootSpy).toHaveBeenCalledWith(DEFAULT_DIR)
    expect(addProjectSpy).toHaveBeenCalledWith(DEFAULT_DIR)
    expect(switchProjectSpy).toHaveBeenCalledWith(DEFAULT_DIR)
    expect(saveSettingsSpy).toHaveBeenCalledTimes(1)
    expect(createSessionSpy).toHaveBeenCalledWith('common.newChat', DEFAULT_DIR)
    expect(showAlertSpy).not.toHaveBeenCalled()
  })

  it('拿不到默认目录（如非 Electron 环境）时弹提示并返回 false，不建会话', async () => {
    ensureDefaultWorkspaceMock.mockResolvedValue('')
    const { openDefaultProject } = useOpenProjectWorkflow()
    await expect(openDefaultProject()).resolves.toBe(false)

    expect(showAlertSpy).toHaveBeenCalledWith('welcomeNoProject.defaultWorkspaceFailed')
    expect(setProjectRootSpy).not.toHaveBeenCalled()
    expect(createSessionSpy).not.toHaveBeenCalled()
  })

  it('ensureDefaultWorkspace 抛错时返回 false、弹提示且不向上传播', async () => {
    ensureDefaultWorkspaceMock.mockRejectedValue(new Error('ipc failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { openDefaultProject } = useOpenProjectWorkflow()
    await expect(openDefaultProject()).resolves.toBe(false)

    expect(showAlertSpy).toHaveBeenCalledWith('welcomeNoProject.defaultWorkspaceFailed')
    expect(createSessionSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('并发调用共享同一 in-flight promise，只 bootstrap 一次', async () => {
    const { openDefaultProject } = useOpenProjectWorkflow()
    const [a, b] = await Promise.all([openDefaultProject(), openDefaultProject()])

    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(ensureDefaultWorkspaceMock).toHaveBeenCalledTimes(1)
    expect(createSessionSpy).toHaveBeenCalledTimes(1)
  })
})
