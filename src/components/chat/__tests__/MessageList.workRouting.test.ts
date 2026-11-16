import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import MessageList from '../MessageList.vue'
import type { Message } from '@/types'
import type { WorkRoutingCardState } from '@/types/workRouting'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
const rootPinia = createPinia()
config.global.plugins = [i18n, rootPinia]

const MessageItemStub = defineComponent({
  name: 'MessageItem',
  props: { message: { type: Object, required: true }, readonly: Boolean, canRewind: Boolean },
  template: '<div class="message-item-stub" data-test="held-bubble">{{ message.content }}</div>',
})

const STUBS = {
  MessageItem: MessageItemStub,
  AgentTimeline: true,
  DesignBlocks: true,
  CurrentTurnChangeCard: true,
  ArtifactSummaryCard: true,
  ConversationMinimap: true,
  LoadingState: true,
  ExtensionDialogCard: true,
}

function heldMessage(): Message {
  return {
    id: 'held-1',
    role: 'user',
    content: '帮我做个可编辑的 PPT',
    timestamp: 1,
    attachments: [{ name: 'outline.md', path: 'D:/work/outline.md', isFolder: false }],
    imageAttachments: [],
  }
}

function mountWith(card: WorkRoutingCardState) {
  return mount(MessageList, {
    props: {
      messages: [],
      loading: false,
      sessionId: 'session-1',
      heldMessage: heldMessage(),
      workRoutingCard: card,
    },
    global: { stubs: STUBS },
  })
}

describe('MessageList 路由候选卡', () => {
  beforeEach(() => {
    setActivePinia(rootPinia)
  })

  it('anchors the card inside the held message block and suppresses the empty state', () => {
    const wrapper = mountWith({
      phase: 'candidates',
      ranked: [
        { name: 'ppt-creator', score: 0.5, reason: '可编辑的 .pptx' },
        { name: 'html-ppt-creator', score: 0.45, reason: '网页幻灯片' },
      ],
      suggestions: [],
    })

    const held = wrapper.find('[data-test="held-work-message"]')
    const card = wrapper.find('[data-test="work-routing-card"]')

    expect(held.exists()).toBe(true)
    expect(card.exists()).toBe(true)
    expect(held.element.contains(card.element)).toBe(true)
    expect(wrapper.find('.empty-state').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="work-routing-candidate"]')).toHaveLength(2)
  })

  it('re-emits the card choices to the host', async () => {
    const wrapper = mountWith({
      phase: 'candidates',
      ranked: [{ name: 'ppt-creator', score: 0.5, reason: '可编辑的 .pptx' }],
      suggestions: [],
    })

    await wrapper.find('[data-test="work-routing-candidate"]').trigger('click')
    await wrapper.find('[data-test="work-routing-general"]').trigger('click')

    expect(wrapper.emitted('routingPick')?.[0]).toEqual(['ppt-creator'])
    expect(wrapper.emitted('routingGeneral')).toHaveLength(1)
  })

  it('shows the matching state with a cancel action', async () => {
    const wrapper = mountWith({ phase: 'matching', ranked: [], suggestions: [] })

    expect(wrapper.find('[data-test="work-routing-title"]').text()).toContain('正在匹配助手')
    expect(wrapper.findAll('[data-test="work-routing-candidate"]')).toHaveLength(0)

    await wrapper.find('[data-test="work-routing-cancel"]').trigger('click')
    expect(wrapper.emitted('routingCancel')).toHaveLength(1)
  })

  it('failure form offers suggestions, general chat and the gallery', async () => {
    const wrapper = mountWith({
      phase: 'candidates',
      ranked: [],
      failure: 'timeout',
      suggestions: [
        { name: 'ppt-creator', description: '可编辑演示文稿' },
        { name: 'docx-writer', description: '文档写作' },
      ],
    })

    expect(wrapper.findAll('[data-test="work-routing-suggestion"]')).toHaveLength(2)
    await wrapper.find('[data-test="work-routing-general"]').trigger('click')
    await wrapper.find('[data-test="work-routing-gallery"]').trigger('click')

    expect(wrapper.emitted('routingGeneral')).toHaveLength(1)
    expect(wrapper.emitted('routingGallery')).toHaveLength(1)
  })
})
