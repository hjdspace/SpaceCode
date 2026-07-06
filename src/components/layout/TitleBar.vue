<template>
  <div class="titlebar" :class="{ 'is-mac': isMac, 'is-windows': isWindows, 'is-linux': isLinux }">
    <!-- macOS: left spacer for traffic lights -->
    <div v-if="isMac" class="titlebar-traffic-lights-spacer"></div>

    <!-- Left section -->
    <div class="titlebar-left" style="-webkit-app-region: no-drag">
      <button class="sidebar-toggle" @click="appStore.toggleSidebar" :title="t('titleBar.toggleSidebar')">
        <Menu :size="16" />
      </button>
      <div class="title-wrapper">
        <span class="title">SpaceCode</span>
        <span
          class="version-badge"
          :class="{ 'has-update': hasUpdate }"
          @click="handleVersionClick"
          :title="hasUpdate ? t('update.newVersionAvailable', { version: updateInfo?.version }) : `v${appVersion}`"
        >
          <span v-if="hasUpdate" class="update-dot"></span>
          v{{ appVersion }}
        </span>
      </div>

      <!-- Session title (when in a session) -->
      <template v-if="chatStore.currentSession?.title && chatStore.currentSession.title !== t('common.newChat')">
        <span class="title-separator">/</span>
        <span class="session-title">{{ chatStore.currentSession.title }}</span>
      </template>
    </div>

    <!-- Center: drag region spacer -->
    <div class="titlebar-center"></div>

    <!-- Right section -->
    <div class="titlebar-right" style="-webkit-app-region: no-drag">
      <!-- 打开项目下拉（默认 VSCode） -->
      <div class="open-file-dropdown" ref="openMenuRef">
        <button
          class="titlebar-btn open-file-trigger"
          :class="{ 'is-active': showOpenMenu }"
          @click="toggleOpenMenu"
          :title="t('titleBar.openFile')"
        >
          <VscodeIcon :size="18" />
          <ChevronDown :size="12" class="trigger-caret" />
        </button>
        <div v-if="showOpenMenu" class="open-file-menu">
          <button
            v-for="item in openTargets"
            :key="item.id"
            class="open-file-menu-item"
            @click="openWith(item.id)"
            :title="t('titleBar.openWith', { editor: t(item.labelKey) })"
          >
            <span class="menu-icon" v-html="item.icon"></span>
            <span class="menu-label">{{ t(item.labelKey) }}</span>
          </button>
        </div>
      </div>

      <!-- Connect mobile -->
      <button class="titlebar-btn" @click="appStore.showConnectMobile = true" :title="t('titleBar.connectMobile')">
        <Smartphone :size="15" />
      </button>

      <!-- Update button -->
      <button
        class="titlebar-btn update-btn"
        :class="{
          'has-update': hasUpdate,
          'is-checking': updateStatus === 'checking',
          'is-up-to-date': updateStatus === 'up-to-date',
          'is-error': updateStatus === 'error',
        }"
        @click="handleUpdateClick"
        :title="updateButtonTitle"
        :disabled="updateStatus === 'checking' || updateStatus === 'downloading'"
      >
        <RefreshCwIcon :size="15" class="update-icon" />
      </button>

      <!-- Split buttons (仅单 leaf 且可分屏时显示) -->
      <template v-if="showSplitButtons">
        <button
          class="titlebar-btn titlebar-split-btn"
          :title="t('splitLayout.splitRight', 'Open on the right')"
          @click="onTitleBarSplit('right')"
        >
          <Columns2 :size="15" />
        </button>
        <button
          class="titlebar-btn titlebar-split-btn"
          :title="t('splitLayout.splitBottom', 'Open below')"
          @click="onTitleBarSplit('bottom')"
        >
          <Rows2 :size="15" />
        </button>
      </template>

      <!-- Toggle bottom terminal dock -->
      <button
        class="titlebar-btn"
        :class="{ 'is-active': appStore.terminalDockVisible }"
        @click="appStore.toggleTerminalDock()"
        :title="t('titleBar.toggleTerminal')"
      >
        <PanelBottom :size="16" />
      </button>

      <!-- Toggle right panel -->
      <button
        class="titlebar-btn"
        :class="{ 'is-active': appStore.infoPanelVisible }"
        @click="appStore.toggleInfoPanel()"
        :title="t('titleBar.togglePanel')"
      >
        <PanelRight :size="16" />
      </button>

      <!-- Windows: spacer for system overlay controls (min/max/close ~138px) -->
      <div v-if="isWindows" class="windows-controls-spacer"></div>

      <!-- Linux: custom window controls (frameless window) -->
      <div v-if="isLinux" class="linux-window-controls">
        <button class="win-ctrl" @click="onMinimize" :title="t('titleBar.minimize')" :aria-label="t('titleBar.minimize')">
          <Minus :size="14" />
        </button>
        <button class="win-ctrl" @click="onToggleMaximize" :title="isMaximized ? t('titleBar.restore') : t('titleBar.maximize')" :aria-label="t('titleBar.maximize')">
          <Square v-if="!isMaximized" :size="12" />
          <Copy v-else :size="12" />
        </button>
        <button class="win-ctrl win-ctrl-close" @click="onClose" :title="t('titleBar.close')" :aria-label="t('titleBar.close')">
          <X :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useSplitLayoutStore } from '@/stores/splitLayout'
