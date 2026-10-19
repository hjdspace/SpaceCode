import { useDesignStore } from '@/stores/design'
import { useTurnStore } from '@/stores/turn'
import { useChatSessionStore } from '@/stores/chatSession'
import { api } from '@/services/electronAPI'
import { findFirstQuestionForm, splitOnQuestionForms } from '@/utils/design/questionForm'
import { buildPreamble } from '@/lib/design/templates'
import { normalizeAbsolutePath } from '@/utils/normalizePath'
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
    // picker 的「清除」传空串：会话级没有合法的空 cwd —— 引擎必须跑在某个目录里，
    // 回滚判定也无从成立。保持当前目录不变，而不是把会话清成无目录状态。
    if (!path) return
    const sid = designStore.activeSessionId
    // 发过消息的会话锁死工作目录：引擎的历史 JSONL 按项目目录存放，换目录后
    // --resume 在新目录下找不到旧 jsonl，必然丢上下文。UI 已置灰入口，这里是
    // 唯一写入口，兜住 picker 之外的调用方（ChatContextToolbar 也直调本函数）。
    if (!chatSessionStore.canSwitchWorkingDirectory(sid)) return
    const previousWorkspace = designStore.designWorkspace
    const previousProjectRoot = chatSessionStore.currentProjectRoot
    designStore.designWorkspace = path
    chatSessionStore.currentProjectRoot = path
    if (!sid) return

    try {
      // cwd 不在 initClaudeCodeSession 的启动配置对账范围内（只对比 systemPrompt / agent / 凭据），
      // 换工作目录必须显式先停止会话，再以新 cwd 重新初始化。
      // 不把 engineSessionId 交接给 _resumeSessionId：能走到这里的只有空会话，
      // 它没有历史要保，而旧项目目录的 jsonl 在新 cwd 下 resume 不回来。
      if (api.claudeCode) {
        try {
          const status = await api.claudeCode.getSessionStatus(sid)
          if (status?.isRunning) await api.claudeCode.stop(sid)
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
      // initClaudeCodeSession 吞掉启动异常（只把 processStatus 置 exited，不外抛），
      // 所以以「会话记录有没有跟上」判定成败：起不来、或 stop 失败让它早退复用了旧进程时，
      // workingDirectory 都不会被回写成新目录。
      const switched = chatSessionStore.sessions.find(s => s.id === sid)
      if (switched?.workingDirectory !== normalizeAbsolutePath(path)) {
        throw new Error(`engine did not adopt cwd: ${switched?.workingDirectory ?? '(none)'}`)
      }
      // 重启文件监听以匹配新的工作目录。失败只记日志：引擎已在新目录跑起来了，
      // 为监听器没重建而把整个会话退回旧目录更糟。
      try {
        await api.design.stopFileWatcher()
        await api.design.startFileWatcher(sid, path)
      } catch (e) {
        console.error('Failed to restart file watcher for new working directory:', e)
      }
    } catch (e) {
      console.error('Failed to switch design working directory, rolling back:', e)
      designStore.designWorkspace = previousWorkspace
      chatSessionStore.currentProjectRoot = previousProjectRoot
      // 引擎起不来时 initClaudeCodeSession 内部已经推过一条分类后的引擎错误 toast，
      // 这里只补它没覆盖的失败（compose 调用失败、stop 失败导致复用了旧进程），
      // 避免同一次切换弹两条。
      const reportedByEngine = chatSessionStore.sessions.find(s => s.id === sid)?.processStatus === 'exited'
      if (!reportedByEngine) {
        errorHandler.pushToast({
          id: crypto.randomUUID(),
          category: ErrorCategory.PROCESS_ERROR,
          title: t('design.workingDirectory.switchFailed'),
          message: t('design.workingDirectory.switchFailedDesc', { path }),
          autoDismiss: true,
          dismissAfter: 5000,
          createdAt: Date.now(),
        })
      }
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
