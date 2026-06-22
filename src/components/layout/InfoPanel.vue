<template>
  <aside class="info-panel" :class="[mode]">
    <InfoPanelTabBar />

    <div class="panel-content">
      <PanelLauncher v-if="showLauncher" />
      <template v-else>
      <DiffViewer v-if="mode === 'diff'" />
      <CodeViewer v-else-if="mode === 'file'" />
      <MarkdownViewer
        v-else-if="mode === 'markdown'"
        :content="appStore.currentFile?.content || ''"
        :file-name="appStore.currentFile?.name"
      />
      <ToolDiffViewer v-else-if="mode === 'tool-diff'" />

      <ArtifactsPanel v-else-if="mode === 'artifacts'" />

      <TerminalPanel v-else-if="mode === 'terminal'" />

      <template v-else-if="mode === 'webview'">
        <div class="webview-nav">
          <button
            class="nav-btn"
            @click="handleGoBack"
            :disabled="!canGoBack"
            :title="t('infoPanel.back')"
          >
            <ArrowLeft :size="14" />
          </button>
          <button
            class="nav-btn"
            @click="handleGoForward"
            :disabled="!canGoForward"
            :title="t('infoPanel.forward')"
          >
            <ArrowRight :size="14" />
          </button>
          <button
            class="nav-btn"
            @click="handleRefresh"
            :title="t('infoPanel.refresh')"
          >
            <RotateCw :size="14" />
          </button>

          <div class="url-bar">
            <input
              v-model="urlInput"
              @keyup.enter="handleNavigate"
              :placeholder="t('infoPanel.urlPlaceholder')"
              class="url-input"
              type="text"
            />
          </div>

          <button
            class="nav-btn external-btn"
            @click="handleOpenInBrowser"
            :title="t('infoPanel.openInBrowser')"
          >
            <ExternalLink :size="14" />
          </button>
        </div>

        <div class="webview-tools">
          <button
            class="tool-btn"
            :class="{ active: selectMode }"
            @click="toggleSelectMode"
            :title="selectMode ? t('workbench.exitSelect') : t('workbench.selectElement')"
          >
            <MousePointerSquareDashed :size="14" />
            <span>{{ selectMode ? t('workbench.exitSelect') : t('workbench.selectElement') }}</span>
          </button>
          <button class="tool-btn" @click="captureViewport" :title="t('workbench.screenshot')">
            <Camera :size="14" />
            <span>{{ t('workbench.screenshot') }}</span>
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
            @console-message="onConsoleMessage"
          />

          <div v-if="appStore.isLoading" class="loading-overlay">
            <Loader2 :size="24" class="spin-icon" />
            <span>{{ t('infoPanel.loading') }}</span>
          </div>

          <div v-if="!appStore.webviewUrl" class="empty-webview">
            <p>{{ t('infoPanel.clickLinkHint') }}</p>
          </div>

          <!-- 选中元素后的评论浮条 -->
          <div v-if="selection" class="comment-bar" :style="commentBarStyle">
            <div class="comment-meta">
              <span class="meta-tag">&lt;{{ selection.tagName }}{{ selection.idClass }}&gt;</span>
              <span class="meta-dim">{{ selection.rect.width }}×{{ selection.rect.height }}</span>
              <div class="meta-nav">
                <button class="nav-mini" @click="moveSelection('up')" :title="t('infoPanel.selectParent')">
                  <ChevronUp :size="14" />
                </button>
                <button class="nav-mini" @click="moveSelection('down')" :title="t('infoPanel.selectChild')">
                  <ChevronDown :size="14" />
                </button>
              </div>
            </div>
            <div class="comment-row">
              <input
                v-model="commentText"
                class="comment-input"
                :placeholder="t('workbench.addComment')"
                @keyup.enter="sendSelection"
              />
              <button class="comment-send" @click="sendSelection" :title="t('workbench.sendToChat')">
                <ArrowUp :size="16" />
              </button>
            </div>
          </div>
        </div>
      </template>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { Loader2, ArrowLeft, ArrowRight, RotateCw, ExternalLink, Camera, MousePointerSquareDashed, ArrowUp, ChevronUp, ChevronDown } from 'lucide-vue-next'
import InfoPanelTabBar from './InfoPanelTabBar.vue'
import PanelLauncher from './PanelLauncher.vue'
import ArtifactsPanel from '../work/ArtifactsPanel.vue'
import TerminalPanel from '../terminal/TerminalPanel.vue'
import DiffViewer from '../common/DiffViewer.vue'
import CodeViewer from '../common/CodeViewer.vue'
import MarkdownViewer from '../common/MarkdownViewer.vue'
import ToolDiffViewer from '../common/ToolDiffViewer.vue'
import {
  INSPECTOR_SCRIPT,
  INSPECTOR_SELECT_PREFIX,
  INSPECTOR_CLEAR_PREFIX,
  buildSelectionMessage,
  type InspectorSelection,
} from '@/utils/webviewInspector'

