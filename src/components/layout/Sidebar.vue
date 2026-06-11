<template>
  <aside class="sidebar" :class="{ collapsed: props.collapsed }" :data-collapsed="props.collapsed" aria-label="侧边栏导航">
    <!-- Icon Navigation Rail (CodePilot-style) -->
    <div class="sidebar-icons" :class="{ 'mac-icons': isMac }">
      <!-- New Chat Button (Top) -->
      <button
        class="icon-btn new-chat-icon"
        :disabled="creatingChat"
        @click="handleNewChat"
        :title="t('sidebar.newConversation')"
        aria-label="新建会话"
      >
        <Plus :size="20" />
        <span class="icon-label">{{ t('sidebar.new') }}</span>
      </button>

      <div class="icon-divider" aria-hidden="true"></div>

      <!-- History Tab -->
      <button
        class="icon-btn"
        :class="{ active: activeTab === 'history' }"
        @click="handleTabClick('history')"
        :title="t('sidebar.chatHistory')"
        aria-label="聊天记录"
      >
        <MessageSquare :size="20" />
        <span class="icon-label">{{ t('sidebar.chats') }}</span>
      </button>
      
      <!-- Explorer Tab -->
      <button
        class="icon-btn"
        :class="{ active: activeTab === 'explorer' }"
        @click="handleTabClick('explorer')"
        :title="t('sidebar.explorer')"
        aria-label="文件浏览器"
      >
        <FolderTree :size="20" />
        <span class="icon-label">{{ t('sidebar.explorer') }}</span>
      </button>

      <!-- Source Control Tab -->
      <button
        class="icon-btn"
        :class="{ active: activeTab === 'scm' }"
        @click="handleTabClick('scm')"
        :title="t('sidebar.sourceControl')"
        aria-label="源代码管理"
      >
        <GitBranch :size="20" />
        <span v-if="scmStore.totalChanges > 0" class="scm-badge" aria-hidden="true">
          {{ scmStore.totalChanges }}
        </span>
        <span class="icon-label">{{ t('sidebar.sourceControl') }}</span>
      </button>

      <!-- Terminal Tab -->
      <button
        class="icon-btn"
        :class="{ active: activeTab === 'terminal' }"
        @click="handleTerminalClick"
        :title="t('sidebar.terminal')"
        aria-label="终端"
      >
        <TerminalIcon :size="20" />
        <span class="icon-label">{{ t('sidebar.terminal') }}</span>
      </button>

      <!-- Debug/Trace Tab -->
      <button
        class="icon-btn"
        :class="{ active: appStore.showTraceViewer }"
        @click="toggleTraceViewer"
        :title="t('sidebar.debugTrace')"
        aria-label="调试追踪"
      >
        <Activity :size="20" />
        <span class="icon-label">{{ t('sidebar.debugTrace') }}</span>
      </button>

      <!-- Spacer to push settings to bottom -->
      <div class="icon-spacer" aria-hidden="true"></div>

      <!-- Settings Button -->
      <button
        class="icon-btn settings-btn"
        :class="{ active: appStore.showSettings }"
        @click="appStore.toggleSettings()"
        :title="t('sidebar.settings')"
        aria-label="设置"
      >
        <Settings :size="20" />
        <span class="icon-label">{{ t('sidebar.settings') }}</span>
      </button>
    </div>

    <!-- Content Panels -->
    <div class="sidebar-content" v-show="!collapsed">
      <!-- History Panel (CodePilot-style Chat List) -->
      <Transition name="fade" mode="out-in">
        <div v-show="activeTab === 'history'" key="history" class="panel history-panel">
          <!-- macOS Traffic Lights Spacing -->
          <div class="traffic-lights-spacer" :class="{ 'mac-spacer': isMac }"></div>

          <!-- Top Action Bar: New Conversation + Search -->
          <div class="chat-toolbar">
            <button
              class="new-chat-btn"
              :disabled="creatingChat"
              @click="handleNewChat"
              :title="t('sidebar.newConversation')"
            >
              <Plus :size="14" />
              <span>{{ t('sidebar.newConversation') }}</span>
            </button>
            <button
              class="search-btn"
              :title="t('sidebar.searchConversations')"
              aria-label="搜索会话"
              @click="handleOpenSearch"
            >
              <Search :size="14" />
            </button>
          </div>

          <!-- Feature Navigation (CodePilot-style) -->
          <div class="feature-nav">
            <button
              class="feature-nav-item"
              :class="{ active: appStore.showSkillsManager }"
              @click="handleOpenSkills"
            >
              <Zap :size="14" />
              <span>{{ t('sidebar.skills') }}</span>
            </button>
            <button
              class="feature-nav-item"
              :class="{ active: appStore.showAgentManager }"
              @click="handleOpenAgents"
            >
              <Cpu :size="14" />
              <span>{{ t('sidebar.agents') }}</span>
            </button>
            <button
              class="feature-nav-item"
              :class="{ active: appStore.showMCPManager }"
              @click="handleOpenMcp"
            >
              <Plug :size="14" />
              <span>MCP</span>
            </button>
            <button
              class="feature-nav-item"
              :class="{ active: appStore.showCronManager }"
              @click="handleOpenCron"
            >
              <Clock :size="14" />
              <span>{{ t('sidebar.cron') }}</span>
            </button>
          </div>

          <!-- Separator -->
          <div class="section-separator"></div>

          <!-- Section Title + Add Project Button -->
          <div class="section-header">
            <span class="section-title">{{ t('sidebar.threads') }}</span>
            <button
              class="add-folder-btn"
              :title="t('sidebar.addProject')"
              @click="handleOpenFolderPicker"
            >
              <FolderPlus :size="12" />
              <span>{{ t('sidebar.addProject') }}</span>
            </button>
          </div>

          <!-- Session List with Enhanced Features -->
          <div class="session-list-container">
            <SessionList
              :sessions="chatStore.sessions"
              :active-id="chatStore.currentSessionId || undefined"
              :active-streaming-sessions="streamingSessions"
              :pending-approval-sessions="pendingApprovalSessions"
              :projects="chatStore.allProjects"
              :current-project="chatStore.currentProjectRoot"
              :show-remove-button="true"
              :loading-session-id="switchingSession"
              @select="handleSelectSession"
              @delete="handleDeleteSession"
              @rename="handleRenameSession"
              @create-session-in-project="handleCreateSessionInProject"
              @remove-project="handleRemoveProject"
              @switch-project="chatStore.switchProject"
              @open-folder-picker="handleOpenFolderPicker"
              @split-screen="handleSplitScreen"
            />
          </div>
        </div>
      </Transition>

      <!-- Explorer Panel -->
      <Transition name="fade" mode="out-in">
        <div v-show="activeTab === 'explorer'" key="explorer" class="panel explorer-panel">
          <div class="traffic-lights-spacer" :class="{ 'mac-spacer': isMac }"></div>
          <div class="panel-header">
            <span class="panel-title">{{ t('sidebar.explorer') }}</span>
          </div>
          <FileTree
            @select="handleFileSelect"
            @add-to-chat="handleAddToChat"
            :working-directory="chatStore.workingDirectory"
            :highlight-path="highlightedFilePath"
          />
        </div>
      </Transition>

      <!-- SCM Panel -->
      <Transition name="fade" mode="out-in">
        <div v-show="activeTab === 'scm'" key="scm" class="panel scm-panel-wrapper">
          <div class="traffic-lights-spacer" :class="{ 'mac-spacer': isMac }"></div>
          <div class="panel-header">
            <span class="panel-title">{{ t('sidebar.sourceControl') }}</span>
            <div class="panel-actions" v-if="scmStore.branch">
              <span class="branch-badge">{{ scmStore.branch }}</span>
            </div>
          </div>
          <ScmPanel />
        </div>
      </Transition>

      <!-- Terminal Panel -->
      <Transition name="fade" mode="out-in">
        <div v-show="activeTab === 'terminal'" key="terminal" class="panel terminal-panel-wrapper">
          <div class="traffic-lights-spacer" :class="{ 'mac-spacer': isMac }"></div>
          <div class="panel-header">
            <span class="panel-title">{{ t('sidebar.terminal') }}</span>
            <div class="terminal-actions">
              <button
                class="terminal-action-btn"
                @click="handleNewTerminal"
                :title="t('sidebar.terminal')"
                aria-label="新建终端"
              >
                <Plus :size="14" />
              </button>
            </div>
          </div>
          <div class="terminal-info">
            <div class="terminal-info-icon">
              <TerminalIcon :size="28" />
            </div>
            <h4>{{ t('sidebar.integratedTerminal') }}</h4>
            <p>{{ t('sidebar.terminalDesc') }}</p>
            <button class="open-terminal-btn" @click="handleOpenTerminal">
              <Play :size="14" />
              {{ t('sidebar.openTerminal') }}
            </button>
            <button class="open-terminal-btn secondary" @click="handleOpenClaudeCLI">
              <TerminalIcon :size="14" />
              {{ t('sidebar.startClaudeCLI') }}
            </button>
            <button class="open-terminal-btn secondary" @click="handleOpenPiCLI">
              <TerminalIcon :size="14" />
              {{ t('sidebar.startPiCLI') }}
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Settings Panel (Modal) -->
    <!-- Settings now renders inline in the center panel via App.vue -->

    <!-- MCP Manager - 已迁移到 App.vue 全屏模式，不再使用弹窗 -->
    
  </aside>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useScmStore } from '@/stores/scm'
