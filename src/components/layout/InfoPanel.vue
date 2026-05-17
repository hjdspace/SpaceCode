<template>
  <aside class="info-panel" :class="[mode]">
    <InfoPanelTabBar />

    <div class="panel-content">
      <DiffViewer v-if="mode === 'diff'" />
      <CodeViewer v-else-if="mode === 'file'" />
      <MarkdownViewer
        v-else-if="mode === 'markdown'"
        :content="appStore.currentFile?.content || ''"
        :file-name="appStore.currentFile?.name"
      />
      <ToolDiffViewer v-else-if="mode === 'tool-diff'" />

      <template v-else-if="mode === 'webview'">
        <div class="webview-nav">
          <button
            class="nav-btn"
            @click="handleGoBack"
            :disabled="!canGoBack"
            title="后退"
          >
            <ArrowLeft :size="14" />
          </button>
          <button
            class="nav-btn"
            @click="handleGoForward"
            :disabled="!canGoForward"
            title="前进"
          >
            <ArrowRight :size="14" />
          </button>
          <button
            class="nav-btn"
            @click="handleRefresh"
            title="刷新"
          >
            <RotateCw :size="14" />
          </button>

          <div class="url-bar">
            <input
              v-model="urlInput"
              @keyup.enter="handleNavigate"
              placeholder="输入网址..."
              class="url-input"
              type="text"
            />
          </div>

          <button
            class="nav-btn external-btn"
            @click="handleOpenInBrowser"
            title="在系统浏览器中打开"
          >
            <ExternalLink :size="14" />
          </button>
        </div>

        <div class="webview-body">
          <webview
            v-if="appStore.webviewUrl"
            :src="appStore.webviewUrl"
            ref="webviewRef"
            class="webview-container"
            allowpopups
            partition="persist:webview-session"
            @did-navigate="onDidNavigate"
            @did-navigate-in-page="onDidNavigateInPage"
            @page-title-updated="onTitleUpdate"
            @did-start-loading="onStartLoading"
            @did-stop-loading="onStopLoading"
            @did-fail-load="onDidFailLoad"
          />

          <div v-if="appStore.isLoading" class="loading-overlay">
            <Loader2 :size="24" class="spin-icon" />
            <span>正在加载...</span>
          </div>

          <div v-if="!appStore.webviewUrl" class="empty-webview">
            <p>点击聊天中的链接在此处查看网页</p>
          </div>
        </div>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { Loader2, ArrowLeft, ArrowRight, RotateCw, ExternalLink } from 'lucide-vue-next'
import InfoPanelTabBar from './InfoPanelTabBar.vue'
import DiffViewer from '../common/DiffViewer.vue'
import CodeViewer from '../common/CodeViewer.vue'
import MarkdownViewer from '../common/MarkdownViewer.vue'
import ToolDiffViewer from '../common/ToolDiffViewer.vue'

const appStore = useAppStore()
const { t } = useI18n()

const mode = computed(() => appStore.infoPanelMode)

const webviewRef = ref<any>(null)
const urlInput = ref('')

watch(() => appStore.webviewUrl, (newUrl) => {
  urlInput.value = newUrl
})

const canGoBack = computed(() => appStore.currentHistoryIndex > 0)
const canGoForward = computed(() =>
  appStore.currentHistoryIndex < appStore.webviewHistory.length - 1
)

function handleGoBack() {
  if (canGoBack.value) {
    appStore.goBackWebview()
    if (webviewRef.value) {
      webviewRef.value.loadURL(appStore.webviewUrl)
    }
  }
}

function handleGoForward() {
  if (canGoForward.value) {
    appStore.goForwardWebview()
    if (webviewRef.value) {
      webviewRef.value.loadURL(appStore.webviewUrl)
    }
  }
}

function handleRefresh() {
  if (webviewRef.value) {
    webviewRef.value.reload()
  }
}

function handleNavigate() {
  const url = urlInput.value.trim()
  if (!url) return

  try {
    let finalUrl = url
    if (!/^https?:\/\//.test(url)) {
      finalUrl = 'https://' + url
    }

    new URL(finalUrl)

    appStore.navigateWebview(finalUrl)
    if (webviewRef.value) {
      webviewRef.value.loadURL(finalUrl)
    }
  } catch (error) {
    console.error('Invalid URL:', error)
  }
}

function handleOpenInBrowser() {
  if (appStore.webviewUrl) {
    const electronAPI = (window as any).electronAPI
    if (electronAPI?.shellOpenExternal) {
      electronAPI.shellOpenExternal(appStore.webviewUrl)
    } else {
      window.open(appStore.webviewUrl, '_blank')
    }
  }
}

function onDidNavigate(event: any) {
  console.log('[InfoPanel] Webview navigated to:', event.url)
  appStore.setWebviewLoading(false)
}

function onDidNavigateInPage(event: any) {
  console.log('[InfoPanel] Webview in-page navigation:', event.url)
  appStore.setWebviewLoading(false)
}

function onTitleUpdate(_event: any, title: string) {
  if (title) {
    appStore.setWebviewTitle(title)
  }
}

function onStartLoading(_event: any) {
  console.log('[InfoPanel] Webview started loading')
  appStore.setWebviewLoading(true)
}

function onStopLoading(_event: any) {
  console.log('[InfoPanel] Webview stopped loading')
  appStore.setWebviewLoading(false)
}

function onDidFailLoad(event: any) {
  console.error('[InfoPanel] Webview failed to load:', event.errorCode, event.errorDescription)
  appStore.setWebviewLoading(false)
}
</script>

<style lang="scss" scoped>
.info-panel {
  width: 400px;
  min-width: 300px;
  max-width: 50vw;
  height: 100%;
  background: var(--surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-left: 1px solid var(--surface-border);
  display: flex;
  flex-direction: column;
  position: relative;
  animation: slideInRight var(--transition-normal) ease-out;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 1px;
    background: linear-gradient(180deg,
      transparent 0%,
      var(--accent-primary-glow) 30%,
      var(--accent-secondary-glow) 70%,
      transparent 100%
    );
    opacity: 0.4;
  }
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  @include scrollbar;
}

.webview-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;

  .nav-btn {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: none;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover:not(:disabled) {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }

    &:active:not(:disabled) {
      transform: scale(0.95);
    }

    &:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    &.external-btn {
      margin-left: auto;
      color: var(--accent-primary);

      &:hover {
        background: rgba(var(--accent-primary-rgb), 0.1);
      }
    }
  }

  .url-bar {
    flex: 1;
    position: relative;

    .url-input {
      width: 100%;
      height: 26px;
      padding: 0 10px;
      border-radius: var(--radius-sm);
      background: var(--bg-primary);
      border: 1px solid transparent;
      color: var(--text-primary);
      font-size: 12px;
      font-family: var(--font-mono);
      outline: none;
      transition: border-color 0.15s ease;

      &::placeholder {
        color: var(--text-muted);
        opacity: 0.6;
      }

      &:focus {
        border-color: var(--accent-primary);
        background: var(--bg-tertiary);
      }
    }
  }
}

.webview-body {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.webview-container {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: white;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(var(--bg-primary-rgb), 0.9);
  backdrop-filter: blur(4px);
  color: var(--text-muted);
  font-size: 13px;
  z-index: 10;

  .spin-icon {
    animation: spin 1s linear infinite;
    color: var(--accent-primary);
  }
}

.empty-webview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 20px;

  p {
    max-width: 200px;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
