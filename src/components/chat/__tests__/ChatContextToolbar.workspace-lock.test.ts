import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import ChatContextToolbar from '../ChatContextToolbar.vue'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useDesignStore } from '@/stores/design'
import zhCN from '@/i18n/locales/zh-CN'
import type { Session } from '@/types'

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
      listAgents: vi.fn().mockResolvedValue([]),
      listAllSessions: vi.fn().mockResolvedValue([]),
    },
    git: {
      getBranches: vi.fn().mockResolvedValue([]),
      getStatus: vi.fn().mockResolvedValue({ branch: 'main', files: [] }),
    },
    getCwd: vi.fn().mockResolvedValue(''),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: false, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    trace: { event: vi.fn() },
    selectFolder: vi.fn(),
  },
}))

// 工具栏只是这两个动作的调用方，各自的行为由自己的测试钉死；这里只验"锁定时不再调用"
const switchWorkingDirectory = vi.fn()
vi.mock('@/composables/useDesignSession', () => ({
  useDesignSession: () => ({ switchWorkingDirectory }),
}))

const openProjectByPath = vi.fn()
const openProjectFromPicker = vi.fn()
vi.mock('@/composables/useOpenProjectWorkflow', () => ({
  useOpenProjectWorkflow: () => ({ openProjectByPath, openProjectFromPicker }),
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN },
})

function addSession(mode: Session['mode'], workingDirectory: string, withMessage: boolean): Session {
  const chat = useChatSessionStore()
  const session = chat.createSession(mode ?? 'code', workingDirectory)
  session.mode = mode
  if (withMessage) {
    session.messages.push({ id: 'm1', role: 'user', content: 'hi', timestamp: 1 })
  }
  return session
}

function seedRecent(paths: string[]) {
  localStorage.setItem('app_recent_project_roots_v1', JSON.stringify(paths))
}

function hintText(): string {
  return document.querySelector('.app-hint-bubble')?.textContent || ''
}

async function mountToolbar(props: Record<string, unknown> = {}) {
  const w = mount(ChatContextToolbar, { props, global: { plugins: [i18n] } })
  await flushPromises()
  return w
}

function projectTrigger(w: Awaited<ReturnType<typeof mountToolbar>>) {
  return w.get('[data-testid="ctx-project-trigger"]')
}

describe('ChatContextToolbar 工作区锁定', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
    setActivePinia(createPinia())
  })

  it('design 会话发过消息后项目入口置灰，点击不展开下拉', async () => {
    useAppStore().setMode('design')
    addSession('design', 'D:/old', true)

    const w = await mountToolbar()
    const btn = projectTrigger(w)

    expect(btn.attributes('aria-disabled')).toBe('true')
    // 用 aria-disabled 而非 disabled：按钮要继续接收 hover，锁定原因才提示得出来
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('mouseenter')
    expect(hintText()).toContain('请新建会话')

    await btn.trigger('click')
    expect(w.find('[data-testid="ctx-project-dropdown"]').exists()).toBe(false)
    expect(switchWorkingDirectory).not.toHaveBeenCalled()
  })

  it('design 空会话仍可切换，且目录选择交给 switchWorkingDirectory 而不是本地写 store', async () => {
    const design = useDesignStore()
    useAppStore().setMode('design')
    addSession('design', 'D:/old', false)
    design.designWorkspace = 'D:/old'
    seedRecent(['D:/new'])

    const w = await mountToolbar()
    await projectTrigger(w).trigger('click')
    expect(w.find('[data-testid="ctx-project-dropdown"]').exists()).toBe(true)

    await w.get('[data-testid="ctx-project-item"]').trigger('click')
    expect(switchWorkingDirectory).toHaveBeenCalledWith('D:/new')
    expect(design.designWorkspace).toBe('D:/old')
  })

  it('受控模式（定时任务弹窗给任务挑目录）不受会话锁定影响', async () => {
    useAppStore().setMode('design')
    addSession('design', 'D:/old', true)
    seedRecent(['D:/new'])

    const w = await mountToolbar({ workspace: 'D:/old', branch: 'main' })
    const btn = projectTrigger(w)
    expect(btn.attributes('aria-disabled')).toBeUndefined()

    await btn.trigger('click')
    await w.get('[data-testid="ctx-project-item"]').trigger('click')

    expect(w.emitted('update:workspace')).toEqual([['D:/new']])
    expect(switchWorkingDirectory).not.toHaveBeenCalled()
  })

  it('work 模式不锁入口，但显示当前会话的真实目录并说明切换只对新会话生效', async () => {
    const app = useAppStore()
    const chat = useChatSessionStore()
    app.setMode('work')
    addSession('work', 'D:/session-dir', true)
    app.setWorkWorkspace('D:/new-workspace')

    const w = await mountToolbar()
    const btn = projectTrigger(w)

    expect(btn.attributes('aria-disabled')).toBeUndefined()
    expect(btn.text()).toContain('session-dir')
    await btn.trigger('mouseenter')
    expect(hintText()).toContain('仅对新建会话生效')
    expect(chat.currentSession?.workingDirectory).toBe('D:/session-dir')
  })

  it('code 模式历史会话不锁入口，但气泡说明选项目只是打开该项目的会话', async () => {
    useAppStore().setMode('code')
    addSession('code', 'D:/repo', true)

    const w = await mountToolbar()
    const btn = projectTrigger(w)

    expect(btn.attributes('aria-disabled')).toBeUndefined()
    await btn.trigger('mouseenter')
    expect(hintText()).toContain('当前会话的工作目录不变')
  })
})