import {
  Plus,
  FolderTree,
  MessageSquare,
  Settings,
  Terminal as TerminalIcon,
  Play,
  GitBranch,
  Search,
  FolderPlus,
  Zap,
  Plug,
  Activity,
  History,
  Cpu,
  Clock
} from 'lucide-vue-next'

// Enhanced Components
import SessionList from '../explorer/SessionList.vue'
import FileTree from '../explorer/FileTree.vue'
import ScmPanel from '../scm/ScmPanel.vue'
import SkillsManager from '../skills/SkillsManager.vue'
// import McpManager from '../mcp/McpManagerModal.vue' // 已迁移到 App.vue 全屏模式
import { api } from '@/services/electronAPI'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { useFileToChat } from '@/composables/useFileToChat'
import { pathsEqual } from '@/utils/recentProjectRoots'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
}

const props = defineProps<{
  collapsed: boolean
}>()

const chatStore = useChatStore()
const appStore = useAppStore()
const settingsStore = useSettingsStore()
const scmStore = useScmStore()
const { t } = useI18n()
const { openProjectFromPicker } = useOpenProjectWorkflow()
const { addFileToFile } = useFileToChat()

const activeTab = ref<'explorer' | 'scm' | 'history' | 'terminal'>('history')
// const showMcpManager = ref(false) // 已迁移到 appStore.showMCPManager

