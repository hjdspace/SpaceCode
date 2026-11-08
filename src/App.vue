<template>
  <div class="app-container" :data-theme="appStore.theme">
    <TitleBar @open-changelog="handleOpenChangelog" />
    <div class="main-content" ref="mainContent">
    <Sidebar
      v-if="!appStore.showSkillsManager && !appStore.showOldSkills"
      :collapsed="appStore.sidebarCollapsed"
      :style="{ width: appStore.sidebarCollapsed ? '48px' : leftWidth + 'px' }"
    />
      <!-- H5 模式侧边栏遮罩层 — 点击关闭侧边栏
           z-index 层级：遮罩层 150 位于主内容之上，侧边栏 200 之下 -->
      <div
        v-if="!appStore.showSkillsManager && !appStore.showOldSkills && h5Mode && !appStore.sidebarCollapsed"
        class="h5-sidebar-overlay"
        @click="appStore.sidebarCollapsed = true"
      ></div>
      <div
        v-if="!appStore.showSkillsManager && !appStore.showOldSkills"
        class="resize-handle vertical"
        @mousedown="startLeftResize"
        :class="{ active: isLeftResizing }"
        :style="{ display: appStore.sidebarCollapsed || appStore.infoPanelFullscreen ? 'none' : 'block' }"
      ></div>
      <div class="center-panel" v-show="!appStore.infoPanelFullscreen">
        <OnboardingBanner v-if="!appStore.showSettings" />
        <div class="center-content">
          <KeepAlive v-if="appStore.showSettings">
            <SettingsPanel />
          </KeepAlive>
          <SkillsManager v-else-if="appStore.showSkillsManager" />
          <OldSkillsManager v-else-if="appStore.showOldSkills" />
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
        v-if="!appStore.showSkillsManager && !appStore.showOldSkills && appStore.infoPanelVisible && !appStore.infoPanelFullscreen"
        class="resize-handle vertical"
        @mousedown="startRightResize"
        :class="{ active: isRightResizing }"
      ></div>
      <InfoPanel
        v-if="!appStore.showSkillsManager && !appStore.showOldSkills && (appStore.infoPanelVisible || appStore.infoPanelTabs.length > 0)"
        v-show="appStore.infoPanelVisible"
        :class="{ 'info-panel-fullscreen': appStore.infoPanelFullscreen }"
        :style="appStore.infoPanelFullscreen ? undefined : { width: rightWidth + 'px' }"
      />
    </div>
    <ConnectMobileDialog
      v-if="appStore.showConnectMobile"
      v-model:visible="appStore.showConnectMobile"
    />
    <WorkspaceOnboarding v-if="appStore.showWorkOnboarding" />
    <OnboardingWizard v-if="onboarding.visible" />
    <FileQuickOpen v-if="appStore.showFileQuickOpen" />
    <DialogProvider />
    <SelectionActionBar />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, onMounted, onUnmounted, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useSettingsStore } from '@/stores/settings'
import { useOnboardingStore } from '@/stores/onboarding'
import { useFontStore } from '@/stores/font'
import { usePetStore } from '@/stores/pet'
import { applyAccentColor, applyDensity, resolveEffectiveTheme } from '@/lib/appearanceSync'
import TitleBar from './components/layout/TitleBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import SplitContainer from './components/layout/SplitContainer.vue'
import OnboardingBanner from './components/onboarding/OnboardingBanner.vue'
import DialogProvider from './components/common/DialogProvider.vue'
import SelectionActionBar from './components/common/SelectionActionBar.vue'
import AsyncLoadingState from './components/common/AsyncLoadingState.vue'
import { api } from '@/services/electronAPI'
import { isH5Mode } from '@/services/h5ApiClient'
import { useShortcuts } from '@/composables/useShortcuts'
import { useVoiceShortcut } from '@/composables/useVoiceShortcut'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { useH5Mirror } from '@/composables/useH5Mirror'
import { useGlobalKeydown } from '@/composables/useGlobalKeydown'
import { useResizablePanel } from '@/composables/useResizablePanel'
import { recordRecentProjectRoot } from '@/utils/recentProjectRoots'

/** 统一的页面级异步组件配置：chunk 加载期间渲染骨架屏，避免白屏。 */
function lazyPage(loader: () => Promise<{ default: Component }>) {
  return defineAsyncComponent({
    loader,
    loadingComponent: AsyncLoadingState,
    delay: 0,
  })
}

