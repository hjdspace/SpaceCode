// src/composables/useH5Mirror.ts
// H5 移动端镜像：把桌面端推送的会话/通知落到本地会话列表与分屏布局。
// 从 App.vue 抽出，宿主只负责在 onMounted 里初始化与注册事件。

import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useFactoryStore } from '@/stores/factory'
import { useSplitLayoutStore } from '@/stores/splitLayout'
import { getCachedDesktopConfig } from '@/services/h5Bootstrap'
import { h5ApiClient } from '@/services/h5ApiClient'
import { h5WebSocketClient } from '@/services/h5WebSocketClient'

type H5RemoteUserMessageDetail = {
  sessionId?: string
  title?: string
  projectPath?: string | null
}

export function useH5Mirror() {
  const appStore = useAppStore()
  const sessionStore = useChatSessionStore()
  const factoryStore = useFactoryStore()
  const splitLayout = useSplitLayoutStore()

  function revealChatSession(detail: H5RemoteUserMessageDetail) {
    const sessionId = detail.sessionId
    if (!sessionId) return

    const session = sessionStore.sessions.find(s => s.id === sessionId)
    const tabId = `session-${sessionId}`

    appStore.showSettings = false
    appStore.showSkillsManager = false
    appStore.showOldSkills = false
    appStore.showAgentManager = false
    appStore.showMCPManager = false
    appStore.showCronManager = false
    appStore.showWorkGallery = false
    appStore.showTraceViewer = false
    if (appStore.mode === 'design') {
      appStore.setMode(session?.mode === 'work' ? 'work' : 'code')
    }

    void sessionStore.selectSession(sessionId)

    if (splitLayout.isSingleLeaf) {
      const leaf = splitLayout.activePane
      if (leaf) {
        splitLayout.setPaneContent(leaf.id, { kind: 'session', tabId })
        splitLayout.setActivePane(leaf.id)
      }
      return
    }

    const targetLeaf = splitLayout.activePane || splitLayout.leaves[0]
    if (targetLeaf) {
      splitLayout.setPaneContent(targetLeaf.id, { kind: 'session', tabId })
      splitLayout.setActivePane(targetLeaf.id)
    }
  }

  function revealRemoteChatSession(event: Event) {
    revealChatSession((event as CustomEvent<H5RemoteUserMessageDetail>).detail || {})
  }

  function revealNotificationSession(detail: { sessionId?: string }) {
    const sessionId = detail.sessionId
    if (!sessionId) return

    const task = factoryStore.tasks.find(task => task.takeover?.sessionId === sessionId)
    if (task) {
      appStore.openFactoryTab()
      factoryStore.openTakeoverPanel(task.id)
      return
    }
    revealChatSession({ sessionId })
  }

  // H5 模式：初始化镜像会话 + 加载桌面端完整会话列表
  async function initH5MirrorSession() {
    const config = getCachedDesktopConfig()
    if (!config) {
      console.warn('[H5] No desktop config available, skipping mirror session init')
      return
    }

    const { mirrorSessionId, mirrorProjectPath } = config
    console.log('[H5] Initializing mirror session:', { mirrorSessionId, mirrorProjectPath })

    // 设置项目根目录
    if (mirrorProjectPath) {
      appStore.projectRoot = mirrorProjectPath
      sessionStore.addProject(mirrorProjectPath)
      sessionStore.switchProject(mirrorProjectPath)
    }

    // ★ 加载桌面端完整会话列表，让手机端侧边栏显示与桌面端一致的会话
    if (mirrorProjectPath) {
      try {
        const remoteSessions = await h5ApiClient.listProjectSessions(mirrorProjectPath)
        if (remoteSessions?.length) {
          console.log('[H5] Loaded', remoteSessions.length, 'sessions from desktop')
          for (const rs of remoteSessions) {
            // 跳过已存在的会话（包括即将创建的镜像会话）
            const existing = sessionStore.sessions.find(s => s.id === rs.sessionId)
            if (existing) continue

            // 将桌面端会话添加到本地 sessions 列表（不切换 currentSessionId）
            const session = {
              id: rs.sessionId,
              title: rs.title || rs.firstUserMessage || 'Chat',
              messages: [],
              createdAt: rs.lastMessageTimestamp || Date.now(),
              updatedAt: rs.lastMessageTimestamp || Date.now(),
              workingDirectory: mirrorProjectPath,
              processStatus: 'none' as const,
              isTabOpen: false,
              lastActivityAt: rs.lastMessageTimestamp || Date.now(),
              mode: 'code' as const,
            }
            sessionStore.sessions.push(session)
          }
          sessionStore.saveToStorage()
        }
      } catch (err) {
        console.error('[H5] Failed to load project sessions:', err)
      }
    }

    // 如果有镜像会话，创建本地 Session 并加载历史
    if (mirrorSessionId) {
      // 检查是否已存在该 session（可能刚从桌面端列表加载）
      let session = sessionStore.sessions.find(s => s.id === mirrorSessionId)
      if (!session) {
        session = sessionStore.createSession('Mirror Session', mirrorProjectPath || undefined, mirrorSessionId)
      } else {
        // 已存在（从桌面端列表加载），更新标题并选中
        session.title = 'Mirror Session'
        void sessionStore.selectSession(mirrorSessionId)
      }

      // 从 H5 API 加载会话历史
      if (mirrorProjectPath) {
        try {
          const history = await h5ApiClient.restoreSession(mirrorSessionId, mirrorProjectPath)
          if (history?.messages?.length) {
            const { buildMessagesFromHistory } = await import('@/utils/sessionRestore')
            const restoredMessages = buildMessagesFromHistory(history.messages)
            if (restoredMessages.length > 0 && session) {
              // 补全 timestamp 字段（buildMessagesFromHistory 返回的类型缺少它）
              session.messages = restoredMessages.map((m, i) => ({
                ...m,
                timestamp: (m as any).timestamp ?? Date.now() - (restoredMessages.length - i) * 1000,
              })) as any
              sessionStore.saveToStorage()
              console.log('[H5] Restored', restoredMessages.length, 'messages from mirror session')
            }
          }
        } catch (err) {
          console.error('[H5] Failed to restore session history:', err)
        }
      }

      // 检查会话是否在桌面端运行中
      const activeSession = config.activeSessions?.find(s => s.sessionId === mirrorSessionId)
      if (activeSession?.isRunning && session) {
        session.processStatus = 'active'
      }

      revealChatSession({
        sessionId: mirrorSessionId,
        title: session?.title || 'Mirror Session',
        projectPath: mirrorProjectPath,
      })
    }
  }

  /**
   * 监听桌面端会话切换 — 当桌面端切换会话时，H5 Server 推送 session_changed 事件，
   * 客户端同步切换到新的镜像会话。返回取消订阅函数。
   */
  function registerH5SessionChanged(): () => void {
    return h5WebSocketClient.on('session_changed', (evt: { sessionId: string; data: any }) => {
      const newSessionId = evt.data?.sessionId
      const newProjectPath = evt.data?.projectPath
      if (!newSessionId) return

      console.log('[H5] Session changed from desktop:', { newSessionId, newProjectPath })

      if (newProjectPath) {
        appStore.projectRoot = newProjectPath
        sessionStore.addProject(newProjectPath)
        sessionStore.switchProject(newProjectPath)
      }

      // 检查是否已存在该会话
      let session = sessionStore.sessions.find(s => s.id === newSessionId)
      if (!session && newProjectPath) {
        // 创建新的本地会话
        session = sessionStore.createSession('Mirror Session', newProjectPath, newSessionId)
      } else if (session) {
        // 已存在，直接选中
        void sessionStore.selectSession(newSessionId)
      }

      revealChatSession({
        sessionId: newSessionId,
        title: session?.title || 'Mirror Session',
        projectPath: newProjectPath || null,
      })

      // 加载新镜像会话的历史
      // ★ 保护：只在 session 没有消息时才加载历史。
      // H5 端发送消息时会触发 startSession → setMirrorSession → session_changed，
      // 如果此时无条件覆盖 session.messages，会丢失用户刚发送的消息。
      // 与 Sidebar.vue handleSelectSession 的保护逻辑保持一致。
      if (newProjectPath && session && session.messages.length === 0) {
        h5ApiClient.restoreSession(newSessionId, newProjectPath).then(async (history) => {
          if (history?.messages?.length) {
            const { buildMessagesFromHistory } = await import('@/utils/sessionRestore')
            const restoredMessages = buildMessagesFromHistory(history.messages)
            if (restoredMessages.length > 0 && session) {
              session.messages = restoredMessages.map((m, i) => ({
                ...m,
                timestamp: (m as any).timestamp ?? Date.now() - (restoredMessages.length - i) * 1000,
              })) as any
              sessionStore.saveToStorage()
              console.log('[H5] Restored', restoredMessages.length, 'messages for new mirror session')
            }
          }
        }).catch((err) => {
          console.error('[H5] Failed to restore new mirror session history:', err)
        })
      }
    })
  }

  return {
    revealChatSession,
    revealRemoteChatSession,
    revealNotificationSession,
    initH5MirrorSession,
    registerH5SessionChanged,
  }
}