// Platform detection for titlebar spacing
const platform = typeof window !== 'undefined' && window.electronAPI?.platform
  ? window.electronAPI.platform
  : (typeof navigator !== 'undefined' ? navigator.platform : '')
const isMac = platform === 'darwin' || /^Mac/i.test(platform)

// Enhanced state for CodePilot-like features
const creatingChat = ref(false)
const streamingSessions = ref<Set<string>>(new Set())
const pendingApprovalSessions = ref<Set<string>>(new Set())
const workspacePath = ref('')
const highlightedFilePath = ref<string>('')

function handleTabClick(tab: 'explorer' | 'scm' | 'history' | 'terminal') {
  // Close settings when switching to another sidebar tab
  if (appStore.showSettings) {
    appStore.showSettings = false
  }
  if (activeTab.value === tab && !appStore.sidebarCollapsed) {
    appStore.toggleSidebar()
  } else {
    activeTab.value = tab
    if (appStore.sidebarCollapsed) {
      appStore.toggleSidebar()
    }
  }
}

function toggleTraceViewer() {
  appStore.showTraceViewer = !appStore.showTraceViewer
}

function handleOpenSkills() {
  appStore.showSkillsManager = true
}

function handleOpenAgents() {
  appStore.showAgentManager = true
}

function handleOpenMcp() {
  appStore.showMCPManager = true  // 使用全局状态，平铺显示在 center-panel
}

function handleOpenCron() {
  appStore.showCronManager = true
}

function handleTerminalClick() {
  handleTabClick('terminal')
}

function handleNewTerminal() {
  appStore.openTerminalTab()
}

function handleOpenTerminal() {
  appStore.openTerminalTab()
}

async function handleOpenClaudeCLI() {
  const cliCommand = await api.getClaudeCliPath()
  const env = settingsStore.buildEnvVars()

  // Set CLAUDE_CODE_SIMPLE=1 to skip OAuth/preflight checks
  const isOAuth = settingsStore.authMethod === 'claudeai' || settingsStore.authMethod === 'console'
  if (!isOAuth) {
    env.CLAUDE_CODE_SIMPLE = '1'
  }

  // Inject GUI model names into settings.json
  await api.injectGuiModelsToSettings({
    primaryModel: settingsStore.getPrimaryModel() || '',
    haikuModel: settingsStore.getHaikuModel(),
    sonnetModel: settingsStore.getSonnetModel(),
    opusModel: settingsStore.getOpusModel(),
    effortLevel: settingsStore.effortLevel
  })

  let fullCommand = cliCommand || 'claude'
  const primaryModel = settingsStore.getPrimaryModel()
  if (primaryModel) {
    fullCommand += ` --model "${primaryModel}"`
  }

  appStore.openTerminalTab(fullCommand, env, appStore.projectRoot || undefined)
}