const DesignPage = lazyPage(() => import('./components/design/DesignPage.vue'))
// 右侧面板整棵模块树（xterm / @git-diff-view / 各 viewer）随此 chunk 首次加载。
// 抽出 loader 供启动后空闲预热，避免首次点击 subagent 卡片等入口时现场加载导致数秒卡顿。
const loadInfoPanel = () => import('./components/layout/InfoPanel.vue')
const InfoPanel = defineAsyncComponent({
  loader: loadInfoPanel,
  loadingComponent: AsyncLoadingState,
  delay: 0,
})
const TerminalTabBar = defineAsyncComponent(() => import('./components/terminal/TerminalTabBar.vue'))
const TerminalPanel = defineAsyncComponent(() => import('./components/terminal/TerminalPanel.vue'))
// TraceViewer chunk 仅 38KB 且依赖（stores-chat）首屏已加载，空闲预热后点击调试追踪零等待。
const loadTraceViewer = () => import('./components/debug/TraceViewer.vue')
const TraceViewer = lazyPage(loadTraceViewer)
const SettingsPanel = defineAsyncComponent({
  loader: () => import('./components/settings/SettingsPanel.vue'),
  loadingComponent: AsyncLoadingState,
  delay: 0,
})
const loadSkillsManager = () => import('./components/skill_manager/SkillManagerShell.vue')
const SkillsManager = defineAsyncComponent({
  loader: loadSkillsManager,
  loadingComponent: AsyncLoadingState,
  delay: 0,
})
const loadOldSkills = () => import('./components/skills/SkillsManager.vue')
const OldSkillsManager = defineAsyncComponent({
  loader: loadOldSkills,
  loadingComponent: AsyncLoadingState,
  delay: 0,
})
const AgentManager = lazyPage(() => import('./components/agents/AgentManager.vue'))
const McpManager = lazyPage(() => import('./components/mcp/McpManager.vue'))
const CronManager = lazyPage(() => import('./components/cron/CronManager.vue'))
const WorkAssistantGallery = lazyPage(() => import('./components/work/WorkAssistantGallery.vue'))
const WorkspaceOnboarding = lazyPage(() => import('./components/work/WorkspaceOnboarding.vue'))
const OnboardingWizard = lazyPage(() => import('./components/onboarding/OnboardingWizard.vue'))
const ConnectMobileDialog = lazyPage(() => import('./components/mobile/ConnectMobileDialog.vue'))
const FileQuickOpen = lazyPage(() => import('./components/layout/FileQuickOpen.vue'))

const appStore = useAppStore()
const sessionStore = useChatSessionStore()
const settingsStore = useSettingsStore()
const onboarding = useOnboardingStore()
const petStore = usePetStore()
const { t } = useI18n()

// H5 模式标记
const h5Mode = isH5Mode()

const { openProjectByPath } = useOpenProjectWorkflow()
const {
  revealRemoteChatSession,
  revealNotificationSession,
  initH5MirrorSession,
  registerH5SessionChanged,
} = useH5Mirror()
let disposeH5SessionChanged: (() => void) | undefined

// Changelog
const showChangelog = ref(false)
const changelogVersion = ref('')

// 事件处理函数（提升到组件作用域，供 onMounted/onUnmounted 使用）
const handleOpenSkillsManager = () => {
  appStore.showSkillsManager = true
}

const handleOpenOldSkills = () => {
  appStore.showOldSkills = true
}

const handleOpenMCPManager = () => {
  appStore.showMCPManager = true
}

let removeNotificationClickListener: (() => void) | undefined

// Initialize shortcuts
useShortcuts({
  'new_chat': () => { sessionStore.createSession(t('common.newChat')) },
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
      sessionStore.createSession(t('common.newChat'))
    }
  }
})

// Alt+V：主进程唤到前台后在这里派发到最近聚焦的输入框。
useVoiceShortcut()

useGlobalKeydown()

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

/** 右面板全屏前保存的宽度，退出全屏时恢复 */
let savedRightWidth = 400

