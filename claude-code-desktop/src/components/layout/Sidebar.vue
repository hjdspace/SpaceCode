<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="sidebar-icons">
      <button
        class="icon-btn"
        :class="{ active: activeTab === 'explorer' }"
        @click="handleTabClick('explorer')"
        title="Explorer"
      >
        <FolderTree :size="20" />
        <span class="icon-label">Explorer</span>
      </button>
      <button
        class="icon-btn"
        :class="{ active: activeTab === 'history' }"
        @click="handleTabClick('history')"
        title="History"
      >
        <Clock :size="20" />
        <span class="icon-label">History</span>
      </button>
      <button
        class="icon-btn"
        :class="{ active: activeTab === 'config' }"
        @click="handleTabClick('config')"
        title="Configuration"
      >
        <Boxes :size="20" />
        <span class="icon-label">Config</span>
      </button>
      <button
        class="icon-btn"
        :class="{ active: activeTab === 'terminal' }"
        @click="handleTerminalClick"
        title="Terminal"
      >
        <TerminalIcon :size="20" />
        <span class="icon-label">Terminal</span>
      </button>
      <div class="icon-spacer"></div>
      <button
        class="icon-btn settings-btn"
        @click="showSettings = true"
        title="Settings"
      >
        <Settings :size="20" />
        <span class="icon-label">Settings</span>
      </button>
    </div>

    <div class="sidebar-content" v-show="!collapsed">
      <div v-show="activeTab === 'explorer'" class="panel explorer-panel animate-fade-in">
        <div class="panel-header">
          <span class="panel-title">EXPLORER</span>
        </div>
        <FileTree @select="handleFileSelect" />
      </div>

      <div v-show="activeTab === 'history'" class="panel history-panel animate-fade-in">
        <div class="panel-header">
          <span class="panel-title">CHAT HISTORY</span>
          <button class="new-chat-btn" @click="chatStore.createSession()">
            <Plus :size="14" />
          </button>
        </div>
        <SessionList
          :sessions="chatStore.sessions"
          :active-id="chatStore.currentSessionId || undefined"
          @select="chatStore.selectSession"
          @delete="chatStore.deleteSession"
        />
      </div>

      <div v-show="activeTab === 'config'" class="panel config-panel animate-fade-in">
        <ConfigPanel />
      </div>

      <div v-show="activeTab === 'terminal'" class="panel terminal-panel-wrapper animate-fade-in">
        <div class="panel-header">
          <span class="panel-title">TERMINAL</span>
          <div class="terminal-actions">
            <button class="terminal-action-btn" @click="handleNewTerminal" title="New Terminal">
              <Plus :size="14" />
            </button>
          </div>
        </div>
        <div class="terminal-info">
          <div class="terminal-info-icon">
            <TerminalIcon :size="28" />
          </div>
          <h4>Integrated Terminal</h4>
          <p>Run commands and interact with Claude CLI directly in the terminal.</p>
          <button class="open-terminal-btn" @click="handleOpenTerminal">
            <Play :size="14" />
            Open Terminal
          </button>
          <button class="open-terminal-btn secondary" @click="handleOpenClaudeCLI">
            <TerminalIcon :size="14" />
            Start Claude CLI
          </button>
        </div>
      </div>
    </div>

    <SettingsPanel
      v-if="showSettings"
      @close="showSettings = false"
      @save="handleSettingsSave"
    />
  </aside>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { Plus, FolderTree, Clock, Settings, Boxes, Terminal as TerminalIcon, Play } from 'lucide-vue-next'
import SessionList from '../explorer/SessionList.vue'
import FileTree from '../explorer/FileTree.vue'
import SettingsPanel from '../settings/SettingsPanel.vue'
import ConfigPanel from './ConfigPanel.vue'
import { initLLMService } from '@/services/llm'
import { api } from '@/services/electronAPI'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
}

defineProps<{
  collapsed: boolean
}>()

const chatStore = useChatStore()
const appStore = useAppStore()
const settingsStore = useSettingsStore()

const activeTab = ref<'explorer' | 'history' | 'config' | 'terminal'>('explorer')
const showSettings = ref(false)