async function handleOpenPiCLI() {
  const cliCommand = await api.getPiCliPath()
  const env = settingsStore.buildEnvVars()

  let fullCommand = cliCommand || 'npx @mariozechner/pi-coding-agent'
  
  appStore.openTerminalTab(fullCommand, env, appStore.projectRoot || undefined)
}

function handleAddToChat(node: TreeNode) {
  addFileToFile(node)
  console.log('[Sidebar] Add to chat:', node.path)
}

async function handleFileSelect(node: TreeNode) {
  if (node.type === 'file') {
    try {
      const content = await api.readFile(node.path)
      if (content !== null) {
        const language = appStore.getLanguageFromPath(node.path)
        const isMarkdown = language === 'markdown'

        appStore.currentLine = 0
        appStore.currentEndLine = 0
        appStore.setCurrentFile({
          path: node.path,
          name: node.name,
          content: content,
          language: language
        })

        highlightedFilePath.value = node.path
      }
    } catch (error) {
      console.error('Failed to read file:', error)
    }
  }
}

// Enhanced Session Management (CodePilot-style)
async function handleNewChat() {
  creatingChat.value = true

  try {
    const workingDirectory = chatStore.currentProjectRoot || chatStore.currentSession?.workingDirectory

    if (chatStore.currentSessionId && chatStore.currentSession) {
      appStore.openSessionTab(chatStore.currentSessionId, chatStore.currentSession.title)
    }

    const session = chatStore.createSession(t('common.newChat'), workingDirectory)
    appStore.openSessionTab(session.id, session.title)

    window.dispatchEvent(new CustomEvent('session-created'))
  } catch (error) {
    console.error('Failed to create session:', error)
    alert('Failed to create new conversation. Please try again.')
  } finally {
    creatingChat.value = false
  }
}

// ========== 优化: 即时UI反馈 + 异步数据加载 ==========
const switchingSession = ref<string | null>(null)

async function handleSelectSession(sessionId: string) {
  // 如果已经在切换中，避免重复点击
  if (switchingSession.value === sessionId) return

  // 立即提供UI反馈：标记正在切换
  switchingSession.value = sessionId

  try {
    // 1. 立即切换UI状态（同步操作，<1ms）
    chatStore.selectSession(sessionId)
    appStore.switchToSessionTab(sessionId)

    // 2. 异步加载会话数据（后台操作，不阻塞UI）
    await nextTick()

    if (chatStore.workingDirectory && chatStore.workingDirectory !== appStore.projectRoot) {
      appStore.setProjectRoot(chatStore.workingDirectory)
      settingsStore.projectRoot = chatStore.workingDirectory
      settingsStore.saveSettings()
    }
  } finally {
    // 清除切换状态
    switchingSession.value = null
  }
}

async function handleDeleteSession(e: MouseEvent, sessionId: string) {
  e.preventDefault()
  e.stopPropagation()

  if (!confirm(t('sidebar.deleteConversation'))) return

  try {
    const tab = appStore.centerTabs.find(t => t.sessionId === sessionId)
    if (tab) appStore.closeSessionTab(tab.id)

    await chatStore.deleteSession(sessionId)
  } catch (error) {
    console.error('Failed to delete session:', error)
  }
}

async function handleRenameSession(sessionId: string, newTitle: string) {
  try {
    // Update session title in store
    const session = chatStore.sessions.find(s => s.id === sessionId)
    if (session) {
      session.title = newTitle
      // Sync tab label with session title
      appStore.updateSessionTabTitle(sessionId, newTitle)
      // Save to storage (method exists on chatStore)
      chatStore.saveToStorage()

      // Dispatch event for UI refresh
      window.dispatchEvent(new CustomEvent('session-updated'))
    }
  } catch (error) {
    console.error('Failed to rename session:', error)
  }
}

