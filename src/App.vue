<template>
  <div class="app-container" :data-theme="appStore.theme">
    <TitleBar @open-changelog="handleOpenChangelog" />
    <div class="main-content" ref="mainContent">
      <Sidebar
        :collapsed="appStore.sidebarCollapsed"
        :style="{ width: appStore.sidebarCollapsed ? '48px' : leftWidth + 'px' }"
      />
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
    <ConnectMobileDialog v-model:visible="appStore.showConnectMobile" />
    <WorkspaceOnboarding />
    <FileQuickOpen />
    <DialogProvider />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useFontStore } from '@/stores/font'
import TitleBar from './components/layout/TitleBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import SplitContainer from './components/layout/SplitContainer.vue'
import DesignPage from './components/design/DesignPage.vue'
import InfoPanel from './components/layout/InfoPanel.vue'
import TerminalTabBar from './components/terminal/TerminalTabBar.vue'
import TerminalPanel from './components/terminal/TerminalPanel.vue'
import TraceViewer from './components/debug/TraceViewer.vue'
import SettingsPanel from './components/settings/SettingsPanel.vue'
import SkillsManager from './components/skills/SkillsManager.vue'
import AgentManager from './components/agents/AgentManager.vue'
import McpManager from './components/mcp/McpManager.vue'
import CronManager from './components/cron/CronManager.vue'
import WorkAssistantGallery from './components/work/WorkAssistantGallery.vue'
import WorkspaceOnboarding from './components/work/WorkspaceOnboarding.vue'
import ConnectMobileDialog from './components/mobile/ConnectMobileDialog.vue'
import FileQuickOpen from './components/layout/FileQuickOpen.vue'
import DialogProvider from './components/common/DialogProvider.vue'
import { api } from '@/services/electronAPI'
import { useShortcuts } from '@/composables/useShortcuts'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { useResizablePanel } from '@/composables/useResizablePanel'
import { recordRecentProjectRoot } from '@/utils/recentProjectRoots'

const appStore = useAppStore()
const chatStore = useChatStore()
const settingsStore = useSettingsStore()

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

// Initialize shortcuts
const { register } = useShortcuts({
  'new_chat': () => { chatStore.createSession() },
  'close_chat': () => {
    if (chatStore.currentSessionId) {
      chatStore.deleteSession(chatStore.currentSessionId)
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
    if (chatStore.currentSessionId) {
      chatStore.deleteSession(chatStore.currentSessionId)
      chatStore.createSession('New Chat')
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

onMounted(() => {
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
    chatStore.switchProject('')
  })

  // 初始化时如果有项目，添加到列表
  const initialProjectRoot = appStore.projectRoot
  if (initialProjectRoot) {
    chatStore.addProject(initialProjectRoot)
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
    getSessions: () => chatStore.sessions || [],
  }

  // 监听打开技能管理器事件
  window.addEventListener('open-skills-manager', handleOpenSkillsManager)

  // 监听打开 MCP 管理器事件
  window.addEventListener('open-mcp-manager', handleOpenMCPManager)
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