function handleTabClick(tab: 'explorer' | 'history' | 'config' | 'terminal') {
  if (activeTab.value === tab && !appStore.sidebarCollapsed) {
    // 如果点击的是当前已激活的标签且侧边栏未折叠，则折叠侧边栏
    appStore.toggleSidebar()
  } else {
    // 否则切换到该标签并确保侧边栏展开
    activeTab.value = tab
    if (appStore.sidebarCollapsed) {
      appStore.toggleSidebar()
    }
  }
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

  // Set CLAUDE_CODE_SIMPLE=1 to skip OAuth/preflight checks that connect to api.anthropic.com
  // Only skip for non-OAuth methods
  const isOAuth = settingsStore.authMethod === 'claudeai' || settingsStore.authMethod === 'console'
  if (!isOAuth) {
    env.CLAUDE_CODE_SIMPLE = '1'
  }

  // Inject GUI model names into ~/.claude/settings.json modelSettings,
  // so they appear in /model list for easy switching.
  // We do NOT set settings.model (handled in main.ts injectGuiModels).
  await api.injectGuiModelsToSettings({
    primaryModel: settingsStore.getPrimaryModel() || '',
    haikuModel: settingsStore.getHaikuModel(),
    sonnetModel: settingsStore.getSonnetModel(),
    opusModel: settingsStore.getOpusModel()
  })

  // Pass the user's chosen model via --model flag.
  // This sets mainLoopModelOverride in CLI (highest priority in getUserSpecifiedModelSetting),
  // but /model can still override it at runtime since onChangeAppState updates mainLoopModelOverride.
  let fullCommand = cliCommand || 'claude'
  const primaryModel = settingsStore.getPrimaryModel()
  if (primaryModel) {
    fullCommand += ` --model "${primaryModel}"`
  }

  appStore.openTerminalTab(fullCommand, env, appStore.projectRoot || undefined)
}

async function handleFileSelect(node: TreeNode) {
  if (node.type === 'file') {
    try {
      const content = await api.readFile(node.path)
      if (content !== null) {
        const language = appStore.getLanguageFromPath(node.path)
        const isMarkdown = language === 'markdown'
        
        appStore.setCurrentFile({
          path: node.path,
          name: node.name,
          content: content,
          language: language
        })
        appStore.showInfoPanel(isMarkdown ? 'markdown' : 'file')
      }
    } catch (error) {
      console.error('Failed to read file:', error)
    }
  }
}

function handleSettingsSave(_settings: any) {
  // Settings are already saved to store via updateFromSettingsPanel
  // Map AuthSettings to LLMConfig format and reinitialize LLM
  const config = settingsStore.config
  initLLMService({
    provider: config.provider,
    apiKey: config.apiKey || '',
    baseUrl: config.apiUrl,
    model: config.model
  })
}
</script>

<style lang="scss" scoped>
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

  &::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 1px;
    background: var(--surface-border);
  }

  &.collapsed {
    .sidebar-content {
      opacity: 0;
      pointer-events: none;
    }
  }
}

.sidebar-icons {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 52px;
  padding: 12px 6px;
  gap: 4px;
  border-right: 1px solid var(--surface-border);
  background: var(--surface-glass);

  .icon-spacer {
    flex: 1;
    min-height: 20px;
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
    }

    &:hover {
      color: var(--text-primary);
      background: var(--surface-glass-hover);
      transform: scale(1.05);
      
      .icon-label {
        opacity: 1;
        visibility: visible;
      }
    }

    &.active {
      color: var(--accent-primary);
      background: var(--surface-glass-active);
      box-shadow: inset 2px 0 0 var(--accent-primary);
      
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
  }
  
  .settings-btn {
    &:hover {
      color: var(--accent-secondary);
    }
  }
}

.sidebar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-glass);
  transition: opacity var(--transition-normal);
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--surface-border);

  .panel-title {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 1px;
    text-transform: uppercase;
  }
}

.new-chat-btn {
  @include reset-button;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-muted);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  transition: all var(--transition-fast);

  &:hover {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: white;
    transform: scale(1.05);
    box-shadow: 0 0 12px var(--accent-primary-glow);
  }
  
  &:active {
    transform: scale(0.95);
  }
}

.terminal-panel-wrapper {
  .panel-header {
    padding: 12px 16px 10px;
  }
}

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
</style>
