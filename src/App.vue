<template>
  <div class="app-container" :data-theme="appStore.theme">
    <TitleBar @open-changelog="handleOpenChangelog" />
    <div class="main-content" ref="mainContent">
      <Sidebar
        :collapsed="appStore.sidebarCollapsed"
        :style="{ width: appStore.sidebarCollapsed ? '48px' : leftWidth + 'px' }"
      />
      <!-- H5 模式侧边栏遮罩层 — 点击关闭侧边栏
           z-index 层级：遮罩层 150 位于主内容之上，侧边栏 200 之下 -->
      <div
        v-if="h5Mode && !appStore.sidebarCollapsed"
        class="h5-sidebar-overlay"
        @click="appStore.sidebarCollapsed = true"
      ></div>
      <div
        class="resize-handle vertical"
        @mousedown="startLeftResize"
        :class="{ active: isLeftResizing }"
        :style="{ display: appStore.sidebarCollapsed ? 'none' : 'block' }"
      ></div>
      <div class="center-panel">
        <div class="center-content">
          <SettingsPanel v-if="appStore.showSettings" />
          <SkillsManager v-else-if="appStore.showSkillsManager" />
          <AgentManager v-else-if="appStore.showAgentManager" />
          <McpManager v-else-if="appStore.showMCPManager" />
          <CronManager v-else-if="appStore.showCronManager" />
          <WorkAssistantGallery v-else-if="appStore.showWorkGallery" />
          <DesignPage v-else-if="appStore.mode === 'design'" />
          <SplitContainer v-else-if="!appStore.showTraceViewer" />
          <TraceViewer v-else />
        </div>
        <!-- Bottom terminal dock resize handle -->
        <div
          v-if="appStore.terminalDockVisible"
          class="resize-handle horizontal"
          @mousedown="startTerminalResize"
          :class="{ active: isTerminalResizing }"
        ></div>
        <!-- Bottom terminal dock (VSCODE style) -->
        <div
          v-if="appStore.terminalDockMounted"
          v-show="appStore.terminalDockVisible"
          class="terminal-dock"
          :style="{ height: appStore.terminalDockHeight + 'px' }"
        >
          <TerminalTabBar />
          <div class="terminal-dock-content">
            <TerminalPanel />
          </div>
        </div>
      </div>
      <div
        v-if="appStore.infoPanelVisible"
        class="resize-handle vertical"
        @mousedown="startRightResize"
        :class="{ active: isRightResizing }"
      ></div>
      <InfoPanel
        v-if="appStore.infoPanelVisible"
        :style="{ width: rightWidth + 'px' }"
      />
    </div>
    <ConnectMobileDialog
      v-if="appStore.showConnectMobile"
      v-model:visible="appStore.showConnectMobile"
    />
    <WorkspaceOnboarding v-if="appStore.showWorkOnboarding" />
    <FileQuickOpen v-if="appStore.showFileQuickOpen" />
    <PetEmbeddedWidget v-if="shouldShowEmbeddedPet" />
    <DialogProvider />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useSettingsStore } from '@/stores/settings'
import { useFontStore } from '@/stores/font'
import { useSplitLayoutStore } from '@/stores/splitLayout'
import { usePetStore } from '@/stores/pet'
import { initPetReactionGlobal } from '@/composables/usePetReaction'
import TitleBar from './components/layout/TitleBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import SplitContainer from './components/layout/SplitContainer.vue'
import DialogProvider from './components/common/DialogProvider.vue'
import { api } from '@/services/electronAPI'
import { isH5Mode } from '@/services/h5ApiClient'
import { getCachedDesktopConfig } from '@/services/h5Bootstrap'
import { h5ApiClient } from '@/services/h5ApiClient'
import { h5WebSocketClient } from '@/services/h5WebSocketClient'
import { useShortcuts } from '@/composables/useShortcuts'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { useResizablePanel } from '@/composables/useResizablePanel'
import { recordRecentProjectRoot } from '@/utils/recentProjectRoots'

