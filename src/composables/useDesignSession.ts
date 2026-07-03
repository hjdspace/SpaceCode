import { useDesignStore } from '@/stores/design'
import { useChatStore, useChatSessionStore } from '@/stores/chat'
import { api } from '@/services/electronAPI'
import { findFirstQuestionForm, splitOnQuestionForms } from '@/utils/design/questionForm'
import { ref } from 'vue'

export function useDesignSession() {
  const designStore = useDesignStore()
  const chatStore = useChatStore()
  const chatSessionStore = useChatSessionStore()
  const isGenerating = ref(false)
  const listenerDisposers = new Map<string, () => void>()

  async function createDesignSession(): Promise<string> {
    const userDataPath = await api.app.getPath('userData')
    const workspacePath = `${userDataPath}/design-workspace/${Date.now()}`
    designStore.designWorkspace = workspacePath

    const session = chatSessionStore.createSession('Design Session', workspacePath)
    session.mode = 'design'

    const systemPrompt = await api.design.composePromptStack({
      skillName: designStore.selectedToolboxSkillId,
      locale: 'zh-CN',
    })

    await chatSessionStore.initClaudeCodeSession(session.id, {
      systemPrompt,
      cwd: workspacePath,
      agent: 'ui-ux-pro-max',
    })

    await api.design.startFileWatcher(session.id, workspacePath)

    // 所有 init 完成后才暴露 sid，避免半初始化会话被后续操作触达
    designStore.activeSessionId = session.id

    attachStreamListener(session.id)
    return session.id
  }

  async function switchToolboxSkill(skillId: string): Promise<void> {
    designStore.selectedToolboxSkillId = skillId
    // 先重新拼装提示词栈：切换技能即改变 system prompt 的核心输入，
    // 无论当前是否存在活跃会话都应触发 compose，便于上层校验技能可用性。
    const systemPrompt = await api.design.composePromptStack({
      skillName: skillId,
      locale: 'zh-CN',
    })
    const sid = designStore.activeSessionId
    if (!sid) return
    await chatSessionStore.initClaudeCodeSession(sid, {
      systemPrompt,
      cwd: designStore.designWorkspace,
      agent: 'ui-ux-pro-max',
    })
  }

  function attachStreamListener(sessionId: string) {
    const claudeCode = api.claudeCode
    if (!claudeCode) return
    let accumulated = ''
    const disposer = claudeCode.onStreamEvent(({ data, sessionId: evSid }: any) => {
      if (evSid !== sessionId) return
      if (data.type === 'text_delta') {
        accumulated += data.text
        const form = findFirstQuestionForm(accumulated)
        if (form && !designStore.pendingQuestionForm) {
          const segs = splitOnQuestionForms(accumulated)
          const textOnly = segs.filter(s => s.type === 'text').map(s => s.text).join('')
          designStore.setPendingQuestionForm(form)
          const session = chatSessionStore.sessions.find((s: any) => s.id === sessionId)
          const last = session && [...session.messages].reverse().find((m: any) => m.role === 'assistant')
          if (last) chatSessionStore.updateMessage(last.id, { content: textOnly }, sessionId)
        }
      } else if (data.type === 'usage') {
        designStore.setUsage(data.usage)
      } else if (data.type === 'status' && data.status === 'idle') {
        isGenerating.value = false
      }
    })
    listenerDisposers.set(sessionId, disposer)
  }

  function detachStreamListener(sessionId: string) {
    const disposer = listenerDisposers.get(sessionId)
    if (disposer) { disposer(); listenerDisposers.delete(sessionId) }
  }

  async function submitQuestionForm(answers: Record<string, any>) {
    const sid = designStore.activeSessionId
    if (!sid) return
    const responseMessage = `[form answers — discovery] ${JSON.stringify(answers)}`
    designStore.clearPendingQuestionForm()
    isGenerating.value = true
    chatSessionStore.currentSessionId = sid
    await chatStore.sendMessage(responseMessage)
  }

  async function stopDesignGeneration() {
    const sid = designStore.activeSessionId
    if (!sid) return
    if (api.claudeCode) {
      try { await api.claudeCode.stop(sid) } catch (e) { console.error(e) }
    }
    await api.design.stopFileWatcher()
    isGenerating.value = false
  }

  async function closeDesignSession(sessionId: string) {
    detachStreamListener(sessionId)
    await api.design.stopFileWatcher()
  }

  return {
    isGenerating,
    createDesignSession,
    switchToolboxSkill,
    submitQuestionForm,
    stopDesignGeneration,
    closeDesignSession,
  }
}
