import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Session } from '@/types'
import SessionListItem from '../SessionListItem.vue'

const i18nMock = vi.hoisted(() => ({
  translate: (key: string) => key,
}))

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'en-US' }, t: i18nMock.translate } }),
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

function mountItem(props: Record<string, unknown> = {}) {
  return mount(SessionListItem, {
    props: {
      session: session(),
      isActive: false,
      isHovered: false,
      isDeleting: false,
      isStreaming: false,
      needsApproval: false,
      processStatus: 'none',
      formatRelativeTime: () => 'now',
      ...props,
    },
    global: { stubs: { SessionThumbnailTooltip: true } },
  })
}

function menuItem(): HTMLButtonElement | null {
  return document.body.querySelector('[data-testid="session-archive-menu-item"]')
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('SessionListItem archive entry points', () => {
  it('keeps the archive button out of the way until the row is hovered', () => {
    expect(mountItem().find('[data-testid="session-archive-button"]').exists()).toBe(false)
    expect(mountItem({ isHovered: true }).find('[data-testid="session-archive-button"]').exists()).toBe(true)
  })

  it('labels the hover button for tooltip and screen reader', () => {
    const button = mountItem({ isHovered: true }).find('[data-testid="session-archive-button"]')
    expect(button.attributes('title')).toBe('explorer.archiveConversation')
    expect(button.attributes('aria-label')).toBe('explorer.archiveConversation')
  })

  it('emits archive without selecting the session or opening the menu', async () => {
    const wrapper = mountItem({ isHovered: true })

    await wrapper.find('[data-testid="session-archive-button"]').trigger('click')

    expect(wrapper.emitted('archive')).toHaveLength(1)
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(menuItem()).toBeNull()
  })

  it('offers archive as a destructive item in the three-dot menu', async () => {
    const wrapper = mountItem({ isHovered: true })
    await wrapper.find('.menu-trigger').trigger('click')

    const item = menuItem()
    expect(item).not.toBeNull()
    expect(item!.classList.contains('destructive')).toBe(true)
    expect(item!.textContent).toContain('explorer.archiveConversation')
  })

  it('emits archive from the menu and closes it, without deleting', async () => {
    const wrapper = mountItem({ isHovered: true })
    await wrapper.find('.menu-trigger').trigger('click')

    menuItem()!.click()
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('archive')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toBeUndefined()
    expect(menuItem()).toBeNull()
  })
})