const DesignPage = defineAsyncComponent(() => import('./components/design/DesignPage.vue'))
const InfoPanel = defineAsyncComponent(() => import('./components/layout/InfoPanel.vue'))
const TerminalTabBar = defineAsyncComponent(() => import('./components/terminal/TerminalTabBar.vue'))
const TerminalPanel = defineAsyncComponent(() => import('./components/terminal/TerminalPanel.vue'))
const TraceViewer = defineAsyncComponent(() => import('./components/debug/TraceViewer.vue'))
const SettingsPanel = defineAsyncComponent(() => import('./components/settings/SettingsPanel.vue'))
const SkillsManager = defineAsyncComponent(() => import('./components/skills/SkillsManager.vue'))
const AgentManager = defineAsyncComponent(() => import('./components/agents/AgentManager.vue'))
const McpManager = defineAsyncComponent(() => import('./components/mcp/McpManager.vue'))
const CronManager = defineAsyncComponent(() => import('./components/cron/CronManager.vue'))
const WorkAssistantGallery = defineAsyncComponent(() => import('./components/work/WorkAssistantGallery.vue'))
const WorkspaceOnboarding = defineAsyncComponent(() => import('./components/work/WorkspaceOnboarding.vue'))
const ConnectMobileDialog = defineAsyncComponent(() => import('./components/mobile/ConnectMobileDialog.vue'))
const FileQuickOpen = defineAsyncComponent(() => import('./components/layout/FileQuickOpen.vue'))
const PetEmbeddedWidget = defineAsyncComponent(() => import('@/components/pets/PetEmbeddedWidget.vue'))

const appStore = useAppStore()
const sessionStore = useChatSessionStore()
const settingsStore = useSettingsStore()
const splitLayout = useSplitLayoutStore()
const petStore = usePetStore()

const shouldShowEmbeddedPet = computed(() =>
  petStore.isInitialized &&
  petStore.activePet &&
  petStore.mode === 'embedded' &&
  !petStore.isMuted
)

// 监听 mode 变化：desktop 窗口的创建/销毁已由 petStore.setMode 负责，
// 此 watch 作为 App 层面的钩子保留，便于未来扩展（如埋点、动画过渡）。
watch(() => petStore.mode, (newMode, oldMode) => {
  if (newMode === 'desktop' && oldMode === 'embedded') {
    // 切换到桌面模式时，embedded widget 自动隐藏（由 shouldShowEmbeddedPet 控制）
    // desktop 窗口已由 petStore.setMode 创建
  } else if (newMode === 'embedded' && oldMode === 'desktop') {
    // 切回嵌入模式，desktop 窗口已由 petStore.setMode 销毁
  }
})

// 监听 reaction 变化，同步到 desktop 窗口
watch(() => petStore.runtimeState.currentReaction, () => {
  if (petStore.mode === 'desktop') {
    petStore.syncToDesktopWindow()
  }
})

// H5 模式标记
const h5Mode = isH5Mode()

const { openProjectByPath } = useOpenProjectWorkflow()

// Changelog
const showChangelog = ref(false)
const changelogVersion = ref('')

// 事件处理函数（提升到组件作用域，供 onMounted/onUnmounted 使用）
const handleOpenSkillsManager = () => {
  appStore.showSkillsManager = true
}

const handleOpenMCPManager = () => {
  appStore.showMCPManager = true
}

type H5RemoteUserMessageDetail = {
  sessionId?: string
  title?: string
  projectPath?: string | null
}

