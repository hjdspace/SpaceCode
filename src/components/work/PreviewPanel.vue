<template>
  <div class="office-preview-panel">
    <!-- Toolbar -->
    <div class="preview-toolbar">
      <div class="preview-file-info">
        <span class="file-icon">{{ fileIcon }}</span>
        <span class="file-name">{{ fileName }}</span>
      </div>
      <div class="preview-actions">
        <button
          v-for="m in availableModes"
          :key="m.id"
          class="preview-mode-btn"
          :class="{ active: currentMode === m.id }"
          @click="switchMode(m.id)"
        >
          {{ m.label }}
        </button>
        <button class="preview-action-btn" :title="t('officePreview.openExternal')" @click="openExternal">
          <ExternalLink :size="14" />
        </button>
        <button class="preview-action-btn" :title="t('officePreview.revealInFolder')" @click="revealInFolder">
          <FolderOpen :size="14" />
        </button>
      </div>
    </div>

    <!-- Preview content -->
    <div class="preview-content">
      <!-- HTML render mode -->
      <div v-if="currentMode === 'html'" class="html-viewer">
        <div v-if="loading" class="preview-loading">
          <Loader2 :size="20" class="spin-icon" />
          <span>{{ t('officePreview.rendering') }}</span>
        </div>
        <div v-else-if="errorMsg" class="preview-error">{{ errorMsg }}</div>
        <webview
          v-else-if="htmlPreviewUrl"
          ref="previewWebviewRef"
          :src="htmlPreviewUrl"
          class="preview-webview"
          partition="persist:office-preview"
          @did-finish-load="onWebviewLoad"
        />
      </div>

      <!-- Screenshot thumbnail mode -->
      <div v-else-if="currentMode === 'screenshots'" class="screenshot-viewer">
        <div v-if="loading" class="preview-loading">
          <Loader2 :size="20" class="spin-icon" />
          <span>{{ t('officePreview.generatingScreenshots') }}</span>
        </div>
        <div v-else-if="errorMsg" class="preview-error">{{ errorMsg }}</div>
        <div v-else-if="screenshotImages.length === 0" class="preview-empty">{{ t('officePreview.noScreenshots') }}</div>
        <div v-else class="screenshot-list">
          <div
            v-for="(dataUrl, index) in screenshotDataUrls"
            :key="index"
            class="screenshot-item"
            @click="openFullSize(screenshotImages[index])"
          >
            <img :src="dataUrl" :alt="`Page ${index + 1}`" />
            <span class="page-num">{{ index + 1 }}</span>
          </div>
        </div>
      </div>

      <!-- Watch live mode -->
      <div v-else-if="currentMode === 'watch'" class="watch-viewer">
        <div v-if="loading" class="preview-loading">
          <Loader2 :size="20" class="spin-icon" />
          <span>{{ t('officePreview.startingWatch') }}</span>
        </div>
        <div v-else-if="errorMsg" class="preview-error">{{ errorMsg }}</div>
        <webview
          v-else-if="watchUrl"
          ref="previewWebviewRef"
          :src="watchUrl"
          class="preview-webview"
          partition="persist:office-preview"
          @did-finish-load="onWebviewLoad"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, ExternalLink, FolderOpen } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'

const props = defineProps<{
  filePath: string
}>()

const { t } = useI18n()
const appStore = useAppStore()
const loading = ref(false)
const errorMsg = ref('')
const currentMode = ref<'html' | 'screenshots' | 'watch'>('html')
const htmlPreviewUrl = ref('')
const screenshotImages = ref<string[]>([])
/** 截图的 base64 data URL 列表（避免 file:// CORS 问题） */
const screenshotDataUrls = ref<string[]>([])
const watchUrl = ref('')
const watchId = ref('')
const previewWebviewRef = ref<any>(null)

/** artifacts:changed 事件取消订阅函数 */
let artifactsUnsubscribe: (() => void) | null = null
/** 防抖：文件变更后延迟重渲染 */
let rerenderDebounceTimer: ReturnType<typeof setTimeout> | null = null

/** 注入到 webview 中的 CSS，使内容铺满视口 */
const EXPAND_CSS = `
  html, body {
    margin: 0 !important;
    padding: 0 !important;
  }
  body {
    overflow: auto !important;
  }
`

const fileName = computed(() => {
  const parts = props.filePath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1]
})

const fileIcon = computed(() => {
  const ext = fileName.value.split('.').pop()?.toLowerCase()
  const icons: Record<string, string> = {
    pptx: '\u{1F4CA}',
    docx: '\u{1F4DD}',
    xlsx: '\u{1F4C8}',
    pdf: '\u{1F4C4}',
  }
  return icons[ext || ''] || '\u{1F4C4}'
})

const availableModes = computed(() => {
  const ext = fileName.value.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') {
    return [{ id: 'html' as const, label: t('officePreview.htmlMode') }]
  }
  return [
    { id: 'html' as const, label: t('officePreview.htmlMode') },
    { id: 'screenshots' as const, label: t('officePreview.screenshotsMode') },
    { id: 'watch' as const, label: t('officePreview.watchMode') },
  ]
})