const appStore = useAppStore()
const { t } = useI18n()

const mode = computed(() => appStore.infoPanelMode)
const showLauncher = computed(() => appStore.panelHome || appStore.infoPanelTabs.length === 0)

const webviewRef = ref<any>(null)
const urlInput = ref('')

// 元素框选状态
const selectMode = ref(false)
const selection = ref<InspectorSelection | null>(null)
const commentText = ref('')

const commentBarStyle = computed(() => {
  if (!selection.value) return {}
  const r = selection.value.rect
  const wvH = webviewRef.value?.clientHeight || 400
  const barH = 80
  const gap = 8
  const top = r.y + r.height + barH + gap < wvH
    ? r.y + r.height + gap
    : Math.max(gap, r.y - barH - gap)
  return { top: `${top}px`, bottom: 'auto' }
})

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

// ===== 截图 + 元素框选 =====

async function nativeImageToAttachment(rect?: { x: number; y: number; width: number; height: number }) {
  const wv = webviewRef.value
  if (!wv?.capturePage) return null
  const image = rect ? await wv.capturePage(rect) : await wv.capturePage()
  if (!image || image.isEmpty?.()) return null
  const dataUrl = image.toDataURL()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return {
    id: crypto.randomUUID(),
    name: `screenshot-${stamp}.png`,
    type: 'image' as const,
    mimeType: 'image/png',
    previewUrl: dataUrl,
    data: dataUrl,
  }
}

async function captureViewport() {
  const image = await nativeImageToAttachment()
  if (image) appStore.pushToInput({ image })
}

function toggleSelectMode() {
  const wv = webviewRef.value
  if (!wv?.executeJavaScript) return
  selectMode.value = !selectMode.value
  if (selectMode.value) {
    wv.executeJavaScript(INSPECTOR_SCRIPT).catch((e: any) => console.error('[InfoPanel] inject inspector failed', e))
  } else {
    wv.executeJavaScript('window.__SPACECODE_INSPECTOR__ && window.__SPACECODE_INSPECTOR__.disable()').catch(() => {})
    selection.value = null
  }
}

function moveSelection(dir: 'up' | 'down') {
  webviewRef.value?.executeJavaScript(
    `window.__SPACECODE_INSPECTOR__ && window.__SPACECODE_INSPECTOR__.moveSelection(${JSON.stringify(dir)})`
  ).catch(() => {})
}

function onConsoleMessage(event: any) {
  const msg: string = event?.message || ''
  if (msg.startsWith(INSPECTOR_SELECT_PREFIX)) {
    try {
      selection.value = JSON.parse(msg.slice(INSPECTOR_SELECT_PREFIX.length))
    } catch { /* ignore malformed */ }
  } else if (msg.startsWith(INSPECTOR_CLEAR_PREFIX)) {
    selection.value = null
  }
}

async function sendSelection() {
  const sel = selection.value
  if (!sel) return
  // 按选中元素的 boundingRect 裁剪区域截图
  const r = sel.rect
  const rect = r.width > 0 && r.height > 0
    ? { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.round(r.width), height: Math.round(r.height) }
    : undefined
  const image = await nativeImageToAttachment(rect)
  appStore.pushToInput({
    text: buildSelectionMessage(sel, commentText.value),
    image: image || undefined,
  })
  // 收尾: 关闭框选, 清空
  commentText.value = ''
  selection.value = null
  selectMode.value = false
  webviewRef.value?.executeJavaScript('window.__SPACECODE_INSPECTOR__ && window.__SPACECODE_INSPECTOR__.disable()').catch(() => {})
}

// 切换页面 / 关闭 webview 时重置框选状态
watch(() => appStore.webviewUrl, () => {
  selectMode.value = false
  selection.value = null
  commentText.value = ''
})

</script>

<style lang="scss" scoped>
.info-panel {
  width: 400px;
  min-width: 300px;
  max-width: 90vw;
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

.webview-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;

  .tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid var(--surface-border);
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }

    &.active {
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.12);
      border-color: var(--accent-primary);
      color: var(--accent-primary);
    }
  }
}

.comment-bar {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 20;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  border: 1px solid var(--accent-primary);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);

  .comment-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 11px;

    .meta-tag {
      font-family: var(--font-mono);
      color: var(--accent-primary);
    }

    .meta-dim {
      color: var(--text-muted);
    }

    .meta-nav {
      margin-left: auto;
      display: flex;
      gap: 4px;
    }

    .nav-mini {
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm);
      border: 1px solid var(--surface-border);
      background: var(--bg-primary);
      color: var(--text-secondary);
      cursor: pointer;

      &:hover {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
      }
    }
  }

  .comment-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .comment-input {
    flex: 1;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--radius-full);
    border: 1px solid var(--surface-border);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    outline: none;

    &:focus {
      border-color: var(--accent-primary);
    }
  }

  .comment-send {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border: none;
    border-radius: 50%;
    background: var(--accent-primary);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;

    &:hover {
      filter: brightness(1.08);
    }
  }
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
