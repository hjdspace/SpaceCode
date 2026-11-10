import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuperAgentTicketCard } from '@/shared/channels/superAgent'
import TicketTimelineEntry from '../TicketTimelineEntry.vue'

const probe = vi.hoisted(() => ({
  readFile: vi.fn(),
  openFile: vi.fn(),
  openOfficePreview: vi.fn(),
  openFileInWebview: vi.fn(),
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => probe }))
vi.mock('@/services/electronAPI', () => ({ api: { readFile: probe.readFile } }))
vi.mock('vue-i18n', async importOriginal => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key }),
}))

const card: SuperAgentTicketCard = {
  ticketId: 'ticket-1', title: '分析项目', state: 'review', assignmentId: 'assignment-1',
  generation: 1, scopePaths: [], createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:01:00Z', ended: null, reviewRemindedAt: null,
  canRetry: false, canStop: true,
}
function render(artifacts?: string[]) {
  return mount(TicketTimelineEntry, {
    props: { card: { ...card, ...(artifacts ? { artifacts } : {}) } },
    global: { stubs: { WorkerTaskCard: true, AttentionBubble: true } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  probe.readFile.mockResolvedValue('# Report')
  probe.openFile.mockResolvedValue(undefined)
  probe.openFileInWebview.mockResolvedValue(undefined)
})

describe('TicketTimelineEntry reported artifacts', () => {
  it('opens Markdown in the right panel using the worker absolute path, without opening the worker', async () => {
    const wrapper = render(['D:/worktrees/worker/docs/优化方案.md'])
    const file = wrapper.get('[data-testid="super-agent-artifact"]')
    expect(file.element.tagName).toBe('BUTTON')
    expect(file.text()).toContain('优化方案.md')
    await file.trigger('click')
    await flushPromises()
    expect(probe.openFile).toHaveBeenCalledWith('D:/worktrees/worker/docs/优化方案.md')
    expect(wrapper.emitted('open')).toBeUndefined()
    wrapper.unmount()
  })

  it('uses the in-app office and HTML viewers', async () => {
    const wrapper = render(['D:/repo/report.pdf', 'D:/repo/demo.html'])
    await wrapper.findAll('[data-testid="super-agent-artifact"]')[0].trigger('click')
    await wrapper.findAll('[data-testid="super-agent-artifact"]')[1].trigger('click')
    await flushPromises()
    expect(probe.openOfficePreview).toHaveBeenCalledWith('D:/repo/report.pdf')
    expect(probe.openFileInWebview).toHaveBeenCalledWith('D:/repo/demo.html')
    expect(probe.openFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows a visible error when the reported document no longer exists', async () => {
    probe.readFile.mockResolvedValue(null)
    const wrapper = render(['D:/repo/missing.md'])
    await wrapper.get('[data-testid="super-agent-artifact"]').trigger('click')
    await flushPromises()
    expect(probe.openFile).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('superAgent.artifacts.unavailable')
    wrapper.unmount()
  })

  it('reports a failed HTML preview request instead of leaving an unhandled rejection', async () => {
    probe.openFileInWebview.mockRejectedValueOnce(new Error('preview unavailable'))
    const wrapper = render(['D:/repo/demo.html'])
    await wrapper.get('[data-testid="super-agent-artifact"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('superAgent.artifacts.unavailable')
    wrapper.unmount()
  })

  it('renders delivered images in the built-in viewer instead of the text editor', async () => {
    const wrapper = render(['D:/repo/shot.png'])
    await wrapper.get('[data-testid="super-agent-artifact"]').trigger('click')
    await flushPromises()
    expect(probe.openFileInWebview).toHaveBeenCalledWith('D:/repo/shot.png')
    expect(probe.readFile).not.toHaveBeenCalled()
    expect(probe.openFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('refuses to render a non-previewable binary as text', async () => {
    const wrapper = render(['D:/repo/bundle.zip'])
    await wrapper.get('[data-testid="super-agent-artifact"]').trigger('click')
    await flushPromises()
    expect(probe.readFile).not.toHaveBeenCalled()
    expect(probe.openFile).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('superAgent.artifacts.unsupported')
    wrapper.unmount()
  })

  it('does not reserve space when the report contains no files', () => {
    const wrapper = render()
    expect(wrapper.find('[data-testid="super-agent-artifacts"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