async function renderHtml() {
  loading.value = true
  errorMsg.value = ''
  try {
    const htmlPath = await api.officecli.viewHtml(props.filePath)
    htmlPreviewUrl.value = pathToFileURL(htmlPath)
  } catch (err) {
    errorMsg.value = String(err)
    console.error('[OfficePreview] HTML render failed:', err)
  } finally {
    loading.value = false
  }
}

async function renderScreenshots() {
  loading.value = true
  errorMsg.value = ''
  try {
    const tmpDir = `${props.filePath}.screenshots`
    const images = await api.officecli.viewScreenshot(props.filePath, tmpDir)
    screenshotImages.value = images
    // Convert file paths to base64 data URLs to bypass file:// CORS in dev mode
    const dataUrls = await Promise.all(
      images.map(img => api.officecli.readImageAsDataURL(img))
    )
    screenshotDataUrls.value = dataUrls
  } catch (err) {
    errorMsg.value = String(err)
    console.error('[OfficePreview] Screenshot render failed:', err)
  } finally {
    loading.value = false
  }
}

async function startWatch() {
  loading.value = true
  errorMsg.value = ''
  try {
    const handle = await api.officecli.watchStart(props.filePath)
    watchId.value = handle.id
    watchUrl.value = handle.url
  } catch (err) {
    errorMsg.value = String(err)
    console.error('[OfficePreview] Watch start failed:', err)
  } finally {
    loading.value = false
  }
}

async function switchMode(mode: 'html' | 'screenshots' | 'watch') {
  // Stop previous watch
  if (watchId.value) {
    try {
      await api.officecli.watchStop(watchId.value)
    } catch { /* ignore */ }
    watchId.value = ''
    watchUrl.value = ''
  }
  currentMode.value = mode
  if (mode === 'html') await renderHtml()
  else if (mode === 'screenshots') await renderScreenshots()
  else if (mode === 'watch') await startWatch()
}

function getLocalImageUrl(imgPath: string): string {
  return pathToFileURL(imgPath)
}

/** Cross-platform file:// URL */
function pathToFileURL(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  return 'file://' + (normalized.startsWith('/') ? '' : '/') + normalized
}

function openFullSize(imgPath: string) {
  api.openInEditor('fileExplorer', imgPath)
}

function openExternal() {
  api.artifacts.open(props.filePath)
}

function revealInFolder() {
  api.artifacts.reveal(props.filePath)
}

function onWebviewLoad() {
  loading.value = false
  injectExpandCSS()
}

/** 向 webview 注入 CSS 使内容铺满面板 */
async function injectExpandCSS() {
  const wv = previewWebviewRef.value
  if (!wv?.insertCSS) return
  try {
    await wv.insertCSS(EXPAND_CSS)
  } catch (e) {
    console.warn('[OfficePreview] CSS injection failed:', e)
  }
}

/** artifacts:changed 回调：防抖后静默重渲染 HTML 预览 */
function onArtifactsChanged() {
  // 仅 HTML 模式需要手动刷新（watch 模式自带实时刷新）
  if (currentMode.value !== 'html') return
  if (!props.filePath) return
  if (rerenderDebounceTimer) clearTimeout(rerenderDebounceTimer)
  rerenderDebounceTimer = setTimeout(async () => {
    rerenderDebounceTimer = null
    if (currentMode.value !== 'html') return
    try {
      const htmlPath = await api.officecli.viewHtml(props.filePath)
      htmlPreviewUrl.value = pathToFileURL(htmlPath)
    } catch (err) {
      console.error('[OfficePreview] Re-render failed:', err)
    }
  }, 800)
}

watch(() => props.filePath, async (newPath) => {
  if (newPath) {
    await switchMode(currentMode.value)
  }
})

onMounted(async () => {
  const initialMode = appStore.officePreviewMode || 'html'
  await switchMode(initialMode)
  // 监听产物文件变更，实现实时刷新预览
  artifactsUnsubscribe = api.artifacts.onChanged(() => {
    onArtifactsChanged()
  })
})

onBeforeUnmount(async () => {
  if (watchId.value) {
    try {
      await api.officecli.watchStop(watchId.value)
    } catch { /* ignore */ }
  }
  if (artifactsUnsubscribe) {
    artifactsUnsubscribe()
    artifactsUnsubscribe = null
  }
  if (rerenderDebounceTimer) {
    clearTimeout(rerenderDebounceTimer)
    rerenderDebounceTimer = null
  }
})
</script>

<style lang="scss" scoped>
.office-preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-glass);
  flex-shrink: 0;
}

.preview-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  .file-icon { font-size: 18px; flex-shrink: 0; }
  .file-name {
    font-size: 13px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.preview-actions {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-shrink: 0;
}

.preview-mode-btn {
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }
}

.preview-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 14px;
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--accent-primary);
    background: var(--surface-glass-hover);
  }
}

.preview-content {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.html-viewer,
.watch-viewer,
.screenshot-viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;

  .spin-icon {
    animation: spin 1s linear infinite;
    color: var(--accent-primary);
  }
}

.preview-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 12px;
  padding: 20px;
  text-align: center;
  word-break: break-word;
}

.preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

.preview-webview {
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  border: none;
  background: white;
}

.screenshot-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.screenshot-item {
  position: relative;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.2s;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  img {
    width: 100%;
    height: auto;
    display: block;
  }

  .page-num {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