const {
  size: rightWidth,
  isResizing: isRightResizing,
  onMousedown: startRightResize,
} = useResizablePanel({
  initial: 400,
  min: 200,
  // 右面板允许拓宽至接近全窗口，仅保留极小主内容区（48px = 侧边栏折叠宽度）
  max: () => Math.max(650, window.innerWidth - 48),
  direction: 'horizontal',
  reverse: true,
  overshootThreshold: 40,
  // 拖到最大后继续往左拖 → 右面板全屏
  onOvershootMax: () => {
    if (!appStore.infoPanelFullscreen) {
      savedRightWidth = rightWidth.value
      appStore.toggleInfoPanelFullscreen()
    }
  },
  // 拖到最小后继续往右拖 → 折叠右面板
  onOvershootMin: () => {
    if (appStore.infoPanelFullscreen) {
      // 全屏状态下 → 退出全屏
      appStore.exitInfoPanelFullscreen()
    } else if (appStore.infoPanelVisible) {
      // 非全屏 → 收起面板
      appStore.infoPanelVisible = false
    }
  },
})

// 退出全屏时恢复全屏前的面板宽度
watch(() => appStore.infoPanelFullscreen, (fullscreen) => {
  if (!fullscreen && savedRightWidth > 0) {
    rightWidth.value = savedRightWidth
  }
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

onMounted(() => {
  void loadSkillsManager()

  // 生成式 UI 卡片的调试入口：只渲染内置 fixture，不接受外部 Schema（票 01 承载链路验收用）。
  // 只在开发模式注册，并走动态 import：Vite 构建把 import.meta.env.DEV 定成 false，
  // 这一整块连同 debugFixture 那个 chunk 都不会进生产产物（票 09 第 2 条）。
  if (import.meta.env.DEV) {
    void import('@/lib/genui/debugFixture').then(({ createGenuiDebugApi }) => {
      window.__SPACECODE_GENUI_DEBUG__ = createGenuiDebugApi({
        appendFixtureMessage: (card) => {
          if (!sessionStore.currentSessionId) return false
          sessionStore.addMessage({
            role: 'assistant',
            content: t('genui.fixtureDebugNote'),
            metadata: { genUiCards: [card] },
          })
          return true
        },
        fixtureLabels: () => ({
          title: t('genui.fixture.title'),
          rows: [
            { label: t('genui.fixture.rows.carrier'), value: t('genui.fixture.rows.carrierValue') },
            { label: t('genui.fixture.rows.usage'), value: t('genui.fixture.rows.usageValue') },
          ],
        }),
      })
    })
  }

  // 空闲时预热右侧面板 chunk（xterm / @git-diff-view / 各 viewer），
  // 使首次打开面板（如点击 subagent 卡片）无需现场加载整棵模块树。
  // 延迟一拍再交给 requestIdleCallback，避免与首屏渲染抢资源。
  const warmInfoPanel = () => { void loadInfoPanel() }
  const warmTraceViewer = () => { void loadTraceViewer() }
  window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(warmInfoPanel, { timeout: 2000 })
      window.requestIdleCallback(warmTraceViewer, { timeout: 4000 })
    } else {
      warmInfoPanel()
      warmTraceViewer()
    }
  }, 800)

  // 宠物窗口是独立功能，不阻塞项目上下文和聊天首屏初始化。
  void petStore.init().catch((err) => {
    console.error('[Pet] Failed to initialize pet store:', err)
  })

  // H5 模式：设置 body 类以触发移动端样式
  if (isH5Mode()) {
    document.body.classList.add('h5-mode')
    // 手机端默认收起侧边栏（改为滑入式覆盖层，不默认展开）
    appStore.sidebarCollapsed = true
    // 初始化镜像会话，并跟随桌面端会话切换
    void initH5MirrorSession()
    disposeH5SessionChanged = registerH5SessionChanged()
  }

  // 初始化字体配置
  const fontStore = useFontStore()
  fontStore.applyFontSettings()

  document.documentElement.setAttribute('data-theme', appStore.theme)

  watch(() => settingsStore.appearance.theme, (newTheme) => {
    appStore.setTheme(resolveEffectiveTheme(newTheme))
  }, { immediate: true })

  // 强调色与密度此前只在外观设置页挂载过时才打到 documentElement，
  // 重启后回到主题默认值；引导向导要求它们即时生效，故统一收到这里。
  watch(() => settingsStore.appearance.accentColor, applyAccentColor, { immediate: true })
  watch(() => settingsStore.appearance.density, applyDensity, { immediate: true })

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

  // localStorage may be reset during a Linux uninstall/reinstall while
  // Claude's durable JSONL transcripts remain under ~/.claude/projects.
  // Recreate missing sidebar entries from that source on desktop startup.
  if (!isH5Mode()) {
    void sessionStore.recoverSessionsFromHistory()
    // 预热引擎进程：后台拉起 CLI（含 MCP 握手），首次发送免冷启动。
    // 挂在 currentSessionId 上，而不是只在启动时对当时那一个会话预热一次 ——
    // 「新建会话」和「切换会话」同样是用户接下来要在这里发消息的信号，而真正发消息
    // 的会话往往已经不是启动时那一个了（warmupSession 的预热进程还会被空闲回收）。
    // warmupSession 自带闸门：等 settings hydration、只对 claude-code 生效、已在运行
    // 就跳过、失败静默、绝不因配置漂移去重启正在运行的会话。
    // 去抖是防止在侧栏里快速连点时每个会话都拉一个 CLI 进程 —— 只预热停下来的那个。
    let warmupTimer: ReturnType<typeof setTimeout> | undefined
    watch(() => sessionStore.currentSessionId, sessionId => {
      if (warmupTimer) clearTimeout(warmupTimer)
      if (!sessionId) return
      warmupTimer = setTimeout(() => void sessionStore.warmupSession(sessionId), 500)
    }, { immediate: true })
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
    // 桌面端当前激活会话的完整 LLM 配置 + 工作目录 + agent
    // 供 MobileServer 启动手机端 session 时复用，避免手机端单独配置 API key
    getActiveSessionConfig: () => {
      const config = settingsStore.config
      const cwd =
        sessionStore.workingDirectory ||
        sessionStore.currentProjectRoot ||
        ''
      return {
        sessionId: sessionStore.currentSessionId || undefined,
        cwd,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        provider: config.provider,
        model: config.model,
        effortLevel: config.effortLevel,
        thinkingEnabled: settingsStore.thinkingEnabled,
        agent: sessionStore.currentSession?.agent || undefined,
        engineType: settingsStore.engineType,
        engineSource: settingsStore.engineSource,
        installedCliPath: settingsStore.installedCliPath ?? undefined,
        modelContextWindows: { ...settingsStore.contextWindowOverrides },
        rtkEnabled: settingsStore.rtkEnabled,
      }
    },
  }

  // 监听打开技能管理器事件
  window.addEventListener('open-skills-manager', handleOpenSkillsManager)
  window.addEventListener('open-old-skills', handleOpenOldSkills)

  // 监听打开 MCP 管理器事件
  window.addEventListener('open-mcp-manager', handleOpenMCPManager)

  // 桌面端：手机 H5 发送消息后，打开/激活对应会话，保证主页面同步可见。
  window.addEventListener('h5-remote-user-message', revealRemoteChatSession)
  removeNotificationClickListener = api.onNotificationClicked(revealNotificationSession)

  // 桌面端：监听会话切换，通知 H5 Server 镜像会话
  if (!isH5Mode() && api.h5Access) {
    watch(() => [sessionStore.currentSessionId, appStore.projectRoot], ([sid, projectPath]) => {
      api.h5Access.setMirrorSession(sid, projectPath).catch(() => {})
    }, { immediate: true })
  }
})

async function handleOpenChangelog() {
  const currentVersion = await api.getAppVersion()
  if (currentVersion && currentVersion !== '0.0.0') {
    changelogVersion.value = currentVersion
    showChangelog.value = true
  }
}

onUnmounted(() => {
  window.removeEventListener('open-skills-manager', handleOpenSkillsManager)
  window.removeEventListener('open-old-skills', handleOpenOldSkills)
  window.removeEventListener('open-mcp-manager', handleOpenMCPManager)
  window.removeEventListener('h5-remote-user-message', revealRemoteChatSession)
  removeNotificationClickListener?.()
  disposeH5SessionChanged?.()
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

.info-panel-fullscreen {
  flex: 1 !important;
  width: auto !important;
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
    background: var(--error-glow);
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
    width: 5px;
    cursor: col-resize;
    background: transparent;
    transition: background var(--transition-fast);

    &:hover {
      background: var(--border-strong);
    }

    &.active {
      background: var(--accent-primary);
    }
  }

  &.horizontal {
    height: 5px;
    cursor: row-resize;
    background: transparent;
    transition: background var(--transition-fast);
    flex-shrink: 0;

    &:hover {
      background: var(--border-strong);
    }

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
