import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import MessageList from '../MessageList.vue'
import { extensionDialogService, type ExtensionDialog } from '@/services/extensionDialogService'
import type { Message } from '@/types'
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

const AgentTimelineStub = defineComponent({
  name: 'AgentTimeline',
  props: {
    messages: { type: Array, required: true },
    dialogs: { type: Array, default: undefined },
    loading: Boolean,
    mode: String,
  },
  template: '<div class="agent-timeline-stub" />',
})

const ExtensionDialogCardStub = defineComponent({
  name: 'ExtensionDialogCard',
  props: { dialog: { type: Object, required: true } },
  template: '<div class="extension-dialog-stub" />',
})

const STUBS = {
  AgentTimeline: AgentTimelineStub,
  ExtensionDialogCard: ExtensionDialogCardStub,
  MessageItem: true,
  DesignBlocks: true,
  CurrentTurnChangeCard: true,
  ArtifactSummaryCard: true,
  ConversationMinimap: true,
  ThinkingState: true,
}

function assistant(id: string): Message {
  return {
    id,
    role: 'assistant',
    content: id,
    timestamp: 1,
    timelineEvents: [{ id: `${id}-text`, type: 'text', timestamp: 1, status: 'completed', content: id }],
  }
}

function user(id: string): Message {
  return { id, role: 'user', content: id, timestamp: 2 }
}

function openDialog(sessionId: string, dialog: Record<string, unknown>): void {
  extensionDialogService.open(sessionId, dialog as never)
}

function mountList(messages: Message[], sessionId: string) {
  return mount(MessageList, {
    props: { messages, loading: false, sessionId },
    global: { stubs: STUBS },
  })
}

function dialogIds(dialogs: ExtensionDialog[] | undefined): string[] {
  return (dialogs ?? []).map(dialog => dialog.dialogId)
}

describe('MessageList 扩展对话框归属', () => {
  beforeEach(() => {
    setActivePinia(rootPinia)
    extensionDialogService.clear()
    // jsdom 没实现 Element.scrollTo；MessageList 的自动滚动 rAF 会在测试结束后触发
    ;(HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = vi.fn()
  })

  it('按 assistant 分组分配：第一轮的卡片不会出现在第二轮', () => {
    openDialog('sid-a', {
      dialogId: 'd1', method: 'select', title: '第一轮', options: ['A'],
      anchorMessageId: 'm1', anchorEventId: 'm1-text',
    })
    openDialog('sid-a', {
      dialogId: 'd2', method: 'select', title: '第二轮', options: ['A'],
      anchorMessageId: 'm2', anchorEventId: 'm2-text',
    })

    const wrapper = mountList([assistant('m1'), user('u2'), assistant('m2')], 'sid-a')
    const timelines = wrapper.findAllComponents({ name: 'AgentTimeline' })

    expect(timelines).toHaveLength(2)
    expect(dialogIds(timelines[0].props('dialogs'))).toEqual(['d1'])
    expect(dialogIds(timelines[1].props('dialogs'))).toEqual(['d2'])
  })

  it('没有游标的卡片只在最后一组出现一次', () => {
    openDialog('sid-a', { dialogId: 'd1', method: 'confirm', title: '信任这个目录？' })

    const wrapper = mountList([assistant('m1'), user('u2'), assistant('m2')], 'sid-a')
    const timelines = wrapper.findAllComponents({ name: 'AgentTimeline' })

    expect(dialogIds(timelines[0].props('dialogs'))).toEqual([])
    expect(dialogIds(timelines[1].props('dialogs'))).toEqual(['d1'])
  })

  it('游标指向已被替换的旧消息时，落到最后一组', () => {
    openDialog('sid-a', {
      dialogId: 'd1', method: 'select', title: '旧提问', options: ['A'],
      anchorMessageId: 'm-removed', anchorEventId: 'gone',
    })

    const wrapper = mountList([assistant('m1'), user('u2'), assistant('m2')], 'sid-a')
    const timelines = wrapper.findAllComponents({ name: 'AgentTimeline' })

    expect(dialogIds(timelines[0].props('dialogs'))).toEqual([])
    expect(dialogIds(timelines[1].props('dialogs'))).toEqual(['d1'])
  })

  it('只取本会话的对话框，分屏渲染别的会话时不串卡', () => {
    openDialog('sid-b', { dialogId: 'd1', method: 'confirm', title: '另一个会话的问题' })

    const messages = [assistant('m1')]
    const other = mountList(messages, 'sid-a')
    expect(dialogIds(other.findComponent({ name: 'AgentTimeline' }).props('dialogs'))).toEqual([])

    const current = mountList(messages, 'sid-b')
    expect(dialogIds(current.findComponent({ name: 'AgentTimeline' }).props('dialogs'))).toEqual(['d1'])
  })

  it('还没有 assistant 分组时，卡片直接挂在列表里', () => {
    openDialog('sid-a', { dialogId: 'd1', method: 'confirm', title: '信任这个目录？' })

    const wrapper = mountList([user('u1')], 'sid-a')

    expect(wrapper.findAllComponents({ name: 'AgentTimeline' })).toHaveLength(0)
    expect(wrapper.findAllComponents({ name: 'ExtensionDialogCard' })).toHaveLength(1)
  })

  it('新到的对话框会被重新分配到最后一组', async () => {
    const wrapper = mountList([assistant('m1'), user('u2'), assistant('m2')], 'sid-a')
    expect(dialogIds(wrapper.findAllComponents({ name: 'AgentTimeline' })[1].props('dialogs'))).toEqual([])

    openDialog('sid-a', {
      dialogId: 'd1', method: 'select', title: '刚弹出来的', options: ['A'],
      anchorMessageId: 'm2', anchorAtStart: true,
    })
    await nextTick()

    expect(dialogIds(wrapper.findAllComponents({ name: 'AgentTimeline' })[1].props('dialogs'))).toEqual(['d1'])
  })
})
