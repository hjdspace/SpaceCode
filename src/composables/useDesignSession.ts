import { useDesignStore } from '@/stores/design'
import { useTurnStore, useChatSessionStore } from '@/stores/chat'
import { api } from '@/services/electronAPI'
import { findFirstQuestionForm, splitOnQuestionForms } from '@/utils/design/questionForm'
import { buildPreamble } from '@/lib/design/templates'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'
import { useI18n } from 'vue-i18n'

export function useDesignSession() {
  const { t } = useI18n()
  const designStore = useDesignStore()
  const turnStore = useTurnStore()
  const chatSessionStore = useChatSessionStore()
  const listenerDisposers = new Map<string, () => void>()

  async function createDesignSession(): Promise<string> {
    const userDataPath = await api.app.getPath('userData')
    // 尊重用户通过 WorkingDirectoryPicker 已选择的项目目录；
    // 仅在用户未选择时才生成临时工作区。
    const workspacePath = designStore.designWorkspace || `${userDataPath}/design-workspace/${Date.now()}`
    designStore.designWorkspace = workspacePath

    const session = chatSessionStore.createSession('Design Session', workspacePath)
    session.mode = 'design'

    const systemPrompt = await api.design.composePromptStack({
      skillName: designStore.selectedToolboxSkillId,
      designSystemId: designStore.selectedDesignSystemId || undefined,
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
      designSystemId: designStore.selectedDesignSystemId || undefined,
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

  async function switchDesignSystem(systemId: string | null, systemName: string | null): Promise<void> {
    designStore.selectedDesignSystemId = systemId
    designStore.selectedDesignSystemName = systemName
    const systemPrompt = await api.design.composePromptStack({
      skillName: designStore.selectedToolboxSkillId,
      designSystemId: systemId || undefined,
      locale: 'zh-CN',
    })
    const sid = designStore.activeSessionId
    if (!sid) return
    await chatSessionStore.initClaudeCodeSession(sid, {
      systemPrompt,
      cwd: designStore.designWorkspace,
      agent: 'ui-ux-pro-max',
    })
    if (systemName) {
      errorHandler.pushToast({
        id: crypto.randomUUID(),
        category: ErrorCategory.UNKNOWN,
        title: t('design.designSystemPicker.switched'),
        message: t('design.designSystemPicker.switchedDesc'),
        autoDismiss: true,
        dismissAfter: 3000,
        createdAt: Date.now(),
      })
    }
  }

  async function switchWorkingDirectory(path: string): Promise<void> {
    designStore.designWorkspace = path
    chatSessionStore.currentProjectRoot = path
    const sid = designStore.activeSessionId
    if (!sid) return
    // 会话已在运行时，initClaudeCodeSession 不会自动重启；
    // 需先停止当前会话，再以新的 cwd 重新初始化。
    if (api.claudeCode) {
      try {
        const status = await api.claudeCode.getSessionStatus(sid)
        if (status?.isRunning) {
          const resumeId = (status.engineSessionId as string) || undefined
          await api.claudeCode.stop(sid)
          const session = chatSessionStore.sessions.find(s => s.id === sid)
          if (session && resumeId) session._resumeSessionId = resumeId
        }
      } catch (e) {
        console.error('Failed to stop session before switching working directory:', e)
      }
    }
    const systemPrompt = await api.design.composePromptStack({
      skillName: designStore.selectedToolboxSkillId,
      designSystemId: designStore.selectedDesignSystemId || undefined,
      locale: 'zh-CN',
    })
    await chatSessionStore.initClaudeCodeSession(sid, {
      systemPrompt,
      cwd: path,
      agent: 'ui-ux-pro-max',
    })
    // 重启文件监听以匹配新的工作目录
    try {
      await api.design.stopFileWatcher()
      await api.design.startFileWatcher(sid, path)
    } catch (e) {
      console.error('Failed to restart file watcher for new working directory:', e)
    }
  }

  function buildDesignMessage(userMessage: string): string {
    const preamble = buildPreamble(
      designStore.selectedTemplateId,
      designStore.selectedDesignSystemName,
    )
    if (!preamble) return userMessage
    return `${preamble}\n\n${userMessage}`
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
        // loading 状态由 chatStream.loadingSessions 管理，无需手动维护
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
    chatSessionStore.currentSessionId = sid
    await turnStore.sendMessage(responseMessage)
  }

  async function stopDesignGeneration() {
    const sid = designStore.activeSessionId
    if (!sid) return
    // 复用 chatStream.abort 统一停止逻辑，它会处理 loadingSessions 状态清理
    chatSessionStore.currentSessionId = sid
    await turnStore.abort()
    await api.design.stopFileWatcher()
  }

  async function closeDesignSession(sessionId: string) {
    detachStreamListener(sessionId)
    await api.design.stopFileWatcher()
  }

  return {
    createDesignSession,
    switchToolboxSkill,
    switchDesignSystem,
    switchWorkingDirectory,
    buildDesignMessage,
    submitQuestionForm,
    stopDesignGeneration,
    closeDesignSession,
  }
}