import { useI18n } from 'vue-i18n'
import { Menu, Minus, Square, Copy, X, ChevronDown, Smartphone, RefreshCw as RefreshCwIcon, PanelRight, PanelBottom, Columns2, Rows2 } from 'lucide-vue-next'
import { computed, h, onMounted, onBeforeUnmount, ref } from 'vue'
import { api, type ExternalEditor } from '@/services/electronAPI'
import { useAutoUpdate } from '@/composables/useAutoUpdate'
import { useDialog } from '@/composables/useDialog'

const appStore = useAppStore()
const chatStore = useChatStore()
const splitLayout = useSplitLayoutStore()
const { t } = useI18n()
const { showAlert } = useDialog()

const emit = defineEmits<{
  'openChangelog': []
}>()

// Auto update composable
const {
  status: updateStatus,
  updateInfo,
  appVersion,
  checkForUpdates,
  downloadUpdate,
  installAndRestart,
  dismiss: dismissUpdate,
} = useAutoUpdate()

const hasUpdate = computed(() => updateStatus.value === 'available' || updateStatus.value === 'downloaded')

const updateButtonTitle = computed(() => {
  switch (updateStatus.value) {
    case 'available': return t('update.newVersionAvailable', { version: updateInfo.value?.version })
    case 'downloading': return t('update.downloading', { version: updateInfo.value?.version })
    case 'downloaded': return t('update.readyToInstall', { version: updateInfo.value?.version })
    case 'checking': return t('update.checking')
    case 'up-to-date': return t('update.upToDate')
    case 'error': return t('update.checkFailed')
    default: return t('update.checkForUpdates')
  }
})

/** 单 leaf 模式下显示分屏按钮 */
const showSplitButtons = computed(() => splitLayout.isSingleLeaf && splitLayout.canSplit)

function onTitleBarSplit(position: 'right' | 'bottom') {
  const activePaneId = splitLayout.activePaneId
  if (!activePaneId) return
  const activeLeaf = splitLayout.activePane
  if (!activeLeaf) return

  // 如果当前 leaf 是 kind='main'，先转为具体绑定
  const c = activeLeaf.content
  let content: { kind: 'session' | 'terminal' | 'empty' | 'main'; tabId: string | null }
  if (c.kind === 'main') {
    const tabId = appStore.activeCenterTab
    if (tabId.startsWith('terminal-')) {
      content = { kind: 'terminal', tabId }
    } else {
      content = { kind: 'session', tabId }
    }
  } else {
    content = { ...c }
  }

  splitLayout.setPaneContent(activePaneId, content)
  splitLayout.splitPane(activePaneId, position, { ...content })
}

function handleVersionClick() {
  if (hasUpdate.value) {
    downloadUpdate()
  }
}

function handleUpdateClick() {
  if (updateStatus.value === 'checking' || updateStatus.value === 'downloading') {
    // 检查中或下载中，忽略重复点击
    return
  }
  if (updateStatus.value === 'downloaded') {
    installAndRestart()
  } else if (updateStatus.value === 'available') {
    downloadUpdate()
  } else {
    checkForUpdates()
  }
}

const platform = typeof window !== 'undefined' && window.electronAPI?.platform
  ? window.electronAPI.platform
  : (typeof navigator !== 'undefined' ? navigator.platform : '')

const isMac = platform === 'darwin' || /^Mac/i.test(platform)
const isWindows = platform === 'win32' || /^Win/i.test(platform)
const isLinux = platform === 'linux' || /Linux/i.test(platform)

