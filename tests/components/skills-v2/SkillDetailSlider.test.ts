import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import zhCN from '@/i18n/locales/zh-CN'
import type { SkillDetail } from '@/types/skillManagerV2'

const storeMocks = vi.hoisted(() => ({ store: {} as Record<string, unknown> }))
const apiMocks = vi.hoisted(() => ({ readFile: vi.fn() }))

vi.mock('@/stores/skillManagerStore', () => ({
  useSkillManagerStore: () => storeMocks.store,
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))

import SkillDetailSlider from '@/components/skills-v2/SkillDetailSlider.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'zh-CN': zhCN },
})

const detail: SkillDetail = {
  id: 'ask-matt',
  name: 'ask-matt',
  description: 'Ask which skill fits the situation.',
  skillType: 'skill',
  centerPath: 'C:\\skills\\ask-matt',
  currentHash: '1234567890abcdef',
  frontmatterJson: '{"name":"ask-matt"}',
  source: null,
  targets: [
    {
      id: 'target-claude',
      skillId: 'ask-matt',
      agentId: 'claude-code',
      targetPath: 'C:\\Users\\tester\\.claude\\skills\\ask-matt',
      installMode: 'link',
      actualMode: 'link',
      sourceHash: 'hash',
      currentHash: 'hash',
      status: 'ok',
      createdAt: '2026-08-17',
      updatedAt: '2026-08-17',
    },
    {
      id: 'target-codex',
      skillId: 'ask-matt',
      agentId: 'codex',
      targetPath: 'C:\\Users\\tester\\.codex\\skills\\ask-matt',
      installMode: 'copy',
      actualMode: 'copy',
      sourceHash: 'hash',
      currentHash: 'hash',
      status: 'ok',
      createdAt: '2026-08-17',
      updatedAt: '2026-08-17',
    },
  ],
  claims: [
    { id: 'claim-1', targetId: 'target-claude', claimType: 'direct', packId: null, createdAt: '2026-08-17' },
    { id: 'claim-2', targetId: 'target-codex', claimType: 'pack', packId: 'daily-tools', createdAt: '2026-08-17' },
  ],
  files: {
    name: 'ask-matt',
    nodeType: 'dir',
    path: 'C:\\skills\\ask-matt',
    children: [
      { name: 'SKILL.md', nodeType: 'file', path: 'C:\\skills\\ask-matt\\SKILL.md', children: null },
      {
        name: 'references',
        nodeType: 'dir',
        path: 'C:\\skills\\ask-matt\\references',
        children: [
          { name: 'guide.md', nodeType: 'file', path: 'C:\\skills\\ask-matt\\references\\guide.md', children: null },
        ],
      },
    ],
  },
  createdAt: '2026-08-17',
  updatedAt: '2026-08-17',
  lastScannedAt: '2026-08-17',
}

function mountSlider() {
  return mount(SkillDetailSlider, {
    global: {
      plugins: [i18n],
      stubs: {
        MarkdownRenderer: {
          props: ['content'],
          template: '<div data-testid="markdown">{{ content }}</div>',
        },
        AgentIconBadge: true,
        DistributeDialog: true,
      },
    },
  })
}

async function loadDetail() {
  const wrapper = mountSlider()
  ;(storeMocks.store as { selectedSkillDetail: SkillDetail | null }).selectedSkillDetail = detail
  await flushPromises()
  return wrapper
}

describe('SkillDetailSlider', () => {
  beforeEach(() => {
    apiMocks.readFile.mockReset()
    apiMocks.readFile.mockImplementation(async (path: string) => path.endsWith('guide.md')
      ? '# Guide\n\nReference content.'
      : '---\nname: ask-matt\n---\n# Ask Matt')

    storeMocks.store = reactive({
      selectedSkillId: 'ask-matt',
      selectedSkillDetail: null as SkillDetail | null,
      detailLoading: false,
      busyAction: null as string | null,
      agents: [
        { id: 'claude-code', displayName: 'Claude Code' },
        { id: 'codex', displayName: 'Codex' },
      ],
      clearSelectedSkill: vi.fn(),
      openPath: vi.fn().mockResolvedValue(undefined),
      deleteTarget: vi.fn().mockResolvedValue(undefined),
      loadSkillDetail: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('renders a collapsible file tree and switches Markdown between preview and source', async () => {
    const wrapper = await loadDetail()
    await wrapper.get('.sds-tabs button:nth-child(2)').trigger('click')

    expect(wrapper.text()).toContain('references')
    expect(wrapper.text()).toContain('guide.md')

    const directoryButton = wrapper.findAll('.sds-file-tree-scroll > button').find((button) => button.text().includes('references'))
    await directoryButton!.trigger('click')
    expect(wrapper.text()).not.toContain('guide.md')
    await directoryButton!.trigger('click')

    const guideButton = wrapper.findAll('.sds-file-tree-scroll > button').find((button) => button.text().includes('guide.md'))
    await guideButton!.trigger('click')
    await flushPromises()
    expect(apiMocks.readFile).toHaveBeenCalledWith('C:\\skills\\ask-matt\\references\\guide.md')
    expect(wrapper.get('[data-testid="markdown"]').text()).toContain('Guide')

    await wrapper.findAll('.sds-file-mode button')[1].trigger('click')
    expect(wrapper.get('.sds-file-content pre').text()).toContain('# Guide')
  })

  it('opens and removes an individual Agent distribution from its card', async () => {
    const wrapper = await loadDetail()
    await wrapper.get('.sds-tabs button:nth-child(3)').trigger('click')

    const claudeCard = wrapper.findAll('.sds-target-card').find((card) => card.text().includes('Claude Code'))!
    const actionButtons = claudeCard.findAll('footer button')
    await actionButtons[0].trigger('click')
    expect((storeMocks.store.openPath as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(detail.targets[0].targetPath)

    await actionButtons[1].trigger('click')
    await wrapper.get('.pd-btn-confirm').trigger('click')
    await flushPromises()
    expect((storeMocks.store.deleteTarget as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('target-claude')
    expect((storeMocks.store.loadSkillDetail as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('ask-matt')
  })

  it('selects and removes multiple Agent distributions', async () => {
    const wrapper = await loadDetail()
    await wrapper.get('.sds-tabs button:nth-child(3)').trigger('click')
    await wrapper.findAll('.sds-agent-toolbar button')[0].trigger('click')
    await wrapper.get('.sds-agent-toolbar input[type="checkbox"]').trigger('change')
    await wrapper.findAll('.sds-agent-toolbar button')[1].trigger('click')
    await wrapper.get('.pd-btn-confirm').trigger('click')
    await flushPromises()

    expect((storeMocks.store.deleteTarget as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
    expect((storeMocks.store.deleteTarget as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(1, 'target-claude')
    expect((storeMocks.store.deleteTarget as ReturnType<typeof vi.fn>)).toHaveBeenNthCalledWith(2, 'target-codex')
  })
})