function revealChatSession(detail: H5RemoteUserMessageDetail) {
  const sessionId = detail.sessionId
  if (!sessionId) return

  const session = sessionStore.sessions.find(s => s.id === sessionId)
  const title = session?.title || detail.title || 'Remote Chat'
  const tabId = `session-${sessionId}`

  appStore.showSettings = false
  appStore.showSkillsManager = false
  appStore.showAgentManager = false
  appStore.showMCPManager = false
  appStore.showCronManager = false
  appStore.showWorkGallery = false
  appStore.showTraceViewer = false
  if (appStore.mode === 'design') {
    appStore.setMode(session?.mode === 'work' ? 'work' : 'code')
  }

  appStore.openSessionTab(sessionId, title)
  void sessionStore.selectSession(sessionId)

  if (splitLayout.isSingleLeaf) {
    const leaf = splitLayout.activePane
    if (leaf && leaf.content.kind !== 'main') {
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

// Initialize shortcuts
const { register } = useShortcuts({
  'new_chat': () => { sessionStore.createSession() },
  'close_chat': () => {
    if (sessionStore.currentSessionId) {
      sessionStore.deleteSession(sessionStore.currentSessionId)
    }
  },
  'toggle_sidebar': () => appStore.toggleSidebar(),
  'new_terminal': () => appStore.openTerminalTab(),
  'close_terminal': () => {
    // Close the currently active terminal tab, or any terminal if none is active
    if (appStore.activeCenterTab.startsWith('terminal-')) {
      appStore.closeCenterTab(appStore.activeCenterTab)
    } else {
      // Find and close the last terminal tab
      const lastTerminal = appStore.centerTabs.find(t => t.id.startsWith('terminal-'))
      if (lastTerminal) {
        appStore.closeCenterTab(lastTerminal.id)
      }
    }
  },
  'focus_input': () => {
    // Focus chat input - will be handled by ChatPanel
    const input = document.querySelector('.chat-input textarea') as HTMLTextAreaElement
    if (input) input.focus()
  },
  'clear_chat': () => {
    if (sessionStore.currentSessionId) {
      sessionStore.deleteSession(sessionStore.currentSessionId)
      sessionStore.createSession('New Chat')
    }
  }
})

const mainContent = ref<HTMLElement | null>(null)

// ── 面板拖拽缩放（通过 useResizablePanel composable 管理） ──
const {
  size: leftWidth,
  isResizing: isLeftResizing,
  onMousedown: startLeftResize,
} = useResizablePanel({
  initial: 350,
  min: 200,
  max: 650,
  direction: 'horizontal',
})

const {
  size: rightWidth,
  isResizing: isRightResizing,
  onMousedown: startRightResize,
} = useResizablePanel({
  initial: 400,
  min: 200,
  // 右面板允许拓宽至接近全窗口，同时保留最小主内容区
  max: () => Math.max(650, window.innerWidth - leftWidth.value - 200),
  direction: 'horizontal',
  reverse: true,
})

const {
  isResizing: isTerminalResizing,
  onMousedown: startTerminalResize,
} = useResizablePanel({
  initial: appStore.terminalDockHeight,
  min: 80,
  max: 500,
  direction: 'vertical',
  reverse: true,
  onUpdate: (h) => appStore.setTerminalDockHeight(h),
})

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

onMounted(() => {
  // 初始化桌面宠物系统
  petStore.init().catch(err => console.error('[Pet] Failed to init:', err))
  initPetReactionGlobal()

  // H5 模式：设置 body 类以触发移动端样式
  if (isH5Mode()) {
    document.body.classList.add('h5-mode')
    // 手机端默认收起侧边栏（改为滑入式覆盖层，不默认展开）
    appStore.sidebarCollapsed = true
    // 初始化镜像会话
    initH5MirrorSession()

    // ★ 监听桌面端会话切换 — 当桌面端切换会话时，H5 Server 推送 session_changed 事件
    // H5 客户端需要同步切换到新的镜像会话
    h5WebSocketClient.on('session_changed', (evt: { sessionId: string; data: any }) => {
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

  // 初始化字体配置
  const fontStore = useFontStore()
  fontStore.applyFontSettings()

  document.documentElement.setAttribute('data-theme', appStore.theme)

  watch(() => settingsStore.appearance.theme, (newTheme) => {
    let effectiveTheme = newTheme
    if (newTheme === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    appStore.setTheme(effectiveTheme as 'light' | 'dark' | 'anthropic' | 'anthropic-dark')
  }, { immediate: true })

  // 监听菜单事件
  api.onMenuOpenFolder((path: string) => {
    openProjectByPath(path, { forceNewSession: true })
  })

  api.onMenuCloseFolder(() => {
    appStore.closeProject()
    // 清空当前项目
    sessionStore.switchProject('')
  })

  // 初始化时如果有项目，添加到列表
  const initialProjectRoot = appStore.projectRoot
  if (initialProjectRoot) {
    sessionStore.addProject(initialProjectRoot)
    recordRecentProjectRoot(initialProjectRoot)
  }

  // 暴露全局 API 供主进程通过 executeJavaScript 调用，避免直接访问 Vue 内部实现
  ;(window as any).__spacecode_api__ = {
    getThemeData: () => ({
      effectiveTheme: appStore.theme,
      appearance: {
        accentColor: settingsStore.appearance.accentColor,
        density: settingsStore.appearance.density,
      },
    }),
    getSessions: () => sessionStore.sessions || [],
  }

  // 监听打开技能管理器事件
  window.addEventListener('open-skills-manager', handleOpenSkillsManager)

  // 监听打开 MCP 管理器事件
  window.addEventListener('open-mcp-manager', handleOpenMCPManager)

  // 桌面端：手机 H5 发送消息后，打开/激活对应会话，保证主页面同步可见。
  window.addEventListener('h5-remote-user-message', revealRemoteChatSession)

  // 桌面端：监听会话切换，通知 H5 Server 镜像会话
  if (!isH5Mode() && api.h5Access) {
    watch(() => [sessionStore.currentSessionId, appStore.projectRoot], ([sid, projectPath]) => {
      api.h5Access.setMirrorSession(sid, projectPath).catch(() => {})
    }, { immediate: true })
  }
})

function handleChangelogClose() {
  if (changelogVersion.value) {
    settingsStore.lastViewedChangelogVersion = changelogVersion.value
    settingsStore.saveSettings()
  }
}

async function handleOpenChangelog() {
  const currentVersion = await api.getAppVersion()
  if (currentVersion && currentVersion !== '0.0.0') {
    changelogVersion.value = currentVersion
    showChangelog.value = true
  }
}

onUnmounted(() => {
  window.removeEventListener('open-skills-manager', handleOpenSkillsManager)
  window.removeEventListener('open-mcp-manager', handleOpenMCPManager)
  window.removeEventListener('h5-remote-user-message', revealRemoteChatSession)
})
</script>

<style lang="scss" scoped>
.app-container {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  color: var(--text-primary);
  position: relative;
  overflow: hidden;
}

.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.center-tabs {
  display: flex;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-default);
  padding: 0 8px;
  gap: 4px;
}

.center-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.active {
    color: var(--accent-primary);
    border-bottom-color: var(--accent-primary);
    background: var(--bg-active);
  }
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  margin-left: 4px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s ease;

  .center-tab:hover & {
    opacity: 1;
  }

  &:hover {
    background: var(--error-bg);
    color: var(--error);
  }
}

.center-content {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.resize-handle {
  flex-shrink: 0;

  &.vertical {
    width: 4px;
    cursor: col-resize;
    background: transparent;
    transition: background 0.2s;

    &:hover,
    &.active {
      background: var(--accent-primary);
    }
  }

  &.horizontal {
    height: 4px;
    cursor: row-resize;
    background: transparent;
    transition: background 0.2s;
    flex-shrink: 0;

    &:hover,
    &.active {
      background: var(--accent-primary);
    }
  }
}

.terminal-dock {
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-top: 1px solid var(--surface-border);
  overflow: hidden;
  flex-shrink: 0;
  min-height: 80px;
}

.terminal-dock-content {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
}
</style>
