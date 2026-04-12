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
            v-if="appStore.centerTabs.some(t => t.id === 'terminal')"
            v-show="appStore.activeCenterTab === 'terminal'"
            :auto-command="appStore.terminalAutoCommand"
            :env="appStore.terminalEnv"
            @ready="handleTerminalReady"
            @error="handleTerminalError"
            @exit="handleTerminalExit"
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

const appStore = useAppStore()
const chatStore = useChatStore()

const mainContent = ref<HTMLElement | null>(null)
const leftWidth = ref(260)
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
    // 加载该项目的聊天记录
    chatStore.loadProjectSessions(path)
  })

  api.onMenuCloseFolder(() => {
    appStore.closeProject()
    // 切换到默认聊天记录
    chatStore.loadProjectSessions('')
  })

  // 初始化时加载当前项目的聊天记录（如果有）
  const initialProjectRoot = appStore.projectRoot || ''
  chatStore.loadProjectSessions(initialProjectRoot)
})

function handleTerminalReady() {
  console.log('[App] Terminal ready')
}

function handleTerminalError(message: string) {
  console.error('[App] Terminal error:', message)
}

function handleTerminalExit(code: number) {
  console.log('[App] Terminal exited:', code)
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
  display: flex;
  flex: 1;
  overflow: hidden;
  height: calc(100vh - 36px);
  position: relative;
  z-index: 1;
}

.resize-handle {
  flex-shrink: 0;
  background: var(--border-subtle);
  transition: all var(--transition-fast);
  
  &.vertical {
    width: 2px;
    cursor: col-resize;
    
    &:hover,
    &.active {
      background: var(--accent-primary);
      box-shadow: 0 0 12px var(--accent-primary-glow);
    }
  }
  
  &.horizontal {
    height: 4px;
    cursor: row-resize;
    
    &:hover,
    &.active {
      background: var(--accent-primary);
    }
  }
}

.center-panel {
  flex: 1;
  min-width: 300px;
  overflow: hidden;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
}

.center-tabs {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 8px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  gap: 2px;
  flex-shrink: 0;
}

.center-tab {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  height: 28px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  transition: all var(--transition-fast);
  position: relative;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--surface-glass-active);
    color: var(--text-primary);

    &::after {
      content: '';
      position: absolute;
      bottom: -4px;
      left: 50%;
      transform: translateX(-50%);
      width: 16px;
      height: 2px;
      background: var(--accent-primary);
      border-radius: var(--radius-full);
    }
  }
}

.tab-close {
  @include reset-button;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  margin-left: 4px;
  opacity: 0;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--error-glow);
    color: var(--error);
  }

  .center-tab:hover & {
    opacity: 1;
  }
}

.center-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