// Window controls state (Linux frameless window)
const isMaximized = ref(false)
const winApi = typeof window !== 'undefined' ? window.electronAPI?.window : null
const showOpenMenu = ref(false)
const openMenuRef = ref<HTMLElement | null>(null)

const onMinimize = () => winApi?.minimize?.()
const onToggleMaximize = () => winApi?.toggleMaximize?.()
const onClose = () => winApi?.close?.()

function toggleOpenMenu() {
  showOpenMenu.value = !showOpenMenu.value
}

function closeOpenMenu() {
  showOpenMenu.value = false
}

// 品牌图标（内联 SVG，避免引入额外的图标包）
const VscodeIcon = () =>
  h(
    'svg',
    {
      width: 18,
      height: 18,
      viewBox: '0 0 24 24',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
    },
    [
      h('path', {
        d: 'M17.156 2.156a1.063 1.063 0 0 0-1.114.108l-4.585 3.207-4.99-3.205a1.062 1.062 0 0 0-1.55.246L3.146 5.95a1.063 1.063 0 0 0 .26 1.434L7.75 10.5l-4.344 3.115a1.062 1.062 0 0 0-.26 1.434l1.77 3.44a1.062 1.062 0 0 0 1.55.246l4.99-3.205 4.586 3.207a1.063 1.063 0 0 0 1.114.107l1.78-.776a1.062 1.062 0 0 0 .626-.961V3.893a1.062 1.062 0 0 0-.626-.96l-1.78-.777Z',
        fill: '#0078D4',
      }),
      h('path', {
        d: 'M12.314 9.75 8.345 12l3.97 2.25L17.062 12 12.314 9.75Z',
        fill: '#FFFFFF',
      }),
    ],
  )

interface OpenTarget {
  id: ExternalEditor
  labelKey: string
  icon: string
}

