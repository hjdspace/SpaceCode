import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatPanel from '@/components/layout/ChatPanel.vue'
import NodeDrawer from '@/components/orchestration/NodeDrawer.vue'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { api } from '@/services/electronAPI'
import enUS from '@/i18n/locales/en-US'

vi.mock('@/services/llm', () => ({
  initLLMService: vi.fn(),
  llmState: { provider: ref(''), isConfigured: ref(false) },
}))

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS } })

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('orchestration node views', () => {
  it('opens only the selected conversation while the global tab remains orchestration', async () => {
    const app = useAppStore()
    app.activeCenterTab = 'orchestration-1'
    app.projectRoot = '/project'
    const sessions = useChatSessionStore()
    sessions.sessions = [1, 2].map(index => ({
      id: `node-session-${index}`, title: `Node ${index}`, workingDirectory: '/project',
      createdAt: 0, updatedAt: 0,
      processStatus: 'none', isTabOpen: true, lastActivityAt: 0,
      messages: [{ id: `message-${index}`, role: 'assistant', content: `Output ${index}`, timestamp: 0 }],
    }))
    sessions.currentSessionId = 'node-session-1'
    const drawer = shallowMount(NodeDrawer, {
      props: { sessionId: 'node-session-2' },
      global: { plugins: [i18n], stubs: { ChatPanel: false } },
    })
    await flushPromises()

    const panel = drawer.getComponent(ChatPanel)
    expect(panel.find('.orchestration-wrapper').exists()).toBe(false)
    expect(panel.find('.terminal-wrapper').exists()).toBe(false)
    expect(panel.get('.chat-content-wrapper').isVisible()).toBe(true)
    expect(panel.props('sessionId')).toBe('node-session-2')
    expect(panel.getComponent({ name: 'MessageList' }).props('messages')).toEqual(sessions.sessions[1].messages)
    sessions.sessions[1].messages[0].content += ' streaming update'
    await flushPromises()
    expect(panel.getComponent({ name: 'MessageList' }).props('messages')[0].content).toBe('Output 2 streaming update')
    expect(app.activeCenterTab).toBe('orchestration-1')
    expect(sessions.currentSessionId).toBe('node-session-1')
  })

  it.each(['@', '/'])('anchors %s menus to each input outside the transformed canvas', async (trigger) => {
    vi.spyOn(api, 'searchFiles').mockResolvedValue([{
      name: 'example.ts', path: '/project/example.ts', relativePath: 'example.ts', isDirectory: false, isFile: true,
    }])
    const canvas = document.createElement('div')
    canvas.style.transform = 'translate(150px, 80px) scale(0.6)'
    canvas.style.overflow = 'hidden'
    document.body.appendChild(canvas)
    const inputs = [0, 1].map(() => mount(ChatInput, {
      attachTo: canvas,
      props: { workingDirectory: '/project' },
      global: { plugins: [i18n], stubs: { ChatContextToolbar: true, ComposerStatusBar: true, PermissionModeSelector: true } },
    }))

    for (const [index, input] of inputs.entries()) {
      const container = input.get('.chat-input-container').element
      const editor = input.get('[contenteditable]').element
      const left = 100 + index * 450
      const top = 350 + index * 200
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, top, 300, 100))
      vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(left + 10, top + 10, 280, 60))
      editor.textContent = trigger
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      await input.get('[contenteditable]').trigger('input')
      await flushPromises()

      const selector = trigger === '@' ? '.context-menu' : '.slash-command-menu'
      const menu = document.querySelector<HTMLElement>(selector)
      expect(menu).not.toBeNull()
      expect(canvas.contains(menu)).toBe(false)
      expect(menu!.style.left).toBe(`${left}px`)
      expect(menu!.style.bottom).toBe(`${window.innerHeight - top - 10 + 8}px`)
      const item = trigger === '@'
        ? menu!.querySelector<HTMLButtonElement>('.dropdown-item')
        : Array.from(menu!.querySelectorAll<HTMLButtonElement>('.dropdown-item')).find(item => item.querySelector('.item-name')?.textContent === 'review')
      expect(item).toBeTruthy()
      item!.click()
      await flushPromises()
      expect(editor.textContent).toContain(trigger === '@' ? 'example.ts' : 'review')
      expect(document.querySelector(selector)).toBeNull()
    }
  })
})
