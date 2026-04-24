<template>
  <div class="app-container" :data-theme="appStore.theme">
    <TitleBar />
    <div class="main-content" ref="mainContent">
      <Sidebar
        :collapsed="appStore.sidebarCollapsed"
        :style="{ width: appStore.sidebarCollapsed ? '48px' : leftWidth + 'px' }"
      />
      <div
        class="resize-handle vertical"
        @mousedown="startResize($event, 'left')"
        :class="{ active: isResizing && resizeTarget === 'left' }"
        :style="{ display: appStore.sidebarCollapsed ? 'none' : 'block' }"
      ></div>
      <div class="center-panel">
        <div class="center-tabs" v-if="appStore.centerTabs.length > 1">
          <button
            v-for="tab in appStore.centerTabs"
            :key="tab.id"
            class="center-tab"
            :class="{ active: appStore.activeCenterTab === tab.id }"
            @click="appStore.activeCenterTab = tab.id"
          >
            <component :is="tab.icon" :size="14" />
            <span>{{ tab.label }}</span>
            <button
              v-if="tab.closable"
              class="tab-close"
              @click.stop="appStore.closeCenterTab(tab.id)"
            >
              <X :size="12" />
            </button>
          </button>
        </div>
        <div class="center-content">
          <ChatPanel v-show="appStore.activeCenterTab === 'chat'" />
          <TerminalPanel
            v-for="instance in appStore.terminalInstances"
            :key="instance.id"
            v-show="appStore.activeCenterTab === instance.id"
            :auto-command="instance.autoCommand"
            :env="instance.env"
            :cwd="instance.cwd"
            @ready="handleTerminalReady(instance.id)"
            @error="handleTerminalError(instance.id, $event)"
            @exit="handleTerminalExit(instance.id, $event)"
          />
        </div>
      </div>
      <div
        v-if="appStore.infoPanelVisible"
        class="resize-handle vertical"
        @mousedown="startResize($event, 'right')"
        :class="{ active: isResizing && resizeTarget === 'right' }"
      ></div>
      <InfoPanel
        v-if="appStore.infoPanelVisible"
        :mode="appStore.infoPanelMode"
        :style="{ width: rightWidth + 'px' }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import TitleBar from './components/layout/TitleBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import ChatPanel from './components/layout/ChatPanel.vue'
import InfoPanel from './components/layout/InfoPanel.vue'
import TerminalPanel from './components/terminal/TerminalPanel.vue'
import { api } from '@/services/electronAPI'
import { X } from 'lucide-vue-next'
import { useShortcuts } from '@/composables/useShortcuts'

const appStore = useAppStore()
const chatStore = useChatStore()

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
const leftWidth = ref(280)
const rightWidth = ref(400)

const minWidth = 150
const maxWidth = 600

const isResizing = ref(false)
const resizeTarget = ref<'left' | 'right' | null>(null)
let startX = 0
let startWidth = 0

function startResize(e: MouseEvent, target: 'left' | 'right') {
  isResizing.value = true
  resizeTarget.value = target
  startX = e.clientX
  startWidth = target === 'left' ? leftWidth.value : rightWidth.value

  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function handleResize(e: MouseEvent) {
  if (!isResizing.value) return

  const diff = e.clientX - startX

  if (resizeTarget.value === 'left') {
    const newWidth = startWidth + diff
    leftWidth.value = Math.min(Math.max(newWidth, minWidth), maxWidth)
  } else if (resizeTarget.value === 'right') {
    const newWidth = startWidth - diff
    rightWidth.value = Math.min(Math.max(newWidth, minWidth), maxWidth)
  }
}

function stopResize() {
  isResizing.value = false
  resizeTarget.value = null
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

onMounted(() => {
  document.documentElement.setAttribute('data-theme', appStore.theme)

  // 监听菜单事件
  api.onMenuOpenFolder((path: string) => {
    appStore.setProjectRoot(path)
    // 添加项目并切换到该项目
    chatStore.addProject(path)
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
  }

  // 监听打开技能管理器事件
  window.addEventListener('open-skills-manager', () => {
    appStore.showSkillsManager = true
  })
})

function handleTerminalReady(id: string) {
  console.log('[App] Terminal ready:', id)
}

function handleTerminalError(id: string, message: string) {
  console.error('[App] Terminal error:', id, message)
}

function handleTerminalExit(id: string, code: number) {
  console.log('[App] Terminal exited:', id, code)
  // Optionally auto-close the tab when terminal exits
  // appStore.closeCenterTab(id)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
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
}
</style>