const openTargets: OpenTarget[] = [
  {
    id: 'vscode',
    labelKey: 'titleBar.openWithVSCode',
    icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.156 2.156a1.063 1.063 0 0 0-1.114.108l-4.585 3.207-4.99-3.205a1.062 1.062 0 0 0-1.55.246L3.146 5.95a1.063 1.063 0 0 0 .26 1.434L7.75 10.5l-4.344 3.115a1.062 1.062 0 0 0-.26 1.434l1.77 3.44a1.062 1.062 0 0 0 1.55.246l4.99-3.205 4.586 3.207a1.063 1.063 0 0 0 1.114.107l1.78-.776a1.062 1.062 0 0 0 .626-.961V3.893a1.062 1.062 0 0 0-.626-.96l-1.78-.777Z" fill="#0078D4"/>
      <path d="M12.314 9.75 8.345 12l3.97 2.25L17.062 12 12.314 9.75Z" fill="#FFFFFF"/>
    </svg>`,
  },
  {
    id: 'visualstudio',
    labelKey: 'titleBar.openWithVisualStudio',
    icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.696 3.546 21 1.5v21l-6.304-2.046V3.546Z" fill="#854CC7"/>
      <path d="M14.696 8.823 9.652 12l5.044 3.177V8.823Z" fill="#FFFFFF"/>
      <path d="m9.652 12-6.07 3.823V8.177L9.652 12Z" fill="#FFFFFF" fill-opacity=".9"/>
      <path d="M3.582 6.27v11.46L1.5 16.5v-9l2.082-1.23Z" fill="#FFFFFF" fill-opacity=".75"/>
    </svg>`,
  },
  {
    id: 'cursor',
    labelKey: 'titleBar.openWithCursor',
    icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#1F1F1F"/>
      <path d="M6 8.5 11 18l1.6-4.4L17 12 6 8.5Z" fill="#FFFFFF"/>
      <path d="M11 18l1.6-4.4L17 12 6 8.5 11 18Z" fill="#FFFFFF"/>
    </svg>`,
  },
  {
    id: 'fileExplorer',
    labelKey: 'titleBar.openWithFileExplorer',
    icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.379a1.5 1.5 0 0 1 1.06.44L11.5 7h8A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z" fill="#FFCB1F"/>
      <path d="M3 9h18v1H3z" fill="#E0A800" opacity=".5"/>
    </svg>`,
  },
  {
    id: 'terminal',
    labelKey: 'titleBar.openWithTerminal',
    icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="4" width="20" height="16" rx="2" fill="#1E1E1E"/>
      <rect x="2" y="4" width="20" height="4" rx="2" fill="#3C3C3C"/>
      <circle cx="5" cy="6" r="0.8" fill="#FF5F56"/>
      <circle cx="7.5" cy="6" r="0.8" fill="#FFBD2E"/>
      <circle cx="10" cy="6" r="0.8" fill="#27C93F"/>
      <path d="m5.5 11 3 2-3 2" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M10.5 16h6" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'gitBash',
    labelKey: 'titleBar.openWithGitBash',
    icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#F1502F"/>
      <path d="M17.5 8.7c-.6-.4-1.3-.5-2-.5-.7 0-1.4.2-2 .5-.4.2-.7.6-.7 1.1 0 .7.5 1 1.4 1.2l1.1.3c.9.3 1.6.7 1.6 1.6 0 .9-.7 1.6-2.1 1.6-.9 0-1.7-.3-2.2-.6l.4-1c.5.3 1.1.5 1.8.5.8 0 1.4-.3 1.4-1 0-.6-.4-.9-1.3-1.1l-1.1-.3c-1-.3-1.7-.8-1.7-1.7 0-1.1 1-1.8 2.1-1.8.8 0 1.5.2 2 .5l-.7 1.7Z" fill="#FFFFFF"/>
      <path d="M9 14.5c0 .6-.4 1-1 1s-1-.4-1-1V8h2v6.5Z" fill="#FFFFFF"/>
    </svg>`,
  },
  {
    id: 'wsl',
    labelKey: 'titleBar.openWithWsl',
    icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="#26A65B"/>
      <ellipse cx="12" cy="14" rx="5.5" ry="5" fill="#FFFFFF"/>
      <circle cx="9.5" cy="11" r="0.9" fill="#1F1F1F"/>
      <circle cx="14.5" cy="11" r="0.9" fill="#1F1F1F"/>
      <path d="M10.5 14.2c.4.4 1 .7 1.5.7s1.1-.3 1.5-.7" stroke="#F5A623" stroke-width="1" stroke-linecap="round" fill="none"/>
      <path d="M7 8.5 9 7M17 8.5 15 7" stroke="#F5A623" stroke-width="1" stroke-linecap="round"/>
    </svg>`,
  },
  {
    id: 'androidStudio',
    labelKey: 'titleBar.openWithAndroidStudio',
    icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="#3DDC84"/>
      <path d="M5 16.5c.6-2 1.8-3.4 3-3.4h8c1.2 0 2.4 1.4 3 3.4" fill="#FFFFFF"/>
      <circle cx="9" cy="10" r="0.9" fill="#1F1F1F"/>
      <circle cx="15" cy="10" r="0.9" fill="#1F1F1F"/>
      <path d="M7.5 5l2.5 3.5M16.5 5 14 8.5" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,
  },
]

async function openWith(editor: ExternalEditor) {
  closeOpenMenu()
  const projectRoot = (appStore.projectRoot || '').trim()
  if (!projectRoot) {
    await showAlert(t('titleBar.noProjectOpen'))
    return
  }
  try {
    const result = await api.openInEditor(editor, projectRoot)
    if (!result.success) {
      await showAlert(t('titleBar.openFailed', { error: result.error || t('titleBar.openFailedHint') }))
    }
  } catch (err) {
    console.error('[TitleBar] Open in editor error:', err)
    await showAlert(t('titleBar.openFailedHint'))
  }
}

function handleDocumentClick(event: MouseEvent) {
  if (!showOpenMenu.value) return
  if (openMenuRef.value?.contains(event.target as Node)) return
  closeOpenMenu()
}

let removeMaxListener: (() => void) | null = null

