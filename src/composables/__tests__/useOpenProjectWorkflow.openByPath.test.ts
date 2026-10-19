import { describe, it, expect, beforeEach, vi } from 'vitest'

const {
  setProjectRootSpy,
  switchProjectSpy,
  selectSessionSpy,
  createSessionSpy,
  state,
} = vi.hoisted(() => ({
  setProjectRootSpy: vi.fn(),
  switchProjectSpy: vi.fn(),
  selectSessionSpy: vi.fn(),
  createSessionSpy: vi.fn(),
  state: { sessions: [] as Array<{ id: string; workingDirectory?: string; updatedAt?: number }> },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({ showAlert: vi.fn() }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: { ensureDefaultWorkspace: vi.fn(), selectFolder: vi.fn() },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ setProjectRoot: setProjectRootSpy, mode: 'code' }),
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ projectRoot: '', saveSettings: vi.fn() }),
}))

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => ({
    addProject: vi.fn(),
    switchProject: switchProjectSpy,
    createSession: createSessionSpy,
    selectSession: selectSessionSpy,
    sessions: state.sessions,
  }),
}))

import { useOpenProjectWorkflow } from '../useOpenProjectWorkflow'

// 侧边栏与 JSONL 恢复存的是归一化写法，工具栏/最近项目传进来的却可能是斜杠形式
describe('useOpenProjectWorkflow.openProjectByPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    state.sessions.length = 0
  })

  it('按归一化后的路径匹配已有会话，不重复建会话', () => {
    state.sessions.push({ id: 'existing', workingDirectory: 'D:\\AI\\SpaceCode', updatedAt: 1 })

    useOpenProjectWorkflow().openProjectByPath('D:/AI/SpaceCode')

    expect(selectSessionSpy).toHaveBeenCalledWith('existing')
    expect(createSessionSpy).not.toHaveBeenCalled()
    expect(switchProjectSpy).toHaveBeenCalledWith('D:\\AI\\SpaceCode')
    expect(setProjectRootSpy).toHaveBeenCalledWith('D:\\AI\\SpaceCode')
  })

  it('项目下没有会话时才新建，且写入的是归一化路径', () => {
    useOpenProjectWorkflow().openProjectByPath('D:/AI/SpaceCode')

    expect(selectSessionSpy).not.toHaveBeenCalled()
    expect(createSessionSpy).toHaveBeenCalledWith('common.newChat', 'D:\\AI\\SpaceCode')
  })
})