function handleCreateSessionInProject(e: MouseEvent, workingDirectory: string) {
  e.stopPropagation()

  try {
    chatStore.switchProject(workingDirectory)
    const session = chatStore.createSession(t('common.newChat'), workingDirectory)
    appStore.openSessionTab(session.id, session.title)
    window.dispatchEvent(new CustomEvent('session-created'))
  } catch (error) {
    console.error('Failed to create session in project:', error)
  }
}

async function handleRemoveProject(workingDirectory: string) {
  if (!confirm(t('sidebar.removeProject'))) return

  try {
    const sessionsToRemove = chatStore.sessions.filter(s => s.workingDirectory === workingDirectory)

    for (const session of sessionsToRemove) {
      await chatStore.deleteSession(session.id)
    }

    chatStore.removeProject(workingDirectory)

    const stillHasFolderSessions = chatStore.sessions.some(
      (s) => !!(s.workingDirectory && String(s.workingDirectory).trim())
    )
    if (!stillHasFolderSessions) {
      appStore.closeProject()
      chatStore.switchProject('')
    } else if (pathsEqual(appStore.projectRoot, workingDirectory)) {
      appStore.closeProject()
    }
  } catch (error) {
    console.error('Failed to remove project:', error)
    alert('Failed to remove project. Please try again.')
  }
}

async function handleOpenFolderPicker() {
  await openProjectFromPicker()
}

function handleOpenSearch() {
  // Could implement global search dialog here
  window.dispatchEvent(new CustomEvent('open-global-search'))
}

function handleSplitScreen(sessionId: string) {
  // TODO: Implement split screen functionality
  // For now, just show a toast notification
  console.log('[Split Screen] Session:', sessionId)
  // Could emit an event or call a store method to enable split screen mode
  window.dispatchEvent(new CustomEvent('split-screen-requested', { detail: { sessionId } }))
}

// Lifecycle
onMounted(() => {
  // Load workspace path if available
  workspacePath.value = appStore.projectRoot || ''

  // Listen for streaming status updates
  window.addEventListener('session-streaming-start', (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (detail?.sessionId) {
      streamingSessions.value.add(detail.sessionId)
    }
  })

  window.addEventListener('session-streaming-end', (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (detail?.sessionId) {
      streamingSessions.value.delete(detail.sessionId)
    }
  })

  // Listen for approval requests
  window.addEventListener('session-approval-required', (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (detail?.sessionId) {
      pendingApprovalSessions.value.add(detail.sessionId)
    }
  })

  window.addEventListener('session-approval-resolved', (e: Event) => {
    const detail = (e as CustomEvent).detail
    if (detail?.sessionId) {
      pendingApprovalSessions.value.delete(detail.sessionId)
    }
  })

  // Listen for open settings event
  window.addEventListener('open-settings', () => {
    appStore.showSettings = true
  })
})
</script>

<style lang="scss" scoped>
// Mixins
@mixin reset-button {
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
}

@mixin flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

@mixin scrollbar-thin {
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--surface-border);
    border-radius: 3px;

    &:hover {
      background: var(--text-muted);
    }
  }
}

// Sidebar Container (CodePilot-style)
.sidebar {
  display: flex;
  flex-direction: row;
  height: 100%;
  background: var(--surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-right: 1px solid var(--surface-border);
  transition: width var(--transition-normal);
  overflow: hidden;
  position: relative;
  z-index: 10;

  &.collapsed,
  &[data-collapsed="true"] {
    .sidebar-content {
      opacity: 0;
      pointer-events: none;
    }
  }
}

// Icon Navigation Rail (52px width like CodePilot)
.sidebar-icons {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 52px;
  padding: 12px 6px;
  gap: 4px;
  border-right: 1px solid var(--surface-border);
  background: var(--surface-glass);
  flex-shrink: 0;

  // macOS: extra top padding to avoid traffic lights overlap
  &.mac-icons {
    padding-top: 40px;
  }

  .icon-spacer {
    flex: 1;
    min-height: 20px;
  }

  .icon-divider {
    width: 24px;
    height: 1px;
    background: var(--surface-border);
    margin: 4px 0;
  }

  .icon-btn {
    @include reset-button;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    color: var(--text-muted);
    transition: all var(--transition-fast);
    position: relative;

    .icon-label {
      position: absolute;
      left: 100%;
      top: 50%;
      transform: translateY(-50%);
      margin-left: 8px;
      padding: 4px 8px;
      background: var(--bg-elevated);
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      opacity: 0;
      visibility: hidden;
      transition: all var(--transition-fast);
      box-shadow: var(--shadow-md);
      pointer-events: none;
      z-index: 100;
    }

    &:hover {
      color: var(--text-primary);
      background: var(--surface-glass-hover);

      .icon-label {
        opacity: 1;
        visibility: visible;
      }
    }

    &.active {
      color: var(--accent-primary);
      background: var(--surface-glass-active);

      &::before {
        content: '';
        position: absolute;
        left: -6px;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 16px;
        background: var(--accent-primary);
        border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
        box-shadow: 0 0 8px var(--accent-primary-glow);
      }
    }

    &:active {
      transform: scale(0.95);
    }

    &.new-chat-icon {
      color: var(--accent-primary);

      &:hover {
        background: rgba(var(--accent-primary-rgb), 0.1);
      }
    }
  }

  .settings-btn {
    &:hover {
      color: var(--accent-secondary);
    }
  }

  .scm-badge {
    position: absolute;
    top: 4px;
    right: 2px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: var(--radius-full);
    background: var(--accent-primary);
    color: white;
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }
}

// Content Panel (240-300px width like CodePilot)
.sidebar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-glass);
  transition: opacity var(--transition-normal);
  min-width: 300px;
  max-width: 380px;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