onMounted(async () => {
  document.addEventListener('click', handleDocumentClick)
  if (!isLinux || !winApi) return
  try {
    isMaximized.value = await winApi.isMaximized()
  } catch { /* ignore */ }
  if (typeof winApi.onMaximizeChanged === 'function') {
    removeMaxListener = winApi.onMaximizeChanged((maximized: boolean) => {
      isMaximized.value = maximized
    })
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  removeMaxListener?.()
})
</script>

<style lang="scss" scoped>
.titlebar {
  height: 44px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--surface-border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  -webkit-app-region: drag;
  position: relative;
  z-index: 100;
  user-select: none;
  flex-shrink: 0;

  // macOS: shift content right to avoid traffic lights
  &.is-mac {
    padding-left: 78px; // Space for close/minimize/maximize buttons
  }

  // Windows: add right padding for overlay controls
  &.is-windows {
    padding-right: 0; // Overlay controls handle their own padding
  }
}

// macOS traffic lights area spacer (when not using hiddenInset padding)
.titlebar-traffic-lights-spacer {
  display: none; // hiddenInset handles spacing automatically
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  .sidebar-toggle {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }

    &:active {
      background: var(--surface-active);
    }

    &:focus-visible {
      outline: 2px solid var(--accent-primary);
      outline-offset: 2px;
    }
  }

  .title-wrapper {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .title {
    font-family: var(--font-display);
    font-size: calc(var(--font-size-base) + 1px);
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .version-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    background: var(--surface-border);
    color: var(--text-muted);
    transition: all var(--transition-fast);
    cursor: pointer;
    white-space: nowrap;
    line-height: 20px;

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }

    &.has-update {
      background: var(--accent-primary-glow);
      color: var(--accent-primary);
      cursor: pointer;

      &:hover {
        background: var(--accent-primary);
        color: #fff;
      }
    }
  }

  .update-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
    animation: pulse-dot 2s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.8); }
  }

  .title-separator {
    color: var(--text-muted);
    font-size: 12px;
    opacity: 0.5;
    flex-shrink: 0;
  }

  .session-title {
    font-size: 13px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
}

.titlebar-center {
  flex: 1;
  min-width: 20px;
}

.titlebar-right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.titlebar-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);

  &:hover {
    background: var(--surface-hover);
    color: var(--accent-secondary);
  }

  &:active {
    background: var(--surface-active);
  }

  &.is-active {
    background: var(--surface-active);
    color: var(--accent-secondary);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  &.update-btn {
    position: relative;
    color: var(--text-muted);

    .update-icon {
      transition: transform 0.2s ease;
    }

    &.is-checking {
      .update-icon {
        animation: spin 1s linear infinite;
      }
      color: var(--accent-secondary);
    }

    &.is-up-to-date {
      color: var(--color-success, #22c55e);
    }

    &.is-error {
      color: var(--color-error, #ef4444);
    }

    &.has-update {
      color: var(--accent-primary);

      &::after {
        content: '';
        position: absolute;
        top: 6px;
        right: 6px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--accent-primary);
        border: 2px solid var(--bg-primary);
        animation: pulse-dot 2s ease-in-out infinite;
      }

      &:hover {
        background: var(--accent-primary-glow);
        color: var(--accent-primary);
      }
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.7;
    }
  }

  &.titlebar-split-btn {
    color: var(--accent-primary);

    &:hover {
      background: var(--accent-primary-glow);
      color: var(--accent-primary);
    }
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.open-file-dropdown {
  position: relative;

  .open-file-trigger {
    width: auto;
    padding: 0 6px 0 7px;
    gap: 3px;
    color: var(--text-secondary);

    .trigger-caret {
      opacity: 0.7;
      transition: transform var(--transition-fast), opacity var(--transition-fast);
    }

    &.is-active,
    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);

      .trigger-caret {
        transform: rotate(180deg);
        opacity: 1;
      }
    }
  }
}

.open-file-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 220px;
  padding: 6px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  animation: menuFadeIn 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes menuFadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.open-file-menu-item {
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
  display: flex;
  align-items: center;
  gap: 10px;

  .menu-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform var(--transition-fast);

    :deep(svg) {
      width: 100%;
      height: 100%;
    }
  }

  .menu-label {
    line-height: 1;
  }

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);

    .menu-icon {
      transform: scale(1.05);
    }
  }

  &:active {
    background: var(--surface-active);
  }
}

// Windows: spacer for system overlay window controls (min/max/close)
.windows-controls-spacer {
  width: 138px;
  flex-shrink: 0;
}

// Linux: custom window controls (frameless window)
.linux-window-controls {
  display: flex;
  align-items: center;
  margin-left: 8px;
  // Ensure the controls themselves stay clickable even though the
  // parent titlebar is a drag region.
  -webkit-app-region: no-drag;

  .win-ctrl {
    width: 36px;
    height: 32px;
    border-radius: var(--radius-md);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }

    &:active {
      background: var(--surface-active);
    }

    &:focus-visible {
      outline: 2px solid var(--accent-primary);
      outline-offset: 2px;
    }
  }

  .win-ctrl-close:hover {
    background: #e81123;
    color: #fff;
  }
}
</style>
