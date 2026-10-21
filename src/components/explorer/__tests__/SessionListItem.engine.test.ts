import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Session } from '@/types'
import SessionListItem from '../SessionListItem.vue'

const i18nMock = vi.hoisted(() => ({
  translate: (key: string) => {
    if (key === 'explorer.enginePi') return 'Pi'
    if (key === 'explorer.engineClaudeCode') return 'Claude Code'
    return key
  },
}))

vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      locale: { value: 'en-US' },
      t: i18nMock.translate,
    },
  }),
  useI18n: () => ({ t: i18nMock.translate }),
}))

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Session',
    messages: [],
    createdAt: 1,
    updatedAt: 2,
    processStatus: 'none',
    isTabOpen: true,
    lastActivityAt: 2,
    ...overrides,
  }
}

function mountItem(overrides: Partial<Session> = {}) {
  return mount(SessionListItem, {
    props: {
      session: session(overrides),
      isActive: false,
      isHovered: false,
      isDeleting: false,
      isStreaming: false,
      needsApproval: false,
      processStatus: 'none',
      formatRelativeTime: () => 'now',
    },
    global: {
      stubs: {
        SessionThumbnailTooltip: true,
      },
    },
  })
}

describe('SessionListItem engine badge', () => {
  it('labels pi sessions', () => {
    const wrapper = mountItem({ engineType: 'pi' })
    const badge = wrapper.find('.engine-badge')

    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('Pi')
    expect(badge.classes()).toContain('engine-pi')
  })

  it('labels Claude Code sessions', () => {
    const wrapper = mountItem({ engineType: 'claude-code' })
    const badge = wrapper.find('.engine-badge')

    expect(badge.text()).toBe('CC')
    expect(badge.classes()).toContain('engine-claude-code')
    expect(badge.attributes('title')).toBe('Claude Code')
  })

  it('shows no badge for sessions that never started an engine', () => {
    expect(mountItem().find('.engine-badge').exists()).toBe(false)
  })
})