// macOS Traffic Lights Spacer — when titleBarStyle: hiddenInset is used,
// traffic light buttons overlap into the sidebar content area.
// A larger spacer is needed on macOS to prevent overlap.
.traffic-lights-spacer {
  height: 20px;
  flex-shrink: 0;

  &.mac-spacer {
    height: 36px;
  }
}

// Panel Header
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 10px;
  border-bottom: 1px solid var(--surface-border);

  .panel-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .branch-badge {
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-sm);
  }
}

// Enhanced History Panel Styles (CodePilot-style)
.history-panel {
  display: flex;
  flex-direction: column;

  .chat-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px 8px;
    flex-shrink: 0;
  }

  .new-chat-btn {
    @include reset-button;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);

    &:hover:not(:disabled) {
      background: var(--surface-glass-hover);
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .search-btn {
    @include reset-button;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);

    &:hover {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }
  }

  // Feature Navigation (CodePilot-style)
  .feature-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 12px 8px;
    flex-shrink: 0;

    .feature-nav-item {
      @include reset-button;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--text-muted);
      border-radius: var(--radius-md);
      transition: all var(--transition-fast);

      &:hover {
        background: var(--surface-glass-hover);
        color: var(--text-primary);
      }
    }
  }

  .section-separator {
    height: 1px;
    background: var(--surface-border);
    margin: 8px 12px;
    flex-shrink: 0;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px 6px;
    flex-shrink: 0;

    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      opacity: 0.7;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
  }

  .add-folder-btn {
    @include reset-button;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    font-size: 11px;
    color: var(--text-muted);
    opacity: 0.7;
    border-radius: var(--radius-sm);
    transition: all var(--transition-fast);

    &:hover {
      opacity: 1;
      color: var(--text-secondary);
      background: var(--surface-glass-hover);
    }
  }

  .session-list-container {
    flex: 1;
    overflow-y: auto;
    @include scrollbar-thin;
  }
}

// Terminal Panel
.terminal-panel-wrapper {
  .terminal-actions {
    display: flex;
    gap: 4px;
  }

  .terminal-action-btn {
    @include reset-button;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    transition: all var(--transition-fast);

    &:hover {
      background: var(--surface-glass-hover);
      color: var(--accent-primary);
    }
  }
}

.terminal-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;

  .terminal-info-icon {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-lg);
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    @include flex-center;
    color: var(--accent-primary);
    margin-bottom: 8px;
  }

  h4 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }

  p {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
    max-width: 200px;
  }
}

.open-terminal-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  background: var(--accent-primary);
  color: white;
  font-size: 12px;
  font-weight: 500;
  transition: all var(--transition-fast);
  margin-top: 4px;

  &:hover {
    background: var(--accent-primary-hover);
    transform: scale(1.02);
    box-shadow: 0 0 12px var(--accent-primary-glow);
  }

  &:active {
    transform: scale(0.98);
  }

  &.secondary {
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    color: var(--text-primary);

    &:hover {
      background: var(--surface-glass-hover);
      border-color: var(--accent-primary);
      box-shadow: none;
    }
  }
}

// Panel Transition Animation
.fade-enter-active,
.fade-leave-active {
  transition: all 0.15s ease-out;
}

.fade-enter-from {
  opacity: 0;
  transform: translateX(10px);
}

.fade-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
</style>
